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

export type AppState = {
  verbose: boolean;
  mainLoopModel: string;
  toolPermissionContext: ToolPermissionContext;
  agent: string | undefined;
  workDir: string;
  sessionId: string;
  turnCount: number;
  tokenUsage: { input: number; output: number };
  compactionCount: number;
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
  turnCount: 0,
  tokenUsage: { input: 0, output: 0 },
  compactionCount: 0,
  todoState: null,
};

export const appStore = createStore<AppState>(defaultAppState);
