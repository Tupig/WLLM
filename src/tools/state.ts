/**
 * 工具状态跟踪器
 *
 * 灵感来自 SWE-agent 的 State Command 模式。
 * 每次工具执行后返回结构化元数据（工作目录、已编辑文件等），
 * 可注入到系统提示词中让模型感知当前状态。
 */

export interface ToolExecutionState {
  /** 当前工作目录 */
  cwd: string;
  /** 最近编辑/写入的文件列表 */
  recentlyEditedFiles: string[];
  /** 最近一次编辑 */
  lastEdit?: {
    file: string;
    timestamp: number;
    operation: "edit" | "write";
  };
  /** 工具执行计数 */
  toolCallCount: number;
  /** 本次会话中使用的工具集合 */
  toolsUsed: Set<string>;
}

export function createToolState(cwd: string): ToolExecutionState {
  return {
    cwd,
    recentlyEditedFiles: [],
    toolCallCount: 0,
    toolsUsed: new Set(),
  };
}

export function recordToolExecution(
  state: ToolExecutionState,
  toolName: string,
  filePath?: string,
  operation?: "edit" | "write",
): void {
  state.toolCallCount++;
  state.toolsUsed.add(toolName);

  if (filePath && operation) {
    state.lastEdit = { file: filePath, timestamp: Date.now(), operation };
    // 保持最近 10 个文件
    if (!state.recentlyEditedFiles.includes(filePath)) {
      state.recentlyEditedFiles.push(filePath);
      if (state.recentlyEditedFiles.length > 10) {
        state.recentlyEditedFiles.shift();
      }
    }
  }
}

/**
 * 将状态格式化为可注入提示词的文本
 */
export function formatToolStateForPrompt(state: ToolExecutionState): string {
  const lines: string[] = [];

  lines.push(`工作目录：${state.cwd}`);
  lines.push(`已执行 ${state.toolCallCount} 次工具调用`);

  if (state.recentlyEditedFiles.length > 0) {
    lines.push(`最近编辑：${state.recentlyEditedFiles.join(", ")}`);
  }

  if (state.toolsUsed.size > 0) {
    lines.push(`已使用工具：${[...state.toolsUsed].join(", ")}`);
  }

  return lines.join("\n");
}
