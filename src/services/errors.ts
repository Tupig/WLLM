/**
 * services/errors.ts — Provider 错误标准分类（思路来自 LiteLLM 错误分类，MIT）
 * 统一 kind/status/retryable/failoverEligible，替代按消息字符串猜布尔。
 */
export type ProviderErrorKind =
  | "rate_limit"
  | "auth"
  | "context_too_long"
  | "overloaded"
  | "server"
  | "network"
  | "invalid_request"
  | "unknown";

export type ClassifiedProviderError = {
  kind: ProviderErrorKind;
  status?: number;
  retryable: boolean;
  failoverEligible: boolean;
};

const NETWORK_PATTERNS = [
  /ECONNREFUSED/i, /ETIMEDOUT/i, /EPIPE/i, /ENOTFOUND/i,
  /fetch failed/i, /socket hang up/i,
  /out of memory/i, /\bOOM\b/i, /server crashed/i,
  /流式响应空闲超时/i, /stream idle/i, // 流式看门狗（issue #46）→ network 语义
];

/** 带上下文词的 status 提取——避免裸数字误伤（如「价格 500 元」） */
function statusFromMessage(msg: string): number | undefined {
  const m =
    msg.match(/(?:返回错误|status|HTTP|error|request)\D{0,10}(\d{3})\b/i) ??
    msg.match(/\b(4\d{2}|5\d{2})\b(?=[\s:：,]*\s*(overloaded|rate limit|too many|unauthorized|forbidden|bad gateway|internal|service unavailable|context|invalid))/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 400 && n <= 599 ? n : undefined;
}

export function classifyProviderError(err: unknown): ClassifiedProviderError {
  const msg = err instanceof Error ? err.message : String(err);
  const objStatus =
    typeof (err as any)?.status === "number" ? (err as any).status :
    typeof (err as any)?.statusCode === "number" ? (err as any).statusCode :
    undefined;
  const status = objStatus ?? statusFromMessage(msg);

  const deny: Omit<ClassifiedProviderError, "kind" | "status"> = { retryable: false, failoverEligible: false };

  if (status === 429 || /rate.?limit|too many requests/i.test(msg)) {
    return { kind: "rate_limit", status, retryable: true, failoverEligible: true };
  }
  if (status === 529 || /\boverloaded\b/i.test(msg)) {
    return { kind: "overloaded", status, retryable: true, failoverEligible: true };
  }
  if (status === 401 || status === 403 || /unauthorized|invalid api key|forbidden/i.test(msg)) {
    return { kind: "auth", status, ...deny };
  }
  if (
    status === 413 ||
    /context (length|window)|maximum context|prompt is too long|input is too long|context length exceeded/i.test(msg)
  ) {
    // 可重试=本端压缩后重建请求（issue #24）；不 failover，切 provider 解决不了上下文超限
    return { kind: "context_too_long", status, retryable: true, failoverEligible: false };
  }
  if (NETWORK_PATTERNS.some((p) => p.test(msg))) {
    return { kind: "network", status, retryable: true, failoverEligible: true };
  }
  if (status !== undefined && status >= 500) {
    return { kind: "server", status, retryable: true, failoverEligible: true };
  }
  if (status !== undefined && status >= 400) {
    return { kind: "invalid_request", status, ...deny };
  }
  return { kind: "unknown", ...deny };
}
