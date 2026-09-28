/**
 * 子代理委派系统（N6 / A15）
 *
 * - 独立上下文：只有任务描述与工具结果，不继承父会话历史
 * - 工具掩码：固定黑名单 + agent 文件白/黑名单（黑名单优先）
 * - 权限 fail-closed：deny/ask 一律拒绝并回喂，子代理内不弹框
 * - XML harness：本地小模型原生 tool call 不稳时走文本解析
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CanUseToolFn, Tool, ToolUseContext } from "../engine/Tool.js";
import { createClient, streamMessage, type ApiClient, type StreamEvent } from "../services/api.js";
import { parseXmlToolCalls, buildXmlToolSection, resolveHarness } from "../engine/harness.js";
import {
  maskTools,
  resolveSubAgentModel,
  type AgentDef,
} from "./agents.js";

export type { AgentDef };
export {
  parseAgentFile,
  loadAgents,
  builtinAgents,
  maskTools,
  formatAgentCatalog,
  resolveSubAgentModel,
  SUBAGENT_FIXED_DENY,
  MAX_AGENT_BYTES,
  AGENT_CATALOG_BUDGET,
} from "./agents.js";

export interface SubAgentTask {
  /** 任务 ID */
  id: string;
  /** 任务描述（子代理的全部输入，必须自包含） */
  description: string;
  /** agent 定义（决定工具掩码与系统提示） */
  agent?: Partial<AgentDef>;
  /** 系统提示词（覆盖 agent 定义） */
  systemPrompt?: string;
  /** 可用工具白名单（在 agent 掩码之上再收窄） */
  tools?: string[];
  /** 模型（覆盖 agent 定义与父模型） */
  model?: string;
  /** 最大轮次 */
  maxTurns?: number;
  /** 最大输出 Token */
  maxTokens?: number;
}

export interface SubAgentResult {
  taskId: string;
  result: string;
  success: boolean;
  turns: number;
  usage?: { input: number; output: number };
  duration: number;
}

export type SubAgentStreamFn = (args: {
  model: string;
  maxTokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
}) => AsyncGenerator<StreamEvent>;

export type SubAgentOptions = {
  client?: ApiClient;
  /** 流注入（测试用） */
  stream?: SubAgentStreamFn;
};

const DEFAULT_SYSTEM = `你是一个子代理，负责完成特定任务。你的上下文里没有主会话历史，任务描述就是全部输入。
专注于任务，必要时自行使用工具查证，完成后只返回结论。`;

export class SubAgentExecutor {
  private client: ApiClient | null;
  private tools: Tool[];
  private opts: SubAgentOptions;

  constructor(tools: Tool[], opts: SubAgentOptions = {}) {
    this.tools = tools;
    this.opts = opts;
    this.client = opts.client ?? null;
  }

  private streamFn(): SubAgentStreamFn {
    if (this.opts.stream) return this.opts.stream;
    if (!this.client) this.client = createClient();
    const client = this.client;
    return (args) =>
      streamMessage(client, args.model, args.maxTokens, args.system, args.messages, args.tools);
  }

  /**
   * 子代理内工具权限：deny/ask 一律 fail-closed（ask 不弹框）
   */
  private async decide(
    canUseTool: CanUseToolFn | undefined,
    tool: Tool,
    input: Record<string, unknown>,
  ): Promise<{ allow: boolean; message?: string }> {
    if (!canUseTool) {
      if (tool.isReadOnly(input)) return { allow: true };
      return { allow: false, message: "子代理未配置权限回调，非只读工具已拒绝" };
    }
    let r;
    try {
      r = await canUseTool(tool.name, input);
    } catch (e) {
      return { allow: false, message: `权限检查失败：${e instanceof Error ? e.message : String(e)}` };
    }
    if (r.behavior === "allow") return { allow: true };
    if (r.behavior === "deny") return { allow: false, message: r.message || "已拒绝" };
    return { allow: false, message: "子代理内需用户批准，已拒绝（不弹框）" };
  }

  async execute(
    task: SubAgentTask,
    context: ToolUseContext,
    canUseTool?: CanUseToolFn,
  ): Promise<SubAgentResult> {
    const startTime = Date.now();
    const def = task.agent;
    const maxTurns = task.maxTurns ?? def?.maxTurns ?? 5;
    const maxTokens = task.maxTokens ?? 4096;
    const model = resolveSubAgentModel(task, def, context);

    let availableTools = maskTools(this.tools, def);
    if (task.tools?.length) {
      const allow = new Set(task.tools);
      availableTools = availableTools.filter((t) => allow.has(t.name));
    }

    const toolDefs: Anthropic.Tool[] = availableTools.map((t) => {
      const raw = zodToJsonSchema(t.inputSchema);
      const { $schema, additionalProperties, ...schema } = raw as any;
      void $schema;
      void additionalProperties;
      return {
        name: t.name,
        description: t.description({} as any),
        input_schema: schema as Anthropic.Tool["input_schema"],
      };
    });

    const harnessXml = resolveHarness() === "xml" && toolDefs.length > 0;
    const baseSystem =
      task.systemPrompt || def?.systemPrompt || DEFAULT_SYSTEM;
    const systemPrompt = harnessXml
      ? `${baseSystem}\n\n${buildXmlToolSection(toolDefs)}`
      : baseSystem;

    // 独立上下文：只有任务描述，不读父消息
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: task.description },
    ];

    let result = "";
    let turns = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    const streamFn = this.streamFn();

    for (let turn = 0; turn < maxTurns; turn++) {
      if (context.abortController.signal.aborted) break;
      turns = turn + 1;

      const toolBuffers = new Map<string, { id: string; name: string; inputJson: string }>();
      let fullText = "";
      let stopReason: string | null = null;

      try {
        for await (const event of streamFn({
          model, maxTokens, system: systemPrompt, messages, tools: toolDefs,
        })) {
          switch (event.type) {
            case "text_delta":
              fullText += event.text;
              break;
            case "tool_use_start":
              toolBuffers.set(event.id, { id: event.id, name: event.name, inputJson: "" });
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
      } catch (err) {
        if (fullText) result = fullText;
        turns = Math.max(0, turns - 1);
        return {
          taskId: task.id,
          result: `${result}\n子代理执行中断：${err instanceof Error ? err.message : String(err)}`.trim(),
          success: false,
          turns,
          usage: { input: inputTokens, output: outputTokens },
          duration: Date.now() - startTime,
        };
      }

      // XML harness 兜底：无原生工具调用时从文本解析
      if (harnessXml && toolBuffers.size === 0 && stopReason !== "error") {
        for (const c of parseXmlToolCalls(fullText)) {
          const id = `xmtool_${turn}_${toolBuffers.size}`;
          toolBuffers.set(id, {
            id, name: c.name,
            inputJson: c.parseError ? "___bad_json___" : JSON.stringify(c.input),
          });
        }
      }

      if (toolBuffers.size === 0) {
        result = fullText;
        break;
      }

      // assistant 消息（文本 + 工具调用）
      const assistantContent: Anthropic.ContentBlockParam[] = [];
      if (fullText) assistantContent.push({ type: "text", text: fullText });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const [, buf] of toolBuffers) {
        let input: Record<string, unknown> = {};
        let parseOk = true;
        try {
          input = JSON.parse(buf.inputJson || "{}");
        } catch {
          parseOk = false;
        }
        assistantContent.push({
          type: "tool_use", id: buf.id, name: buf.name, input: parseOk ? input : {},
        });

        if (!parseOk) {
          toolResults.push({
            type: "tool_result", tool_use_id: buf.id,
            content: "错误：工具输入 JSON 解析失败", is_error: true,
          });
          continue;
        }

        const tool = availableTools.find((t) => t.name === buf.name);
        if (!tool) {
          toolResults.push({
            type: "tool_result", tool_use_id: buf.id,
            content: `未知或未授权工具：${buf.name}`, is_error: true,
          });
          continue;
        }

        const decision = await this.decide(canUseTool, tool, input);
        if (!decision.allow) {
          toolResults.push({
            type: "tool_result", tool_use_id: buf.id,
            content: decision.message || "已拒绝", is_error: true,
          });
          continue;
        }

        try {
          const r = await tool.call(input, context, canUseTool ?? (async () => ({ behavior: "deny" as const, message: "子代理不允许再委派" })));
          toolResults.push({
            type: "tool_result", tool_use_id: buf.id,
            content: r.resultForAssistant || JSON.stringify(r.data),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result", tool_use_id: buf.id,
            content: `工具执行错误：${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: "assistant", content: assistantContent });
      messages.push({ role: "user", content: toolResults });
      if (fullText) result = fullText;
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

export function createSubAgent(tools: Tool[], opts?: SubAgentOptions): SubAgentExecutor {
  return new SubAgentExecutor(tools, opts);
}
