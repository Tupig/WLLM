import { describe, expect, it } from "vitest";

describe("冒烟", () => {
  it("核心纯模块可加载", async () => {
    const constants = await import("../src/constants");
    const tool = await import("../src/Tool");
    expect(constants).toBeTruthy();
    expect(tool).toBeTruthy();
  });
});
