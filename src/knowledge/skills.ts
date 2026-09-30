/**
 * skills/index.ts — 技能：披露预算 + 三重门禁 + 技能包（A12）
 * 门禁①：路径限定在 skills root 内（防穿越）
 * 门禁②：frontmatter 必须含 name+description（否则不入目录/不可加载）
 * 门禁③：单文件 ≤ MAX_SKILL_BYTES
 */
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

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
  return join(workDir, ".tupigcode", "skills");
}

/** 内置技能包根目录（src/knowledge/skills → dist/knowledge/skills） */
export const BUILTIN_SKILLS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "skills");

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

function scanRoot(root: string): SkillMeta[] {
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
  return out;
}

/**
 * 技能目录：用户 `.tupigcode/skills/` 优先，同名覆盖内置包；
 * 内置包（src/knowledge/skills）静态装载，门禁与用户包一致（issue #19）。
 */
export function loadSkills(workDir: string): SkillMeta[] {
  const out = scanRoot(skillsRoot(workDir)); // 用户条目全保留（用户内重名可被 diag 检出）
  const userNames = new Set(out.map((s) => s.name));
  for (const s of scanRoot(BUILTIN_SKILLS_ROOT)) {
    if (!userNames.has(s.name)) out.push(s); // 同名被用户覆盖 → 内置不入场
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

function tryResolveFrom(root: string, name: string): SkillPackage | null {
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

/** 解析技能：用户目录优先，未命中/被门禁挡则回落内置（issue #19） */
export function resolveSkill(workDir: string, name: string): SkillPackage | null {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return null;
  return tryResolveFrom(resolve(skillsRoot(workDir)), name)
    ?? tryResolveFrom(resolve(BUILTIN_SKILLS_ROOT), name);
}
