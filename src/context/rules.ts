/**
 * 项目规则文件加载器 — 分层（全局/项目/就近）+ @path 引用展开与校验
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";

const RULE_FILE_NAMES = [".tupigcoderules", ".cursorrules", ".clinerules"];
const LOCAL_RULE_NAMES = ["rules.md", ".tupigcoderules"];

export interface ProjectRules {
  source: string;
  content: string;
}

export type RuleTier = "global" | "project" | "local";

export type RuleLayer = {
  tier: RuleTier;
  source: string;
  content: string;
  baseDir: string;
};

function homeDir(): string {
  return process.env.HOME || homedir();
}

function readIfExists(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const c = readFileSync(path, "utf-8").trim();
    return c ? c : null;
  } catch {
    return null;
  }
}

export function resolveRuleLayers(workDir: string, filePath?: string): RuleLayer[] {
  const layers: RuleLayer[] = [];

  const global = readIfExists(join(homeDir(), ".tupigcode", "rules.md"));
  if (global) layers.push({ tier: "global", source: "~/.tupigcode/rules.md", content: global, baseDir: join(homeDir(), ".tupigcode") });

  const projectParts: { source: string; content: string }[] = [];
  for (const name of RULE_FILE_NAMES) {
    const c = readIfExists(join(workDir, name));
    if (c) projectParts.push({ source: name, content: c });
  }
  if (projectParts.length > 0) {
    layers.push({
      tier: "project",
      source: projectParts.map((p) => p.source).join("+"),
      content: projectParts.map((p) => p.content).join("\n\n"),
      baseDir: resolve(workDir),
    });
  }

  if (filePath) {
    const dir = dirname(resolve(workDir, filePath));
    if (dir === resolve(workDir) || dir.startsWith(resolve(workDir))) {
      for (const name of LOCAL_RULE_NAMES) {
        const c = readIfExists(join(dir, name));
        if (c) {
          layers.push({ tier: "local", source: join(dir, name), content: c, baseDir: dir });
          break;
        }
      }
    }
  }

  return layers;
}

export function expandRuleRefs(content: string, baseDir: string): string {
  return content.replace(/^@(\S+)\s*$/gm, (_m, p: string) => {
    const target = resolve(baseDir, p);
    const c = readIfExists(target);
    if (c !== null) return c;
    return `[缺失引用: @${p}（${target} 不存在）]`;
  });
}

export function validateRuleRefs(content: string, baseDir: string): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const re = /^@(\S+)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (!existsSync(resolve(baseDir, m[1]))) missing.push(m[1]);
  }
  return { ok: missing.length === 0, missing };
}

const TIER_TITLE: Record<RuleTier, string> = {
  global: "全局规则",
  project: "项目规则",
  local: "就近规则",
};

export function formatLayersForPrompt(layers: RuleLayer[]): string {
  if (layers.length === 0) return "";
  const blocks: string[] = ["", "## 规则（分层注入）"];
  for (const l of layers) {
    blocks.push("", `### ${TIER_TITLE[l.tier]}（${l.source}）`, "", expandRuleRefs(l.content, l.baseDir));
  }
  return blocks.join("\n");
}

export function loadProjectRules(workDir: string): ProjectRules | null {
  for (const name of RULE_FILE_NAMES) {
    const path = join(workDir, name);
    const c = readIfExists(path);
    if (c) return { source: name, content: c };
  }
  return null;
}

export function formatRulesForPrompt(rules: ProjectRules): string {
  return ["", "## 项目规则", `（来源：${rules.source}）`, "", rules.content, ""].join("\n");
}
