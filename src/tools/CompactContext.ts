/**
 * tools/CompactContext.ts — 模型主动压缩上下文（issue #41，借鉴 claude-code #98123）
 * 只置信号：QueryEngine 在下一轮循环前执行压缩流水线（focus 透传摘要）
 */
import { z } from "zod";
import { buildTool } from "../engine/Tool.js";

export const CompactContextInput = z.object({
  focus: z.string().optional().describe("压缩时需要重点保留的主题（如：登录流程、性能优化）"),
});

export const CompactContextTool = buildTool<string>({
  name: "CompactContext",
  inputSchema: CompactContextInput,
  maxResultSizeChars: Infinity,
  description: () =>
    "主动压缩对话上下文：当阶段任务完成、上下文杂乱臃肿时使用。将较早的对话折叠为摘要并保留关键线索，下一轮生效。",
  prompt: () => "阶段任务完成后可用它折叠上下文；focus 指定必须保留的主题。",
  userFacingName: () => "CompactContext",
  isReadOnly: () => true,
  isConcurrencySafe: () => false,
  isEnabled: () => true,

  async checkPermissions(input, _ctx) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<{ data: string }> {
    if (context.requestCompaction) {
      context.requestCompaction(input.focus);
      return {
        data: input.focus
          ? `已请求压缩（焦点：${input.focus}）：将在下一轮前折叠上下文并继续。`
          : "已请求压缩：将在下一轮前折叠上下文并继续。",
      };
    }
    return { data: "当前环境不支持主动压缩（无压缩信号通道），请基于现有上下文继续。" };
  },
});
