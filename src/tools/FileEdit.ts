/**
 * tools/FileEdit.ts — 文件编辑工具
 */
import { z } from "zod";
import { readFile, writeFile, stat } from "fs/promises";
import { buildTool, type ToolUseContext, type ToolResult } from "../Tool.js";
import { safePath } from "../utils/path.js";
import { runPostEditLint, formatLintResult } from "./lint.js";
import { formatNoMatchFeedback } from "./similar.js";
import { writeWithRollback } from "./rollback.js";
import { resolveSandboxPolicy, checkPath, checkBashPaths } from "../services/sandbox.js";

export const FileEditInput = z.object({
  file_path: z.string().describe("文件路径"),
  old_string: z.string().describe("要查找并替换的精确文本"),
  new_string: z.string().describe("替换后的新文本"),
  replace_all: z.boolean().optional().describe("替换所有匹配项"),
});

function findActualString(content: string, oldString: string): number {
  const idx = content.indexOf(oldString);
  if (idx !== -1) return idx;
  const normalize = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  return normalize(content).indexOf(normalize(oldString));
}

export const FileEditTool = buildTool<string>({
  name: "Edit",
  inputSchema: FileEditInput,
  maxResultSizeChars: 100_000,
  description: () => "通过精确替换文本来编辑文件。old_string 必须精确匹配。",
  prompt: () => "执行精确的字符串替换。old_string 必须在文件中恰好出现一次，除非设置了 replace_all。",
  userFacingName: () => "Edit",
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  isEnabled: () => true,

  async checkPermissions(input, ctx) {
    const policy = resolveSandboxPolicy(ctx.workDir);
    if (checkPath(policy, safePath(ctx.workDir, (input as any).file_path), "write") === "deny") {
      return { behavior: "deny", message: "沙箱策略：目标路径不可写（仅允许工作目录与 PILOT_SANDBOX_WRITE 白名单）" } as any;
    }
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<ToolResult<string>> {
    const resolved = safePath(context.workDir, input.file_path);

    let content: string;
    try {
      content = await readFile(resolved, "utf-8");
    } catch {
      return { data: `错误：文件未找到：${resolved}` };
    }

    const cached = context.readFileState.get(resolved);
    if (cached) {
      try {
        const s = await stat(resolved);
        if (s.mtimeMs !== cached.mtime && cached.mtime !== 0) {
          return { data: "错误：文件在上次读取后已被修改，请重新读取后再编辑。" };
        }
      } catch {}
    }

    const idx = findActualString(content, input.old_string);
    if (idx === -1) {
      const fb = formatNoMatchFeedback(content, input.old_string, resolved);
      return { data: fb, resultForAssistant: fb };
    }

    if (!input.replace_all) {
      const secondIdx = findActualString(content.slice(idx + input.old_string.length), input.old_string);
      if (secondIdx !== -1) {
        return { data: "错误：old_string 匹配了多次。请使用 replace_all 或提供更多上下文。" };
      }
    }

    const lintFn = () => runPostEditLint(context.workDir, resolved);

    if (input.replace_all) {
      const count = content.split(input.old_string).length - 1;
      const next = content.split(input.old_string).join(input.new_string);
      const r = await writeWithRollback(resolved, next, lintFn);
      if (!r.ok) {
        const msg = `${r.error}\n${formatLintResult(r.lint!)}\n请修正后重试，本次替换未生效（${count} 处待替换）`;
        return { data: msg, resultForAssistant: msg };
      }
      const s = await stat(resolved);
      context.readFileState.set(resolved, { mtime: s.mtimeMs });
      const lintMsg = r.lint ? "\n" + formatLintResult(r.lint) : "";
      const result = `已在 ${resolved} 中替换 ${count} 处${lintMsg}`;
      return { data: result, resultForAssistant: result };
    }

    const next = content.slice(0, idx) + input.new_string + content.slice(idx + input.old_string.length);
    const r = await writeWithRollback(resolved, next, lintFn);
    if (!r.ok) {
      const msg = `${r.error}\n${formatLintResult(r.lint!)}\n请修正后重试，本次编辑未生效。`;
      return { data: msg, resultForAssistant: msg };
    }

    const s = await stat(resolved);
    context.readFileState.set(resolved, { mtime: s.mtimeMs });
    const lintMsg = r.lint ? "\n" + formatLintResult(r.lint) : "";
    const result = `已成功编辑 ${resolved}${lintMsg}`;
    return { data: result, resultForAssistant: result };
  },

  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: "tool_result", tool_use_id: toolUseID, content };
  },
});
