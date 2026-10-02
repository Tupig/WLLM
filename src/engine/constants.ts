/**
 * constants.ts — 全局常量
 */
export const DEFAULT_MODEL = "14b";
export const MAX_CONTEXT_TOKENS_HARD_LIMIT = 10_000_000;
export const ADAPTIVE_ITERATIONS_CAP = 50;
export const DEFAULT_MAX_CONTEXT_TOKENS = 30_000;

export function resolveMaxContextTokens(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TUPIG_MAX_CONTEXT_TOKENS;
  if (!raw) return DEFAULT_MAX_CONTEXT_TOKENS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < DEFAULT_MAX_CONTEXT_TOKENS) return DEFAULT_MAX_CONTEXT_TOKENS;
  return Math.min(Math.floor(n), MAX_CONTEXT_TOKENS_HARD_LIMIT);
}

export const MAX_CONTEXT_TOKENS = resolveMaxContextTokens();
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_GLOB_RESULTS = 100;
export const MAX_GREP_RESULTS = 250;
export const MAX_BASH_OUTPUT_CHARS = 50_000;
/**
 * 工具结果上限（唯一事实源，issue #84 接线）：写工具 maxResultSizeChars
 * 与 DocRead maxSize 必须引用本常量，禁止字面量 100_000 散落。
 */
export const MAX_RESULT_CHARS = 100_000;
/** 写组并行度上限（issue #57）：不同 file_path 的写可并行，同文件保序串行 */
export const MAX_WRITE_CONCURRENCY = 4;
export function resolveWriteConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TUPIG_WRITE_CONCURRENCY;
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 1) return MAX_WRITE_CONCURRENCY;
  return Math.min(n, 16);
}
function resolveToolTimeoutMs(): number {
  const raw = process.env.TUPIG_TOOL_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 100) return 30_000;
  return n;
}
export const TOOL_TIMEOUT_MS = resolveToolTimeoutMs();
export const GREP_FALLBACK_TIMEOUT_MS = 15_000;
/**
 * hook 执行超时（唯一事实源，issue #84 接线）：triggerShellHook 默认参数
 * 必须引用本常量，禁止字面量 5000 散落。
 */
export const HOOK_TIMEOUT_MS = 5_000;
export const API_FETCH_TIMEOUT_MS = 1_800_000;
/** 流式内容进度看门狗（issue #46）：距上一个内容事件的最长时间 */
export const STREAM_IDLE_TIMEOUT_MS = 120_000;
export function resolveStreamIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TUPIG_STREAM_IDLE_MS;
  if (raw === undefined) return STREAM_IDLE_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return STREAM_IDLE_TIMEOUT_MS;
  return Math.floor(n); // 0 = 关闭
}
/**
 * token 估算字节系数（唯一事实源，issue #84 接线）：estimateTokens 必须
 * 引用本常量，禁止内联 /4 散落。
 */
export const TOKEN_BYTES_PER_TOKEN = 4;
export const MAX_RETRIES = 3;
