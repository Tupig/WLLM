/**
 * Git 工具集
 *
 * 提供 Git 操作工具：
 * - GitStatus：查看仓库状态
 * - GitDiff：查看变更
 * - GitCommit：提交变更
 * - GitUndo：撤销提交
 */
import { z } from "zod";
import { defineTool } from "../Tool.js";
import {
  getGitStatus,
  getDiff,
  getWorkingDiff,
  autoCommit,
  undoLastCommit,
  formatGitStatus,
} from "./index.js";

export const GitStatusTool = defineTool({
  name: "GitStatus",
  description: "查看 Git 仓库状态（分支、变更文件等）",
  input: z.object({}),
  readOnly: true,
  async execute(_input, ctx) {
    const status = await getGitStatus(ctx.workDir);
    return formatGitStatus(status);
  },
});

export const GitDiffTool = defineTool({
  name: "GitDiff",
  description: "查看 Git 变更（已提交或未提交的 diff）",
  input: z.object({
    mode: z.enum(["committed", "working"]).optional().describe("committed=已提交变更，working=未提交变更（默认 working）"),
  }),
  readOnly: true,
  async execute(input, ctx) {
    const mode = input.mode || "working";
    if (mode === "committed") {
      const diff = await getDiff(ctx.workDir);
      return diff || "没有已提交的变更";
    }
    const diff = await getWorkingDiff(ctx.workDir);
    return diff || "没有未提交的变更";
  },
});

export const GitCommitTool = defineTool({
  name: "GitCommit",
  description: "暂存并提交变更",
  input: z.object({
    message: z.string().describe("提交信息"),
    files: z.array(z.string()).optional().describe("要提交的文件列表（为空则提交所有变更）"),
  }),
  async execute(input, ctx) {
    const commit = await autoCommit(ctx.workDir, input.message, input.files);
    if (!commit) {
      return "没有可提交的变更，或不在 Git 仓库中";
    }
    return `已提交：${commit.hash.slice(0, 7)} - ${commit.message}`;
  },
});

export const GitUndoTool = defineTool({
  name: "GitUndo",
  description: "撤销上次提交（保留文件变更在工作区）",
  input: z.object({}),
  destructive: true,
  async execute(_input, ctx) {
    const success = await undoLastCommit(ctx.workDir);
    if (!success) {
      return "撤销失败：没有可撤销的提交，或不在 Git 仓库中";
    }
    return "已撤销上次提交，文件变更保留在工作区";
  },
});
