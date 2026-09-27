/**
 * 项目规则文件加载器
 *
 * 扫描工作目录下的规则文件，注入到系统提示词中。
 * 支持格式：.pilotrules / .cursorrules / .clinerules
 *
 * 规则文件为 Markdown 格式，内容直接拼接到系统提示词末尾。
 * 示例：
 * ```markdown
 * # 项目规则
 * - 使用 TypeScript strict 模式
 * - 提交前必须运行测试
 * - 优先使用函数式编程风格
 * ```
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const RULE_FILE_NAMES = [".pilotrules", ".cursorrules", ".clinerules"];

export interface ProjectRules {
  /** 规则来源文件名 */
  source: string;
  /** 规则内容 */
  content: string;
}

/**
 * 加载项目规则文件
 * @param workDir 工作目录
 * @returns 规则内容，无规则文件返回 null
 */
export function loadProjectRules(workDir: string): ProjectRules | null {
  for (const name of RULE_FILE_NAMES) {
    const path = join(workDir, name);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8").trim();
        if (content) {
          return { source: name, content };
        }
      } catch {
        // 读取失败，跳过
      }
    }
  }
  return null;
}

/**
 * 将规则格式化为可注入系统提示词的文本块
 */
export function formatRulesForPrompt(rules: ProjectRules): string {
  return [
    "",
    "## 项目规则",
    `（来源：${rules.source}）`,
    "",
    rules.content,
    "",
  ].join("\n");
}
