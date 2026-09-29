/**
 * providers/failover.ts — 基础设施故障回退（本地 OOM/断连/限流/过载 → 云端兜底）
 * 分类逻辑统一在 services/errors.ts（LiteLLM 思路），此处只保留 failover 语义。
 */
import type { StreamEvent } from "./api.js";
import { classifyProviderError } from "./errors.js";

export function isInfraError(err: unknown): boolean {
  return classifyProviderError(err).failoverEligible;
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
