/**
 * engine/lineage.ts — repo-map 变更史注入（Context Lineage，issue #22）
 *
 * git log 近 N 条 → 模型压成短摘要 → 缓存（HEAD 变更才重算）→
 * 摘要随 repo-map 注入 system prompt 尾部（预算截断取最近）。
 * 无 git / 无模型 / 超时 → 静默返回空串，零影响。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ApiClient } from "../services/api.js";

export const LINEAGE_CACHE_REL = ".tupigcode/cache/lineage.json";
const DEFAULT_COMMITS = 30;
const DEFAULT_MAX_CHARS = 800;
const SUMMARIZE_TIMEOUT_MS = 5_000;
const LINEAGE_SYSTEM =
  "你是 git 变更史摘要器。把给定 commit 列表压缩成一段中文短摘要（不超过200字），" +
  "只保留与代码结构、行为、重构方向相关的关键变更，不要列表符号。";

export interface LineageCache {
  head: string;
  summary: string;
  at: string;
}

function gitOut(workDir: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: workDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
  } catch {
    return null;
  }
}

export function gitHead(workDir: string): string | null {
  return gitOut(workDir, ["rev-parse", "HEAD"])?.trim() || null;
}

export function gitRecentLog(workDir: string, n = DEFAULT_COMMITS): string[] | null {
  const out = gitOut(workDir, ["log", `-n`, String(n), "--pretty=format:%h %s"]);
  if (out === null) return null;
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

export async function summarizeLineage(client: ApiClient, model: string, log: string[]): Promise<string> {
  const user = `commit 列表（新→旧）：\n${log.join("\n")}`;
  if (client.type === "mock") return `（mock 变更史摘要：${log.length} 条 commit）`;

  if (client.type === "anthropic" && client.anthropic) {
    const resp = await client.anthropic.messages.create({
      model: model || "claude-haiku-4-20250414",
      max_tokens: 300,
      system: LINEAGE_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    return resp.content[0]?.type === "text" ? resp.content[0].text : "";
  }

  if (client.type === "openai") {
    const base = process.env.OPENAI_BASE_URL;
    const key = process.env.OPENAI_API_KEY;
    if (!base || !key) throw new Error("OPENAI_BASE_URL / OPENAI_API_KEY 未设置");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARIZE_TIMEOUT_MS);
    try {
      const url = base.replace(/\/+$/, "") + (base.includes("/v1") ? "/chat/completions" : "/v1/chat/completions");
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: LINEAGE_SYSTEM },
            { role: "user", content: user },
          ],
          max_tokens: 300,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`变更史摘要返回 ${resp.status}`);
      const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`不支持的 provider：${client.type}`);
}

export function loadLineageCache(workDir: string): LineageCache | null {
  try {
    const p = join(workDir, LINEAGE_CACHE_REL);
    if (!existsSync(p)) return null;
    const c = JSON.parse(readFileSync(p, "utf-8")) as LineageCache;
    return c && typeof c.head === "string" && typeof c.summary === "string" ? c : null;
  } catch {
    return null;
  }
}

export function saveLineageCache(workDir: string, cache: LineageCache): void {
  try {
    const p = join(workDir, LINEAGE_CACHE_REL);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(cache));
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

/** 预算截断：超出取最近（保留尾部） */
export function capLineage(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  return "…" + text.slice(-(maxChars - 1));
}

/**
 * 主入口：返回可注入的变更史摘要；任何失败 → ""（静默跳过）。
 * HEAD 与缓存一致直接命中；否则模型压缩并落缓存；全程 5s 超时兜底。
 */
export async function getLineage(
  workDir: string,
  client: ApiClient,
  model: string,
  opts?: { commits?: number; maxChars?: number },
): Promise<string> {
  try {
    const maxChars = Number(process.env.TUPIG_LINEAGE_MAX_CHARS || opts?.maxChars || DEFAULT_MAX_CHARS);
    const head = gitHead(workDir);
    if (!head) return "";
    const log = gitRecentLog(workDir, opts?.commits);
    if (!log || log.length === 0) return "";

    const cache = loadLineageCache(workDir);
    let summary: string;
    if (cache && cache.head === head) {
      summary = cache.summary;
    } else {
      const race = new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error("lineage 摘要超时")), SUMMARIZE_TIMEOUT_MS),
      );
      summary = await Promise.race([summarizeLineage(client, model, log), race]);
      if (!summary) return "";
      saveLineageCache(workDir, { head, summary, at: new Date().toISOString() });
    }
    return capLineage(summary, maxChars);
  } catch {
    return "";
  }
}
