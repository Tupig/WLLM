/**
 * prompt.ts — 系统提示渲染（纯函数，供 QueryEngine 复用）
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "./Tool.js";
import { buildXmlToolSection, resolveHarness } from "./harness.js";

export type PromptOptions = {
  rulesText?: string;
  stateText?: string;
  append?: string;
};

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

  if (opts.rulesText) prompt += opts.rulesText;
  if (opts.stateText) prompt += `\n\n## 当前状态\n${opts.stateText}`;

  if (resolveHarness() === "xml" && tools.length > 0) {
    const section = buildXmlToolSection(tools as unknown as Anthropic.Tool[]);
    if (section) prompt += `\n\n## 工具调用（XML 格式）\n${section}`;
  }

  if (opts.append) prompt += "\n\n" + opts.append;
  return prompt;
}
