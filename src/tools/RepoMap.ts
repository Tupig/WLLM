/**
 * tools/RepoMap.ts — 仓库符号地图（N9 / A18）
 */
import { z } from "zod";
import { buildTool, type ToolResult } from "../engine/Tool.js";
import { safePath } from "../utils/path.js";
import { buildRepoMap, REPO_MAP_BUDGET } from "../context/repomap.js";

export const RepoMapInput = z.object({
  path: z.string().optional().describe("只索引该子目录（相对工作区）"),
  budget: z.number().min(200).max(50_000).optional().describe(`输出字符预算（默认 ${REPO_MAP_BUDGET}）`),
});

export const RepoMapTool = buildTool<string>({
  name: "RepoMap",
  inputSchema: RepoMapInput,
  description: () =>
    "输出仓库符号地图：`路径:行号 [种类] 符号名` 列表，带字符预算截断。开工前先看它找结构，省去全仓 grep。",
  prompt: () => "需要了解项目结构或不确定代码放哪时使用；配合 path 参数缩小范围。",
  userFacingName: () => "RepoMap",
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isEnabled: () => true,

  async checkPermissions(input, _ctx) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<ToolResult<string>> {
    if (input.path) safePath(context.workDir, input.path);
    try {
      const r = buildRepoMap(context.workDir, { budget: input.budget, path: input.path });
      const cacheNote = r.fromCache ? "（缓存命中）" : "";
      return { data: `${r.text}\n${cacheNote}`.trim(), resultForAssistant: r.text };
    } catch (err) {
      return { data: `错误：${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
});
