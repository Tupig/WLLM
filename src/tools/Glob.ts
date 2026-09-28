/**
 * tools/Glob.ts — 文件查找工具
 */
import { z } from "zod";
import { glob } from "glob";
import { buildTool, type ToolUseContext, type ToolResult } from "../engine/Tool.js";
import { safePath } from "../utils/path.js";
import { MAX_GLOB_RESULTS } from "../engine/constants.js";

export const GlobInput = z.object({
  pattern: z.string().describe("Glob 匹配模式（例如 '**/*.ts'、'src/**/*.tsx'）"),
  path: z.string().optional().describe("搜索起始目录"),
});

export const GlobTool = buildTool<string>({
  name: "Glob",
  inputSchema: GlobInput,
  description: () => "按模式查找匹配的文件。",
  prompt: () => "使用 glob 模式查找文件。'**' 匹配嵌套目录。",
  userFacingName: () => "Glob",
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isEnabled: () => true,

  async checkPermissions(input, _ctx) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<ToolResult<string>> {
    const searchPath = input.path ? safePath(context.workDir, input.path) : context.workDir;
    const start = Date.now();

    try {
      const matches = await glob(input.pattern, { cwd: searchPath, absolute: false, dot: true });
      const durationMs = Date.now() - start;
      const truncated = matches.length > MAX_GLOB_RESULTS;
      const filenames = truncated ? matches.slice(0, MAX_GLOB_RESULTS) : matches;

      let result = `找到 ${matches.length} 个文件（${durationMs}ms）：\n${filenames.join("\n")}`;
      if (truncated) result += `\n（已截断，显示前 ${MAX_GLOB_RESULTS} 个，共 ${matches.length} 个）`;
      return { data: result, resultForAssistant: result };
    } catch (err) {
      return { data: `错误：无效的 glob 模式「${input.pattern}」：${err instanceof Error ? err.message : err}` };
    }
  },

  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: "tool_result", tool_use_id: toolUseID, content };
  },
});
