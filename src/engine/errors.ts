/**
 * 错误恢复与重试机制
 *
 * 提供自动重试、降级、错误分类等功能。
 * 灵感来自 Aider 的 lint/test/repair 循环。
 */

export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 基础延迟（毫秒） */
  baseDelay: number;
  /** 最大延迟（毫秒） */
  maxDelay: number;
  /** 退避因子 */
  backoffFactor: number;
  /** 可重试的错误类型 */
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
  retryableErrors: [
    "rate_limit",
    "timeout",
    "overloaded",
    "server_error",
    "network_error",
  ],
};

export type ErrorCategory =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "validation"
  | "not_found"
  | "server_error"
  | "network_error"
  | "unknown";

/**
 * 分类错误
 */
export function categorizeError(error: string | Error): ErrorCategory {
  const msg = typeof error === "string" ? error : error.message;
  const lower = msg.toLowerCase();

  if (lower.includes("auth") || lower.includes("unauthorized") || lower.includes("401")) {
    return "auth";
  }
  if (lower.includes("rate") || lower.includes("429")) {
    return "rate_limit";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "timeout";
  }
  if (lower.includes("valid") || lower.includes("invalid") || lower.includes("400")) {
    return "validation";
  }
  if (lower.includes("not found") || lower.includes("404")) {
    return "not_found";
  }
  if (lower.includes("500") || lower.includes("502") || lower.includes("503")) {
    return "server_error";
  }
  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("fetch")) {
    return "network_error";
  }
  return "unknown";
}

/**
 * 延迟执行
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 错误恢复上下文
 */
export interface RecoveryContext {
  /** 操作名称 */
  operation: string;
  /** 尝试次数 */
  attempts: number;
  /** 最大尝试次数 */
  maxAttempts: number;
  /** 上一次错误 */
  lastError?: Error;
  /** 恢复建议 */
  suggestions: string[];
}

