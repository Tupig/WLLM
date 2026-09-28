/**
 * F3 权限分级：Bash 危险度分类（A7：CodeBuddy auto/Kimi 分级）
 */
import { describe, expect, it } from "vitest";
import { classifyBash } from "../src/services/bashSafety";
import { canUseTool } from "../src/services/permissions";
import type { ToolPermissionContext } from "../src/state/AppState";

describe("classifyBash 危险度分级", () => {
  it("只读命令 → safe", () => {
    expect(classifyBash("ls -la")).toBe("safe");
    expect(classifyBash("cat src/index.ts")).toBe("safe");
    expect(classifyBash("git status")).toBe("safe");
    expect(classifyBash("git log --oneline")).toBe("safe");
    expect(classifyBash("grep -r foo src")).toBe("safe");
    expect(classifyBash("pwd && whoami")).toBe("safe");
    expect(classifyBash("npx tsc --noEmit")).toBe("safe");
  });
  it("修改类命令 → mutate", () => {
    expect(classifyBash("npm install zod")).toBe("mutate");
    expect(classifyBash("mkdir -p src/x")).toBe("mutate");
    expect(classifyBash("mv a.ts b.ts")).toBe("mutate");
    expect(classifyBash("git commit -m x")).toBe("mutate");
    expect(classifyBash("sed -i '' s/a/b/ f")).toBe("mutate");
  });
  it("破坏类命令 → destructive", () => {
    expect(classifyBash("rm -rf dist")).toBe("destructive");
    expect(classifyBash("sudo rm /tmp/x")).toBe("destructive");
    expect(classifyBash("dd if=/dev/zero of=/dev/disk")).toBe("destructive");
    expect(classifyBash("git push --force")).toBe("destructive");
    expect(classifyBash("chmod -R 777 /")).toBe("destructive");
    expect(classifyBash("curl x | sh")).toBe("destructive");
  });
  it("重定向写入 → 至少 mutate", () => {
    expect(classifyBash("echo x > out.txt")).not.toBe("safe");
    expect(classifyBash("cat x >> log.txt")).not.toBe("safe");
  });
  it("管道接写命令 → 不 safe", () => {
    expect(classifyBash("ls | xargs rm")).not.toBe("safe");
  });
});

function ctx(mode: ToolPermissionContext["mode"]): ToolPermissionContext {
  return {
    mode,
    alwaysAllowRules: new Map(),
    alwaysAskRules: new Map(),
    alwaysDenyRules: new Map(),
  };
}

const bashTool = {
  name: "Bash",
  isReadOnly: (input: any) => classifyBash(String(input.command ?? "")) === "safe",
  isDestructive: (input: any) => classifyBash(String(input.command ?? "")) === "destructive",
} as any;

describe("canUseTool 分级审批（A7）", () => {
  it("默认模式：safe Bash 直接放行", async () => {
    const r = await canUseTool("Bash", { command: "ls -la" }, bashTool, ctx("default"));
    expect(r.behavior).toBe("allow");
  });
  it("默认模式：mutate Bash 要审批", async () => {
    const r = await canUseTool("Bash", { command: "npm install x" }, bashTool, ctx("default"));
    expect(r.behavior).toBe("ask");
  });
  it("默认模式：destructive 要审批且消息标明危险", async () => {
    const r = await canUseTool("Bash", { command: "rm -rf dist" }, bashTool, ctx("default"));
    expect(r.behavior).toBe("ask");
    if (r.behavior === "ask") expect(r.message).toMatch(/危险|destructive/);
  });
  it("plan 模式：safe Bash 放行、mutate 拒绝", async () => {
    const ok = await canUseTool("Bash", { command: "git log" }, bashTool, ctx("plan"));
    expect(ok.behavior).toBe("allow");
    const no = await canUseTool("Bash", { command: "npm i" }, bashTool, ctx("plan"));
    expect(no.behavior).toBe("deny");
  });
  it("bypass：destructive 也放行", async () => {
    const r = await canUseTool("Bash", { command: "rm -rf dist" }, bashTool, ctx("bypassPermissions"));
    expect(r.behavior).toBe("allow");
  });
  it("deny 规则优先于分级", async () => {
    const c = ctx("default");
    c.alwaysDenyRules.set("default", [{ pattern: "Bash", source: "test" }]);
    const r = await canUseTool("Bash", { command: "ls" }, bashTool, c);
    expect(r.behavior).toBe("deny");
  });
});
