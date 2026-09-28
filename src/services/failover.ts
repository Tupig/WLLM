/**
 * providers/failover.ts — 基础设施故障回退（本地 OOM/断连 → 云端兜底）
 */
import type { StreamEvent } from "./api.js";

const INFRA_PATTERNS = [
  /ECONNREFUSED/i, /fetch failed/i, /ETIMEDOUT/i, /EPIPE/i, /ENOTFOUND/i,
  /\b50[0-9]\b/, /status 50[0-9]/, /返回错误 50[0-9]/,
  /out of memory/i, /\bOOM\b/i, /server crashed/i, /socket hang up/i,
];

export function isInfraError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return INFRA_PATTERNS.some((p) => p.test(msg));
}

export function resolveFallback(env: NodeJS.ProcessEnv = process.env): "anthropic" | "openai" | null {
  if (env.PILOT_FAILOVER === "off") return null;
  const hasOpenAI = !!(env.OPENAI_BASE_URL && env.OPENAI_API_KEY);
  const hasAnthropic = !!env.ANTHROPIC_API_KEY;
  const currentIsOpenAI = hasOpenAI && !env.PILOT_PROVIDER;
  const explicit = env.PILOT_PROVIDER;
  if (explicit === "openai" || (currentIsOpenAI && !explicit)) {
    return hasAnthropic ? "anthropic" : null;
  }
  if (explicit === "anthropic" || hasAnthropic) {
    return hasOpenAI ? "openai" : null;
  }
  return null;
}

export async function* streamWithFailover(
  primary: () => AsyncGenerator<StreamEvent>,
  fallback: (() => AsyncGenerator<StreamEvent>) | null,
  label: string | null,
  onFallback?: (label: string) => void,
): AsyncGenerator<StreamEvent> {
  try {
    yield* primary();
  } catch (err) {
    if (!isInfraError(err) || !fallback || !label) throw err;
    onFallback?.(label);
    yield* fallback();
  }
}
