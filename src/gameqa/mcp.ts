/**
 * gameqa/mcp.ts — Unity MCP 代理（mcp.go 移植）
 * /api/mcp/* 转发到 MCP_SERVER_URL（默认 http://localhost:8080/mcp）。
 */
import type { Json } from "./store.js";

const MCP_MAX_BODY = 10 << 20; // 上游响应上限 10MB

/** MCP 工具名白名单（防路径穿越/查询注入到上游） */
export const TOOL_NAME_RE = /^[A-Za-z0-9_-]+$/;

export function mcpServerURL(): string {
  const v = (process.env["MCP_SERVER_URL"] ?? "").trim();
  return (v === "" ? "http://localhost:8080/mcp" : v).replace(/\/+$/, "");
}

export async function mcpGet(endpoint: string, params: URLSearchParams | null, timeoutMs: number): Promise<Record<string, Json>> {
  let u = mcpServerURL() + endpoint;
  if (params && [...params.keys()].length > 0) u += "?" + params.toString();
  try {
    const resp = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
    return (await resp.json()) as Record<string, Json>;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function mcpPost(endpoint: string, data: Json, timeoutMs: number): Promise<Record<string, Json>> {
  try {
    const resp = await fetch(mcpServerURL() + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await resp.text();
    if (text.length > MCP_MAX_BODY) return { error: "响应超过 10MB 上限" };
    try {
      return JSON.parse(text) as Record<string, Json>;
    } catch (err) {
      return { error: `响应解析失败: ${(err as Error).message}` };
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function mcpAvailable(): Promise<boolean> {
  const resp = await mcpGet("/resources/project_info", null, 30_000);
  return !("error" in resp);
}

/** 合并必填参数与可选 properties（与 Python 版一致：props 覆盖） */
export function mcpMergeProps(base: Record<string, Json>, props: Record<string, Json> | null): Record<string, Json> {
  return { ...base, ...(props ?? {}) };
}
