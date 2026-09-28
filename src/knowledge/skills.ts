/**
 * skills/index.ts — 技能：披露预算 + 三重门禁 + 技能包（A12）
 * 门禁①：路径限定在 skills root 内（防穿越）
 * 门禁②：frontmatter 必须含 name+description（否则不入目录/不可加载）
 * 门禁③：单文件 ≤ MAX_SKILL_BYTES
 */
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";

export const SKILL_CATALOG_BUDGET = 3_000;
export const MAX_SKILL_BYTES = 100_000;

export type SkillMeta = {
  name: string;
  description: string;
  dir: string;
};

export type SkillPackage = SkillMeta & {
  body: string;
  path: string;
};

function skillsRoot(workDir: string): string {
  return join(workDir, ".wllm", "skills");
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2] ?? "" };
}

export function loadSkills(workDir: string): SkillMeta[] {
  const root = skillsRoot(workDir);
  if (!existsSync(root)) return [];
  const out: SkillMeta[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      const parsed = parseFrontmatter(readFileSync(file, "utf-8"));
      if (!parsed) continue;
      const { name, description } = parsed.meta;
      if (!name || !description) continue;
      out.push({ name, description, dir: join(root, entry.name) });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function formatSkillCatalog(skills: SkillMeta[]): string {
  if (skills.length === 0) return "";
  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  for (const s of skills) {
    const line = `- ${s.name}：${s.description}`;
    if (used + line.length > SKILL_CATALOG_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
    shown++;
  }
  if (shown < skills.length) {
    lines.push(`（其余 ${skills.length - shown} 个技能未展示，用 /skill <name> 查看）`);
  }
  return ["", "## 技能目录", "（用 /skill <name> 加载完整技能）", "", ...lines, ""].join("\n");
}

export function resolveSkill(workDir: string, name: string): SkillPackage | null {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return null;
  const root = resolve(skillsRoot(workDir));
  const dir = resolve(root, name);
  if (dir !== root && !dir.startsWith(root + "/")) return null;

  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return null;
  try {
    if (statSync(file).size > MAX_SKILL_BYTES) return null;
    const parsed = parseFrontmatter(readFileSync(file, "utf-8"));
    if (!parsed) return null;
    const { name: fmName, description } = parsed.meta;
    if (!fmName || !description) return null;
    return { name: fmName, description, dir, body: parsed.body.trim(), path: file };
  } catch {
    return null;
  }
}
