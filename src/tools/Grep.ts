/**
 * tools/Grep.ts — 内容搜索工具
 */
import { z } from "zod";
import { spawn } from "child_process";
import { buildTool, type ToolUseContext, type ToolResult } from "../Tool.js";
import { safePath } from "../utils/path.js";
import { MAX_GREP_RESULTS, TOOL_TIMEOUT_MS, GREP_FALLBACK_TIMEOUT_MS } from "../constants.js";

export const GrepInput = z.object({
  pattern: z.string().describe("用于搜索的正则表达式"),
  path: z.string().optional().describe("搜索目录"),
  include: z.string().optional().describe("要包含的文件 glob（例如 '*.ts'）"),
  output_mode: z.enum(["content", "files_with_matches", "count"]).optional().describe("输出模式（默认：content）"),
  head_limit: z.number().optional().describe("最大结果数（默认 250）"),
});

export type GrepInput = z.infer<typeof GrepInput>;

export const GrepTool = buildTool<string>({
  name: "Grep",
  inputSchema: GrepInput,
  description: () => "使用正则表达式搜索文件内容（基于 ripgrep），返回匹配的文件路径和行号。",
  prompt: () => "使用正则表达式搜索文件内容。可通过 include 参数按文件类型过滤。",
  userFacingName: () => "Grep",
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isEnabled: () => true,

  async checkPermissions(input, _ctx) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<ToolResult<string>> {
    const searchPath = input.path ? safePath(context.workDir, input.path) : context.workDir;
    const mode = input.output_mode || "content";
    const headLimit = input.head_limit || MAX_GREP_RESULTS;
    const include = input.include || "";

    try {
      new RegExp(input.pattern);
    } catch (e) {
      return { data: `错误：无效的正则表达式「${input.pattern}」：${e instanceof Error ? e.message : e}` };
    }

    const args: string[] = [];
    if (mode === "files_with_matches") args.push("-l");
    else if (mode === "count") args.push("-c");

    args.push("--glob", "!.git", "--glob", "!.svn", "--glob", "!.hg");
    if (include) args.push("--glob", include);
    args.push("--max-columns", "500", "-n", input.pattern, searchPath);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ToolResult<string>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const child = spawn("rg", args, { timeout: TOOL_TIMEOUT_MS });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch {}
        finish({ data: "错误：搜索超时" });
      }, TOOL_TIMEOUT_MS + 5000);

      child.on("close", () => {
        if (stderr && !stdout) {
          finish({ data: `错误：${stderr.trim()}` });
          return;
        }

        const lines = stdout.trim().split("\n").filter(Boolean);
        const truncated = lines.length > headLimit;
        const resultLines = truncated ? lines.slice(0, headLimit) : lines;

        let result: string;
        if (mode === "content" && truncated) {
          // SWE-agent 做法：超量且散在多文件 → 只列文件名，逼模型缩窄条件
          const files = [...new Set(lines.map((l) => l.split(":")[0]))];
          if (files.length > 10) {
            result =
              `匹配 ${lines.length} 行、散在 ${files.length} 个文件，超出显示预算。\n` +
              `涉及文件：\n${files.slice(0, 50).join("\n")}\n` +
              `（先按文件名定位，再用 include / 更精确 pattern / output_mode=files_with_matches 缩窄）`;
            finish({ data: result });
            return;
          }
        }

        if (mode === "files_with_matches") {
          result = `找到 ${resultLines.length} 个文件：\n${resultLines.join("\n")}`;
        } else if (mode === "count") {
          result = `匹配数：\n${resultLines.join("\n")}`;
        } else {
          result = `找到 ${resultLines.length} 处匹配：\n${resultLines.join("\n")}`;
        }

        if (truncated) result += `\n（显示前 ${headLimit} 条，共 ${lines.length} 条匹配）`;
        finish({ data: result });
      });

      child.on("error", () => {
        const findArgs = [searchPath, "-type", "f"];
        if (include) findArgs.push("-name", include);
        findArgs.push("-exec", "grep", "-Hn", "--", input.pattern, "{}", "+");

        const fallback = spawn("find", findArgs, { timeout: GREP_FALLBACK_TIMEOUT_MS });
        let out = "";
        fallback.stdout.on("data", (d: Buffer) => { out += d.toString(); });
        fallback.stderr.on("data", () => {});
        fallback.on("close", () => {
          const fl = out.trim().split("\n").filter(Boolean).slice(0, headLimit);
          finish({
            data: fl.length
              ? `找到 ${fl.length} 处匹配：\n${fl.join("\n")}`
              : `未找到匹配「${input.pattern}」的结果`,
          });
        });
        fallback.on("error", () => {
          finish({ data: "错误：ripgrep 和 find+grep 均不可用" });
        });
      });
    });
  },

  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: "tool_result", tool_use_id: toolUseID, content };
  },
});
