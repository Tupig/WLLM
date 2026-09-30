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
}

export type HookResult = {
  block?: boolean;
  replacement?: string;
  message?: string;
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
      return {
        block: parsed.block === true,
        replacement: parsed.replacement,
        message: parsed.message,
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
  matcher?: { tool_name?: string; source?: string };
  command: string;
  timeout?: number;
};

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
  matcher?: { tool_name?: string; source?: string };
  handler: HookHandler;
  type?: HookType;
  timeout?: number;
};

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
      if (m.matcher?.tool_name && m.matcher.tool_name !== ctx.toolName) return false;
      if (m.matcher?.source && m.matcher.source !== ctx.source) return false;
      return true;
    });

    let result: HookResult = {};
    for (const m of matching) {
      try {
        const r = await m.handler(ctx);
        if (r) {
          result = { ...result, ...r };
          if (result.block) break;
        }
      } catch (err) {
        if (process.env.TUPIG_DEBUG) {
          console.error(`[Hook] 处理器执行出错：`, err);
        }
      }
    }
    return result;
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
