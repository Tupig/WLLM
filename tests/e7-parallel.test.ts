/**
 * E7 并发执行：限流映射 + 只读工具分批
 */
import { describe, expect, it } from "vitest";
import { mapWithConcurrency, partitionRuns } from "../src/tools/parallel";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("保持输入顺序返回结果", async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (ms) => { await sleep(ms); return ms * 2; });
    expect(out).toEqual([60, 20, 40]);
  });
  it("并发不超过 limit", async () => {
    let active = 0, peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      active++; peak = Math.max(peak, active);
      await sleep(20);
      active--;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
  });
  it("空数组 → 空结果", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
  it("异常 → 快速失败", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (x) => { if (x === 2) throw new Error("boom"); return x; }),
    ).rejects.toThrow("boom");
  });
});

describe("partitionRuns 连续可并行分批", () => {
  it("连续 safe 合并为一批，写操作隔断", () => {
    const items = [
      { id: "r1", safe: true }, { id: "r2", safe: true },
      { id: "w1", safe: false },
      { id: "r3", safe: true }, { id: "r4", safe: true },
      { id: "w2", safe: false },
    ];
    const batches = partitionRuns(items, (i) => i.safe);
    expect(batches).toEqual([
      [{ id: "r1", safe: true }, { id: "r2", safe: true }],
      [{ id: "w1", safe: false }],
      [{ id: "r3", safe: true }, { id: "r4", safe: true }],
      [{ id: "w2", safe: false }],
    ]);
  });
  it("全 unsafe → 每个一批", () => {
    const batches = partitionRuns([{ s: false }, { s: false }], (i: any) => i.s);
    expect(batches).toHaveLength(2);
  });
  it("空 → 空", () => {
    expect(partitionRuns([], () => true)).toEqual([]);
  });
});
