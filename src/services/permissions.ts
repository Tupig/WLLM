/**
 * services/permissions.ts — 权限系统
 */
import type { Tool, PermissionResult } from "../engine/Tool.js";
import type { ToolPermissionContext } from "../state/AppState.js";
import { classifyBash } from "./bashSafety.js";
import { getMcpApproval } from "../engine/mcp.js";
import { resolve } from "path";
import chalk from "chalk";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesRule(toolName: string, input: Record<string, unknown>, pattern: string): boolean {
  const match = pattern.match(/^(\w+)(?:\((.+)\))?$/);
  if (!match) return toolName === pattern;

  const [, patternName, argPattern] = match;
  if (toolName !== patternName) return false;

  if (argPattern) {
    const inputStr = JSON.stringify(input);
    const escaped = escapeRegExp(argPattern).replace(/\\\*/g, ".*").replace(/\\\?/g, ".");
    try {
      return new RegExp("^" + escaped + "$").test(inputStr);
    } catch {
      return false;
    }
  }
  return true;
}

function evaluateRules(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolPermissionContext,
): "allow" | "deny" | "ask" | null {
  for (const [, rules] of ctx.alwaysDenyRules) {
    for (const rule of rules) {
      if (matchesRule(toolName, input, rule.pattern)) return "deny";
    }
  }
  for (const [, rules] of ctx.alwaysAskRules) {
    for (const rule of rules) {
      if (matchesRule(toolName, input, rule.pattern)) return "ask";
    }
  }
  for (const [, rules] of ctx.alwaysAllowRules) {
    for (const rule of rules) {
      if (matchesRule(toolName, input, rule.pattern)) return "allow";
    }
  }
  return null;
}

export async function canUseTool(
  toolName: string,
  input: Record<string, unknown>,
  tool: Tool | undefined,
  ctx: ToolPermissionContext,
): Promise<PermissionResult> {
  const { mode } = ctx;

  if (mode === "bypassPermissions") {
    return { behavior: "allow", decisionReason: "bypassPermissions 模式" };
  }

  if (mode === "plan") {
    if (tool?.isReadOnly(input)) {
      return { behavior: "allow", decisionReason: "plan 模式：只读工具" };
    }
    // 唯一可写面：spec/plan 产物（阶段②落盘），路径逃逸在 resolve 后失效
    const artifact = String((input as any).file_path ?? (input as any).path ?? "");
    if (artifact && (toolName === "Write" || toolName === "Edit") && resolve(artifact).includes("/.wllm/specs/")) {
      return { behavior: "allow", decisionReason: "plan 模式：计划产物可写" };
    }
    return { behavior: "deny", message: "plan 模式下不允许写操作", decisionReason: "plan 模式" };
  }

  const ruleResult = evaluateRules(toolName, input, ctx);
  if (ruleResult === "deny") {
    return { behavior: "deny", message: `工具「${toolName}」已被规则禁止`, decisionReason: "deny 规则" };
  }
  if (ruleResult === "ask") {
    return { behavior: "ask", message: `工具「${toolName}」需要审批` };
  }
  if (ruleResult === "allow") {
    return { behavior: "allow", decisionReason: "allow 规则" };
  }

  // MCP 双重审批（issue #10）：通用规则（deny/ask/allow）已判，plan/bypass 已前置拦截
  const mcpDecision = getMcpApproval(toolName);
  if (mcpDecision !== undefined) {
    const env = process.env.PILOT_MCP_APPROVAL;
    if (env === "off") {
      return { behavior: "allow", decisionReason: "PILOT_MCP_APPROVAL=off" };
    }
    if (env === "ask") {
      return { behavior: "ask", message: `MCP 工具「${toolName}」需要用户确认（PILOT_MCP_APPROVAL=ask）` };
    }
    if (mcpDecision === "deny") {
      return { behavior: "deny", message: `MCP 工具「${toolName}」已被 mcp.json 审批禁止`, decisionReason: "mcp deny" };
    }
    if (mcpDecision === "ask") {
      return { behavior: "ask", message: `MCP 工具「${toolName}」需要用户确认（mcp.json 审批）` };
    }
    if (mcpDecision === "allow") {
      return { behavior: "allow", decisionReason: "mcp.json 白名单" };
    }
    // "default"：未配置审批 → 落回通用链（readOnlyHint 分级）
  }

  if (mode === "acceptEdits") {
    if (tool?.isReadOnly(input)) {
      return { behavior: "allow", decisionReason: "acceptEdits：只读" };
    }
    if (tool && !tool.isDestructive?.(input) && toolName !== "Bash") {
      return { behavior: "allow", decisionReason: "acceptEdits：非破坏性写入" };
    }
  }

  if (mode === "dontAsk") {
    return { behavior: "deny", message: "dontAsk 模式：工具未被预先批准", decisionReason: "dontAsk 模式" };
  }

  if (toolName === "Bash" && classifyBash(String(input.command ?? "")) === "destructive") {
    return { behavior: "ask", message: `危险命令（destructive）：${String(input.command).slice(0, 200)}` };
  }

  if (tool?.isReadOnly(input)) {
    return { behavior: "allow", decisionReason: "默认：只读/安全命令" };
  }

  return { behavior: "ask", message: `工具「${toolName}」需要用户确认` };
}

export async function promptUser(toolName: string, input: Record<string, unknown>): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const inputStr = JSON.stringify(input, null, 2);
  const truncated = inputStr.length > 500 ? inputStr.slice(0, 500) + "\n..." : inputStr;

  console.log(chalk.yellow(`\n⚠️  ${toolName}`));
  console.log(chalk.gray(truncated));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      process.stdin.pause();
      resolve(result);
    };

    process.stdout.write(chalk.cyan("允许执行？(y/N) "));
    process.stdin.setEncoding("utf-8");
    process.stdin.resume();

    process.stdin.once("data", (data: string) => {
      const answer = data.trim().toLowerCase();
      finish(answer === "y" || answer === "yes");
    });

    process.stdin.once("close", () => finish(false));
    process.stdin.once("end", () => finish(false));

    // 30 秒超时
    const timeout = setTimeout(() => finish(false), 30_000);
  });
}
