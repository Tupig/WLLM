/**
 * tools/FileWrite.ts — 文件写入工具
 */
import { z } from "zod";
import { writeFile, mkdir, stat } from "fs/promises";
import { dirname } from "path";
import { buildTool, type ToolUseContext, type ToolResult } from "../Tool.js";
import { safePath } from "../utils/path.js";
import { runPostEditLint, formatLintResult } from "./lint.js";

export const FileWriteInput = z.object({
  file_path: z.string().describe("文件路径"),
  content: z.string().describe("要写入的内容"),
});

export const FileWriteTool = buildTool<string>({
  name: "Write",
  inputSchema: FileWriteInput,
  maxResultSizeChars: 100_000,
  description: () => "将内容写入文件。自动创建父目录，覆盖已有内容。",
  prompt: () => "将内容写入文件，内容会覆盖文件中的现有内容。",
  userFacingName: () => "Write",
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  isEnabled: () => true,

  async checkPermissions(input, _ctx) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<ToolResult<string>> {
    const resolved = safePath(context.workDir, input.file_path);

    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, input.content, "utf-8");

    const s = await stat(resolved);
    context.readFileState.set(resolved, { mtime: s.mtimeMs });

    const lines = input.content.split("\n").length;

    // 写入后 lint 检查
    const lintResult = await runPostEditLint(context.workDir, resolved);
    const lintMsg = lintResult ? "\n" + formatLintResult(lintResult) : "";

    const result = `已写入 ${lines} 行至 ${resolved}${lintMsg}`;
    return { data: result, resultForAssistant: result };
  },

  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: "tool_result", tool_use_id: toolUseID, content };
  },
});
