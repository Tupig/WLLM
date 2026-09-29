/** gameqa/outcome.ts — Agent 执行结果类型（agent/executors/各执行器共享，避免循环依赖） */

export interface Outcome {
  success: boolean;
  logPath: string | null;
  summary: Record<string, import("./store").Json>;
  artifacts: [string, string][];
}

export function outcomeFailure(message: string, extra?: Record<string, import("./store").Json>): Outcome {
  return { success: false, logPath: null, summary: { message, ...extra }, artifacts: [] };
}
