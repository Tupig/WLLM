/**
 * gameqa/unity.ts — Unity 测试真实执行（runner_* 占位逻辑的正式实现）
 * 蓝本 runner_mac.py 的 run_unity_test 只有注释掉的 subprocess 占位；此处落地：
 *   Unity -batchmode -projectPath <p> -runTests -testPlatform <PlayMode|EditMode>
 *        -testResults <xml> -logFile <log> [-testFilter <f>]
 * 结果解析 NUnit3 XML（test-run 根属性 + 失败用例明细）。
 * generate_and_run：extra.generated_test_csharp 写入 Assets/Tests/Generated/ 后带 -testFilter Generated 执行。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Json } from "./store.js";

export const ARTIFACT_MAX_BYTES = 64 * 1024;

export interface UnityRunOptions {
  projectPath: string;
  testPlatform: string;
  testFilter?: string;
  resultsPath: string;
  logPath: string;
  timeoutMs: number;
}

export interface UnityRunResult {
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
  resultsXml: string;
  logPath: string;
}

/** 定位 Unity 可执行文件：UNITY_PATH → Unity Hub 安装目录（取最高版本）→ PATH 上的 Unity/unity */
export function resolveUnityBinary(): string {
  const envPath = (process.env["UNITY_PATH"] ?? "").trim();
  if (envPath !== "") return envPath;

  const home = process.env["HOME"] ?? "";
  const candidates: { root: string; rel: string; scan: string }[] = [
    { root: "/Applications/Unity/Hub/Editor", rel: "Unity.app/Contents/MacOS/Unity", scan: "mac" },
    { root: path.join(home, "Unity/Hub/Editor"), rel: "Editor/Unity", scan: "linux" },
    { root: "C:\\Program Files\\Unity\\Hub\\Editor", rel: "Editor\\Unity.exe", scan: "win" },
  ];
  for (const c of candidates) {
    let versions: string[] = [];
    try {
      versions = fs.readdirSync(c.root).sort();
    } catch {
      continue;
    }
    // 语义化版本倒序：先试最高版本
    versions.sort((a, b) => compareVersions(b, a));
    for (const v of versions) {
      const bin = path.join(c.root, v, c.rel);
      if (fs.existsSync(bin)) return bin;
    }
  }
  // PATH 兜底（spawn 时找不到会报错，交由执行阶段处理）
  return "Unity";
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 执行 Unity batchmode 测试；stdout/stderr 合入 logFile（Unity 自身写 logFile，spawn 输出仅兜底） */
export function runUnityTests(opts: UnityRunOptions): Promise<UnityRunResult> {
  const bin = resolveUnityBinary();
  const args = [
    "-batchmode",
    "-projectPath",
    opts.projectPath,
    "-runTests",
    "-testPlatform",
    opts.testPlatform,
    "-testResults",
    opts.resultsPath,
    "-logFile",
    opts.logPath,
  ];
  if (opts.testFilter && opts.testFilter.trim() !== "") {
    args.push("-testFilter", opts.testFilter.trim());
  }

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ exitCode: null, timedOut: false, error: (err as Error).message, resultsXml: "", logPath: opts.logPath });
      return;
    }
    // Unity 主要写 logFile；spawn 输出做补充（部分环境 stdout 有编译错误）
    const extraOut: Buffer[] = [];
    child.stdout?.on("data", (c: Buffer) => extraOut.push(c));
    child.stderr?.on("data", (c: Buffer) => extraOut.push(c));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut: false, error: err.message, resultsXml: "", logPath: opts.logPath });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (extraOut.length > 0) {
        try {
          fs.appendFileSync(opts.logPath, Buffer.concat(extraOut));
        } catch {
          /* log 已存在即可 */
        }
      }
      let resultsXml = "";
      try {
        resultsXml = fs.readFileSync(opts.resultsPath, "utf-8");
      } catch {
        /* 未生成（崩溃/编译失败） */
      }
      resolve({ exitCode: code, timedOut, resultsXml, logPath: opts.logPath });
    });
  });
}

export interface NUnitFailure {
  name: string;
  message: string;
}

export interface NUnitCase {
  fullname: string;
  name: string;
  classname: string;
  result: string;
  duration: number;
  message: string | null;
  stack: string | null;
  stdout: string | null;
  [k: string]: Json;
}

export interface NUnitSummary {
  result: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: NUnitFailure[];
  cases: NUnitCase[];
}

const CASES_MAX = 2000;
const FIELD_MAX = 4096;

function clip(s: string): string {
  if (s.length <= FIELD_MAX) return s;
  const suffix = "…（截断）";
  return s.slice(0, FIELD_MAX - suffix.length) + suffix;
}

function attr(tag: string, name: string): string {
  // 负向后顾防撞名：name= 不得匹配到 fullname= / methodname= 等
  const m = tag.match(new RegExp(`(?<![\\w-])${name}="([^"]*)"`));
  return m ? m[1] : "";
}

/** 解析 NUnit3 结果 XML（UTF 的 -testResults 输出）；无法识别返回 null */
export function parseNUnitXml(xml: string): NUnitSummary | null {
  const root = xml.match(/<test-run\b[^>]*>/);
  if (!root) return null;
  const tag = root[0];
  const num = (name: string): number => {
    const v = attr(tag, name);
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  };
  const failures: NUnitFailure[] = [];
  const cases: NUnitCase[] = [];
  // 匹配全部 test-case（不限 Failed），并截取各自块内提取 message/stack/output
  const caseRe = /<test-case\b[^>]*>/g;
  let cm: RegExpExecArray | null;
  while ((cm = caseRe.exec(xml)) !== null && cases.length < CASES_MAX) {
    const caseTag = cm[0];
    const name = attr(caseTag, "fullname") || attr(caseTag, "name") || "(unknown)";
    const selfClosing = caseTag.endsWith("/>");
    const startIdx = cm.index + caseTag.length;
    const endIdx = selfClosing ? -1 : xml.indexOf("</test-case>", startIdx);
    const block = endIdx > 0 ? xml.slice(startIdx, endIdx) : selfClosing ? "" : xml.slice(startIdx, startIdx + 4000);

    const result = attr(caseTag, "result") || "Unknown";
    const durRaw = parseFloat(attr(caseTag, "duration"));
    const duration = Number.isFinite(durRaw) ? durRaw : 0;

    const c: NUnitCase = {
      fullname: name,
      name: attr(caseTag, "name") || name,
      classname: attr(caseTag, "classname") || "",
      result,
      duration,
      message: null,
      stack: null,
      stdout: null,
    };

    const msgM = block.match(/<message>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/message>/);
    if (msgM) c.message = clip(msgM[1].trim());
    const stM = block.match(/<stack-trace>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/stack-trace>/);
    if (stM) c.stack = clip(stM[1].trim());
    const outM = block.match(/<output>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/output>/);
    if (outM) c.stdout = clip(outM[1].trim());

    cases.push(c);
    if (result === "Failed") {
      failures.push({ name, message: c.message ?? "" });
    }
  }
  return {
    result: attr(tag, "result") || "Unknown",
    total: num("total") || num("testcasecount"),
    passed: num("passed"),
    failed: num("failed"),
    skipped: num("skipped"),
    failures,
    cases,
  };
}

/** 取字节缓冲尾部（UTF-8 字符边界截断，与 Rust tail_utf8 一致） */
export function tailUtf8(data: Buffer, maxBytes: number): string {
  if (data.length <= maxBytes) return data.toString("utf-8");
  let start = data.length - maxBytes;
  while (start < data.length && (data[start] & 0xc0) === 0x80) start++;
  return "…（前段已截断）…\n" + data.subarray(start).toString("utf-8");
}
