/**
 * tools/todo.ts — TodoWrite 任务清单（A16）
 */
import { z } from "zod";
import { buildTool, type ToolResult } from "../Tool.js";
import { appStore } from "../state/AppState.js";

export const TodoItemSchema = z.object({
  content: z.string().min(1).describe("任务描述"),
  status: z.enum(["pending", "in_progress", "completed"]).describe("状态"),
  priority: z.enum(["high", "medium", "low"]).describe("优先级"),
});

export const TodoWriteInput = z.object({
  items: z.array(TodoItemSchema).max(50).describe("完整任务清单（全量替换）"),
});

export type TodoState = {
  items: z.infer<typeof TodoItemSchema>[];
  updatedAt: string;
};

export function applyTodoWrite(
  prev: TodoState | null,
  items: z.infer<typeof TodoItemSchema>[],
): TodoState {
  void prev;
  return { items: [...items], updatedAt: new Date().toISOString() };
}

const MARK: Record<string, string> = {
  completed: "[x]",
  in_progress: "[~]",
  pending: "[ ]",
};

export function renderTodoState(state: TodoState | null): string {
  if (!state || state.items.length === 0) return "";
  const done = state.items.filter((i) => i.status === "completed").length;
  const lines = state.items.map((i) => `${MARK[i.status]} ${i.content}（${i.priority}）`);
  return ["", "## 任务清单", `进度 ${done}/${state.items.length}`, "", ...lines, ""].join("\n");
}

export const TodoWriteTool = buildTool<string>({
  name: "TodoWrite",
  inputSchema: TodoWriteInput,
  description: () => "更新任务清单（全量替换）。规划多步任务、跟踪进度时使用。",
  prompt: () => "用完整列表替换任务清单；每步开工前将该项标为 in_progress，完成后标 completed。",
  userFacingName: () => "TodoWrite",
  isReadOnly: () => true,
  isDestructive: () => false,
  isConcurrencySafe: () => false,
  isEnabled: () => true,
  async checkPermissions(input) {
    return { behavior: "allow", updatedInput: input };
  },
  async call(input): Promise<ToolResult<string>> {
    appStore.setState((s) => ({ ...s, todoState: applyTodoWrite(s.todoState ?? null, input.items) }));
    const msg = `任务清单已更新：${input.items.length} 项`;
    return { data: msg, resultForAssistant: msg };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: "tool_result", tool_use_id: toolUseID, content };
  },
});
