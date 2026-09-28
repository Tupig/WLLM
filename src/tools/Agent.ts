/**
 * tools/Agent.ts — 子代理委派工具（N6 / A15）
 * 描述里注入 agent 目录（name+description），主模型据此选型；
 * 固定黑名单保证子代理拿不到本工具（嵌套默认关闭）。
 */
import { z } from "zod";
import { buildTool, type Tool } from "../engine/Tool.js";
import {
  builtinAgents,
  formatAgentCatalog,
  loadAgents,
  maskTools,
  type AgentDef,
} from "../agents/agents.js";
import { SubAgentExecutor } from "../agents/index.js";

export const AgentInput = z.object({
  agent: z.string().optional().describe("子代理名，缺省 general；名字来自 agent 目录"),
  prompt: z.string().min(1).describe("自包含的任务描述：子代理看不到主会话历史，必须写全"),
});

export type AgentRegistry = Map<string, AgentDef>;

let registry: AgentRegistry = new Map(builtinAgents().map((a) => [a.name, a]));
let loadedFrom: string | null = null;

export function setAgentRegistry(reg: AgentRegistry, workDir = "*"): void {
  registry = reg;
  loadedFrom = workDir;
}

export function getAgentRegistry(): AgentRegistry {
  return registry;
}

/** 懒加载（QueryEngine 未注入时按 workDir 载入一次） */
export function ensureAgentRegistry(workDir: string): AgentRegistry {
  if (loadedFrom === workDir) return registry;
  registry = loadAgents(workDir);
  loadedFrom = workDir;
  return registry;
}

export const AgentTool = buildTool({
  name: "Agent",
  aliases: ["Task"],
  inputSchema: AgentInput,
  maxResultSizeChars: 30_000,
  description: () =>
    [
      "把一段自包含的任务委派给隔离上下文的子代理，只返回结论（省主上下文）。",
      "子代理看不到主会话历史，prompt 必须写全输入；主上下文贵的大段读取/搜索优先外包。",
      "可用子代理：",
      formatAgentCatalog(getAgentRegistry().values()),
    ].join("\n"),
  prompt: () => "委派子任务时使用。prompt 自包含，附上文件路径与预期产出。",
  userFacingName: () => "Agent",
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  isEnabled: () => true,
  async checkPermissions(input) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context, canUseTool) {
    const reg = ensureAgentRegistry(context.workDir);
    const name = input.agent || "general";
    const def = reg.get(name);
    if (!def) {
      const names = [...reg.keys()].sort().join(", ");
      return { data: `未知子代理：${name}。可用：${names}` };
    }

    const tools: Tool[] = maskTools((context.options.tools ?? []) as Tool[], def);
    const executor = new SubAgentExecutor(tools);
    const r = await executor.execute(
      {
        id: `sub_${Date.now()}`,
        description: input.prompt,
        agent: def,
      },
      context,
      canUseTool,
    );

    const header = `【子代理 ${def.name}｜${r.turns} 轮｜${r.success ? "完成" : "中断"}】`;
    return {
      data: r.result,
      resultForAssistant: `${header}\n${r.result}`,
    };
  },
});
