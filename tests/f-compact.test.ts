/**
 * F1/F2 压缩强化：阈值梯子+熔断+keep_first+结果预算（A13/A14）
 */
import { describe, expect, it } from "vitest";
import { ContextCompactor, pickStrategy, type Strategy } from "../src/compact/index";

describe("pickStrategy 阈值梯子（A13）", () => {
  it("<60% → 不压", () => {
    expect(pickStrategy(0.5, 10)).toBe("none");
    expect(pickStrategy(0.59, 10)).toBe("none");
  });
  it("60-70% → micro", () => {
    expect(pickStrategy(0.62, 10)).toBe("micro");
    expect(pickStrategy(0.69, 10)).toBe("micro");
  });
  it("70-85% → snip", () => {
    expect(pickStrategy(0.75, 10)).toBe("snip");
  });
  it("85-95% → collapse", () => {
    expect(pickStrategy(0.9, 10)).toBe("collapse");
  });
  it(">95% 或消息数超限 → force（模型摘要）", () => {
    expect(pickStrategy(0.96, 10)).toBe("force");
    expect(pickStrategy(0.5, 1000)).toBe("force");
  });
});

describe("阈值梯子分级压缩", () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg-${i} ${"x".repeat(200)}`,
    }));

  it("低占用不压", () => {
    const c = new ContextCompactor();
    const msgs = mk(4);
    const r = c.compactByLadder(msgs, 1000, 30_000);
    expect(r.strategy).toBe("none");
    expect(r.messages).toBe(msgs);
  });
  it("中占用走 snip/micro 且不丢首条", () => {
    const c = new ContextCompactor();
    const msgs = mk(30);
    const r = c.compactByLadder(msgs, 24_000, 30_000);
    expect(["micro", "snip"]).toContain(r.strategy);
    expect(r.messages[0]).toBe(msgs[0]);
  });
  it("keep_first：压缩后首条 user prompt 原样", () => {
    const c = new ContextCompactor();
    const msgs = mk(40);
    msgs[0] = { role: "user", content: "原始任务指令不可变" };
    const r = c.compactByLadder(msgs, 29_000, 30_000);
    expect(JSON.stringify(r.messages[0])).toBe(JSON.stringify(msgs[0]));
  });
});

describe("熔断（A13）", () => {
  it("压缩后不降反升 → 熔断，后续直接返回原消息", () => {
    const c = new ContextCompactor();
    const msgs = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    c.recordResult(msgs, msgs, 25_000, 30_000);
    expect(c.isCircuitOpen()).toBe(true);
    const r = c.compactByLadder(msgs, 25_000, 30_000);
    expect(r.strategy).toBe("circuit-open");
    expect(r.messages).toBe(msgs);
  });
  it("压缩有效 → 不熔断", () => {
    const c = new ContextCompactor();
    const before = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i} ${"y".repeat(100)}` }));
    const after = before.slice(0, 10);
    c.recordResult(before, after, 25_000, 30_000);
    expect(c.isCircuitOpen()).toBe(false);
  });
});

describe("非破坏性快照（A14）", () => {
  it("压缩前保存原消息，可回卷", () => {
    const c = new ContextCompactor();
    const msgs = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    c.compactByLadder(msgs, 28_000, 30_000);
    const snap = c.getLastOriginal();
    expect(snap).toBe(msgs);
  });
});

describe("结果预算迭代（A14）", () => {
  it("压到预算内或达迭代上限", () => {
    const c = new ContextCompactor();
    const msgs = Array.from({ length: 60 }, (_, i) => ({
      role: ("user" as const),
      content: `msg-${i} ${"z".repeat(500)}`,
    }));
    const r = c.compactToBudget(msgs, 40_000, 30_000, 5);
    expect(r.iterations).toBeLessThanOrEqual(5);
    const est = Math.ceil(JSON.stringify(r.messages).length / 4);
    expect(est <= 30_000 || r.iterations === 5).toBe(true);
  });
  it("空/短消息直接返回", () => {
    const c = new ContextCompactor();
    const msgs = [{ role: "user" as const, content: "hi" }];
    const r = c.compactToBudget(msgs, 100, 30_000, 5);
    expect(r.iterations).toBe(0);
    expect(r.messages).toBe(msgs);
  });
});
