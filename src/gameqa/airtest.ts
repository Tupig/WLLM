/**
 * gameqa/airtest.ts — Airtest 执行引擎（Rust airtest.rs / integrations/airtest_executor.py 移植）
 * 定位 airtest CLI（可选安装）运行 .air 图像识别脚本，支持 Android / Windows 设备 URI。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Json, Job } from "./store.js";
import { outcomeFailure, type Outcome } from "./outcome.js";

/** URL 查询参数编码（非保留字符外的字节全部转 %XX） */
export function urlencode(s: string): string {
  let out = "";
  for (const b of Buffer.from(s, "utf-8")) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.~]/.test(c)) out += c;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function regexEscape(s: string): string {
  let out = "";
  for (const c of s) {
    if (!/[A-Za-z0-9]/.test(c)) out += "\\";
    out += c;
  }
  return out;
}

/** 根据平台与任务参数构造 Airtest 设备 URI（Python build_device_uri 对齐）；不支持的平台抛错 */
export function buildDeviceUri(platform: string, extra: Record<string, Json>): string {
  if (platform === "android") {
    const serial = typeof extra["device_serial"] === "string" && extra["device_serial"] !== ""
      ? (extra["device_serial"] as string)
      : process.env["ANDROID_SERIAL"] ?? "";
    return `Android:///${serial}`;
  }
  if (platform === "windows") {
    const titleRe = typeof extra["window_title_re"] === "string" ? (extra["window_title_re"] as string) : "";
    const title = typeof extra["window_title"] === "string" ? (extra["window_title"] as string) : "";
    if (titleRe !== "") return `Windows:///?title_re=${urlencode(titleRe)}`;
    if (title !== "") return `Windows:///?title_re=${urlencode(regexEscape(title))}`;
    return "Windows:///";
  }
  throw new Error(`Airtest 暂不支持 platform=${platform}（当前支持 android / windows，iOS/Mac 驱动待接入）`);
}

/** 定位 airtest CLI：优先可执行文件同目录，其次 PATH，最后 python3 -m 兜底 */
export function findAirtestCmd(): string[] {
  const exeName = process.platform === "win32" ? "airtest.exe" : "airtest";
  const local = path.join(path.dirname(process.execPath), exeName);
  if (fs.existsSync(local)) return [local];
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const cand = path.join(dir, exeName);
    if (fs.existsSync(cand)) return [cand];
  }
  return process.platform === "win32" ? ["py", "-3", "-m", "airtest"] : ["python3", "-m", "airtest"];
}

export async function runAirtestScript(job: Job, platform: string, workdir: string): Promise<Outcome> {
  const extra = (job["extra"] ?? {}) as Record<string, Json>;
  const script = typeof extra["script_path"] === "string" ? (extra["script_path"] as string) : "";
  if (script === "" || !fs.existsSync(script)) {
    return outcomeFailure(`脚本不存在: ${script}`, { hint: "script_path 需为 Agent 本机上的 .air 目录" });
  }

  let uri: string;
  try {
    uri = buildDeviceUri(platform, extra);
  } catch (err) {
    return outcomeFailure((err as Error).message);
  }

  const logDir = path.join(workdir, "airtest_log");
  fs.mkdirSync(logDir, { recursive: true });

  const rawTimeout = typeof extra["timeout"] === "number" ? extra["timeout"] : 3600;
  const timeoutSec = Math.min(86_400, Math.max(60, Number.isFinite(rawTimeout) ? rawTimeout : 3600));
  const cmd = findAirtestCmd();
  console.log(`[Airtest] 执行: ${cmd.join(" ")} run ${script} --device ${uri} --log ${logDir}`);

  const args = [...cmd.slice(1), "run", script, "--device", uri, "--log", logDir];
  const stdoutFd = fs.openSync(path.join(workdir, "airtest_stdout.log"), "w");
  const stderrFd = fs.openSync(path.join(workdir, "airtest_stderr.log"), "w");

  let code: number | null = null;
  let timedOut = false;
  let spawnError: string | undefined;
  try {
    const child = spawn(cmd[0], args, { stdio: ["ignore", stdoutFd, stderrFd] });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutSec * 1000);
      child.on("error", (err: Error) => {
        clearTimeout(timer);
        spawnError = err.message;
        resolve();
      });
      child.on("close", (c: number | null) => {
        clearTimeout(timer);
        code = c;
        resolve();
      });
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }

  if (spawnError !== undefined) {
    return outcomeFailure(`启动 airtest 失败: ${spawnError}`);
  }
  const logTxt = path.join(logDir, "log.txt");
  const logPath = fs.existsSync(logTxt) ? logTxt : logDir;
  if (timedOut) {
    return {
      success: false,
      logPath,
      summary: { message: "脚本执行超时", timeout: timeoutSec, device: uri },
      artifacts: [],
    };
  }
  const success = code === 0;
  return {
    success,
    logPath,
    summary: {
      message: success ? "airtest 脚本执行成功" : "airtest 脚本执行失败",
      script,
      device: uri,
      exit_code: code,
    },
    artifacts: [],
  };
}
