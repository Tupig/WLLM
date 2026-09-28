/**
 * prompt.ts — 系统提示渲染（纯函数，供 QueryEngine 复用）
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "./Tool.js";
import { buildXmlToolSection, resolveHarness } from "./harness.js";

export type PromptOptions = {
  rulesText?: string;
  memoryText?: string;
  skillCatalog?: string;
  stateText?: string;
  append?: string;
  /** plan 模式阶段指引（spec 名，可空） */
  planSpec?: string;
};

const PLAN_GUIDE = (spec?: string) => `
## Plan 模式（只读 + 计划产物可写）
按 5 阶段推进，先探索再落盘，不要改源码：
1. 探索：只读工具摸清现状
2. 落盘：把计划写入 \`.wllm/specs/${spec || "<name>"}/plan.md\`（首次执行：\`/spec new <name> <目标>\`），必须含「目标 / 涉及文件 / 步骤（编号列表）/ 风险」四节
3. 自校验：确认四节齐全、步骤有编号、涉及文件是列表
4. 呈现：向用户概述计划要点
5. 等待用户 \`/spec approve <name>\` 批准后，切 \`/act\` 执行`;

function toolCatalog(tools: Tool[]): string {
  return tools
    .map((t) => `- ${t.name}：${t.description({} as never)}`)
    .join("\n");
}

export function renderSystemPrompt(tools: Tool[], opts: PromptOptions = {}): string {
  let prompt = `你是一个运行在用户终端中的 AI 编程助手。你可以读写文件、执行命令、搜索代码来帮助完成编程任务。

## 工具
${toolCatalog(tools)}

## 原则
1. 先理解意图再行动；不确定时先询问
2. 修改文件前先读取
3. 使用项目现有的库和代码风格
4. 不添加不必要的注释
5. 遵循安全最佳实践
6. 破坏性命令前先确认
7. 用用户的语言回复`;

  if (opts.planSpec !== undefined) prompt += PLAN_GUIDE(opts.planSpec);
  if (opts.rulesText) prompt += opts.rulesText;
  if (opts.memoryText) prompt += opts.memoryText;
  if (opts.skillCatalog) prompt += opts.skillCatalog;
  if (opts.stateText) prompt += `\n\n## 当前状态\n${opts.stateText}`;

  if (resolveHarness() === "xml" && tools.length > 0) {
    const section = buildXmlToolSection(tools as unknown as Anthropic.Tool[]);
    if (section) prompt += `\n\n## 工具调用（XML 格式）\n${section}`;
  }

  if (opts.append) prompt += "\n\n" + opts.append;
  return prompt;
}
