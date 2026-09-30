/**
 * engine/hookEvents.ts — 生命周期事件触发（issue #26）
 *
 * Stop / SessionStart / PreCompact / PostCompact 此前只有类型声明没有
 * 触发点；统一出口：吞掉一切异常（hook 失败不阻塞主流程），
 * 压缩事件透传 source（manual/auto）供 matcher 过滤。
 */
import { hookSystem, type HookSystem, type HookContext, type HookEvent } from "./hooks.js";

export async function fireLifecycle(
  hs: HookSystem,
  event: HookEvent,
  ctx: HookContext,
): Promise<void> {
  try {
    await hs.trigger(event, ctx);
  } catch {
    /* hook 失败不阻塞 */
  }
}

export async function fireSessionStart(hs: HookSystem = hookSystem, ctx: HookContext): Promise<void> {
  await fireLifecycle(hs, "SessionStart", ctx);
}

export async function fireStop(hs: HookSystem = hookSystem, ctx: HookContext): Promise<void> {
  await fireLifecycle(hs, "Stop", ctx);
}

/** 压缩前（供需要在 Pre/Post 之间夹压缩动作的调用方） */
export async function fireCompactPre(
  hs: HookSystem = hookSystem,
  ctx: HookContext,
  source: "manual" | "auto",
): Promise<void> {
  await fireLifecycle(hs, "PreCompact", { ...ctx, source });
}

/** 压缩后 */
export async function fireCompactPost(
  hs: HookSystem = hookSystem,
  ctx: HookContext,
  source: "manual" | "auto",
): Promise<void> {
  await fireLifecycle(hs, "PostCompact", { ...ctx, source });
}

/** 便捷：连发 Pre+Post（无夹心动作时用） */
export async function fireCompact(
  hs: HookSystem = hookSystem,
  ctx: HookContext,
  source: "manual" | "auto",
): Promise<void> {
  await fireCompactPre(hs, ctx, source);
  await fireCompactPost(hs, ctx, source);
}

/** /clear 序列（issue #33）：Pre → 清空 → Post；hook 异常吞掉，reset 异常上抛 */
export async function runClearSequence(
  hs: HookSystem,
  ctx: HookContext,
  reset: () => void,
): Promise<void> {
  await fireLifecycle(hs, "PreClear", ctx);
  reset();
  await fireLifecycle(hs, "PostClear", ctx);
}
