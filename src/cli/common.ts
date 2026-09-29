/**
 * cli/common.ts — 启动器共享设施（端口探测、服务拉起、进程替换）
 */
import { spawn } from "child_process";
import net from "net";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

export function cliRoot(): string {
  // dist/cli/common.js 或 src/cli/common.ts → 仓库根（上两级）
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function info(name: string, msg: string): void {
  process.stderr.write(`[${name}] ${msg}\n`);
}

export function die(name: string, msg: string): never {
  process.stderr.write(`[${name}] 错误: ${msg}\n`);
  process.exit(1);
}

export function portListening(port: number): Promise<boolean> {
  return new Promise((res) => {
    const sock = new net.Socket();
    const done = (ok: boolean) => {
      sock.destroy();
      res(ok);
    };
    sock.setTimeout(500);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, "127.0.0.1");
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 拉起 mlx 服务并等待端口就绪；细粒度前 10 次 200ms，之后 1s */
export async function ensureService(
  name: string,
  port: number,
  startArgs: string[] = [],
  waitSeconds = 60,
): Promise<void> {
  if (await portListening(port)) return;
  info(name, "本地服务未运行，正在启动（首次约 30 秒）…");
  const { runMlxCmd } = await import("./mlxcmd.js");
  try {
    await runMlxCmd(["start", ...startArgs]);
  } catch {
    die(name, "服务启动失败");
  }
  for (let i = 0; i < 10; i++) {
    if (await portListening(port)) return;
    await sleep(200);
  }
  const rest = Math.max(0, waitSeconds - 2);
  for (let i = 0; i < rest; i++) {
    if (await portListening(port)) return;
    await sleep(1000);
  }
  die(name, `等待 :${port} 就绪超时，可用 mlx-local doctor 排查`);
}

/** exec 替换：stdio 继承，退出码透传 */
export function execReplace(name: string, cmd: string, args: string[]): never {
  const child = spawn(cmd, args, { stdio: "inherit" });
  child.on("error", (e) => die(name, `${cmd} 启动失败：${e.message}`));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
  // 保持父进程存活直到子进程退出
  return undefined as never;
}
