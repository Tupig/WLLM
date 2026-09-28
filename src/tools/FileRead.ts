/**
 * tools/FileRead.ts — 文件读取工具
 */
import { z } from "zod";
import { readFile, stat } from "fs/promises";
import { resolveSandboxPolicy, checkPath, checkBashPaths } from "../services/sandbox.js";
import { buildTool, type ToolUseContext, type ToolResult } from "../Tool.js";
import { safePath } from "../utils/path.js";
import { MAX_FILE_SIZE_BYTES } from "../constants.js";

const FILE_UNCHANGED_STUB = "FILE_UNCHANGED";

export const FileReadInput = z.object({
  file_path: z.string().describe("文件的绝对路径或相对路径"),
  offset: z.number().optional().describe("起始行号（从 0 开始）"),
  limit: z.number().optional().describe("最多读取行数（默认 2000）"),
});

export const FileReadTool = buildTool<string>({
  name: "Read",
  inputSchema: FileReadInput,
  maxResultSizeChars: Infinity,
  description: () => "读取文件内容，返回带行号的完整内容。",
  prompt: () => "读取文件内容。大文件可使用 offset/limit 参数。",
  userFacingName: () => "Read",
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isEnabled: () => true,

  async checkPermissions(input, ctx) {
    const policy = resolveSandboxPolicy(ctx.workDir);
    if (checkPath(policy, safePath(ctx.workDir, (input as any).file_path), "read") === "deny") {
      return { behavior: "deny", message: "沙箱策略：敏感路径禁止读取" } as any;
    }
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<ToolResult<string>> {
    const resolved = safePath(context.workDir, input.file_path);

    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(resolved);
      if (fileStat.isDirectory()) {
        return { data: `错误：${resolved} 是一个目录，请使用 Glob 工具。` };
      }
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        return { data: `错误：文件过大（${(fileStat.size / 1024 / 1024).toFixed(1)}MB）` };
      }
    } catch {
      return { data: `错误：文件未找到：${resolved}` };
    }

    const existing = context.readFileState.get(resolved);
    if (existing && existing.mtime === fileStat.mtimeMs) {
      return { data: FILE_UNCHANGED_STUB, resultForAssistant: FILE_UNCHANGED_STUB };
    }

    const content = await readFile(resolved, "utf-8");
    context.readFileState.set(resolved, { mtime: fileStat.mtimeMs });

    const lines = content.split("\n");
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 2000;
    const slice = lines.slice(offset, offset + limit);
    const numbered = slice.map((line, i) => `${offset + i + 1}: ${line}`).join("\n");

    let info = `${resolved}（共 ${lines.length} 行）`;
    if (offset > 0 || slice.length < lines.length) {
      info += `\n显示第 ${offset + 1}-${offset + slice.length} 行，共 ${lines.length} 行`;
    }
    return { data: `${info}\n\n${numbered}`, resultForAssistant: `${info}\n\n${numbered}` };
  },

  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: "tool_result", tool_use_id: toolUseID, content };
  },
});
