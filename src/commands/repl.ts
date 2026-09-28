/**
 * REPL 增强
 *
 * 提供自动补全、历史记录、语法高亮等功能。
 * 灵感来自 Node.js REPL 和 IPython。
 */
import { createInterface, Interface } from "readline";
import chalk from "chalk";

export interface REPLConfig {
  /** 提示符 */
  prompt?: string;
  /** 是否启用历史记录 */
  enableHistory?: boolean;
  /** 历史记录文件 */
  historyFile?: string;
  /** 最大历史记录数 */
  maxHistory?: number;
  /** 是否启用自动补全 */
  enableCompletion?: boolean;
}

const DEFAULT_COMMANDS = [
  "/help", "/clear", "/cost", "/model", "/quit",
  "/plan", "/act", "/sessions", "/resume", "/config",
];

/**
 * 创建增强的 REPL
 */
export function createEnhancedREPL(config: REPLConfig = {}): Interface {
  const prompt = config.prompt ?? chalk.green("❯ ");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt,
    history: config.enableHistory !== false ? [] : undefined,
  });

  // 自动补全
  if (config.enableCompletion !== false) {
    rl.on("line", () => {});
  }

  return rl;
}

/**
 * 自动补全函数
 */
export function completer(line: string): [string[], string] {
  const hits = DEFAULT_COMMANDS.filter((cmd) => cmd.startsWith(line.trim()));
  return [hits.length ? hits : DEFAULT_COMMANDS, line];
}

/**
 * 语法高亮
 */
export function highlightInput(input: string): string {
  // 命令高亮
  if (input.startsWith("/")) {
    const parts = input.split(/\s+/);
    const cmd = chalk.cyan.bold(parts[0]);
    const args = parts.slice(1).join(" ");
    return args ? `${cmd} ${args}` : cmd;
  }

  // 文件路径高亮
  if (input.includes("/") || input.includes("\\")) {
    return input.replace(
      /([\/\\][^\s]+)/g,
      (match) => chalk.yellow(match),
    );
  }

  return input;
}

/**
 * 多行输入支持
 */
export class MultiLineInput {
  private lines: string[] = [];
  private inBlock = false;
  private blockDelimiter = '"""';

  /**
   * 处理输入行
   * @returns 如果输入完成返回完整字符串，否则返回 null
   */
  processLine(line: string): string | null {
    // 检查块开始/结束
    if (line.includes(this.blockDelimiter)) {
      if (!this.inBlock) {
        this.inBlock = true;
        this.lines.push(line.replace(this.blockDelimiter, ""));
        return null;
      } else {
        this.inBlock = false;
        this.lines.push(line.replace(this.blockDelimiter, ""));
        const result = this.lines.join("\n");
        this.lines = [];
        return result;
      }
    }

    if (this.inBlock) {
      this.lines.push(line);
      return null;
    }

    // 单行输入
    return line;
  }

  /**
   * 是否在多行模式
   */
  get isMultiLine(): boolean {
    return this.inBlock;
  }

  /**
   * 取消当前输入
   */
  cancel(): void {
    this.inBlock = false;
    this.lines = [];
  }
}

/**
 * 历史记录管理
 */
export class HistoryManager {
  private history: string[] = [];
  private maxSize: number;
  private position = -1;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * 添加记录
   */
  add(entry: string): void {
    if (entry.trim()) {
      this.history.push(entry);
      if (this.history.length > this.maxSize) {
        this.history.shift();
      }
    }
    this.position = this.history.length;
  }

  /**
   * 获取上一条
   */
  previous(): string | null {
    if (this.history.length === 0) return null;
    if (this.position > 0) {
      this.position--;
    }
    return this.history[this.position] ?? null;
  }

  /**
   * 获取下一条
   */
  next(): string | null {
    if (this.position < this.history.length - 1) {
      this.position++;
      return this.history[this.position];
    }
    this.position = this.history.length;
    return "";
  }

  /**
   * 搜索历史
   */
  search(query: string): string[] {
    return this.history.filter((h) => h.includes(query));
  }

  /**
   * 获取所有历史
   */
  getAll(): string[] {
    return [...this.history];
  }
}

/**
 * 输入验证器
 */
export class InputValidator {
  /**
   * 验证命令
   */
  static validateCommand(input: string): { valid: boolean; error?: string } {
    const trimmed = input.trim();
    if (!trimmed) return { valid: false, error: "输入不能为空" };

    if (trimmed.startsWith("/")) {
      const cmd = trimmed.split(/\s+/)[0];
      if (!DEFAULT_COMMANDS.includes(cmd)) {
        return { valid: false, error: `未知命令：${cmd}。输入 /help 查看可用命令` };
      }
    }

    return { valid: true };
  }

  /**
   * 验证文件路径
   */
  static validatePath(path: string): { valid: boolean; error?: string } {
    if (!path.trim()) return { valid: false, error: "路径不能为空" };
    if (path.includes("..")) return { valid: false, error: "路径不能包含 .." };
    return { valid: true };
  }
}
