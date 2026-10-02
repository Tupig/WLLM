/**
 * reflexion/index.ts — 复盘写回（I4 / A24）
 * 会话结束跑 review 代理，四选一：discard / merge / skill / rule；
 * skill 与 rule 走 staging 先审后存（对齐 I1），每次决策落 `.tupigcode/runs/`。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export type ReviewAction = "discard" | "merge" | "skill" | "rule";
export type ReviewDecision = {
  action: ReviewAction;
  reason: string;
  content?: string;
};

export const RETRO_DIFF_BUDGET = 12_000;
export function buildRetroPrompt(input: { diff: string; failures?: string[] }): string {
  const failures = (input.failures ?? []).filter(Boolean);
  if (!input.diff.trim() && failures.length === 0) {
    return "无可复盘：本次会话没有产生改动，也没有工具失败记录，无需复盘。";
  }
  let diff = input.diff;
  let truncated = false;
  if (diff.length > RETRO_DIFF_BUDGET) {
    diff = diff.slice(0, RETRO_DIFF_BUDGET);
    truncated = true;
  }
  const failText = failures.length
    ? failures.slice(0, 5).map((f, i) => `${i + 1}. ${f.slice(0, 400)}`).join("\n")
    : "（无工具失败记录）";

  return [
    "你是会话复盘（review）代理。基于本次改动与真实失败记录（工具退出码/错误回喂，不是模型自评），在四个动作里选**一个**：",
    "- `discard`：改动无价值，丢弃",
    "- `merge`：改动可保留，无需沉淀",
    "- `skill`：沉淀为可复用技能（content 给 SKILL.md 正文，含触发条件与步骤）",
    "- `rule`：沉淀为项目规则（content 给 AGENTS.md 风格的条目）",
    "",
    "只输出一个 JSON 对象，不要输出其它内容：",
    '{"action":"discard|merge|skill|rule","reason":"一句话依据","content":"skill/rule 时必填"}',
    "",
    "## 真实失败记录",
    failText,
    "",
    "<diff>",
    diff,
    truncated ? "\n…（diff 超预算已截断）" : "",
    "</diff>",
  ].join("\n");
}

function extractJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

export function parseReviewDecision(text: string): ReviewDecision | null {
  const raw = extractJson(text || "");
  if (!raw) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const action = parsed?.action;
  if (!["discard", "merge", "skill", "rule"].includes(action)) return null;
  const reason = typeof parsed.reason === "string" ? parsed.reason : "";
  const content = typeof parsed.content === "string" && parsed.content.trim() ? parsed.content : undefined;
  if ((action === "skill" || action === "rule") && !content) return null;
  return { action, reason, content };
}

/** 从会话消息抽工具失败回喂（is_error），供 prompt 使用；兼容 string 与 content blocks 数组（issue #92） */
export function extractFailures(messages: unknown[]): string[] {
  const out: string[] = [];
  for (const m of messages as any[]) {
    const blocks = Array.isArray(m?.content) ? m.content : [];
    for (const b of blocks) {
      if (b?.type !== "tool_result" || !b.is_error) continue;
      const c = b.content;
      if (typeof c === "string" && c.trim()) {
        out.push(c.slice(0, 500));
        continue;
      }
      if (Array.isArray(c)) {
        const text = c
          .filter((x: any) => x?.type === "text" && typeof x.text === "string")
          .map((x: any) => x.text)
          .join("\n")
          .trim();
        if (text) out.push(text.slice(0, 500));
      }
    }
  }
  return out;
}

export type ApplyResult = {
  applied: boolean;
  runPath: string;
  stagedPath?: string;
  message: string;
};

export function applyReviewDecision(
  workDir: string,
  decision: ReviewDecision,
  id: string,
): ApplyResult {
  const runsDir = join(workDir, ".tupigcode", "runs");
  mkdirSync(runsDir, { recursive: true });
  const runPath = join(runsDir, `${id}.json`);
  const record = { ts: Date.now(), id, ...decision };
  writeFileSync(runPath, JSON.stringify(record, null, 2));

  if (decision.action === "skill") {
    const staging = join(workDir, ".tupigcode", "staging");
    mkdirSync(staging, { recursive: true });
    const stagedPath = join(staging, `skill-${id}.md`);
    writeFileSync(
      stagedPath,
      `---\nname: ${id}\ndescription: ${decision.reason || "复盘沉淀（待审）"}\n---\n\n${decision.content}\n`,
    );
    return {
      applied: true, runPath, stagedPath,
      message: `技能草稿已入 staging（先审后存）：${stagedPath}。审阅后移入 .tupigcode/skills/<name>/SKILL.md`,
    };
  }

  if (decision.action === "rule") {
    const rulesDir = join(workDir, ".tupigcode", "staging", "rules");
    mkdirSync(rulesDir, { recursive: true });
    const stagedPath = join(rulesDir, `rule-${id}.md`);
    writeFileSync(stagedPath, `${decision.content}\n`);
    return {
      applied: true, runPath, stagedPath,
      message: `规则草稿已入 staging：${stagedPath}。审阅后并入 AGENTS.md`,
    };
  }

  return {
    applied: true, runPath,
    message:
      decision.action === "discard"
        ? `改动判定为丢弃，记录已保存：${runPath}`
        : `改动判定为保留（merge），记录已保存：${runPath}`,
  };
}

export type RunRecord = { id: string; action: ReviewAction; reason: string; ts: number };

export function listRuns(workDir: string): RunRecord[] {
  const runsDir = join(workDir, ".tupigcode", "runs");
  if (!existsSync(runsDir)) return [];
  const out: RunRecord[] = [];
  for (const f of readdirSync(runsDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const row = JSON.parse(readFileSync(join(runsDir, f), "utf-8"));
      out.push({ id: row.id ?? f.replace(/\.json$/, ""), action: row.action, reason: row.reason ?? "", ts: row.ts ?? 0 });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => b.ts - a.ts || b.id.localeCompare(a.id));
}
