/**
 * hooks/system.ts — Hook 系统
 */
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "UserPromptSubmit"
  | "PreCompact"
  | "PostCompact"
  | "PreClear"
  | "PostClear"
  | "PostRewind"
  | "PermissionResult"
  | "ModeChange"
  | "Stop"
  | "SessionStart"
  | "SessionEnd";

export type HookType = "shell" | "llm-evaluated" | "webhook";

export interface HookContext {
  toolName?: string;
  input?: Record<string, unknown>;
  output?: string;
  turnNumber: number;
  sessionId: string;
  /** 压缩事件触发方：manual | auto（issue #26） */
  source?: string;
  /** 工具执行纯耗时 ms（不含权限询问与 PreToolUse，issue #31） */
  durationMs?: number;
  /** 权限最终决策（issue #35） */
  decision?: "allow" | "deny" | "always";
  /** 决策来源：规则/持久 allow/交互/敏感 deny 等描述 */
  ruleSource?: string;
  /** 模式切换前后（issue #42） */
  modeFrom?: string;
  modeTo?: string;
}

export type HookResult = {
  block?: boolean;
  replacement?: string;
  message?: string;
  /** UserPromptSubmit 注入的附加上下文（issue #48），多 hook 合并时拼接 */
  additionalContext?: string;
};

export type HookHandler = (
  ctx: HookContext,
) => Promise<HookResult | void> | HookResult | void;

export function interpretShellExit(
  code: number | null,
  stdout: string,
  stderr: string,
  failOpen = false,
): HookResult {
  const enforce = !failOpen && process.env.TUPIG_HOOKS_FAIL_OPEN !== "1";

  if (code === 0) {
    try {
      const parsed = JSON.parse(stdout);
      const ac = parsed?.hookSpecificOutput?.additionalContext ?? parsed?.additionalContext;
      return {
        block: parsed.block === true,
        replacement: parsed.replacement,
        message: parsed.message,
        additionalContext: typeof ac === "string" && ac.length > 0 ? ac : undefined,
      };
    } catch {
      return {};
    }
  }
  if (code === 2) {
    return { block: true, message: (stderr || stdout || "hook exit 2").trim() };
  }
  if (code === null) {
    return { block: enforce, message: "hook 超时（fail-closed）" };
  }
  return { block: enforce, message: `hook 退出码 ${code}（fail-closed）${stderr ? "：" + stderr.trim() : ""}` };
}

export type ShellHookConfig = {
  event: HookEvent;
  matcher?: {
    tool_name?: string;
    source?: string;
    decision?: "allow" | "deny" | "always";
    modeTo?: string;
  };
  command: string;
  timeout?: number;
};

const DECISIONS = new Set(["allow", "deny", "always"]);

export function loadShellHooks(workDir: string): ShellHookConfig[] {
  const file = process.env.TUPIG_HOOKS_FILE || join(workDir, ".tupigcode", "hooks.json");
  try {
    const raw = readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((h: any) => typeof h?.command === "string" && typeof h?.event === "string")
      .map((h: any) => ({
        event: h.event as HookEvent,
        matcher: h.matcher && typeof h.matcher === "object"
          ? {
              ...(typeof h.matcher.tool_name === "string" ? { tool_name: h.matcher.tool_name } : {}),
              ...(typeof h.matcher.source === "string" ? { source: h.matcher.source } : {}),
              // decision/modeTo 此前被丢弃（issue #50）
              ...(typeof h.matcher.decision === "string" && DECISIONS.has(h.matcher.decision)
                ? { decision: h.matcher.decision as "allow" | "deny" | "always" }
                : {}),
              ...(typeof h.matcher.modeTo === "string" ? { modeTo: h.matcher.modeTo } : {}),
            }
          : undefined,
        command: h.command,
        timeout: typeof h.timeout === "number" ? h.timeout : undefined,
      }));
  } catch {
    return [];
  }
}

export type HookMatcher = {
  event: HookEvent;
  matcher?: { tool_name?: string; source?: string; decision?: "allow" | "deny" | "always"; modeTo?: string };
  handler: HookHandler;
  type?: HookType;
  timeout?: number;
};

/**
 * tool_name 匹配（issue #50）：全串锚定正则 `^(?:pattern)$`——
 * `Edit|Write` 命中两工具且不误伤 MultiEdit；既有精确配置行为不变；
 * 子串意图写 `.*X.*`；非法正则回退精确比较。
 */
export function matchToolPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return pattern === value;
  }
}

export class HookSystem {
  private matchers: HookMatcher[] = [];

  register(matcher: HookMatcher): void {
    this.matchers.push(matcher);
  }

  /** 清空全部匹配器（测试隔离 / 热重载） */
  clear(): void {
    this.matchers = [];
  }

  async trigger(event: HookEvent, ctx: HookContext): Promise<HookResult> {
    const matching = this.matchers.filter((m) => {
      if (m.event !== event) return false;
      if (m.matcher?.tool_name && (ctx.toolName === undefined || !matchToolPattern(m.matcher.tool_name, ctx.toolName))) return false;
      if (m.matcher?.source && m.matcher.source !== ctx.source) return false;
      if (m.matcher?.decision && m.matcher.decision !== ctx.decision) return false;
      if (m.matcher?.modeTo && m.matcher.modeTo !== ctx.modeTo) return false;
      return true;
    });

    // 并行执行（issue #49）：不再串行叠加超时，单点异常吞掉不拖累他人
    const results = await Promise.all(
      matching.map(async (m) => {
        try {
          return await m.handler(ctx);
        } catch (err) {
          if (process.env.TUPIG_DEBUG) {
            console.error(`[Hook] 处理器执行出错：`, err);
          }
          return null;
        }
      }),
    );

    // 最严合并（issue #49）：block 优先且不被后续覆盖；未 block 取注册序
    // 第一个非空 message/replacement；additionalContext 拼接不互相覆盖
    let blockFirst: HookResult | null = null;
    let message: string | undefined;
    let replacement: string | undefined;
    const acParts: string[] = [];
    for (const r of results) {
      if (!r) continue;
      if (typeof r.additionalContext === "string" && r.additionalContext.length > 0) acParts.push(r.additionalContext);
      if (r.block) {
        if (!blockFirst) blockFirst = r;
        continue;
      }
      if (blockFirst) continue; // block 之后的 handler 结果视为不生效（等价原短路）
      if (r.message && message === undefined) message = r.message;
      if (r.replacement && replacement === undefined) replacement = r.replacement;
    }

    const out: HookResult = {};
    if (blockFirst) {
      out.block = true;
      out.message = blockFirst.message ?? message;
      if (blockFirst.replacement) out.replacement = blockFirst.replacement;
    } else {
      if (message !== undefined) out.message = message;
      if (replacement !== undefined) out.replacement = replacement;
    }
    if (acParts.length > 0) out.additionalContext = acParts.join("\n");
    return out;
  }

  async triggerShellHook(
    command: string,
    ctx: HookContext,
    timeoutMs = 5000,
  ): Promise<HookResult> {
    return new Promise((resolve) => {
      let settled = false;
      const child = spawn("bash", ["-c", command], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      // 子进程可能不读 stdin 就退出（快退 hook/CI 竞态），忽略 EPIPE 防未捕获异常
      child.stdin.on("error", () => {});
      child.stdin.write(JSON.stringify(ctx));
      child.stdin.end();

      const finish = (result: HookResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch {}
        finish(interpretShellExit(null, stdout, stderr));
      }, timeoutMs);

      child.on("close", (code) => {
        finish(interpretShellExit(code, stdout, stderr));
      });

      child.on("error", () => finish(interpretShellExit(127, stdout, stderr)));
    });
  }
}

export const hookSystem = new HookSystem();
