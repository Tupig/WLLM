/**
 * 会话持久化
 *
 * 保存/恢复会话状态，支持断点续传。
 * 灵感来自 Cline 的 Task 持久化和 SWE-agent 的 trajectory recording。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
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
  /** 工具调用次数 */
  turnCount: number;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

const SESSIONS_DIR = ".tupigcode/sessions";

/**
 * 保存会话状态
 */
export function saveSession(workDir: string, state: SessionState): string | null {
  const sessionsDir = join(workDir, SESSIONS_DIR);
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  const filename = `session-${state.sessionId}.json`;
  const filepath = join(sessionsDir, filename);

  try {
    state.updatedAt = Date.now();
    writeFileSync(filepath, JSON.stringify(state, null, 2), "utf-8");
    return filepath;
  } catch {
    return null;
  }
}

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
 * 删除会话
 */
export function deleteSession(workDir: string, sessionId: string): boolean {
  const filepath = join(workDir, SESSIONS_DIR, `session-${sessionId}.json`);
  if (!existsSync(filepath)) return false;

  try {
    unlinkSync(filepath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理过期会话（保留最近 N 个）
 */
export function cleanupSessions(workDir: string, keepCount = 10): number {
  const sessions = listSessions(workDir);
  if (sessions.length <= keepCount) return 0;

  const toDelete = sessions.slice(keepCount);
  let deleted = 0;

  for (const session of toDelete) {
    if (deleteSession(workDir, session.sessionId)) {
      deleted++;
    }
  }

  return deleted;
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
    turnCount: 0,
    metadata: {},
  };
}

/**
 * 格式化会话列表为可读文本
 */
export function formatSessionList(sessions: SessionState[]): string {
  if (sessions.length === 0) return "没有保存的会话";

  const lines: string[] = ["会话列表："];

  for (const session of sessions.slice(0, 10)) {
    const date = new Date(session.updatedAt).toLocaleString();
    const msgCount = session.messages.length;
    lines.push(`  ${session.sessionId} - ${date} (${msgCount} 条消息)`);
  }

  if (sessions.length > 10) {
    lines.push(`  ... 还有 ${sessions.length - 10} 个会话`);
  }

  return lines.join("\n");
}
