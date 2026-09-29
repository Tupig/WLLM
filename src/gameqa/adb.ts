/**
 * gameqa/adb.ts — ADB 命令执行共享工具（Rust adb.rs 移植；gameperf/executors 共用）
 * 可执行文件可用 ADB_PATH 覆盖（测试用）。
 */
import { execFileSync } from "node:child_process";

export function adbBin(): string {
  return process.env["ADB_PATH"] ?? "adb";
}

/** 构造 adb 命令参数（可带 -s 序列号） */
export function adbBase(serial?: string): string[] {
  const v = [adbBin()];
  if (serial !== undefined && serial !== "") {
    v.push("-s", serial);
  }
  return v;
}

/** 执行 adb 命令返回 stdout；非零退出抛错 */
export function adbOutput(args: string[]): string {
  try {
    return execFileSync(args[0], args.slice(1), { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    const e = err as { status?: number; stderr?: string; message?: string };
    if (e.status !== undefined) {
      throw new Error(`adb 退出码 ${String(e.status)}: ${(e.stderr ?? "").trim()}`);
    }
    throw new Error(`adb 执行失败: ${e.message ?? String(err)}`);
  }
}

/** 执行 adb shell 子命令；失败返回空串（单条属性采集不整体中断） */
export function adbShell(serial: string | undefined, cmd: string): string {
  const args = adbBase(serial);
  args.push("shell", cmd);
  try {
    return adbOutput(args).trim();
  } catch {
    return "";
  }
}
