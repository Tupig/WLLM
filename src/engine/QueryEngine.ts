/**
 * QueryEngine.ts — 核心 Agent 循环
 * 对齐 Claude Code 的 AsyncGenerator 流式架构
 */
import Anthropic from "@anthropic-ai/sdk";
import chalk from "chalk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool, ToolUseContext, CanUseToolFn } from "./Tool.js";
import { anthropicToolResultContent } from "./Tool.js";
import { connectMcpServers, type McpConnection } from "./mcp.js";
import { getDefaultTools, getToolByName, resolveExtraTools } from "./toolRegistry.js";
import { promptTools, setExplicitExtras, setSearchPool, markLoaded } from "./lazyTools.js";
import { resetTurnOps } from "./diffReview.js";
import { createClient, streamMessage, type StreamEvent, type ApiClient } from "../services/api.js";
import { resolveHarness, parseXmlToolCalls, buildXmlToolSection } from "./harness.js";
import { resolveFallback, streamWithFailover, isInfraError } from "../services/failover.js";
import { renderSystemPrompt } from "./prompt.js";
import { routeTask, formatRouteLog, profileTask, appendRouteFeedback } from "./router.js";
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { mapWithConcurrency, partitionRuns } from "../tools/parallel.js";
import { canUseTool, promptUserDecision } from "../services/permissions.js";
import { deriveAlwaysPattern } from "../services/approvalStore.js";
import { hookSystem, loadShellHooks } from "./hooks.js";
import { firePermissionResult, firePostToolUseFailure } from "./hookEvents.js";
import { ensureHookTrust, answerHookTrust, promptHookTrust } from "./hookTrust.js";
import { getLineage } from "./lineage.js";
import { OverflowRecovery, MAX_OVERFLOW_RETRIES } from "./overflowRecovery.js";
import { fireSessionStart, fireStop, fireCompactPre, fireCompactPost } from "./hookEvents.js";
import { ContextCompactor, LADDER_MICRO } from "../context/compact/index.js";
import { appStore } from "../state/AppState.js";
import { MAX_CONTEXT_TOKENS, DEFAULT_MODEL, TOOL_TIMEOUT_MS } from "./constants.js";
import { resolveRuleLayers, formatLayersForPrompt, type RuleLayer } from "../context/rules.js";
import { loadMemoriesSync, formatMemoriesForPrompt, type MemoryEntry } from "../knowledge/memory.js";
import { loadSkills, formatSkillCatalog, type SkillMeta } from "../knowledge/skills.js";
import { loadAgents } from "../agents/agents.js";
import { listSpecs } from "../modes/spec.js";
import { setAgentRegistry } from "../tools/Agent.js";
import { renderTodoState } from "../tools/todo.js";
import { createToolState, recordToolExecution, formatToolStateForPrompt, type ToolExecutionState } from "../tools/state.js";
import { ModeManager, type AgentMode } from "../modes/modes.js";
import { createTrajectoryRecorder, type TrajectoryRecorder } from "../session/trajectory.js";
import { autoSnapshot } from "../session/checkpoint.js";

const WRITE_SNAP_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);
import { getConfig, type TupigCodeConfig } from "../config.js";
import { ToolCache, isCacheable, createDefaultCache } from "../context/cache.js";
import {
  saveSession, loadSession, createSessionState,
  generateSessionId, type SessionState,
} from "../session/sessionState.js";
import { categorizeError, getRecoverySuggestions, withRetry, isRetryable } from "./errors.js";
import { TokenBudgetManager, createDefaultBudgetManager } from "../context/budget.js";

export type SDKMessage =
  | { type: "assistant"; message: { content: Array<{ type: string; [key: string]: unknown }> } }
  | { type: "tool_use"; toolName: string; input: Record<string, unknown>; toolUseId: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | { type: "result"; subtype: "success" | "error"; result: string; cost_usd?: number; duration_ms?: number; num_turns?: number }
  | { type: "system"; subtype: "init"; model: string; tools: string[] }
  | { type: "text"; text: string }
  | { type: "session"; messages: Anthropic.MessageParam[] };

export type QueryEngineConfig = {
  cwd: string;
  model: string;
  maxTokens: number;
  maxTurns: number;
  permissionMode?: "plan" | "default" | "acceptEdits" | "bypassPermissions";
  allowedTools?: string[];
  disallowedTools?: string[];
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  fallbackModel?: string;
  verbose?: boolean;
  /** 初始模式：plan 或 act */
  initialMode?: AgentMode;
  /** 是否启用轨迹记录 */
  enableTrajectory?: boolean;
  /** 轨迹保存路径 */
  trajectoryPath?: string;
  /** E9 路由决策的 provider 切换（local/cloud/mock） */
  routeProvider?: "local" | "cloud" | "mock";
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 是否启用会话持久化 */
  enableSession?: boolean;
  /** 会话 ID（用于恢复） */
  sessionId?: string;
  /** 会话续接：初始历史消息 */
  initialMessages?: Anthropic.MessageParam[];
  /** 预算限制 */
  budget?: {
    maxCostPerSession?: number;
    maxTokensPerRequest?: number;
  };
};

type LoopState = {
  messages: Anthropic.MessageParam[];
  turnCount: number;
  compacted: boolean;
  maxOutputTokensOverride: number;
  hasAttemptedReactiveCompact: boolean;
};

const MAX_OUTPUT_TOKEN_ESCALATION = [8192, 16384, 32768, 65536];

export function createDoomDetector(threshold = 3) {
  let lastSig = "";
  let count = 0;
  return {
    feed(sig: string): boolean {
      if (sig === lastSig) count++;
      else { lastSig = sig; count = 1; }
      return count >= threshold;
    },
    reset() { lastSig = ""; count = 0; },
  };
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label} 执行超时（${ms}ms）`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function appendRouteLog(prompt: string, route: ReturnType<typeof routeTask>, cwd: string): void {
  try {
    const dir = join(cwd, ".tupigcode");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "route.log"), formatRouteLog({ ...route, prompt, kind: profileTask(prompt).kind }) + "\n");
  } catch { /* routelog 失败不影响主流程 */ }
}

export class QueryEngine {
  private config: QueryEngineConfig;
  private tools: Tool[];
  private client: ApiClient;
  private compactor: ContextCompactor;
  private lineageText = ""; // repo-map 变更史摘要（issue #22）
  private overflowRecovery = new OverflowRecovery(); // 上下文溢出恢复（issue #24）
  private abortController: AbortController;
  private readFileState: Map<string, { mtime: number }> = new Map();
  private currentMessages: Anthropic.MessageParam[] = [];
  private toolState: ToolExecutionState;
  private ruleLayers: RuleLayer[] = [];
  private memoryEntries: MemoryEntry[] = [];
  private skillCatalog: string = "";
  private streaming = false;
  private modeManager: ModeManager;
  private trajectory: TrajectoryRecorder | null = null;
  private cache: ToolCache;
  private sessionState: SessionState | null = null;
  private budgetManager: TokenBudgetManager;
  private doomDetector = createDoomDetector(3);
  private mcp: McpConnection | null = null;
  private mcpInitialized = false;
  private fallbackClient: ApiClient | null = null;
  private fallbackLabel: string | null = null;

  constructor(config: QueryEngineConfig) {
    this.config = config;
    this.tools = [...getDefaultTools(), ...resolveExtraTools()];
    // 工具延迟装载（issue #17）：核心常驻 + ToolSearch 按需挂载；显式 extras 保持常驻
    setExplicitExtras(resolveExtraTools().map((t) => t.name));
    setSearchPool(this.tools);
    if (config.routeProvider === "mock") {
      this.client = { type: "mock" };
    } else if (config.routeProvider === "cloud" && process.env.ANTHROPIC_API_KEY) {
      this.client = { type: "anthropic", anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) };
    } else {
      this.client = createClient();
    }
    const fbKind = resolveFallback();
    if (fbKind && fbKind !== (this.client.type as string)) {
      this.fallbackLabel = fbKind;
      this.fallbackClient =
        fbKind === "anthropic"
          ? { type: "anthropic", anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }) }
          : { type: "openai" };
    }
    this.compactor = new ContextCompactor();
    this.abortController = new AbortController();
    this.toolState = createToolState(config.cwd);
    this.modeManager = new ModeManager(config.initialMode ?? "act");
    this.cache = createDefaultCache();
    this.budgetManager = createDefaultBudgetManager(config.model);

    // 加载或创建会话
    if (config.sessionId) {
      this.sessionState = loadSession(config.cwd, config.sessionId);
      if (this.sessionState && config.verbose) {
        console.log(`\n已恢复会话：${config.sessionId}`);
      }
    }

    if (!this.sessionState) {
      this.sessionState = createSessionState(
        config.sessionId ?? generateSessionId(),
        config.model,
        config.cwd,
      );
    }

    // 初始化轨迹记录器
    if (config.enableTrajectory) {
      this.trajectory = createTrajectoryRecorder(
        this.sessionState.sessionId,
        config.model,
        config.cwd,
        { enabled: true, savePath: config.trajectoryPath },
      );
    }

    // 加载项目规则文件
    for (const h of loadShellHooks(config.cwd)) {
      hookSystem.register({
        event: h.event,
        matcher: h.matcher,
        handler: async (c) => {
          // TOFU 信任（issue #20）：首次询问、信任持久化、规则变更重询
          const gate = await ensureHookTrust(config.cwd, h);
          if (gate === "ask") {
            const yes = await promptHookTrust(h);
            if (answerHookTrust(config.cwd, h, yes) === "deny") {
              return { block: true, message: "hook 未获信任，已阻止（/hooks clear 可重置后重新询问）" };
            }
          }
          return hookSystem.triggerShellHook(h.command, c, h.timeout);
        },
      });
    }
    this.ruleLayers = resolveRuleLayers(config.cwd);
    this.memoryEntries = loadMemoriesSync(config.cwd);
    this.skillCatalog = formatSkillCatalog(loadSkills(config.cwd));
    setAgentRegistry(loadAgents(config.cwd), config.cwd);
    if (this.ruleLayers.length > 0 && config.verbose) {
      console.log(`\n已加载规则层：${this.ruleLayers.map((l) => l.tier).join(" → ")}`);
    }

    if (this.client.type === "mock") {
      appStore.setState((s) => ({
        ...s,
        toolPermissionContext: { ...s.toolPermissionContext, mode: "bypassPermissions" },
      }));
    }
  }

  /** 惰性连接 .tupigcode/mcp.json 配置的 MCP server；未配置零变化，失败只降级 */
  private async ensureMcpTools(): Promise<void> {
    if (this.mcpInitialized) return;
    this.mcpInitialized = true;
    try {
      const mcp = await connectMcpServers(this.config.cwd, (msg) =>
        process.stderr.write(`⚠️  ${msg}\n`),
      );
      this.mcp = mcp;
      if (mcp.tools.length > 0) {
        this.tools.push(...mcp.tools);
        markLoaded(mcp.tools.map((t) => t.name)); // MCP 工具显式配置 → 常驻
        setSearchPool(this.tools);
      }
    } catch {
      /* MCP 不可用不影响主流程 */
    }
  }

  async *submitMessage(prompt: string): AsyncGenerator<SDKMessage, void, unknown> {
    await this.ensureMcpTools();
    // 记录用户消息
    this.trajectory?.recordUserMessage(prompt);

    // 检查模式切换命令
    if (prompt === "/plan") {
      this.modeManager.enterPlan("用户切换到 Plan 模式");
      yield {
        type: "text",
        text: "已切换到 Plan 模式（只读）",
      };
      return;
    }
    if (prompt === "/act") {
      this.modeManager.enterAct("用户切换到 Act 模式");
      yield {
        type: "text",
        text: "已切换到 Act 模式（完整执行）",
      };
      return;
    }

    // 根据模式过滤工具
    const activeTools = this.modeManager.filterTools(this.tools);

    yield {
      type: "system",
      subtype: "init",
      model: this.config.model,
      tools: activeTools.map((t) => t.name),
    };

    await fireSessionStart(undefined, {
      turnNumber: 0,
      sessionId: this.sessionState?.sessionId ?? "",
    });

    const toolContext = this.buildToolContext();
    const canUseToolFn = this.buildCanUseToolFn();

    const baseMessages = this.config.initialMessages?.length
      ? [...this.config.initialMessages, { role: "user" as const, content: prompt }]
      : [{ role: "user" as const, content: prompt }];
    const loopState: LoopState = {
      messages: baseMessages,
      turnCount: 0,
      compacted: false,
      maxOutputTokensOverride: this.config.maxTokens,
      hasAttemptedReactiveCompact: false,
    };
    this.currentMessages = loopState.messages;

    let hitMaxTurns = false;
    for (let turn = 0; turn < this.config.maxTurns; turn++) {
      if (this.abortController.signal.aborted) break;
      loopState.turnCount = turn + 1;

      const estimatedTokens = this.estimateTokens(loopState.messages);
      if (
        !loopState.hasAttemptedReactiveCompact &&
        estimatedTokens > MAX_CONTEXT_TOKENS * LADDER_MICRO
      ) {
        const r = this.compactor.compactByLadder(loopState.messages, estimatedTokens, MAX_CONTEXT_TOKENS);
        loopState.hasAttemptedReactiveCompact = true;
        if (r.strategy !== "none" && r.strategy !== "circuit-open") {
          const hctx = { turnNumber: loopState.turnCount, sessionId: this.sessionState?.sessionId ?? "" };
          await fireCompactPre(undefined, hctx, "auto");
          // force 档（>95%）：LLM 摘要（openai/anthropic/mock 三链路，失败自动回退预算削减）
          let out = r.messages;
          if (r.strategy === "force") {
            out = await this.compactor.autoCompact(this.client, this.config.model, loopState.messages);
          }
          this.compactor.recordResult(loopState.messages, out, estimatedTokens, MAX_CONTEXT_TOKENS);
          loopState.messages = out;
          loopState.compacted = true;
          appStore.setState((s) => ({ ...s, compactionCount: s.compactionCount + 1 }));
          await fireCompactPost(undefined, hctx, "auto");
        }
      }

      const turnResult = await this.executeTurn(loopState, toolContext, canUseToolFn);

      for (const event of turnResult.events) {
        yield event;
      }

      if (turnResult.stopReason === "end_turn" || turnResult.stopReason === "stop" || !turnResult.stopReason) {
        break;
      }

      if (turnResult.stopReason === "tool_use" && turnResult.toolResults.length > 0) {
        loopState.messages.push({
          role: "user",
          content: turnResult.toolResults.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.tool_use_id,
            content: r.content,
            is_error: r.is_error,
          })),
        });
      } else {
        break;
      }

      if (turn + 1 >= this.config.maxTurns) hitMaxTurns = true;
    }

    if (hitMaxTurns) {
      const errorMsg = `已达到最大轮次限制（${this.config.maxTurns} 轮），任务可能未完成`;
      this.trajectory?.recordError(errorMsg);
      yield {
        type: "result",
        subtype: "error",
        result: errorMsg,
        num_turns: loopState.turnCount,
      };
    } else {
      await fireStop(undefined, {
        turnNumber: loopState.turnCount,
        sessionId: this.sessionState?.sessionId ?? "",
        output: "任务已完成",
      });
      yield {
        type: "result",
        subtype: "success",
        result: "任务已完成",
        num_turns: loopState.turnCount,
      };
    }

    // 保存轨迹
    this.trajectory?.finish();
    const trajectoryPath = this.trajectory?.save();
    if (trajectoryPath && this.config.verbose) {
      console.log(chalk.gray(`\n轨迹已保存：${trajectoryPath}`));
    }

    // routelog 反馈回填（A23 闭环，供画像选型）
    appendRouteFeedback(this.config.cwd, {
      model: this.config.model,
      kind: profileTask(prompt).kind,
      success: !hitMaxTurns,
      oneShot: !hitMaxTurns && loopState.turnCount <= 2,
    });
  }

  private async executeTurn(
    loopState: LoopState,
    toolContext: ToolUseContext,
    canUseToolFn: CanUseToolFn,
  ): Promise<{
    stopReason: string | null;
    toolResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
    events: SDKMessage[];
  }> {
    const events: SDKMessage[] = [];
    const residentTools = promptTools(this.tools);
    const toolDefs: Anthropic.Tool[] = residentTools.map((t) => {
      const raw = (t.jsonSchema as any) ?? zodToJsonSchema(t.inputSchema);
      // 清理 zod-to-json-schema 添加的多余字段
      const { $schema, additionalProperties, ...schema } = raw as any;
      return {
        name: t.name,
        description: t.description(t as any),
        input_schema: schema as Anthropic.Tool["input_schema"],
      };
    });

    const toolBuffers = new Map<string, { id: string; name: string; inputJson: string }>();
    const toolResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];
    let fullText = "";
    let stopReason: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

    for (let attempt = 0; attempt < MAX_OUTPUT_TOKEN_ESCALATION.length; attempt++) {
      toolBuffers.clear();
      fullText = "";
      stopReason = null;

      try {
        const stream = () => streamMessage(
          this.client, this.config.model, loopState.maxOutputTokensOverride,
          this.buildSystemPrompt(toolDefs), loopState.messages, toolDefs,
        );
        const fbStream = this.fallbackClient
          ? () => streamMessage(
              this.fallbackClient!, this.config.model, loopState.maxOutputTokensOverride,
              this.buildSystemPrompt(toolDefs), loopState.messages, toolDefs,
            )
          : null;
        for await (const event of streamWithFailover(stream, fbStream, this.fallbackLabel, (l) => {
          process.stdout.write(chalk.yellow(`\n⚡ 本地推理故障，已回退到 ${l}\n`));
          this.trajectory?.recordError(`基础设施故障，回退 ${l}`);
        })) {
          switch (event.type) {
            case "text_delta":
              process.stdout.write(event.text);
              fullText += event.text;
              break;
            case "tool_use_start":
              toolBuffers.set(event.id, { id: event.id, name: event.name, inputJson: "" });
              process.stdout.write(chalk.yellow(`\n🔧 ${event.name} `));
              break;
            case "tool_use_delta": {
              const buf = toolBuffers.get(event.id);
              if (buf) buf.inputJson += event.inputJsonDelta;
              break;
            }
            case "tool_use_stop": break;
            case "message_delta":
              stopReason = event.stopReason;
              inputTokens += (event.usage as any)?.input_tokens || 0;
              outputTokens += event.usage?.output_tokens || 0;
              break;
            case "message_stop": break;
          }
        }
        break;
      } catch (err: any) {
        if (err?.message?.includes("max_tokens") && attempt < MAX_OUTPUT_TOKEN_ESCALATION.length - 1) {
          loopState.maxOutputTokensOverride = MAX_OUTPUT_TOKEN_ESCALATION[attempt + 1];
          process.stdout.write(chalk.yellow(`\n⚠️  输出 Token 超限，正在以 ${loopState.maxOutputTokensOverride} 重试...\n`));
          continue;
        }

        // 上下文溢出自动恢复（issue #24）：压缩重建 messages 后重试本轮，限 2 次
        if (this.overflowRecovery.shouldRetry(err)) {
          const hctx = { turnNumber: loopState.turnCount, sessionId: this.sessionState?.sessionId ?? "" };
          await fireCompactPre(undefined, hctx, "auto");
          const recovered = await this.overflowRecovery.recover(
            this.compactor, this.client, this.config.model, loopState.messages,
          );
          if (recovered !== loopState.messages) {
            loopState.messages = recovered;
            appStore.setState((st) => ({ ...st, compactionCount: st.compactionCount + 1 }));
            this.trajectory?.recordError(`上下文溢出，自动压缩恢复（第 ${this.overflowRecovery.attempts} 次）`);
            await fireCompactPost(undefined, hctx, "auto");
            process.stdout.write(chalk.yellow(`\n⚠️  上下文超限，已自动压缩并重试（${this.overflowRecovery.attempts}/${MAX_OVERFLOW_RETRIES}）...\n`));
            attempt--; // 溢出恢复不消耗 max_tokens 升级额度（互不干扰）
            continue;
          }
        }

        process.stdout.write(chalk.red(`\n❌ API 错误：${err?.message || err}\n`));
        return {
          stopReason: "error", toolResults: [],
          events: [...events, { type: "result", subtype: "error", result: String(err) }],
        };
      }
    }

    if (resolveHarness() === "xml" && toolBuffers.size === 0 && stopReason !== "error") {
      const calls = parseXmlToolCalls(fullText);
      for (const c of calls) {
        const id = `xmtool_${Date.now()}_${toolBuffers.size}`;
        toolBuffers.set(id, { id, name: c.name, inputJson: c.parseError ? "___bad_json___" : JSON.stringify(c.input) });
        process.stdout.write(chalk.yellow(`\n🔧 ${c.name} `));
      }
      if (calls.length > 0) stopReason = "tool_use";
    }

    if (toolBuffers.size > 0) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (fullText) content.push({ type: "text", text: fullText });
      for (const [, buf] of toolBuffers) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(buf.inputJson || "{}"); } catch {
          content.push({ type: "tool_use", id: buf.id, name: buf.name, input: {} });
          toolResults.push({
            tool_use_id: buf.id,
            content: `错误：工具输入 JSON 解析失败，请检查参数格式`,
            is_error: true,
          });
          events.push({
            type: "tool_result", toolUseId: buf.id,
            content: `错误：工具输入 JSON 解析失败，请检查参数格式`, isError: true,
          });
          continue;
        }
        content.push({ type: "tool_use", id: buf.id, name: buf.name, input });
        events.push({ type: "tool_use", toolName: buf.name, input, toolUseId: buf.id });
      }
      loopState.messages.push({ role: "assistant", content });

      const entries: Array<{ buf: { id: string; name: string; inputJson: string }; input: Record<string, unknown> | null }> = [];
      for (const [, buf] of toolBuffers) {
        let input: Record<string, unknown> | null = null;
        try { input = JSON.parse(buf.inputJson || "{}"); } catch { input = null; }
        if (input) entries.push({ buf, input });
      }
      const isSafe = (e: { buf: { name: string }; input: Record<string, unknown> | null }) => {
        if (!e.input) return false;
        const t = getToolByName(this.tools, e.buf.name);
        return !!t && t.isReadOnly(e.input) && t.isConcurrencySafe(e.input);
      };
      const batches = partitionRuns(entries, isSafe);
      for (const batch of batches) {
        if (batch.length > 1) {
          await mapWithConcurrency(batch, 4, async (e) => {
            await this.runToolBuffer(e.buf, e.input!, getToolByName(this.tools, e.buf.name), toolContext, canUseToolFn, loopState, events, toolResults, true);
          });
        } else {
          const e = batch[0];
          await this.runToolBuffer(e.buf, e.input ?? {}, getToolByName(this.tools, e.buf.name), toolContext, canUseToolFn, loopState, events, toolResults, false);
        }
      }

      stopReason = "tool_use";
    } else {
      loopState.messages.push({ role: "assistant", content: fullText });
    }

    this.currentMessages = loopState.messages;
    appStore.setState((s) => ({
      ...s,
      tokenUsage: {
        input: s.tokenUsage.input + inputTokens,
        output: s.tokenUsage.output + outputTokens,
      },
    }));

    process.stdout.write("\n");
    return { stopReason, toolResults, events };
  }

  private async runToolBuffer(
    buf: { id: string; name: string; inputJson: string },
    input: Record<string, unknown>,
    tool: Tool | undefined,
    toolContext: ToolUseContext,
    canUseToolFn: CanUseToolFn,
    loopState: LoopState,
    events: any[],
    toolResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }>,
    parallel: boolean,
  ): Promise<void> {
      const permission = await canUseToolFn(buf.name, input);
      this.trajectory?.record("permission", {
        toolName: buf.name,
        behavior: permission.behavior,
        reason: (permission as any).decisionReason ?? (permission as any).message ?? "",
      });
      const permSource =
        (permission as any).decisionReason ?? (permission as any).message ?? undefined;
      const firePerm = (decision: "allow" | "deny" | "always", source?: string) => {
        void firePermissionResult(hookSystem, {
          toolName: buf.name, decision, ruleSource: source ?? permSource,
        }, { turnNumber: loopState.turnCount, sessionId: appStore.getState().sessionId });
      };

      // 应用权限层改写（plan 模式 staging 暂存等，issue #18）
      if (permission.behavior !== "deny" && (permission as any).updatedInput) {
        input = (permission as any).updatedInput;
      }

      if (permission.behavior === "deny") {
        const msg = permission.message || "已拒绝";
        firePerm("deny", permSource);
        process.stdout.write(chalk.red(`\n🚫 ${msg}\n`));
        toolResults.push({ tool_use_id: buf.id, content: msg, is_error: true });
        events.push({ type: "tool_result", toolUseId: buf.id, content: msg, isError: true });
        return;
      }

      if (permission.behavior === "ask") {
        const decision = await promptUserDecision(buf.name, input);
        if (decision === "deny") {
          firePerm("deny", "交互拒绝");
          toolResults.push({ tool_use_id: buf.id, content: "用户已拒绝", is_error: true });
          events.push({ type: "tool_result", toolUseId: buf.id, content: "用户已拒绝", isError: true });
          return;
        }
        firePerm(decision === "always" ? "always" : "allow", decision === "always" ? "交互:总是允许" : "交互:单次允许");
        if (decision === "always") {
          process.stdout.write(chalk.green(`\n✓ 已持久化「总是允许」：${deriveAlwaysPattern(buf.name, input)}（/permissions clear 清除）\n`));
        }
      } else {
        firePerm("allow", permSource);
      }

      const hookResult = await hookSystem.trigger("PreToolUse", {
        toolName: buf.name, input,
        turnNumber: loopState.turnCount,
        sessionId: appStore.getState().sessionId,
      });

      if (hookResult.block) {
        const msg = hookResult.message || "已被 Hook 阻断";
        process.stdout.write(chalk.red(`\n🚫 ${msg}\n`));
        toolResults.push({ tool_use_id: buf.id, content: msg, is_error: true });
        events.push({ type: "tool_result", toolUseId: buf.id, content: msg, isError: true });
        return;
      }

      if (tool) {
        const parsed = tool.inputSchema.safeParse(input);
        if (!parsed.success) {
          const errMsg = `输入校验失败：${parsed.error.errors.map((e: any) => e.message).join(", ")}`;
          process.stdout.write(chalk.red(`\n❌ ${errMsg}\n`));
          toolResults.push({ tool_use_id: buf.id, content: errMsg, is_error: true });
          events.push({ type: "tool_result", toolUseId: buf.id, content: errMsg, isError: true });
          return;
        }

        // 流式锁：防止并发工具执行
        if (this.streaming) {
          toolResults.push({ tool_use_id: buf.id, content: "错误：另一个工具正在执行中", is_error: true });
          return;
        }
        this.streaming = true;

        const doomSig = JSON.stringify({ name: buf.name, input });
        if (this.doomDetector.feed(doomSig)) {
          this.streaming = false;
          const errMsg = "检测到连续重复动作（doom loop），已中断。请换一种方式完成任务。";
          process.stdout.write(chalk.red(`\n🛑 ${errMsg}\n`));
          toolResults.push({ tool_use_id: buf.id, content: errMsg, is_error: true });
          events.push({ type: "tool_result", toolUseId: buf.id, content: errMsg, isError: true });
          this.trajectory?.recordError(errMsg);
          return;
        }

        // 记录工具调用
        this.trajectory?.recordToolUse(buf.name, input, buf.id);
        const toolStartTime = Date.now();

        process.stdout.write(chalk.gray("⏳ "));
        let result;
        try {
          result = await withTimeout(
            tool.call(parsed.data, toolContext, canUseToolFn),
            TOOL_TIMEOUT_MS, `工具 ${buf.name}`,
          );
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          void firePostToolUseFailure(hookSystem, {
            toolName: buf.name, input, output: errMsg,
            durationMs: Date.now() - toolStartTime,
          }, { turnNumber: loopState.turnCount, sessionId: appStore.getState().sessionId });
          process.stdout.write(chalk.red(`\n❌ ${errMsg}\n`));
          toolResults.push({ tool_use_id: buf.id, content: errMsg, is_error: true });
          events.push({ type: "tool_result", toolUseId: buf.id, content: errMsg, isError: true });
          this.trajectory?.recordError(errMsg);
          return;
        } finally {
          this.streaming = false;
        }

        // 记录工具执行状态
        const filePath = (input as any).file_path || (input as any).path;
        const operation = buf.name === "Write" ? "write" : buf.name === "Edit" ? "edit" : undefined;
        recordToolExecution(this.toolState, buf.name, filePath, operation);

        const resultStr = result.resultForAssistant || JSON.stringify(result.data);
        toolResults.push({ tool_use_id: buf.id, content: anthropicToolResultContent(result, resultStr) as never, is_error: false });
        events.push({ type: "tool_result", toolUseId: buf.id, content: resultStr, isError: false });

        // 记录工具结果
        const toolDuration = Date.now() - toolStartTime;
        this.trajectory?.recordToolResult(buf.id, resultStr, false, toolDuration);

        process.stdout.write(chalk.green(`✅（${resultStr.length} 字符）\n`));

        await hookSystem.trigger("PostToolUse", {
          toolName: buf.name, input, output: resultStr,
          turnNumber: loopState.turnCount,
          sessionId: appStore.getState().sessionId,
          durationMs: toolDuration,
        });

        // 自动快照（issue #14）：写类工具成功后（防抖 5s；无改动/非 git 静默）
        if (process.env.TUPIG_AUTOSNAPSHOT !== "0" && WRITE_SNAP_TOOLS.has(buf.name)) {
          void autoSnapshot(toolContext.workDir, `auto:tool:${buf.name}`).catch(() => {});
        }
      } else {
        const errMsg = `未知工具：${buf.name}`;
        toolResults.push({ tool_use_id: buf.id, content: errMsg, is_error: true });
        events.push({ type: "tool_result", toolUseId: buf.id, content: errMsg, isError: true });
      }
  }

  private buildToolContext(): ToolUseContext {
    return {
      options: {
        debug: this.config.verbose || false,
        mainLoopModel: this.config.model,
        tools: this.tools,
        verbose: this.config.verbose || false,
        isNonInteractiveSession: false,
      },
      abortController: this.abortController,
      readFileState: this.readFileState,
      getMessages: () => this.currentMessages as any,
      workDir: this.config.cwd,
      sessionId: appStore.getState().sessionId,
    };
  }

  private buildCanUseToolFn(): CanUseToolFn {
    return async (toolName, input) => {
      const tool = getToolByName(this.tools, toolName);
      const state = appStore.getState();
      return canUseTool(toolName, input, tool, state.toolPermissionContext);
    };
  }

  private buildSystemPrompt(toolDefs: Anthropic.Tool[] = []): string {
    void toolDefs;
    let planSpec: string | undefined;
    if (this.modeManager.mode === "plan") {
      const specs = listSpecs(this.config.cwd);
      planSpec = (specs.find((s) => s.status === "approved") ?? specs[0])?.name;
    }
    const lineage = this.lineageText ? `## 近期变更\n${this.lineageText}` : undefined;
    const append = [lineage, this.config.appendSystemPrompt].filter(Boolean).join("\n\n") || undefined;
    return renderSystemPrompt(promptTools(this.tools), {
      planSpec,
      rulesText: this.ruleLayers.length ? formatLayersForPrompt(this.ruleLayers) : undefined,
      memoryText: this.memoryEntries.length ? formatMemoriesForPrompt(this.memoryEntries) : undefined,
      skillCatalog: this.skillCatalog || undefined,
      stateText:
        (formatToolStateForPrompt(this.toolState) + renderTodoState(appStore.getState().todoState ?? null)) || undefined,
      append,
    });
  }

  /** 预取变更史摘要（issue #22）：失败/超时静默为空，不阻塞主流程 */
  async preloadLineage(): Promise<void> {
    try {
      this.lineageText = await getLineage(this.config.cwd, this.client, this.config.model);
    } catch {
      this.lineageText = "";
    }
  }

  private estimateTokens(messages: Anthropic.MessageParam[]): number {
    try {
      return Math.ceil(JSON.stringify(messages).length / 4);
    } catch {
      return 0;
    }
  }

  interrupt(): void {
    this.abortController.abort();
  }

  getTools(): Tool[] {
    return this.tools;
  }

  getSessionMessages(): Anthropic.MessageParam[] {
    return this.currentMessages;
  }
}

export async function* query(params: {
  prompt: string;
  initialMessages?: Anthropic.MessageParam[];
  options?: Partial<QueryEngineConfig>;
}): AsyncGenerator<SDKMessage, void, unknown> {
  const cwd = params.options?.cwd ?? process.cwd();
  const route = routeTask({
    prompt: params.prompt,
    model: params.options?.model,
    env: process.env,
    workDir: cwd,
  });
  appendRouteLog(params.prompt, route, cwd);
  resetTurnOps(); // 清理上一入口（single/spec 等）遗留的写操作，避免审查串轮

  const engine = new QueryEngine({
    cwd,
    maxTokens: 8192,
    maxTurns: 20,
    ...params.options,
    model: route.model,
    routeProvider: route.provider,
    initialMessages: params.initialMessages,
  });

  await engine.preloadLineage(); // 变更史摘要（失败静默跳过，~5s 超时兜底）
  yield* engine.submitMessage(params.prompt);
  yield { type: "session", messages: engine.getSessionMessages() };
}
