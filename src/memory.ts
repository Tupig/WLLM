/**
 * memory.ts — 记忆：先审后存（A11），存取与提示注入
 */
import { mkdir, readFile, appendFile } from "fs/promises";
import { readFileSync } from "fs";
import { join } from "path";

export type MemoryEntry = {
  id: string;
  category: string;
  content: string;
  createdAt: string;
  approved: boolean;
};

function entriesPath(workDir: string): string {
  return join(workDir, ".wllm", "memory", "entries.jsonl");
}

export function stageMemory(input: { category?: string; content: string }): MemoryEntry {
  return {
    id: `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    category: (input.category ?? "通用").slice(0, 40),
    content: input.content.trim().slice(0, 2000),
    createdAt: new Date().toISOString(),
    approved: false,
  };
}

export async function commitMemory(
  workDir: string,
  staged: MemoryEntry,
  approved: boolean,
): Promise<boolean> {
  if (!approved || !staged.content.trim()) return false;
  await mkdir(join(workDir, ".wllm", "memory"), { recursive: true });
  await appendFile(
    entriesPath(workDir),
    JSON.stringify({ ...staged, approved: true }) + "\n",
    "utf-8",
  );
  return true;
}

export async function loadMemories(workDir: string): Promise<MemoryEntry[]> {
  try {
    const raw = await readFile(entriesPath(workDir), "utf-8");
    const out: MemoryEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (typeof e.content === "string" && e.content.trim()) {
          out.push({
            id: String(e.id ?? ""),
            category: String(e.category ?? "通用"),
            content: e.content,
            createdAt: String(e.createdAt ?? ""),
            approved: true,
          });
        }
      } catch {
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function loadMemoriesSync(workDir: string): MemoryEntry[] {
  try {
    const raw = readFileSync(entriesPath(workDir), "utf-8");
    const out: MemoryEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (typeof e.content === "string" && e.content.trim()) {
          out.push({
            id: String(e.id ?? ""),
            category: String(e.category ?? "通用"),
            content: e.content,
            createdAt: String(e.createdAt ?? ""),
            approved: true,
          });
        }
      } catch {
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m) => `- [${m.category}] ${m.content}`);
  return ["", "## 记忆", "（用户已确认的持久记忆，遵循之）", "", ...lines, ""].join("\n");
}
