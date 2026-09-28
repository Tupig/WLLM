/**
 * services/sandbox.ts — 沙箱策略：允许写目录 + 敏感路径拦截（A8）
 */
import { homedir } from "os";
import { isAbsolute, resolve } from "path";

export interface SandboxPolicy {
  workDir: string;
  allowedWrite: string[];
  blocked: string[];
}

const DEFAULT_BLOCKED = ["/etc", ".git/hooks", ".ssh", "id_rsa", ".aws/credentials", ".gnupg"];

function expand(p: string): string {
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

export function resolveSandboxPolicy(workDir: string): SandboxPolicy {
  const extraWrite = (process.env.PILOT_SANDBOX_WRITE ?? "")
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(expand);
  const extraDeny = (process.env.PILOT_SANDBOX_DENY ?? "")
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(expand);
  return {
    workDir: resolve(workDir),
    allowedWrite: [resolve(workDir), ...extraWrite],
    blocked: [...DEFAULT_BLOCKED, ...extraDeny],
  };
}

function isBlocked(policy: SandboxPolicy, path: string): boolean {
  const p = expand(path);
  return policy.blocked.some((b) => p.includes(b));
}

export function checkPath(policy: SandboxPolicy, path: string, op: "read" | "write"): "allow" | "deny" {
  const p = expand(path);
  if (isBlocked(policy, p)) return "deny";
  if (op === "read") return "allow";
  const allowed = policy.allowedWrite.some(
    (dir) => p === dir || p.startsWith(dir.endsWith("/") ? dir : dir + "/"),
  );
  return allowed ? "allow" : "deny";
}

export function checkBashPaths(policy: SandboxPolicy, command: string): "allow" | "deny" {
  const expanded = command.replace(/(~\/[^\s'"`]+)/g, (m) => expand(m));
  if (policy.blocked.some((b) => expanded.includes(b))) return "deny";
  return "allow";
}
