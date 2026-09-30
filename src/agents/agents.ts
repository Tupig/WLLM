/**
 * subagent/agents.ts — 子代理定义（agent 文件）与工具掩码（A15）
 *
 * 门禁对齐 skills：
 *   ① 路径限定在 agents root 内（防穿越）
 *   ② frontmatter 必须含 description（否则不注册）
 *   ③ 单文件 ≤ MAX_AGENT_BYTES
 * 固定黑名单对所有子代理恒生效（防嵌套委派与任务清单污染）。
 */
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";

export const MAX_AGENT_BYTES = 50_000;
export const AGENT_CATALOG_BUDGET = 1_500;

/** 任何子代理都拿不到的工具（嵌套默认关闭 + todo 不入子代理） */
export const SUBAGENT_FIXED_DENY = ["Agent", "Task", "TodoWrite"];

export type AgentDef = {
  name: string;
  description: string;
  systemPrompt: string;
  /** 工具白名单（空/缺省 = 全部可用工具） */
  tools?: string[];
  /** 工具黑名单（优先于白名单） */
  disallowedTools?: string[];
  /** 只读代理：只留只读工具 */
  readOnly?: boolean;
  model?: string;
  maxTurns?: number;
  builtin?: boolean;
  path?: string;
};

export function parseAgentFile(raw: string, fallbackName: string): AgentDef | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  const description = meta.description;
  if (!description) return null;

  const name = meta.name || fallbackName;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;

  const list = (v?: string) =>
    v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const maxTurns = meta.maxTurns ? Number(meta.maxTurns) : undefined;

  return {
    name,
    description,
    systemPrompt: (m[2] ?? "").trim(),
    tools: list(meta.tools),
    disallowedTools: list(meta.disallowedTools),
    readOnly: meta.readOnly === "true" || meta.readOnly === "yes",
    model: meta.model || undefined,
    maxTurns: Number.isFinite(maxTurns) && (maxTurns as number) > 0 ? maxTurns : undefined,
  };
}

export function builtinAgents(): AgentDef[] {
  return [
    {
      name: "explore",
      description: "只读探索：搜索与阅读代码，返回结论摘要，不改任何文件",
      systemPrompt:
        "你是只读探索代理。只使用搜索/读取工具，绝不修改文件。把大段读取消化在自己的上下文里，只向调用方返回精炼结论与文件位置。",
      readOnly: true,
      builtin: true,
      maxTurns: 15,
    },
    {
      name: "general",
      description: "通用子代理：在隔离上下文里完成一段自包含任务并返回结果",
      systemPrompt:
        "你是通用子代理。你的上下文里没有主会话历史，任务描述即全部输入；信息不足就先自行查证。完成后只返回结论，不复述过程。",
      builtin: true,
      maxTurns: 10,
    },
  ];
}

function agentsRoot(workDir: string): string {
  return join(workDir, ".tupigcode", "agents");
}

/**
 * 加载 agent 注册表：内置 → 用户目录 → 项目目录（后者覆盖前者）
 */
export function loadAgents(workDir: string, homeDir?: string): Map<string, AgentDef> {
  const reg = new Map<string, AgentDef>();
  for (const a of builtinAgents()) reg.set(a.name, a);

  const dirs: string[] = [];
  const home = homeDir ?? process.env.HOME ?? "";
  if (home) dirs.push(join(home, ".tupigcode", "agents"));
  dirs.push(agentsRoot(workDir));

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const file = join(dir, entry.name);
      try {
        if (statSync(file).size > MAX_AGENT_BYTES) continue;
        const def = parseAgentFile(readFileSync(file, "utf-8"), entry.name.replace(/\.md$/, ""));
        if (!def) continue;
        reg.set(def.name, { ...def, path: file });
      } catch {
        continue;
      }
    }
  }
  return reg;
}

export type MaskableTool = { name: string; isReadOnly(input: any): boolean };

/**
 * 工具掩码：固定黑名单 → 白名单交集 → 黑名单（优先）→ readOnly 裁剪
 */
export function maskTools<T extends MaskableTool>(tools: T[], def?: Partial<AgentDef>): T[] {
  let out = [...tools];
  const fixed = new Set(SUBAGENT_FIXED_DENY);
  out = out.filter((t) => !fixed.has(t.name));
  if (def?.tools?.length) {
    const allow = new Set(def.tools);
    out = out.filter((t) => allow.has(t.name));
  }
  if (def?.disallowedTools?.length) {
    const deny = new Set(def.disallowedTools);
    out = out.filter((t) => !deny.has(t.name));
  }
  if (def?.readOnly) out = out.filter((t) => t.isReadOnly({}));
  return out;
}

/** 子代理工具目录（注入 Task/Agent 工具描述，供主模型按 description 选型） */
export function formatAgentCatalog(
  defs: Iterable<{ name: string; description: string }>,
  budget = AGENT_CATALOG_BUDGET,
): string {
  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  let total = 0;
  for (const d of defs) {
    total++;
    const line = `- ${d.name}：${d.description}`;
    if (used + line.length > budget) continue;
    lines.push(line);
    used += line.length + 1;
    shown++;
  }
  if (shown === 0) return "";
  const more = total - shown > 0 ? `\n（其余 ${total - shown} 个子代理未展示）` : "";
  return lines.join("\n") + more;
}

/** 模型解析：task.model > agent.model > 父会话模型 > 环境默认 */
export function resolveSubAgentModel(
  task: { model?: string },
  def: Partial<AgentDef> | undefined,
  context: { options: { mainLoopModel?: string } },
): string {
  return task.model || def?.model || context.options.mainLoopModel || process.env.TUPIG_MODEL || "default_model";
}
