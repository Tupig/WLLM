/**
 * E35 /resume 列表信息缺口（issue #32）
 * 倒序 / 首条用户 prompt 预览截断 60 字 / 空占位 / 相对时间
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  listSessions,
  truncatePreview,
  relativeTime,
  formatSessionRow,
} from "../src/session/session";

const dir = mkdtempSync(join(tmpdir(), "tupig-resume-"));

function writeSession(id: string, updatedAt: string, messages: any[]) {
  const p = join(dir, ".tupigcode", "sessions");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, `${id}.json`), JSON.stringify({ updatedAt, messages }));
}

beforeAll(() => {
  writeSession("old", "2026-01-01T00:00:00.000Z", [{ role: "user", content: "最早的任务" }]);
  writeSession("new", "2026-06-01T00:00:00.000Z", [{ role: "user", content: "最新任务" }]);
  writeSession("mid", "2026-03-01T00:00:00.000Z", [
    { role: "assistant", content: "这是助手先说话的会话" },
    { role: "user", content: "用户真正发的第一句" },
  ]);
  writeSession("long", "2026-05-01T00:00:00.000Z", [{ role: "user", content: "字".repeat(200) }]);
  writeSession("empty", "2026-04-01T00:00:00.000Z", []);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listSessions", () => {
  it("按 updatedAt 倒序", async () => {
    const list = await listSessions(dir);
    const ids = list.map((s) => s.id);
    expect(ids.indexOf("old")).toBeGreaterThan(ids.indexOf("mid"));
    expect(ids.indexOf("mid")).toBeGreaterThan(ids.indexOf("new"));
    expect(list[0].id).toBe("new");
  });

  it("预览取首条用户消息（跳过 assistant 先发的情况）", async () => {
    const list = await listSessions(dir);
    const mid = list.find((s) => s.id === "mid")!;
    expect(mid.preview).toBe("用户真正发的第一句");
  });

  it("超长 prompt 截断到 60 字", async () => {
    const list = await listSessions(dir);
    const long = list.find((s) => s.id === "long")!;
    expect(long.preview.length).toBe(60);
  });

  it("空会话 preview 为空串（渲染层给占位）", async () => {
    const list = await listSessions(dir);
    const empty = list.find((s) => s.id === "empty")!;
    expect(empty.preview).toBe("");
  });
});

describe("truncatePreview", () => {
  it("60 字截断 + 无占位符污染", () => {
    expect(truncatePreview("a".repeat(100))).toHaveLength(60);
    expect(truncatePreview("短文本")).toBe("短文本");
    expect(truncatePreview("")).toBe("");
  });
});

describe("relativeTime", () => {
  it("刚刚 / 分钟前 / 小时前 / 天前", () => {
    expect(relativeTime(new Date().toISOString())).toBe("刚刚");
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5 分钟前");
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3 小时前");
    expect(relativeTime(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe("2 天前");
    expect(relativeTime("")).toBe("未知时间");
  });
});

describe("formatSessionRow", () => {
  it("含 id / 相对时间 / 条数 / 预览", async () => {
    const list = await listSessions(dir);
    const row = formatSessionRow(list.find((s) => s.id === "mid")!);
    expect(row).toContain("mid");
    expect(row).toContain("2 条");
    expect(row).toContain("用户真正发的第一句");
    expect(row).toContain("前");
  });

  it("空预览显示占位", async () => {
    const list = await listSessions(dir);
    const row = formatSessionRow(list.find((s) => s.id === "empty")!);
    expect(row).toContain("无预览");
  });
});
