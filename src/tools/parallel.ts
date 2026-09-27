/**
 * 并行工具执行器
 *
 * 支持独立工具的并行执行，提升性能。
 * 灵感来自 Cline 的并行工具调用和 SWE-agent 的 ACI 设计。
 */
import type { Tool, ToolUseContext, ToolResult, CanUseToolFn } from "../Tool.js";

export interface ParallelToolCall {
  /** 工具调用 ID */
  id: string;
  /** 工具名称 */
  toolName: string;
  /** 输入参数 */
  input: Record<string, unknown>;
}

export interface ParallelToolResult {
  /** 调用 ID */
  callId: string;
  /** 工具名称 */
  toolName: string;
  /** 结果 */
  result: ToolResult;
  /** 耗时（毫秒） */
  duration: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 检查工具是否可以并行执行
 */
export function isParallelizable(tool: Tool): boolean {
  // 只读工具可以并行
  return tool.isReadOnly({}) && tool.isConcurrencySafe({});
}

/**
 * 对工具调用进行分组（可并行的放一组）
 */
export function groupToolCalls(
  calls: ParallelToolCall[],
  tools: Tool[],
): ParallelToolCall[][] {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const groups: ParallelToolCall[][] = [];
  let currentGroup: ParallelToolCall[] = [];

  for (const call of calls) {
    const tool = toolMap.get(call.toolName);
    if (!tool) {
      // 未知工具单独一组
      groups.push([call]);
      continue;
    }

    if (isParallelizable(tool) && currentGroup.length < 5) {
      // 可并行的工具加入当前组
      currentGroup.push(call);
    } else {
      // 不可并行或组已满，开始新组
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = isParallelizable(tool) ? [call] : [];
      if (!isParallelizable(tool)) {
        groups.push([call]);
      }
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * 并行执行工具调用
 */
export async function executeParallel(
  calls: ParallelToolCall[],
  tools: Tool[],
  context: ToolUseContext,
  canUseToolFn: CanUseToolFn,
): Promise<ParallelToolResult[]> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const results: ParallelToolResult[] = [];

  // 分组执行
  const groups = groupToolCalls(calls, tools);

  for (const group of groups) {
    if (group.length === 1) {
      // 单个工具直接执行
      const call = group[0];
      const result = await executeSingle(call, toolMap, context, canUseToolFn);
      results.push(result);
    } else {
      // 多个工具并行执行
      const groupResults = await Promise.all(
        group.map((call) => executeSingle(call, toolMap, context, canUseToolFn)),
      );
      results.push(...groupResults);
    }
  }

  return results;
}

/**
 * 执行单个工具调用
 */
async function executeSingle(
  call: ParallelToolCall,
  toolMap: Map<string, Tool>,
  context: ToolUseContext,
  canUseToolFn: CanUseToolFn,
): Promise<ParallelToolResult> {
  const startTime = Date.now();
  const tool = toolMap.get(call.toolName);

  if (!tool) {
    return {
      callId: call.id,
      toolName: call.toolName,
      result: { data: `未知工具：${call.toolName}` },
      duration: Date.now() - startTime,
      success: false,
      error: `未知工具：${call.toolName}`,
    };
  }

  try {
    // 权限检查
    const permission = await canUseToolFn(call.toolName, call.input);
    if (permission.behavior === "deny") {
      return {
        callId: call.id,
        toolName: call.toolName,
        result: { data: permission.message || "已拒绝" },
        duration: Date.now() - startTime,
        success: false,
        error: permission.message,
      };
    }

    // 输入校验
    const parsed = tool.inputSchema.safeParse(call.input);
    if (!parsed.success) {
      const errMsg = `输入校验失败：${parsed.error.errors.map((e: { message: string }) => e.message).join(", ")}`;
      return {
        callId: call.id,
        toolName: call.toolName,
        result: { data: errMsg },
        duration: Date.now() - startTime,
        success: false,
        error: errMsg,
      };
    }

    // 执行工具
    const result = await tool.call(parsed.data, context, canUseToolFn);
    return {
      callId: call.id,
      toolName: call.toolName,
      result,
      duration: Date.now() - startTime,
      success: true,
    };
  } catch (err) {
    return {
      callId: call.id,
      toolName: call.toolName,
      result: { data: `工具执行错误：${err}` },
      duration: Date.now() - startTime,
      success: false,
      error: String(err),
    };
  }
}

/**
 * 格式化并行执行结果
 */
export function formatParallelResults(results: ParallelToolResult[]): string {
  const lines: string[] = [`并行执行 ${results.length} 个工具调用：`];

  for (const r of results) {
    const status = r.success ? "✅" : "❌";
    const duration = `${r.duration}ms`;
    lines.push(`  ${status} ${r.toolName} (${duration})`);
  }

  return lines.join("\n");
}
