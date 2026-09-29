/**
 * gameqa/ai.ts — AI 探索测试：视觉大模型驱动的「截图 → 决策 → 执行」循环（Rust ai.rs 移植）
 * Android 端原生实现（adb screencap/input + OpenAI 兼容视觉接口），目标机无需 Python/Airtest。
 * 纯逻辑（parseAction / validateAction / toPixels / parsePngSize / parseWmSize /
 * escapeInputText / buildStepMessages）与 Python integrations/ai_agent.py 行为一致，均有单测。
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Json, Job } from "./store.js";
import { adbBase } from "./adb.js";
import { outcomeFailure, type Outcome } from "./outcome.js";

/** 模型可输出的动作空间（与 Python 版一致，供文档与校验参考） */
export const ALLOWED_ACTIONS = ["tap", "swipe", "text", "key", "wait", "finish"] as const;

export const SYSTEM_PROMPT = `你是一个游戏 QA 自动化测试 Agent，通过观察屏幕截图来操作设备完成测试任务。
每一步你只能输出一个 JSON 对象（不要 markdown 代码块、不要解释），动作为以下之一：
{"action": "tap", "x": 0.5, "y": 0.3}          # 点击，坐标为归一化 0~1（相对截图宽高）
{"action": "swipe", "x1": 0.5, "y1": 0.8, "x2": 0.5, "y2": 0.2}   # 滑动
{"action": "text", "text": "hello"}             # 向输入框输入文本（需先点击输入框）
{"action": "key", "key": "BACK"}                # Android 按键：BACK/HOME/MENU/ENTER 等
{"action": "wait", "seconds": 3}                # 等待 1~30 秒
{"action": "finish", "success": true, "reason": "设置面板已打开"}   # 任务完成或确认无法完成
要求：
1. x/y 坐标必须来自当前截图观察，不要凭空猜测。
2. 任务目标未完成且仍有可尝试的操作时，不要输出 finish。
3. 界面明显无法继续（卡死、报错、找不到入口）时，输出 finish 且 success=false，并说明原因。`;

// ---------- 纯逻辑（可单测） ----------

/** 从模型输出中提取首个 JSON 对象；解析失败返回 null */
export function parseAction(textOut: string): Record<string, Json> | null {
  let s = textOut.trim();
  if (s === "") return null;
  const fenceStart = s.indexOf("```");
  if (fenceStart >= 0) {
    let after = s.slice(fenceStart + 3);
    if (after.startsWith("json")) after = after.slice(4);
    const fenceEnd = after.indexOf("```");
    if (fenceEnd >= 0) s = after.slice(0, fenceEnd).trim();
  }
  const start = s.indexOf("{");
  if (start < 0) return null;
  const end = s.lastIndexOf("}");
  if (end <= start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1)) as Json;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, Json>;
  } catch {
    /* 解析失败 */
  }
  return null;
}

function coordOk(v: Json | undefined): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

/** 校验按键名：仅允许字母/数字/下划线（adb shell 会拼给设备端 sh 解释，放行元字符=任意命令执行） */
function keyOk(v: Json | undefined): boolean {
  return typeof v === "string" && v !== "" && /^[A-Za-z0-9_]+$/.test(v);
}

/** 校验动作合法性：action 在动作空间内、坐标/参数类型正确 */
export function validateAction(act: Record<string, Json>): boolean {
  const action = act["action"];
  if (typeof action !== "string") return false;
  switch (action) {
    case "tap":
      return coordOk(act["x"]) && coordOk(act["y"]);
    case "swipe":
      return ["x1", "y1", "x2", "y2"].every((k) => coordOk(act[k]));
    case "text":
      return typeof act["text"] === "string" && act["text"] !== "";
    case "key":
      return keyOk(act["key"]);
    case "wait": {
      const v = act["seconds"];
      if (v === undefined || v === null) return true;
      return typeof v === "number" && v > 0 && v <= 30;
    }
    case "finish":
      return typeof act["success"] === "boolean";
    default:
      return false;
  }
}

/** 归一化坐标 → 设备像素坐标（截断取整，与 Python to_pixels 一致） */
export function toPixels(act: Record<string, Json>, width: number, height: number): Record<string, Json> {
  const px = (k: string): number => Math.trunc((typeof act[k] === "number" ? act[k] : 0) * width);
  const py = (k: string): number => Math.trunc((typeof act[k] === "number" ? act[k] : 0) * height);
  if (act["action"] === "tap") return { action: "tap", x: px("x"), y: py("y") };
  if (act["action"] === "swipe") {
    const d = typeof act["duration"] === "number" ? act["duration"] : 0.5;
    return {
      action: "swipe",
      x1: px("x1"),
      y1: py("y1"),
      x2: px("x2"),
      y2: py("y2"),
      duration: Math.min(10.0, Math.max(0.1, d)),
    };
  }
  return { ...act };
}

/** 从 PNG 字节解析 IHDR 宽高（横屏时 screencap 输出已旋转帧缓冲，与 wm size 不一致） */
export function parsePngSize(bytes: Buffer): [number, number] | null {
  if (bytes.length < 24) return null;
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!magic.every((b, i) => bytes[i] === b)) return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  return w > 0 && h > 0 ? [w, h] : null;
}

/** 解析 `adb shell wm size` 输出；Override 优先于 Physical。单行解析失败不放弃其余行 */
export function parseWmSize(output: string): [number, number] | null {
  let physical: [number, number] | null = null;
  let override: [number, number] | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    let rest: string | null = null;
    let isOverride = false;
    if (line.startsWith("Physical size:")) rest = line.slice("Physical size:".length);
    else if (line.startsWith("Override size:")) {
      rest = line.slice("Override size:".length);
      isOverride = true;
    }
    if (rest === null) continue;
    const parts = rest.trim().split(/[xX]/);
    const w = parseInt((parts[0] ?? "").trim(), 10);
    const h = parseInt((parts[1] ?? "").trim(), 10);
    if (Number.isNaN(w) || Number.isNaN(h)) continue;
    if (isOverride) override = [w, h];
    else physical = [w, h];
  }
  return override ?? physical;
}

/** adb input text 只接受有限字符：空格转 %s，其余 shell 敏感字符丢弃 */
export function escapeInputText(s: string): string {
  let out = "";
  for (const c of s) {
    if (c === " ") out += "%s";
    else if (/[A-Za-z0-9]/.test(c) || "-._%".includes(c)) out += c;
  }
  return out;
}

/** 构造每步请求的文本消息（图片由调用方以 image_url 追加到最后一条 user 消息） */
export function buildStepMessages(task: string, history: Record<string, Json>[]): { role: string; content: Json }[] {
  let hist: string;
  if (history.length === 0) {
    hist = "历史步骤：无，这是第一步。";
  } else {
    const lines: string[] = [];
    const start = Math.max(0, history.length - 8);
    for (const h of history.slice(start)) {
      const desc: Record<string, Json> = {};
      for (const k of ["step", "action", "result", "error"]) {
        if (h[k] !== undefined) desc[k] = h[k];
      }
      lines.push(`${String(lines.length + 1)}. ${JSON.stringify(desc)}`);
    }
    hist = `历史步骤（最近 8 条）：\n${lines.join("\n")}`;
  }
  const user = `测试任务：${task}\n\n${hist}\n\n请观察当前截图，输出下一步动作 JSON。`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

// ---------- adb / OpenAI ----------

const ADB_TIMEOUT_MS = 30_000;

/** 带超时的命令执行（execFileSync timeout 杀进程）；返回 stdout 字节 */
function adbExec(args: string[], timeoutMs = ADB_TIMEOUT_MS): Buffer {
  try {
    return execFileSync(args[0], args.slice(1), { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }) as Buffer;
  } catch (err) {
    const e = err as { status?: number | null; stderr?: Buffer | string; message?: string; code?: string };
    if (e.status !== undefined && e.status !== null) {
      const stderr = e.stderr !== undefined ? String(e.stderr).trim() : "";
      throw new Error(`退出码 ${String(e.status)}: ${stderr}`);
    }
    if (e.code !== undefined) {
      throw new Error(`命令执行失败: ${e.code}`);
    }
    if (e.message !== undefined && e.message.includes("ETIMEDOUT")) {
      throw new Error(`命令超时（超过 ${String(timeoutMs)}ms）已终止`);
    }
    throw new Error(e.message ?? String(err));
  }
}

function adbShellRun(serial: string | undefined, shellArgs: string[]): void {
  const args = adbBase(serial);
  args.push("shell", ...shellArgs);
  adbExec(args);
}

function adbScreencap(serial: string | undefined): Buffer {
  const args = adbBase(serial);
  args.push("exec-out", "screencap", "-p");
  return adbExec(args);
}

function adbScreenSize(serial: string | undefined): [number, number] {
  const args = adbBase(serial);
  args.push("shell", "wm", "size");
  try {
    return parseWmSize(adbExec(args).toString("utf-8")) ?? [1080, 1920];
  } catch {
    return [1080, 1920];
  }
}

function openaiModel(): string {
  return process.env["OPENAI_VISION_MODEL"] ?? process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
}

/** 调用 OpenAI 兼容视觉接口；返回模型文本输出 */
export async function openaiChat(messages: { role: string; content: Json }[], imageDataUrl: string): Promise<string> {
  const apiKey = (process.env["OPENAI_API_KEY"] ?? "").trim();
  if (apiKey === "") throw new Error("OPENAI_API_KEY 未配置");
  const base = (process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const msgs = messages.map((m) => ({ ...m }));
  const last = msgs[msgs.length - 1];
  const text = typeof last.content === "string" ? last.content : "";
  last.content = [
    { type: "text", text },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
  let resp: Response;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: openaiModel(), messages: msgs, temperature: 0.2 }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(`模型调用失败: ${(err as Error).message}`);
  }
  if (!resp.ok) throw new Error(`模型调用失败: HTTP ${String(resp.status)}`);
  const v = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const out = (v.choices?.[0]?.message?.content ?? "").trim();
  if (out === "") throw new Error("模型返回为空");
  return out;
}

/** 执行像素坐标动作；返回 "ok" 或错误描述 */
async function executeAction(px: Record<string, Json>, serial: string | undefined): Promise<string> {
  const action = typeof px["action"] === "string" ? px["action"] : "";
  try {
    switch (action) {
      case "tap":
        adbShellRun(serial, ["input", "tap", String(px["x"]), String(px["y"])]);
        break;
      case "swipe": {
        const ms = Math.trunc((typeof px["duration"] === "number" ? px["duration"] : 0.5) * 1000);
        adbShellRun(serial, ["input", "swipe", String(px["x1"]), String(px["y1"]), String(px["x2"]), String(px["y2"]), String(ms)]);
        break;
      }
      case "text": {
        const raw = typeof px["text"] === "string" ? px["text"] : "";
        const text = escapeInputText(raw);
        if (text === "" && raw !== "") {
          return "执行失败: 不支持非 ASCII 文本输入（adb input text 限制，仅支持 ASCII）";
        }
        adbShellRun(serial, ["input", "text", text]);
        break;
      }
      case "key":
        adbShellRun(serial, ["input", "keyevent", String(px["key"])]);
        break;
      case "wait": {
        const secs = Math.min(30, typeof px["seconds"] === "number" ? px["seconds"] : 1.0);
        await sleep(secs * 1000);
        break;
      }
      default:
        return "执行失败: 未知动作";
    }
    return "ok";
  } catch (err) {
    return `执行失败: ${(err as Error).message}`;
  }
}

// ---------- 主循环 ----------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** ai_exploratory 主流程。extra: prompt(必填) / device_serial / max_steps */
export async function runAiExploratory(job: Job, platform: string, workdir: string): Promise<Outcome> {
  const extra = (job["extra"] ?? {}) as Record<string, Json>;
  const task = typeof extra["prompt"] === "string" ? (extra["prompt"] as string) : "";
  if (task === "") {
    return outcomeFailure("缺少 extra.prompt（AI 探索测试目标）");
  }
  if ((process.env["OPENAI_API_KEY"] ?? "").trim() === "") {
    return outcomeFailure("OPENAI_API_KEY 未配置");
  }
  if (platform !== "android") {
    return outcomeFailure(`AI 探索测试当前仅支持 android 平台（收到 ${platform}），Windows 桌面驱动待接入`);
  }
  const serialRaw = typeof extra["device_serial"] === "string" ? (extra["device_serial"] as string) : "";
  const serial = serialRaw !== "" ? serialRaw : process.env["ANDROID_SERIAL"] ?? "";
  const serialOpt = serial !== "" ? serial : undefined;

  fs.mkdirSync(workdir, { recursive: true });
  const device = `Android:///${serial}`;
  const model = openaiModel();
  const maxSteps = Math.min(200, Math.max(1, Math.trunc(typeof extra["max_steps"] === "number" ? extra["max_steps"] : 12)));

  // 唤醒屏幕（锁屏时避免在黑屏上空耗步数）
  try {
    adbShellRun(serialOpt, ["input", "keyevent", "WAKEUP"]);
  } catch {
    /* 唤醒失败不阻断 */
  }

  const history: Record<string, Json>[] = [];
  let success = false;
  let reason = "达到最大步数";

  for (let i = 1; i <= maxSteps; i++) {
    // 截图 → base64 data URL
    const png = path.join(workdir, `step_${String(i).padStart(2, "0")}.png`);
    let bytes: Buffer;
    try {
      bytes = adbScreencap(serialOpt);
    } catch (err) {
      reason = `截图失败: ${(err as Error).message}`;
      break;
    }
    if (bytes.length === 0) {
      reason = "截图为空（设备可能处于异常状态）";
      break;
    }
    try {
      fs.writeFileSync(png, bytes);
    } catch (err) {
      reason = `写入截图失败: ${png}: ${(err as Error).message}`;
      break;
    }

    // 以截图实际尺寸换算坐标（横屏时与 wm size 的自然朝向不同）
    const size = parsePngSize(bytes) ?? adbScreenSize(serialOpt) ?? [1080, 1920];
    const [w, h] = size;
    const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

    // 视觉模型决策
    const messages = buildStepMessages(task, history);
    let out: string;
    try {
      out = await openaiChat(messages, dataUrl);
    } catch (err) {
      reason = (err as Error).message;
      break;
    }

    const act = parseAction(out);
    if (act === null || !validateAction(act)) {
      const raw = Array.from(out).slice(0, 200).join("");
      history.push({ step: i, raw, error: "动作解析失败，请重新输出 JSON" });
      continue;
    }

    if (act["action"] === "finish") {
      success = act["success"] === true;
      reason = typeof act["reason"] === "string" ? act["reason"] : "";
      history.push({ step: i, action: act, result: "finish" });
      break;
    }

    const px = toPixels(act, w, h);
    const result = await executeAction(px, serialOpt);
    history.push({ step: i, action: act, result, screenshot: path.basename(png) });
    await sleep(1000);
  }

  const stepsPath = path.join(workdir, "steps.json");
  const record = { task, success, reason, steps: history };
  fs.writeFileSync(stepsPath, JSON.stringify(record, null, 2), "utf-8");

  return {
    success,
    logPath: stepsPath,
    summary: {
      message: success ? "AI 探索测试达成" : "AI 探索测试未达成",
      model,
      device,
      steps: history.length,
      reason,
    },
    artifacts: [],
  };
}
