/**
 * 可组合的上下文过滤器链
 *
 * 灵感来自 SWE-agent 的 HistoryProcessor 系统。
 * 每个过滤器对消息数组进行一次变换，过滤器可任意组合和排序。
 */
import Anthropic from "@anthropic-ai/sdk";

export interface MessageFilter {
  /** 过滤器名称（用于日志） */
  name: string;
  /** 对消息数组进行变换 */
  filter(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[];
}

/**
 * 保留最近 N 条消息，中间用省略标记替代
 */
export class LastNFilter implements MessageFilter {
  name = "last_n";

  constructor(
    private n: number,
    private preserveSystem = true,
  ) {}

  filter(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    if (messages.length <= this.n) return messages;

    let systemMessages: Anthropic.MessageParam[] = [];
    let conversationMessages = messages;

    if (this.preserveSystem) {
      const firstNonSystem = messages.findIndex((m) => (m as any).role !== "system");
      if (firstNonSystem > 0) {
        systemMessages = messages.slice(0, firstNonSystem);
        conversationMessages = messages.slice(firstNonSystem);
      }
    }

    const tail = conversationMessages.slice(-this.n);
    const omitted = conversationMessages.length - this.n;

    return [
      ...systemMessages,
      { role: "user", content: `[已省略 ${omitted} 条历史消息]` },
      { role: "assistant", content: "已记录。" } as any,
      ...tail,
    ];
  }
}

/**
 * 确保消息角色交替（避免连续相同角色）
 */
export class RoleAlternationFilter implements MessageFilter {
  name = "role_alternation";

  filter(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    if (messages.length === 0) return messages;

    const result: Anthropic.MessageParam[] = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
      const prev = result[result.length - 1];
      const curr = messages[i];

      if (prev.role === curr.role) {
        // 插入对侧空消息打破连续
        const fillerRole = curr.role === "user" ? "assistant" : "user";
        result.push({ role: fillerRole, content: "好的。" } as any);
      }
      result.push(curr);
    }

    return result;
  }
}

/**
 * 截断超长工具结果
 */
export class TruncateResultsFilter implements MessageFilter {
  name = "truncate_results";

  constructor(private maxChars = 50_000) {}

  filter(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    return messages.map((msg) => {
      if (typeof msg.content === "string") return msg;
      if (!Array.isArray(msg.content)) return msg;

      const truncated = msg.content.map((block) => {
        if (block.type !== "tool_result") return block;
        if (typeof block.content !== "string") return block;
        if (block.content.length <= this.maxChars) return block;
        return {
          ...block,
          content:
            block.content.slice(0, this.maxChars) +
            `\n\n[已截断，原始长度 ${block.content.length} 字符]`,
        };
      });

      return { ...msg, content: truncated };
    });
  }
}

/**
 * 移除空工具结果
 */
export class RemoveEmptyResultsFilter implements MessageFilter {
  name = "remove_empty_results";

  filter(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;

      const filtered = msg.content.filter((block) => {
        if (block.type !== "tool_result") return true;
        if (typeof block.content === "string" && block.content.trim() === "")
          return false;
        return true;
      });

      return { ...msg, content: filtered.length > 0 ? filtered : "(空结果)" };
    });
  }
}

/**
 * 过滤器管道：按顺序执行多个过滤器
 */
export class FilterPipeline {
  private filters: MessageFilter[] = [];

  add(filter: MessageFilter): this {
    this.filters.push(filter);
    return this;
  }

  addAll(filters: MessageFilter[]): this {
    this.filters.push(...filters);
    return this;
  }

  apply(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    let result = messages;
    for (const filter of this.filters) {
      result = filter.filter(result);
    }
    return result;
  }

  get names(): string[] {
    return this.filters.map((f) => f.name);
  }
}

/**
 * 创建默认过滤器管道
 */
export function createDefaultFilterPipeline(
  maxMessages?: number,
  maxResultChars?: number,
): FilterPipeline {
  const pipeline = new FilterPipeline();

  if (maxMessages && maxMessages > 0) {
    pipeline.add(new LastNFilter(maxMessages));
  }
  pipeline.add(new RoleAlternationFilter());
  if (maxResultChars && maxResultChars > 0) {
    pipeline.add(new TruncateResultsFilter(maxResultChars));
  }
  pipeline.add(new RemoveEmptyResultsFilter());

  return pipeline;
}
