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
 * 检查错误是否可重试
 */
export function isRetryable(error: string | Error, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
  const category = categorizeError(error);
  return config.retryableErrors.includes(category);
}

/**
 * 计算重试延迟（指数退避）
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const delay = config.baseDelay * Math.pow(config.backoffFactor, attempt);
  return Math.min(delay, config.maxDelay);
}

/**
 * 延迟执行
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 重试执行器
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<{ result: T; attempts: number }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt + 1 };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= config.maxRetries) break;

      if (!isRetryable(lastError, config)) break;

      const waitTime = calculateDelay(attempt, config);
      await delay(waitTime);
    }
  }

  throw lastError;
}

/**
 * 降级策略
 */
export type FallbackStrategy<T> = {
  /** 主执行 */
  primary: () => Promise<T>;
  /** 降级执行 */
  fallback: () => Promise<T>;
  /** 判断是否需要降级 */
  shouldFallback?: (error: Error) => boolean;
};

/**
 * 执行带降级的操作
 */
export async function withFallback<T>(strategy: FallbackStrategy<T>): Promise<T> {
  try {
    return await strategy.primary();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    if (strategy.shouldFallback && !strategy.shouldFallback(error)) {
      throw error;
    }

    return await strategy.fallback();
  }
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

/**
 * 生成错误恢复建议
 */
export function getRecoverySuggestions(error: Error, context: Partial<RecoveryContext> = {}): string[] {
  const category = categorizeError(error);
  const suggestions: string[] = [];

  switch (category) {
    case "auth":
      suggestions.push("检查 API Key 是否正确");
      suggestions.push("确认 API Key 有足够权限");
      break;
    case "rate_limit":
      suggestions.push("等待一段时间后重试");
      suggestions.push("减少并发请求");
      break;
    case "timeout":
      suggestions.push("增加超时时间");
      suggestions.push("简化请求内容");
      break;
    case "validation":
      suggestions.push("检查输入参数格式");
      suggestions.push("查看 API 文档确认参数要求");
      break;
    case "not_found":
      suggestions.push("检查资源路径是否正确");
      suggestions.push("确认资源是否存在");
      break;
    case "server_error":
      suggestions.push("稍后重试");
      suggestions.push("联系 API 提供商支持");
      break;
    case "network_error":
      suggestions.push("检查网络连接");
      suggestions.push("确认 API 端点可达");
      break;
    default:
      suggestions.push("查看详细错误信息");
      suggestions.push("尝试简化操作");
  }

  if (context.attempts && context.attempts > 1) {
    suggestions.push(`已尝试 ${context.attempts} 次`);
  }

  return suggestions;
}

/**
 * 格式化错误信息
 */
export function formatError(error: Error, includeSuggestions = true): string {
  const category = categorizeError(error);
  const lines: string[] = [
    `错误类型：${category}`,
    `错误信息：${error.message}`,
  ];

  if (includeSuggestions) {
    const suggestions = getRecoverySuggestions(error);
    if (suggestions.length > 0) {
      lines.push("恢复建议：");
      for (const s of suggestions) {
        lines.push(`  - ${s}`);
      }
    }
  }

  return lines.join("\n");
}
