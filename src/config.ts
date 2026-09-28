/**
 * 配置文件管理
 *
 * 支持项目级配置文件 .pilot/config.json
 * 以及全局配置 ~/.pilot/config.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface PilotConfig {
  /** 默认模型 */
  model?: string;
  /** 最大输出 Token */
  maxTokens?: number;
  /** 最大轮次 */
  maxTurns?: number;
  /** 权限模式 */
  permissionMode?: "plan" | "default" | "acceptEdits" | "bypassPermissions";
  /** 允许的工具 */
  allowedTools?: string[];
  /** 禁止的工具 */
  disabledTools?: string[];
  /** 是否启用轨迹记录 */
  enableTrajectory?: boolean;
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 自定义系统提示词 */
  systemPrompt?: string;
  /** 附加系统提示词 */
  appendSystemPrompt?: string;
  /** Linter 命令 */
  linterCommand?: string;
  /** 自定义工具路径 */
  customTools?: string[];
  /** Hook 脚本 */
  hooks?: {
    preToolUse?: string[];
    postToolUse?: string[];
    preCompact?: string[];
    postCompact?: string[];
  };
  /** 扩展字段 */
  [key: string]: unknown;
}

const GLOBAL_CONFIG_DIR = join(homedir(), ".pilot");
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, "config.json");
const PROJECT_CONFIG_FILE = "config.json";

/**
 * 全局默认配置
 */
const DEFAULT_CONFIG: PilotConfig = {
  model: "claude-sonnet-4-20250514",
  maxTokens: 8192,
  maxTurns: 20,
  permissionMode: "default",
  enableTrajectory: false,
  enableCache: true,
};

/**
 * 加载全局配置
 */
export function loadGlobalConfig(): PilotConfig {
  return loadConfigFromFile(GLOBAL_CONFIG_FILE);
}

/**
 * 加载项目配置
 */
export function loadProjectConfig(workDir: string): PilotConfig {
  const projectConfigPath = join(workDir, ".pilot", PROJECT_CONFIG_FILE);
  return loadConfigFromFile(projectConfigPath);
}

/**
 * 合并配置（项目配置优先于全局配置）
 */
export function mergeConfigs(
  globalConfig: PilotConfig,
  projectConfig: PilotConfig,
): PilotConfig {
  return {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...projectConfig,
  };
}

/**
 * 获取完整配置
 */
export function getConfig(workDir: string): PilotConfig {
  const globalConfig = loadGlobalConfig();
  const projectConfig = loadProjectConfig(workDir);
  return mergeConfigs(globalConfig, projectConfig);
}

/**
 * 保存项目配置
 */
export function saveProjectConfig(workDir: string, config: PilotConfig): void {
  const configDir = join(workDir, ".pilot");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  const configPath = join(configDir, PROJECT_CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * 保存全局配置
 */
export function saveGlobalConfig(config: PilotConfig): void {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * 从文件加载配置
 */
function loadConfigFromFile(filePath: string): PilotConfig {
  if (!existsSync(filePath)) return {};
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as PilotConfig;
  } catch {
    return {};
  }
}

/**
 * 格式化配置为可读文本
 */
export function formatConfig(config: PilotConfig): string {
  const lines: string[] = ["Pilot 配置："];

  if (config.model) lines.push(`  模型：${config.model}`);
  if (config.maxTokens) lines.push(`  最大 Token：${config.maxTokens}`);
  if (config.maxTurns) lines.push(`  最大轮次：${config.maxTurns}`);
  if (config.permissionMode) lines.push(`  权限模式：${config.permissionMode}`);
  if (config.enableTrajectory) lines.push(`  轨迹记录：已启用`);
  if (config.enableCache) lines.push(`  工具缓存：已启用`);
  if (config.allowedTools?.length) lines.push(`  允许工具：${config.allowedTools.join(", ")}`);
  if (config.disabledTools?.length) lines.push(`  禁用工具：${config.disabledTools.join(", ")}`);
  if (config.customTools?.length) lines.push(`  自定义工具：${config.customTools.join(", ")}`);

  return lines.join("\n");
}

export { DEFAULT_CONFIG };
