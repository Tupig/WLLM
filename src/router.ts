/**
 * router.ts — 双轨路由器：纯难度分流（默认）
 * 规则：显式 model 最高 > mock > 难度（hard+云→云，其余本地；本地上下文/并发策略选 14b/8b）
 * 决策写 routelog 供 I4 复盘。
 */
import { resolveProvider } from "./services/api.js";

export type RouteDecision = {
  model: string;
  provider: "local" | "cloud" | "mock";
  reason: string;
  contextTokens?: number;
};

const HARD_PATTERNS = [
  /重构/, /迁移/, /架构/, /重写/, /跨\s*\d*\s*个?文件/, /所有(调用|引用|文件)/,
  /实现.{0,12}(系统|服务|模块|框架)/, /设计并/, /整合/, /统一(错误|处理|重构)/,
  /refactor/i, /migrate/i, /redesign/i, /across\s+\w+\s+files/i,
];
const EASY_PATTERNS = [
  /^(读|看|列|查|搜|找|grep|cat|read|list|show|explain|解释|总结|说明)/i,
  /TODO|FIXME/, /什么(是|叫)/, /在哪|哪里|位置/,
];

export function estimateDifficulty(prompt: string): "easy" | "hard" {
  const p = prompt.trim();
  if (!p) return "easy";
  if (HARD_PATTERNS.some((r) => r.test(p))) return "hard";
  if (EASY_PATTERNS.some((r) => r.test(p))) return "easy";
  return p.length > 400 ? "hard" : "easy";
}

function isLocalBase(base: string | undefined): boolean {
  if (!base) return false;
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(base);
}

export function routeTask(params: {
  prompt: string;
  model?: string;
  contextTokens?: number;
  concurrency?: number;
  env?: NodeJS.ProcessEnv;
}): RouteDecision {
  const env = params.env ?? process.env;
  const ctx = params.contextTokens ?? 0;
  const conc = params.concurrency ?? 1;

  if (params.model) {
    return { model: params.model, provider: resolveProvider(env) === "mock" ? "mock" : (isLocalBase(env.OPENAI_BASE_URL) && resolveProvider(env) === "openai" ? "local" : "cloud"), reason: "显式指定 model", contextTokens: ctx };
  }
  if (env.PILOT_MOCK === "1") {
    return { model: "mock", provider: "mock", reason: "PILOT_MOCK", contextTokens: ctx };
  }

  const provider = resolveProvider(env);
  const hasCloud = !!env.ANTHROPIC_API_KEY;
  const cloudModel = env.PILOT_CLOUD_MODEL || "claude-sonnet-4-20250514";
  const diff = estimateDifficulty(params.prompt);

  if (diff === "hard" && hasCloud) {
    return { model: cloudModel, provider: "cloud", reason: "hard+云端凭据", contextTokens: ctx };
  }
  if (diff === "hard" && !hasCloud) {
    return { model: "14b", provider: "local", reason: "hard-无云端凭据，回落本地", contextTokens: ctx };
  }

  if (provider === "openai" && isLocalBase(env.OPENAI_BASE_URL)) {
    if (ctx >= 14_000) return { model: "8b", provider: "local", reason: "easy-ctx>=14k→8b", contextTokens: ctx };
    if (conc > 1) return { model: "8b", provider: "local", reason: "easy-并发>1→8b", contextTokens: ctx };
    return { model: "14b", provider: "local", reason: "easy-本地14b", contextTokens: ctx };
  }
  if (provider === "openai") {
    return { model: params.model || env.OPENAI_MODEL || "default_model", provider: "cloud", reason: "easy-云端 OpenAI 兼容网关", contextTokens: ctx };
  }
  return { model: cloudModel, provider: "cloud", reason: "easy-仅有云端 Anthropic", contextTokens: ctx };
}

export function formatRouteLog(d: RouteDecision & { prompt: string; ts?: number }): string {
  const prompt = d.prompt.length > 100 ? d.prompt.slice(0, 100) + "…" : d.prompt;
  return JSON.stringify({
    ts: d.ts ?? Date.now(),
    model: d.model, provider: d.provider, reason: d.reason,
    ctx: d.contextTokens ?? 0, prompt,
  });
}
