/**
 * tools.ts — 工具注册表
 */
import type { Tool } from "./Tool.js";
import { FileReadTool } from "./tools/FileRead.js";
import { FileWriteTool } from "./tools/FileWrite.js";
import { FileEditTool } from "./tools/FileEdit.js";
import { GlobTool } from "./tools/Glob.js";
import { GrepTool } from "./tools/Grep.js";
import { BashTool } from "./tools/Bash.js";
import { GitStatusTool, GitDiffTool, GitCommitTool, GitUndoTool } from "./git/tools.js";
import { WebSearchTool, WebFetchTool } from "./tools/Web.js";
import { ImageReadTool, DocReadTool } from "./tools/DocRead.js";
import {
  RenameSymbolTool, ExtractFunctionTool, MoveFileTool,
  InlineVariableTool, ExtractConstantTool,
} from "./tools/Refactor.js";
import {
  CodeStatsTool, ListFunctionsTool, DependencyAnalysisTool,
  ComplexityAnalysisTool,
} from "./tools/Analysis.js";
import {
  PackageInstallTool, PackageUninstallTool, PackageListTool,
  RunScriptTool,
} from "./tools/PackageManager.js";

export function getDefaultTools(): Tool[] {
  return [
    // 文件操作
    FileReadTool, FileWriteTool, FileEditTool,
    GlobTool, GrepTool, BashTool,
    // Git
    GitStatusTool, GitDiffTool, GitCommitTool, GitUndoTool,
    // Web
    WebSearchTool, WebFetchTool,
    // 文档
    ImageReadTool, DocReadTool,
    // 重构
    RenameSymbolTool, ExtractFunctionTool, MoveFileTool,
    InlineVariableTool, ExtractConstantTool,
    // 分析
    CodeStatsTool, ListFunctionsTool, DependencyAnalysisTool,
    ComplexityAnalysisTool,
    // 包管理
    PackageInstallTool, PackageUninstallTool, PackageListTool,
    RunScriptTool,
  ];
}

export function getToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find((t) => t.name === name || t.aliases?.includes(name));
}

export function filterToolsByReadOnly(tools: Tool[], input: Record<string, unknown>): Tool[] {
  return tools.filter((t) => t.isReadOnly(input));
}

export function filterToolsByConcurrency(tools: Tool[], input: Record<string, unknown>): Tool[] {
  return tools.filter((t) => t.isConcurrencySafe(input));
}
