/**
 * session.ts — 会话持久化：save/load/list/fork（A5 resume/fork）
 */
import { mkdir, readFile, writeFile, readdir, stat } from "fs/promises";
import { join } from "path";

export type SessionMeta = {
  id: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
};

function sessionsDir(workDir: string): string {
  return join(workDir, ".tupigcode", "sessions");
}

export async function saveSessionMessages(
  workDir: string,
  sessionId: string,
  messages: unknown[],
): Promise<void> {
  await mkdir(sessionsDir(workDir), { recursive: true });
  await writeFile(
    join(sessionsDir(workDir), `${sessionId}.json`),
    JSON.stringify({ updatedAt: new Date().toISOString(), messages }),
    "utf-8",
  );
}

export async function loadSessionMessages<T = unknown>(
  workDir: string,
  sessionId: string,
): Promise<T[] | null> {
  try {
    const raw = await readFile(join(sessionsDir(workDir), `${sessionId}.json`), "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.messages)) return null;
    return data.messages as T[];
  } catch {
    return null;
  }
}

export async function listSessions(workDir: string): Promise<SessionMeta[]> {
  try {
    const files = await readdir(sessionsDir(workDir));
    const metas: SessionMeta[] = [];
    for (const f of files.filter((x) => x.endsWith(".json"))) {
      const p = join(sessionsDir(workDir), f);
      try {
        const raw = await readFile(p, "utf-8");
        const data = JSON.parse(raw);
        const messages: any[] = Array.isArray(data.messages) ? data.messages : [];
        const first = messages.find((m) => typeof m.content === "string" && m.content.length > 0);
        const s = await stat(p);
        metas.push({
          id: f.replace(/\.json$/, ""),
          updatedAt: data.updatedAt ?? s.mtime.toISOString(),
          messageCount: messages.length,
          preview: String(first?.content ?? "").slice(0, 80),
        });
      } catch {
        continue;
      }
    }
    return metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}

export function forkMessages<T extends { role: string; content?: unknown }>(
  messages: T[],
  at: number,
): T[] {
  const cut = messages.slice(0, Math.max(0, Math.min(at, messages.length)));
  const last = cut[cut.length - 1];
  const danglingToolUse =
    last !== undefined &&
    last.role === "assistant" &&
    Array.isArray(last.content) &&
    (last.content as Array<{ type?: string }>).some((b) => b.type === "tool_use");
  if (danglingToolUse) cut.pop();
  return cut;
}
