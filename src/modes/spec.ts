/**
 * spec/index.ts — spec 三件套 + Plan 5 阶段落地（N8 / A17）
 *
 * 落盘：`.wllm/specs/<name>/{requirements.md, design.md, tasks.md, plan.md, status.json}`
 * 5 阶段：探索(plan 模式) → 写 plan.md → 自校验 validatePlan → 呈现 → 批准 approveSpec
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";

export const SPEC_FILES = {
  requirements: "requirements.md",
  design: "design.md",
  tasks: "tasks.md",
  plan: "plan.md",
} as const;

export type SpecTask = {
  id: string;
  content: string;
  status: "pending" | "done";
  depends: string[];
};

export type SpecSummary = {
  name: string;
  dir: string;
  status: string;
  tasksDone: number;
  tasksTotal: number;
  updatedAt: number;
};

function specRoot(workDir: string): string {
  return join(workDir, ".wllm", "specs");
}

function assertName(name: string): void {
  if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`非法 spec 名：${name || "(空)"}（只允许字母数字与 _-）`);
  }
}

function readStatus(dir: string): string {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "status.json"), "utf-8"));
    return typeof raw?.status === "string" ? raw.status : "draft";
  } catch {
    return "draft";
  }
}

export function createSpec(workDir: string, name: string, goal: string): { dir: string; name: string } {
  assertName(name);
  const root = specRoot(workDir);
  const dir = resolve(root, name);
  if (dir !== resolve(root) && !dir.startsWith(resolve(root) + "/")) {
    throw new Error(`spec 路径越界：${name}`);
  }
  if (existsSync(dir)) throw new Error(`spec 已存在：${name}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, SPEC_FILES.requirements),
    `# 需求 · ${name}\n\n> 目标：${goal}\n\n## 用户故事\n- 作为……我希望……以便……\n\n## 验收标准\n- [ ] \n`,
  );
  writeFileSync(
    join(dir, SPEC_FILES.design),
    `# 设计 · ${name}\n\n## 架构与数据流\n\n## 错误处理\n\n## 测试策略\n`,
  );
  writeFileSync(
    join(dir, SPEC_FILES.tasks),
    `# 任务 · ${name}\n\n> 任务行格式：\`- [ ] T1 描述 @depends T0\`\n\n- [ ] T1 \n`,
  );
  writeFileSync(
    join(dir, SPEC_FILES.plan),
    `# 计划 · ${name}\n\n## 目标\n\n## 涉及文件\n\n## 步骤\n\n## 风险\n`,
  );
  writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "draft", updatedAt: Date.now() }, null, 2));
  return { dir, name };
}

export function listSpecs(workDir: string): SpecSummary[] {
  const root = specRoot(workDir);
  if (!existsSync(root)) return [];
  const out: SpecSummary[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    try {
      const tasks = parseTasks(readText(join(dir, SPEC_FILES.tasks)));
      out.push({
        name: entry.name,
        dir,
        status: readStatus(dir),
        tasksDone: tasks.filter((t) => t.status === "done").length,
        tasksTotal: tasks.length,
        updatedAt: statSync(dir).mtimeMs,
      });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

export function loadSpec(
  workDir: string,
  name: string,
): { dir: string; requirements: string; design: string; tasks: string; plan: string; status: string } {
  assertName(name);
  const dir = resolve(specRoot(workDir), name);
  if (!existsSync(dir)) throw new Error(`spec 不存在：${name}`);
  return {
    dir,
    requirements: readText(join(dir, SPEC_FILES.requirements)),
    design: readText(join(dir, SPEC_FILES.design)),
    tasks: readText(join(dir, SPEC_FILES.tasks)),
    plan: readText(join(dir, SPEC_FILES.plan)),
    status: readStatus(dir),
  };
}

/** 任务行：`- [ ] T1 描述 @depends T0,T2` */
export function parseTasks(text: string): SpecTask[] {
  const out: SpecTask[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*\[( |x|X)\]\s*([A-Za-z0-9_-]+)\s+(.*)$/);
    if (!m) continue;
    let content = m[3];
    const depMatch = content.match(/@depends\s+([^\s]+)/);
    const depends = depMatch
      ? depMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    if (depMatch) content = content.replace(depMatch[0], "").trim();
    out.push({
      id: m[2],
      content,
      status: m[1] === " " ? "pending" : "done",
      depends,
    });
  }
  return out;
}

/**
 * 依赖分 wave（拓扑分层）：同 wave 可并行；环不扩散，环内任务落最后一层
 */
export function buildWaves(tasks: SpecTask[]): SpecTask[][] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const remaining = new Set(tasks.map((t) => t.id));
  const waves: SpecTask[][] = [];
  let guard = tasks.length + 2;

  while (remaining.size > 0 && guard-- > 0) {
    const wave: SpecTask[] = [];
    for (const id of remaining) {
      const t = byId.get(id)!;
      const pending = t.depends.filter((d) => d !== id && remaining.has(d));
      if (pending.length === 0) wave.push(t);
    }
    if (wave.length === 0) {
      waves.push([...remaining].map((id) => byId.get(id)!));
      break;
    }
    for (const t of wave) remaining.delete(t.id);
    waves.push(wave);
  }
  return waves;
}

/** Plan 自校验（阶段③）：结构门禁，本地小模型也能稳定通过 */
export function validatePlan(planText: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const text = planText || "";
  if (!text.trim()) errors.push("plan.md 为空");
  const has = (re: RegExp) => re.test(text);
  if (!/^\s*#{1,3}\s*目标/m.test(text)) errors.push("缺「目标」小节");
  if (!/^\s*#{1,3}\s*涉及文件/m.test(text)) errors.push("缺「涉及文件」小节");
  if (!/^\s*#{1,3}\s*步骤/m.test(text)) errors.push("缺「步骤」小节");
  if (!/^\s*#{1,3}\s*风险/m.test(text)) errors.push("缺「风险」小节");
  if (has(/^\s*#{1,3}\s*步骤/m)) {
    const section = text.split(/^\s*#{1,3}\s*步骤.*$/m)[1] ?? "";
    if (!/^\s*\d+\.\s+\S/m.test(section)) errors.push("「步骤」需要编号列表（1. / 2. …）");
  }
  if (has(/^\s*#{1,3}\s*涉及文件/m)) {
    const section = text.split(/^\s*#{1,3}\s*涉及文件.*$/m)[1] ?? "";
    if (!/[-*]\s+\S/.test(section)) errors.push("「涉及文件」需要列表项");
  }
  return { ok: errors.length === 0, errors };
}

/** 阶段⑤：批准（自校验 + 需求非空 + 有任务），通过则落 status.json */
export function approveSpec(workDir: string, name: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let dir: string;
  try {
    dir = resolve(specRoot(workDir), name);
    assertName(name);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  if (!existsSync(dir)) return { ok: false, errors: [`spec 不存在：${name}`] };

  const requirements = readText(join(dir, SPEC_FILES.requirements))
    .replace(/^#.*$/m, "")
    .replace(/^\s*[-=>#>*].*$/gm, "")
    .trim();
  if (!requirements) errors.push("requirements.md 无实质内容");

  const tasks = parseTasks(readText(join(dir, SPEC_FILES.tasks)));
  if (tasks.length === 0) errors.push("tasks.md 至少要有一个任务行");

  const planCheck = validatePlan(readText(join(dir, SPEC_FILES.plan)));
  if (!planCheck.ok) errors.push(...planCheck.errors);

  if (errors.length > 0) return { ok: false, errors };

  writeFileSync(
    join(dir, "status.json"),
    JSON.stringify({ status: "approved", approvedAt: Date.now(), updatedAt: Date.now() }, null, 2),
  );
  return { ok: true, errors: [] };
}
