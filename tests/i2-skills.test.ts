/**
 * I2 技能：披露预算 + 三重门禁 + 技能包（A12）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadSkills, formatSkillCatalog, resolveSkill, SKILL_CATALOG_BUDGET } from "../src/knowledge/skills";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wllm-sk-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function mkSkill(name: string, frontmatter: string, body: string) {
  const d = path.join(dir, ".wllm", "skills", name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
  return d;
}

describe("loadSkills 扫描与门禁禁①②", () => {
  it("合法技能解析 name/description", () => {
    mkSkill("deploy", "name: deploy\ndescription: 一键部署到测试环境", "# 部署步骤\n...");
    const skills = loadSkills(dir);
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("deploy");
    expect(skills[0].description).toContain("部署");
  });
  it("缺 description → 门禁拒绝（不入目录）", () => {
    mkSkill("bad", "name: bad", "body");
    expect(loadSkills(dir)).toEqual([]);
  });
  it("非 SKILL.md 目录忽略", () => {
    const d = path.join(dir, ".wllm", "skills", "nope");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "readme.md"), "x");
    expect(loadSkills(dir)).toEqual([]);
  });
  it("无 skills 目录 → []", () => {
    expect(loadSkills(dir)).toEqual([]);
  });
});

describe("formatSkillCatalog 披露预算（A12）", () => {
  const many = (n: number) => {
    for (let i = 0; i < n; i++) mkSkill(`s${i}`, `name: s${i}\ndescription: 技能${i} ${"详".repeat(120)}`, "b");
  };
  it("预算内全列 name+description", () => {
    mkSkill("a", "name: a\ndescription: 短描述", "b");
    const skills = loadSkills(dir);
    const text = formatSkillCatalog(skills);
    expect(text).toContain("a");
    expect(text).toContain("短描述");
    expect(text.length).toBeLessThanOrEqual(SKILL_CATALOG_BUDGET);
  });
  it("超出预算 → 截断并计数提示", () => {
    many(50);
    const skills = loadSkills(dir);
    const text = formatSkillCatalog(skills);
    expect(text.length).toBeLessThanOrEqual(SKILL_CATALOG_BUDGET);
    expect(text).toMatch(/其余 \d+ 个技能/);
  });
  it("空技能 → 空串", () => {
    expect(formatSkillCatalog([])).toBe("");
  });
});

describe("resolveSkill 三重门禁③ + 技能包", () => {
  it("合法加载：frontmatter+正文全文", () => {
    const d = mkSkill("deploy", "name: deploy\ndescription: 部署", "# 步骤\nrun tests");
    const r = resolveSkill(dir, "deploy");
    expect(r).not.toBeNull();
    expect(r!.body).toContain("run tests");
    expect(r!.path).toBe(path.join(d, "SKILL.md"));
  });
  it("门禁①：路径穿越名 → 拒绝", () => {
    mkSkill("x", "name: x\ndescription: d", "b");
    expect(resolveSkill(dir, "../.wllm/skills/x")).toBeNull();
    expect(resolveSkill(dir, "x/../../other")).toBeNull();
  });
  it("门禁③：超大文件 → 拒绝", () => {
    const d = mkSkill("big", "name: big\ndescription: d", "x".repeat(200_000));
    expect(resolveSkill(dir, "big")).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
  it("不存在 → null", () => {
    expect(resolveSkill(dir, "nope")).toBeNull();
  });
});
