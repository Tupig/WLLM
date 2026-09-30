/** engine/time.ts — 共享 withTimeout（QueryEngine 与子代理共用，issue #37） */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label} 执行超时（${ms}ms）`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
