/**
 * state/AppState.ts — 应用状态
 */
import { createStore } from "./store.js";
import type { PermissionMode } from "../engine/Tool.js";
import { DEFAULT_MODEL } from "../engine/constants.js";

export type ToolPermissionContext = {
  mode: PermissionMode;
  alwaysAllowRules: Map<string, { pattern: string; source: string }[]>;
  alwaysDenyRules: Map<string, { pattern: string; source: string }[]>;
  alwaysAskRules: Map<string, { pattern: string; source: string }[]>;
};

/** 压缩丢弃可见记录（issue #40） */
export type CompactionRecord = {
  before: number;
  after: number;
  tokensBefore: number;
  tokensAfter: number;
  source: string;
  at: string;
};

export type AppState = {
  verbose: boolean;
  mainLoopModel: string;
  toolPermissionContext: ToolPermissionContext;
  agent: string | undefined;
  workDir: string;
  sessionId: string;
  /** 已提交的用户输入数（issue #69）：UserPromptSubmit fire 前读=该条 0-based 序号，fire 后递增 */
  userPromptCount: number;
  tokenUsage: { input: number; output: number };
  compactionCount: number;
  lastCompaction?: CompactionRecord;
  /** 最大工具调用轮次（CLI --max-turns，issue #89） */
  maxTurns: number;
  /** 最大输出 Token（CLI -t/--max-tokens，issue #89） */
  maxTokens: number;
  todoState?: import("../tools/todo.js").TodoState | null;
};

export const defaultToolPermissionContext: ToolPermissionContext = {
  mode: "acceptEdits",
  alwaysAllowRules: new Map(),
  alwaysDenyRules: new Map(),
  alwaysAskRules: new Map(),
};

export const defaultAppState: AppState = {
  verbose: false,
  mainLoopModel: DEFAULT_MODEL,
  toolPermissionContext: defaultToolPermissionContext,
  agent: undefined,
  workDir: process.cwd(),
  sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  userPromptCount: 0,
  tokenUsage: { input: 0, output: 0 },
  compactionCount: 0,
  maxTurns: 20,
  maxTokens: 8192,
  todoState: null,
};

export const appStore = createStore<AppState>(defaultAppState);

/** 会话身份切换（issue #88）：REPL 生成 / resume / fork 后同步，hook ctx 与磁盘同一 id */
export function adoptSessionId(id: string): void {
  appStore.setState((s) => ({ ...s, sessionId: id }));
}
