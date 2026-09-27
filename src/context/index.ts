/**
 * 上下文提供者系统
 *
 * 灵感来自 Continue 的 Context Providers：
 * - 用户通过 @ 引用注入上下文
 * - 每个提供者实现标准接口
 * - 支持文件、代码、终端等多种上下文源
 */
import { readFileSync, existsSync } from "fs";
import { join, relative } from "path";
import { globSync } from "glob";
import { safePath } from "../utils/path.js";

export interface ContextItem {
  /** 上下文类型 */
  type: string;
  /** 显示名称 */
  name: string;
  /** 内容 */
  content: string;
  /** 来源文件路径（可选） */
  filePath?: string;
  /** 行号范围（可选） */
  lineRange?: { start: number; end: number };
}

export interface ContextProvider {
  /** 提供者名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 触发前缀（如 @file） */
  prefix: string;
  /** 获取上下文 */
  getContext(query: string, workDir: string): Promise<ContextItem[]>;
}

/**
 * 文件上下文提供者
 * @file <path> - 引用指定文件
 */
export class FileProvider implements ContextProvider {
  name = "file";
  description = "引用工作区文件";
  prefix = "@file";

  async getContext(query: string, workDir: string): Promise<ContextItem[]> {
    let filePath: string;
    try {
      filePath = safePath(workDir, query.trim());
    } catch {
      return [];
    }
    if (!existsSync(filePath)) return [];

    try {
      const content = readFileSync(filePath, "utf-8");
      return [
        {
          type: "file",
          name: relative(workDir, filePath),
          content,
          filePath,
        },
      ];
    } catch {
      return [];
    }
  }
}

/**
 * 目录树上下文提供者
 * @tree <path> - 显示目录结构
 */
export class TreeProvider implements ContextProvider {
  name = "tree";
  description = "显示目录结构";
  prefix = "@tree";

  async getContext(query: string, workDir: string): Promise<ContextItem[]> {
    let targetDir: string;
    try {
      targetDir = query.trim() ? safePath(workDir, query.trim()) : workDir;
    } catch {
      return [];
    }
    if (!existsSync(targetDir)) return [];

    try {
      const items = globSync("**/*", {
        cwd: targetDir,
        ignore: [
          "node_modules/**",
          ".git/**",
          "dist/**",
          "build/**",
          "*.pyc",
          "__pycache__/**",
        ],
        nodir: false,
      });

      const tree = this.buildTree(items);
      return [
        {
          type: "tree",
          name: relative(workDir, targetDir) || ".",
          content: tree,
        },
      ];
    } catch {
      return [];
    }
  }

  private buildTree(items: string[]): string {
    const lines: string[] = [];
    const sorted = items.sort();

    for (const item of sorted) {
      const depth = item.split("/").length - 1;
      const name = item.split("/").pop() || "";
      const indent = "  ".repeat(depth);
      lines.push(`${indent}${name}`);
    }

    return lines.join("\n");
  }
}

/**
 * Diff 上下文提供者
 * @diff - 显示当前 git diff
 */
export class DiffProvider implements ContextProvider {
  name = "diff";
  description = "显示 Git 变更";
  prefix = "@diff";

  async getContext(_query: string, workDir: string): Promise<ContextItem[]> {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      const { stdout } = await execFileAsync("git", ["diff"], {
        cwd: workDir,
        timeout: 5000,
      });

      if (!stdout.trim()) return [];

      return [
        {
          type: "diff",
          name: "Git Diff",
          content: stdout,
        },
      ];
    } catch {
      return [];
    }
  }
}

/**
 * 最近文件上下文提供者
 * @recent - 显示最近编辑的文件
 */
export class RecentProvider implements ContextProvider {
  name = "recent";
  description = "最近编辑的文件";
  prefix = "@recent";

  async getContext(query: string, workDir: string): Promise<ContextItem[]> {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      const count = parseInt(query) || 10;
      const { stdout } = await execFileAsync(
        "git",
        [
          "log",
          `-n${count}`,
          "--pretty=format:",
          "--name-only",
        ],
        { cwd: workDir, timeout: 5000 },
      );

      const files = [...new Set(stdout.trim().split("\n").filter(Boolean))];
      if (files.length === 0) return [];

      return [
        {
          type: "recent",
          name: `最近 ${count} 个文件`,
          content: files.join("\n"),
        },
      ];
    } catch {
      return [];
    }
  }
}

/**
 * 上下文管理器
 */
export class ContextManager {
  private providers: Map<string, ContextProvider> = new Map();

  constructor() {
    // 注册默认提供者
    this.register(new FileProvider());
    this.register(new TreeProvider());
    this.register(new DiffProvider());
    this.register(new RecentProvider());
  }

  /** 注册提供者 */
  register(provider: ContextProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** 获取提供者 */
  getProvider(name: string): ContextProvider | undefined {
    return this.providers.get(name);
  }

  /** 列出所有提供者 */
  listProviders(): ContextProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 解析 @ 引用并获取上下文
   * @param input 用户输入
   * @param workDir 工作目录
   */
  async resolve(input: string, workDir: string): Promise<ContextItem[]> {
    const items: ContextItem[] = [];
    const regex = /@(\w+)(?:\s+([^\s@]+))?/g;
    let match;

    while ((match = regex.exec(input)) !== null) {
      const [, providerName, query] = match;
      const provider = this.getProvider(providerName);
      if (provider) {
        const contextItems = await provider.getContext(query || "", workDir);
        items.push(...contextItems);
      }
    }

    return items;
  }

  /**
   * 将上下文项格式化为提示词片段
   */
  formatForPrompt(items: ContextItem[]): string {
    if (items.length === 0) return "";

    const parts: string[] = ["\n## 引用的上下文"];

    for (const item of items) {
      parts.push(`\n### ${item.name}（${item.type}）`);
      if (item.filePath) {
        parts.push(`路径：${item.filePath}`);
      }
      if (item.lineRange) {
        parts.push(`行号：${item.lineRange.start}-${item.lineRange.end}`);
      }
      parts.push("```");
      parts.push(item.content);
      parts.push("```");
    }

    return parts.join("\n");
  }
}

/**
 * 创建默认上下文管理器
 */
export function createContextManager(): ContextManager {
  return new ContextManager();
}
