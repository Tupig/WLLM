/**
 * hooks/system.ts — Hook 系统
 */
import { spawn } from "child_process";

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
}

export type HookResult = {
  block?: boolean;
  replacement?: string;
  message?: string;
};

export type HookHandler = (
  ctx: HookContext,
) => Promise<HookResult | void> | HookResult | void;

export type HookMatcher = {
  event: HookEvent;
  matcher?: { tool_name?: string };
  handler: HookHandler;
  type?: HookType;
  timeout?: number;
};

export class HookSystem {
  private matchers: HookMatcher[] = [];

  register(matcher: HookMatcher): void {
    this.matchers.push(matcher);
  }

  async trigger(event: HookEvent, ctx: HookContext): Promise<HookResult> {
    const matching = this.matchers.filter((m) => {
      if (m.event !== event) return false;
      if (m.matcher?.tool_name && m.matcher.tool_name !== ctx.toolName) return false;
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
        if (process.env.PILOT_DEBUG) {
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
        finish({});
      }, timeoutMs);

      child.on("close", () => {
        try {
          const parsed = JSON.parse(stdout);
          finish({ block: parsed.block === true, replacement: parsed.replacement, message: parsed.message });
        } catch {
          finish({});
        }
      });

      child.on("error", () => finish({}));
    });
  }
}

export const hookSystem = new HookSystem();
