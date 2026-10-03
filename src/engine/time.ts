/**
 * engine/time.ts — 共享 withTimeout（QueryEngine 与子代理共用，issue #37）
 *
 * issue #99：超时不再只 race——把底层 promise 包进 AbortController，
 * 超时即 abort（signal 会随 context 传给 tool.call，工具读 signal 才真正取消），
 * 同时给错误文案追加「底层可能仍在执行」的副作用提示。
 */
export type TimeoutOptions = {
  /** 超时时 abort 的 controller（通常由调用方为本次 tool.call 新建） */
  controller?: AbortController;
  /** 超时错误文案追加的副作用提示（如「写类操作可能已部分落盘」） */
  sideEffectHint?: string;
};

export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  opts: TimeoutOptions = {},
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const onTimeout = () => {
    opts.controller?.abort();
    const hint = opts.sideEffectHint ? `；${opts.sideEffectHint}` : "；底层操作可能仍在执行，请核对副作用";
    return new Error(`${label} 执行超时（${ms}ms）${hint}`);
  };
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(onTimeout()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
