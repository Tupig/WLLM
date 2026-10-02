/**
 * 会话持久化
 *
 * 保存/恢复会话状态，支持断点续传。
 * 灵感来自 Cline 的 Task 持久化和 SWE-agent 的 trajectory recording。
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type Anthropic from "@anthropic-ai/sdk";

export interface SessionState {
  /** 会话 ID */
  sessionId: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 模型 */
  model: string;
  /** 工作目录 */
  workDir: string;
  /** 消息历史 */
  messages: Anthropic.MessageParam[];
  /** Token 使用量 */
  tokenUsage: { input: number; output: number };
  /** 压缩次数 */
  compactionCount: number;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

const SESSIONS_DIR = ".tupigcode/sessions";

/**
 * 加载会话状态
 */
export function loadSession(workDir: string, sessionId: string): SessionState | null {
  const filepath = join(workDir, SESSIONS_DIR, `session-${sessionId}.json`);
  if (!existsSync(filepath)) return null;

  try {
    const content = readFileSync(filepath, "utf-8");
    return JSON.parse(content) as SessionState;
  } catch {
    return null;
  }
}

/**
 * 列出所有会话
 */
export function listSessions(workDir: string): SessionState[] {
  const sessionsDir = join(workDir, SESSIONS_DIR);
  if (!existsSync(sessionsDir)) return [];

  try {
    const files = readdirSync(sessionsDir).filter((f) => f.startsWith("session-") && f.endsWith(".json"));
    const sessions: SessionState[] = [];

    for (const file of files) {
      const filepath = join(sessionsDir, file);
      try {
        const content = readFileSync(filepath, "utf-8");
        sessions.push(JSON.parse(content) as SessionState);
      } catch {
        // skip invalid files
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * 生成会话 ID
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * 创建新会话状态
 */
export function createSessionState(
  sessionId: string,
  model: string,
  workDir: string,
): SessionState {
  return {
    sessionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    model,
    workDir,
    messages: [],
    tokenUsage: { input: 0, output: 0 },
    compactionCount: 0,
    metadata: {},
  };
}

