/**
 * 子代理委派系统
 *
 * 灵感来自 Cursor 的 SubAgent 和 Cline 的 AgentRuntime：
 * - 在隔离的上下文窗口中运行子任务
 * - 返回结果给主对话
 * - 支持并行委派多个子代理
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Tool, ToolUseContext, ToolResult } from "../Tool.js";
import { createClient, streamMessage, type ApiClient } from "../services/api.js";

export interface SubAgentTask {
  /** 任务 ID */
  id: string;
  /** 任务描述 */
  description: string;
  /** 系统提示词（覆盖默认） */
  systemPrompt?: string;
  /** 可用工具（为空则使用所有工具） */
  tools?: string[];
  /** 最大轮次 */
  maxTurns?: number;
  /** 最大输出 Token */
  maxTokens?: number;
}

export interface SubAgentResult {
  /** 任务 ID */
  taskId: string;
  /** 执行结果 */
  result: string;
  /** 是否成功 */
  success: boolean;
  /** 执行轮次 */
  turns: number;
  /** Token 使用量 */
  usage?: {
    input: number;
    output: number;
  };
  /** 耗时（毫秒） */
  duration: number;
}

/**
 * 子代理执行器
 */
export class SubAgentExecutor {
  private client: ApiClient;
  private tools: Tool[];

  constructor(tools: Tool[]) {
    this.client = createClient();
    this.tools = tools;
  }

  /**
   * 执行子代理任务
   */
  async execute(
    task: SubAgentTask,
    context: ToolUseContext,
  ): Promise<SubAgentResult> {
    const startTime = Date.now();
    const maxTurns = task.maxTurns ?? 5;
    const maxTokens = task.maxTokens ?? 4096;

    // 构建子代理工具列表
    const availableTools = task.tools
      ? this.tools.filter((t) => task.tools!.includes(t.name))
      : [...this.tools];

    // 构建系统提示词
    const systemPrompt =
      task.systemPrompt ??
      `你是一个子代理，负责完成特定任务。专注于任务，完成后返回结果。

## 可用工具
${availableTools.map((t) => `- ${t.name}：${t.description({} as any)}`).join("\n")}`;

    // 初始消息
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: task.description },
    ];

    let result = "";
    let turns = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      turns = turn + 1;

      // 构建工具定义
      const toolDefs: Anthropic.Tool[] = availableTools.map((t) => ({
        name: t.name,
        description: t.description({} as any),
        input_schema: t.inputSchema as any,
      }));

      let stopReason: string | null = null;
      const toolBuffers = new Map<
        string,
        { id: string; name: string; inputJson: string }
      >();

      try {
        for await (const event of streamMessage(
          this.client,
          "claude-sonnet-4-20250514",
          maxTokens,
          systemPrompt,
          messages,
          toolDefs,
        )) {
          switch (event.type) {
            case "text_delta":
              result += event.text;
              break;
            case "tool_use_start":
              toolBuffers.set(event.id, {
                id: event.id,
                name: event.name,
                inputJson: "",
              });
              break;
            case "tool_use_delta":
              if (toolBuffers.has(event.id)) {
                toolBuffers.get(event.id)!.inputJson += event.inputJsonDelta;
              }
              break;
            case "message_delta":
              stopReason = event.stopReason;
              inputTokens += (event.usage as any)?.input_tokens || 0;
              outputTokens += event.usage?.output_tokens || 0;
              break;
          }
        }
      } catch {
        break;
      }

      // 如果没有工具调用，任务完成
      if (toolBuffers.size === 0) break;

      // 执行工具调用
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const [, buf] of toolBuffers) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(buf.inputJson || "{}");
        } catch {
          toolResults.push({
            type: "tool_result",
            tool_use_id: buf.id,
            content: "JSON 解析失败",
            is_error: true,
          });
          continue;
        }

        const tool = availableTools.find((t) => t.name === buf.name);
        if (!tool) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: buf.id,
            content: `未知工具：${buf.name}`,
            is_error: true,
          });
          continue;
        }

        try {
          const toolResult = await tool.call(input, context, async () => ({
            behavior: "allow",
          }));
          const resultStr =
            toolResult.resultForAssistant || JSON.stringify(toolResult.data);
          toolResults.push({
            type: "tool_result",
            tool_use_id: buf.id,
            content: resultStr,
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: buf.id,
            content: `工具执行错误：${err}`,
            is_error: true,
          });
        }
      }

      // 添加 assistant 消息和工具结果
      const assistantContent: Anthropic.ContentBlockParam[] = [];
      if (result) {
        assistantContent.push({ type: "text", text: result });
      }
      for (const [, buf] of toolBuffers) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(buf.inputJson || "{}");
        } catch {}
        assistantContent.push({
          type: "tool_use",
          id: buf.id,
          name: buf.name,
          input,
        });
      }

      messages.push({ role: "assistant", content: assistantContent });
      messages.push({ role: "user", content: toolResults });

      result = "";
    }

    return {
      taskId: task.id,
      result,
      success: true,
      turns,
      usage: { input: inputTokens, output: outputTokens },
      duration: Date.now() - startTime,
    };
  }
}

/**
 * 创建子代理执行器
 */
export function createSubAgent(tools: Tool[]): SubAgentExecutor {
  return new SubAgentExecutor(tools);
}
