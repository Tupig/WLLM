/**
 * 并行工具执行器
 *
 * 支持独立工具的并行执行，提升性能。
 * 灵感来自 Cline 的并行工具调用和 SWE-agent 的 ACI 设计。
 */

/**
 * 并发映射（fail-soft，issue #43）：settled 语义，单任务异常不整批 reject，
 * 结果按输入顺序返回，失败项为 `rejected` 由调用方各自兜底。
 */
export async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new RangeError(`mapWithConcurrency: limit 必须 >= 1，收到 ${limit}`);
  }
  if (items.length === 0) return [];
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export function partitionRuns<T>(items: T[], isSafe: (item: T) => boolean): T[][] {
  const batches: T[][] = [];
  let cur: T[] = [];
  for (const item of items) {
    if (isSafe(item)) {
      cur.push(item);
    } else {
      if (cur.length) batches.push(cur);
      batches.push([item]);
      cur = [];
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/**
 * 写工具按 file_path 分组（issue #57）：同文件保持输入序串行成链，
 * 异文件各自成组可并行；无 file_path（null）→ 各自独立成组。
 */
export function partitionWriteGroups<T>(items: T[], fileKey: (item: T) => string | null): T[][] {
  const groups: T[][] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const key = fileKey(item);
    if (key === null) {
      groups.push([item]);
      continue;
    }
    const idx = indexByKey.get(key);
    if (idx === undefined) {
      indexByKey.set(key, groups.length);
      groups.push([item]);
    } else {
      groups[idx].push(item);
    }
  }
  return groups;
}

