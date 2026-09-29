/**
 * Tool.ts — 工具类型定义
 * 对齐 Claude Code v2.1.88 的 src/Tool.ts
 */
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

export type ToolResultOutput =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "error"; error: string }
  | { type: "json"; data: unknown };

export type ToolResult<T = unknown> = {
  data: T;
  resultForAssistant?: string;
  output?: ToolResultOutput;
  newMessages?: Message[];
  contextModifier?: (ctx: ToolUseContext) => ToolUseContext;
};

/**
 * 工具结果 → Anthropic tool_result.content。
 * 带 image output 时返回 [text, image] 数组，否则原样返回字符串（现状零变化）。
 */
export function anthropicToolResultContent(
  result: Pick<ToolResult, "output">,
  text: string,
): string | Anthropic.ToolResultBlockParam["content"] {
  const out = result.output;
  if (out?.type === "image") {
    const mediaType = out.mimeType as Extract<
      Anthropic.ImageBlockParam["source"],
      { type: "base64" }
    >["media_type"];
    return [
      { type: "text", text },
      { type: "image", source: { type: "base64", media_type: mediaType, data: out.data } },
    ];
  }
  return text;
}

export type PermissionMode =
  | "plan"
  | "default"
  | "acceptEdits"
  | "auto"
  | "dontAsk"
  | "bypassPermissions";

export type PermissionDecision<Input> =
  | { behavior: "allow"; updatedInput?: Input; decisionReason?: string }
  | { behavior: "ask"; message: string; updatedInput?: Input }
  | { behavior: "deny"; message: string; decisionReason?: string };

export type PermissionResult<Input = unknown> = PermissionDecision<Input>;

export type ToolProgressData = Record<string, unknown>;

export type Message = {
  uuid: string;
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
  timestamp: number;
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export type ToolUseContext = {
  options: {
    debug: boolean;
    mainLoopModel: string;
    tools: Tool[];
    verbose: boolean;
    isNonInteractiveSession: boolean;
    maxBudgetUsd?: number;
    customSystemPrompt?: string;
  };
  abortController: AbortController;
  readFileState: Map<string, { mtime: number }>;
  getMessages: () => Message[];
  workDir: string;
  sessionId: string;
  agentId?: string;
};

export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<PermissionResult>;

export type ToolDefinition<
  Input extends z.ZodTypeAny = z.ZodTypeAny,
  Output = unknown,
> = {
  readonly name: string;
  aliases?: string[];
  searchHint?: string;
  readonly inputSchema: Input;
  maxResultSizeChars?: number;
  readonly strict?: boolean;

  call(
    args: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
  ): Promise<ToolResult<Output>>;

  description(input: z.infer<Input>): string;
  prompt(): string;
  userFacingName(): string;

  isReadOnly(input: z.infer<Input>): boolean;
  isDestructive?(input: z.infer<Input>): boolean;
  isConcurrencySafe(input: z.infer<Input>): boolean;
  isEnabled(): boolean;
  isOpenWorld?(input: z.infer<Input>): boolean;

  checkPermissions(
    input: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<PermissionResult>;
  validateInput?(
    input: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<{ valid: boolean; error?: string }>;

  mapToolResultToToolResultBlockParam(
    content: string,
    toolUseID: string,
  ): Anthropic.ToolResultBlockParam;
};

export type Tool = ToolDefinition<any, any>;

const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  isDestructive: () => false,
  checkPermissions: (input: unknown) =>
    Promise.resolve({ behavior: "allow" as const, updatedInput: input }),
  userFacingName: () => "",
  maxResultSizeChars: 100_000,
  description: () => "",
  prompt: () => "",
  mapToolResultToToolResultBlockParam: (content: string, toolUseID: string) => ({
    type: "tool_result" as const,
    tool_use_id: toolUseID,
    content,
  }),
};

export function buildTool<Output = unknown>(
  def: Partial<ToolDefinition<any, Output>> & {
    name: string;
    inputSchema: z.ZodTypeAny;
    call: ToolDefinition<any, Output>["call"];
  },
): ToolDefinition<any, Output> {
  return { ...TOOL_DEFAULTS, userFacingName: () => def.name, ...def } as ToolDefinition<any, Output>;
}

/**
 * 简化的工具定义函数
 *
 * 灵感来自 Cline 的 createTool()。
 * 提供更简洁的 API，自动推断类型，减少样板代码。
 */
export function defineTool<Input extends z.ZodTypeAny>(config: {
  name: string;
  description: string;
  prompt?: string;
  input: Input;
  maxResultSizeChars?: number;
  readOnly?: boolean;
  destructive?: boolean;
  concurrentSafe?: boolean;
  execute: (input: z.infer<Input>, context: ToolUseContext) => Promise<string>;
}): ToolDefinition<Input> {
  return buildTool({
    name: config.name,
    inputSchema: config.input,
    maxResultSizeChars: config.maxResultSizeChars,
    description: () => config.description,
    prompt: () => config.prompt ?? "",
    userFacingName: () => config.name,
    isReadOnly: () => config.readOnly ?? false,
    isDestructive: () => config.destructive ?? false,
    isConcurrencySafe: () => config.concurrentSafe ?? false,
    isEnabled: () => true,
    async checkPermissions(input, _ctx) {
      return { behavior: "allow", updatedInput: input };
    },
    async call(input, context): Promise<ToolResult<string>> {
      const data = await config.execute(input, context);
      return { data, resultForAssistant: data };
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
      return { type: "tool_result", tool_use_id: toolUseID, content };
    },
  });
}
