/**
 * tools/rollback.ts — lint 拦截：写盘→校验→失败回滚（A2/A3 行为等效"拒落盘"）
 */
import { readFile, writeFile, unlink } from "fs/promises";
import type { LintResult } from "./lint.js";

export type RollbackResult = {
  ok: boolean;
  lint: LintResult | null;
  error?: string;
  /** 写入前的原内容（null = 新建文件），供 diff 审查记录/回滚（issue #18） */
  prev: string | null;
};

export async function writeWithRollback(
  filePath: string,
  nextContent: string,
  lintFn: () => Promise<LintResult | null>,
): Promise<RollbackResult> {
  let prev: string | null;
  try {
    prev = await readFile(filePath, "utf-8");
  } catch {
    prev = null;
  }
  await writeFile(filePath, nextContent, "utf-8");

  let lint: LintResult | null;
  try {
    lint = await lintFn();
  } catch (e) {
    lint = { success: false, output: e instanceof Error ? e.message : String(e) };
  }

  if (lint && !lint.success) {
    if (prev === null) {
      await unlink(filePath).catch(() => {});
    } else {
      await writeFile(filePath, prev, "utf-8");
    }
    return { ok: false, lint, error: "lint 拦截：文件已回滚，未落盘", prev };
  }
  return { ok: true, lint, prev };
}
