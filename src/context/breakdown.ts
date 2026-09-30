/**
 * context/breakdown.ts — /context 上下文占用分段明细（issue #21）
 *
 * 把上下文拆成 system / 消息 / 工具结果 / 工具 schema / 记忆 五段，
 * 各段 token 估算后求和即总量；消息段与既有估算器 estimateTokens 对齐
 * （序列化开销容差内）。
 */
import { estimateTokens } from "./compact/index.js";

export interface ContextSegment {
  id: "system" | "messages" | "tool_results" | "tool_schemas" | "memories";
  label: string;
  tokens: number;
  count?: number;
}

export interface ContextBreakdownInput {
  systemPrompt?: string;
  messages: any[];
  toolSchemas?: unknown[];
  memories?: string[];
}

export interface ContextBreakdown {
  segments: ContextSegment[];
  totalTokens: number;
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hasToolResult(m: any): boolean {
  return Array.isArray(m?.content) && m.content.some((b: any) => b?.type === "tool_result");
}

function countToolResults(m: any): number {
  if (!Array.isArray(m?.content)) return 0;
  return m.content.filter((b: any) => b?.type === "tool_result").length;
}

export function contextBreakdown(input: ContextBreakdownInput): ContextBreakdown {
  const segments: ContextSegment[] = [];

  if (input.systemPrompt) {
    segments.push({ id: "system", label: "系统提示", tokens: estimateTextTokens(input.systemPrompt), count: 1 });
  }

  const msgs = input.messages ?? [];
  const toolMsgs = msgs.filter(hasToolResult);
  const plainMsgs = msgs.filter((m) => !hasToolResult(m));
  if (plainMsgs.length > 0) {
    segments.push({ id: "messages", label: "对话消息", tokens: estimateTokens(plainMsgs), count: plainMsgs.length });
  }
  const toolBlocks = msgs.reduce((n, m) => n + countToolResults(m), 0);
  if (toolMsgs.length > 0) {
    segments.push({ id: "tool_results", label: "工具结果", tokens: estimateTokens(toolMsgs), count: toolBlocks });
  }

  if (input.toolSchemas && input.toolSchemas.length > 0) {
    segments.push({
      id: "tool_schemas",
      label: "工具 schema",
      tokens: estimateTextTokens(JSON.stringify(input.toolSchemas)),
      count: input.toolSchemas.length,
    });
  }

  if (input.memories && input.memories.length > 0) {
    segments.push({
      id: "memories",
      label: "记忆/规则",
      tokens: estimateTextTokens(input.memories.join("\n")),
      count: input.memories.length,
    });
  }

  const totalTokens = segments.reduce((n, s) => n + s.tokens, 0);
  return { segments, totalTokens };
}
