/**
 * 插件系统
 *
 * 允许用户通过配置文件加载自定义工具。
 * 灵感来自 Cline 的 MCP 工具和 SWE-agent 的 Tool Bundles。
 */
import { existsSync } from "fs";
import { join } from "path";
import type { Tool, ToolDefinition } from "../Tool.js";

export interface PluginManifest {
  /** 插件名称 */
  name: string;
  /** 版本 */
  version: string;
  /** 描述 */
  description: string;
  /** 入口文件 */
  entry: string;
  /** 作者 */
  author?: string;
  /** 依赖 */
  dependencies?: string[];
  /** 工具列表 */
  tools: string[];
}

export interface Plugin {
  /** 清单 */
  manifest: PluginManifest;
  /** 加载的工具 */
  tools: Tool[];
}

/**
 * 插件加载器
 */
export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  /**
   * 从目录加载插件
   */
  async loadFromDirectory(pluginDir: string): Promise<Plugin | null> {
    const manifestPath = join(pluginDir, "plugin.json");
    if (!existsSync(manifestPath)) return null;

    try {
      const manifestContent = require(manifestPath) as PluginManifest;
      const entryPath = join(pluginDir, manifestContent.entry);

      if (!existsSync(entryPath)) return null;

      const pluginModule = await import(entryPath);
      const tools: Tool[] = [];

      for (const toolName of manifestContent.tools) {
        const tool = pluginModule[toolName];
        if (tool && typeof tool === "object" && "name" in tool) {
          tools.push(tool as Tool);
        }
      }

      const plugin: Plugin = {
        manifest: manifestContent,
        tools,
      };

      this.plugins.set(manifestContent.name, plugin);
      return plugin;
    } catch {
      return null;
    }
  }

  /**
   * 从配置加载插件
   */
  async loadFromConfig(pluginPaths: string[]): Promise<Plugin[]> {
    const loaded: Plugin[] = [];

    for (const pluginPath of pluginPaths) {
      const fullPath = join(this.workDir, pluginPath);
      const plugin = await this.loadFromDirectory(fullPath);
      if (plugin) {
        loaded.push(plugin);
      }
    }

    return loaded;
  }

  /**
   * 获取所有已加载的工具
   */
  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const plugin of this.plugins.values()) {
      tools.push(...plugin.tools);
    }
    return tools;
  }

  /**
   * 获取插件列表
   */
  listPlugins(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((p) => p.manifest);
  }

  /**
   * 检查插件是否已加载
   */
  isLoaded(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }

  /**
   * 卸载插件
   */
  unload(pluginName: string): boolean {
    return this.plugins.delete(pluginName);
  }
}

/**
 * 创建插件加载器
 */
export function createPluginLoader(workDir: string): PluginLoader {
  return new PluginLoader(workDir);
}
