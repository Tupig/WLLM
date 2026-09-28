/**
 * compact/index.ts — 上下文压缩 5 阶段流水线
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ApiClient } from "../services/api.js";

export interface CompactionConfig {
  threshold: number;
  maxMessages: number;
}

const DEFAULT_CONFIG: CompactionConfig = {
  threshold: 0.85,
  maxMessages: 100,
};

export type Strategy =
  | "none"
  | "micro"
  | "snip"
  | "collapse"
  | "force"
  | "circuit-open";

export const LADDER_MICRO = 0.6;
const LADDER_SNIP = 0.7;
const LADDER_COLLAPSE = 0.85;
const LADDER_FORCE = 0.95;

export function pickStrategy(usage: number, messageCount: number): Strategy {
  if (messageCount > 100) return "force";
  if (usage > LADDER_FORCE) return "force";
  if (usage > LADDER_COLLAPSE) return "collapse";
  if (usage > LADDER_SNIP) return "snip";
  if (usage > LADDER_MICRO) return "micro";
  return "none";
}

export function estimateTokens(messages: Anthropic.MessageParam[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

export class ContextCompactor {
  private config: CompactionConfig;
  private circuitOpen = false;
  private lastOriginal: Anthropic.MessageParam[] | null = null;

  constructor(config?: Partial<CompactionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  getLastOriginal(): Anthropic.MessageParam[] | null {
    return this.lastOriginal;
  }

  recordResult(
    before: Anthropic.MessageParam[],
    after: Anthropic.MessageParam[],
    _beforeTokens: number,
    _maxTokens: number,
  ): void {
    this.lastOriginal = before;
    if (estimateTokens(after) >= estimateTokens(before)) {
      this.circuitOpen = true;
    }
  }

  compactByLadder(
    messages: Anthropic.MessageParam[],
    estimatedTokens: number,
    maxTokens: number,
  ): { messages: Anthropic.MessageParam[]; strategy: Strategy } {
    if (this.circuitOpen) return { messages, strategy: "circuit-open" };
    const strategy = pickStrategy(estimatedTokens / maxTokens, messages.length);
    this.lastOriginal = messages;
    switch (strategy) {
      case "none":
        return { messages, strategy };
      case "micro":
        return { messages: this.microcompact(messages), strategy };
      case "snip":
        return { messages: this.snip(messages), strategy };
      case "collapse":
      case "force":
        return { messages: this.contextCollapse(messages), strategy };
      default:
        return { messages, strategy: "none" };
    }
  }

  compactToBudget(
    messages: Anthropic.MessageParam[],
    estimatedTokens: number,
    maxTokens: number,
    maxIterations: number,
  ): { messages: Anthropic.MessageParam[]; iterations: number } {
    if (estimatedTokens <= maxTokens) return { messages, iterations: 0 };
    this.lastOriginal = messages;
    let current = messages;
    let currentTokens = estimatedTokens;
    let iterations = 0;
    while (currentTokens > maxTokens && iterations < maxIterations && current.length > 4) {
      const r = this.compactByLadder(current, currentTokens, maxTokens);
      if (r.strategy === "none" || r.strategy === "circuit-open") break;
      if (r.messages.length >= current.length && r.strategy !== "snip") break;
      current = r.messages;
      currentTokens = estimateTokens(current);
      iterations++;
    }
    if (currentTokens > maxTokens) {
      this.lastOriginal = messages;
      current = this.budgetReduction(messages);
      iterations++;
    }
    return { messages: current, iterations };
  }

  shouldCompact(messages: Anthropic.MessageParam[], estimatedTokens: number, maxTokens: number): boolean {
    const usage = estimatedTokens / maxTokens;
    return usage > this.config.threshold || messages.length > this.config.maxMessages;
  }

  budgetReduction(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    if (messages.length <= 4) return messages;
    return messages.slice(-4);
  }

  snip(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    if (messages.length <= 6) return messages;
    return messages.map((msg, idx) => {
      if (idx < 2 || idx >= messages.length - 2) return msg;
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const hasToolResults = msg.content.some((b: any) => b.type === "tool_result");
        if (hasToolResults) {
          return { ...msg, content: [{ type: "text" as const, text: "[工具结果已截断以节省上下文空间]" }] };
        }
      }
      return msg;
    });
  }

  microcompact(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    if (messages.length <= 8) return messages;
    const head = messages.slice(0, 2);
    const tail = messages.slice(-4);
    const middle = messages.slice(2, -4);
    if (middle.length > 3) {
      const compacted = [...middle.slice(0, 2), middle[middle.length - 1]];
      return [...head, ...compacted, ...tail];
    }
    return messages;
  }

  contextCollapse(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    if (messages.length <= 10) return messages;
    const head = messages.slice(0, 2);
    const tail = messages.slice(-6);
    const middle = messages.slice(2, -6);
    if (middle.length === 0) return messages;

    const headEndsWithAssistant = head.length > 0 && head[head.length - 1].role === "assistant";

    const collapsed: Anthropic.MessageParam[] = [];
    if (headEndsWithAssistant) {
      collapsed.push({ role: "user", content: `[上下文已折叠：省略了 ${middle.length} 条消息]` });
    } else {
      collapsed.push({ role: "user", content: `[上下文已折叠：省略了 ${middle.length} 条消息]` });
      collapsed.push({ role: "assistant", content: "已收到折叠上下文中的信息。" });
    }

    return [...head, ...collapsed, ...tail];
  }

  async autoCompact(
    client: ApiClient, model: string, messages: Anthropic.MessageParam[],
  ): Promise<Anthropic.MessageParam[]> {
    if (messages.length <= 6) return messages;
    if (client.type !== "anthropic" || !client.anthropic) {
      return this.contextCollapse(messages);
    }

    const recent = messages.slice(-6);
    const toSummarize = messages.slice(0, -6);
    if (toSummarize.length === 0) return messages;

    try {
      const resp = await client.anthropic.messages.create({
        model: model || "claude-haiku-4-20250414",
        max_tokens: 1024,
        system: "请简洁地总结对话历史，保留关键决策、代码变更和上下文信息。",
        messages: [{
          role: "user",
          content: `请总结以下对话：\n${JSON.stringify(toSummarize, null, 2)}`,
        }],
      });

      const summary = resp.content[0]?.type === "text" ? resp.content[0].text : "之前的上下文。";

      return [
        { role: "user", content: `[之前的对话摘要]\n${summary}` },
        { role: "assistant", content: "已收到之前对话的上下文。" },
        ...recent,
      ];
    } catch {
      return this.budgetReduction(messages);
    }
  }

  async compact(
    client: ApiClient, model: string, messages: Anthropic.MessageParam[],
  ): Promise<{ messages: Anthropic.MessageParam[]; strategy: string }> {
    const afterSnip = this.snip(messages);
    if (JSON.stringify(afterSnip) !== JSON.stringify(messages)) {
      return { messages: afterSnip, strategy: "snip" };
    }

    const afterMicro = this.microcompact(messages);
    if (afterMicro.length < messages.length) {
      return { messages: afterMicro, strategy: "microcompact" };
    }

    const afterCollapse = this.contextCollapse(messages);
    if (afterCollapse.length < messages.length) {
      return { messages: afterCollapse, strategy: "context-collapse" };
    }

    const afterAuto = await this.autoCompact(client, model, messages);
    return { messages: afterAuto, strategy: "auto-compact" };
  }
}
