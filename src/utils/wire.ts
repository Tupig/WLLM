/**
 * utils/wire.ts — wire.jsonl 原始报文轨迹（issue #16，对齐 Kimi wire.jsonl 思路）
 *
 * 每行一次完整 JSON 记录：LLM 请求/响应（流式合并后正文）、代理透传观测。
 * TUPIG_WIRE=1 开启（默认关，零开销）；体积超限滚动裁剪保留尾部。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";

export interface WireRecord {
  ts: string;
  req_id: string;
  kind: string;
  provider?: string;
  model?: string;
  data: unknown;
}

export function wireEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TUPIG_WIRE === "1";
}

export function wireFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.TUPIG_WIRE_FILE || join(process.cwd(), ".tupigcode", "wire.jsonl");
}

export function wireMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.TUPIG_WIRE_MAX_BYTES ?? 5 * 1024 * 1024);
}

/**
 * 追加一行记录。开关关 / 写入失败均静默（轨迹绝不影响主流程）。
 * 返回 req_id 供调用方将 request/response 配对。
 */
export function appendWire(
  rec: { kind: string; provider?: string; model?: string; data: unknown; req_id?: string },
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!wireEnabled(env)) return null;
  const reqId = rec.req_id ?? randomUUID();
  const line: WireRecord = {
    ts: new Date().toISOString(),
    req_id: reqId,
    kind: rec.kind,
    provider: rec.provider,
    model: rec.model,
    data: rec.data,
  };
  try {
    const file = wireFile(env);
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size > wireMaxBytes(env)) {
      trimWireFile(file, wireMaxBytes(env));
    }
    appendFileSync(file, JSON.stringify(line) + "\n", "utf-8");
    return reqId;
  } catch {
    return reqId;
  }
}

/** 体积上限滚动裁剪：丢最旧行、保尾部完整行（写回后仍逐行可解析） */
export function trimWireFile(file: string, maxBytes = 5 * 1024 * 1024): void {
  try {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size <= maxBytes) return;
    const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
    const target = Math.floor(maxBytes * 0.8);
    const kept: string[] = [];
    let acc = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (acc + l.length + 1 > target && kept.length > 0) break;
      kept.unshift(l);
      acc += l.length + 1;
    }
    writeFileSync(file, kept.length ? kept.join("\n") + "\n" : "", "utf-8");
  } catch {
    /* 裁剪失败不影响主流程 */
  }
}
