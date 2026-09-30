/**
 * N3 会话检查点（A4）：git 快照 + 回滚
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { snapshot, listCheckpoints, rollbackCheckpoint } from "../src/session/checkpoint";

let dir: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf-8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tupigcode-ckpt-"));
  git("init", "-q");
  fs.writeFileSync(path.join(dir, "a.txt"), "v1\n");
  git("add", ".");
  git("commit", "-qm", "init");
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("snapshot 快照", () => {
  it("有改动 → 创建检查点并记录 jsonl", async () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "v2\n");
    const r = await snapshot(dir, "改了a");
    expect(r).not.toBeNull();
    expect(r!.label).toBe("改了a");
    expect(r!.sha).toMatch(/^[0-9a-f]{7,40}$/);
    const list = await listCheckpoints(dir);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(r!.id);
  });
  it("无改动 → null", async () => {
    const r = await snapshot(dir, "空转");
    expect(r).toBeNull();
  });
  it("多次快照按时间倒序列出", async () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "v2");
    await snapshot(dir, "第一");
    fs.writeFileSync(path.join(dir, "a.txt"), "v3");
    await snapshot(dir, "第二");
    const list = await listCheckpoints(dir);
    expect(list.length).toBe(2);
    expect(list[0].label).toBe("第二");
  });
  it("非 git 目录 → null", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "tupigcode-plain-"));
    const r = await snapshot(plain, "x");
    fs.rmSync(plain, { recursive: true, force: true });
    expect(r).toBeNull();
  });
});

describe("rollbackCheckpoint 回滚", () => {
  it("回滚到检查点 → 文件内容恢复", async () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "v2-changed");
    const ck = await snapshot(dir, "v2点");
    expect(ck).not.toBeNull();
    fs.writeFileSync(path.join(dir, "a.txt"), "v3-discard");
    const r = await rollbackCheckpoint(dir, ck!.id);
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf-8")).toContain("v2-changed");
  });
  it("回滚前自动生成安全检查点", async () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "v2");
    const ck = await snapshot(dir, "v2点");
    fs.writeFileSync(path.join(dir, "a.txt"), "v3-unsafe");
    await rollbackCheckpoint(dir, ck!.id);
    const list = await listCheckpoints(dir);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].label).toMatch(/安全|safety/);
  });
  it("不存在的 id → ok:false", async () => {
    const r = await rollbackCheckpoint(dir, "nope-123");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/不存在/);
  });
});
