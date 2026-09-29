/**
 * engine/mcp.ts — MCP 客户端工具桥（协议/握手交给 @modelcontextprotocol/sdk）
 * 配置：workDir/.wllm/mcp.json（Claude Code 兼容 { mcpServers: { name: { command, args, env } } }）
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";
import { buildTool, type Tool, type ToolUseContext, type CanUseToolFn } from "./Tool.js";

export type McpServerEntry = { command: string; args?: string[]; env?: Record<string, string> };
export type McpConfigFile = { mcpServers?: Record<string, McpServerEntry> };

/** 读取 .wllm/mcp.json；不存在/非法 → null（不抛） */
export function loadMcpConfig(workDir: string): McpConfigFile | null {
  try {
    const raw = readFileSync(join(workDir, ".wllm", "mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as McpConfigFile;
    return parsed && typeof parsed === "object" && parsed.mcpServers ? parsed : null;
  } catch {
    return null;
  }
}

type McpToolDef = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
};

function wrapMcpTool(serverName: string, def: McpToolDef, client: Client): Tool {
  const toolName = `mcp_${serverName}_${def.name}`;
  const readOnly = def.annotations?.readOnlyHint === true;
  const jsonSchema = def.inputSchema ?? { type: "object", properties: {} };
  const desc = def.description || "MCP 工具（无描述）";

  return buildTool<string>({
    name: toolName,
    inputSchema: z.any(),
    jsonSchema,
    maxResultSizeChars: 100_000,
    description: () => `[MCP:${serverName}] ${desc}\n参数 JSON Schema：${JSON.stringify(jsonSchema)}`,
    prompt: () => desc,
    userFacingName: () => toolName,
    isReadOnly: () => readOnly,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    async checkPermissions() {
      return { behavior: "allow" as const };
    },
    async call(input, _ctx: ToolUseContext, _canUseTool: CanUseToolFn) {
      try {
        const r = await client.callTool({ name: def.name, arguments: (input ?? {}) as Record<string, unknown> });
        const content = (r?.content ?? []) as Array<{ type: string; text?: string }>;
        const texts = content.filter((b) => b.type === "text").map((b) => b.text ?? "");
        const joined = texts.length > 0 ? texts.join("\n") : JSON.stringify(content);
        if ((r as any)?.isError) {
          return { data: `错误：MCP 工具 ${toolName} 返回失败\n${joined}` };
        }
        return { data: joined, resultForAssistant: joined };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { data: `错误：调用 MCP 工具 ${toolName} 失败：${msg}` };
      }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
      return { type: "tool_result", tool_use_id: toolUseID, content };
    },
  });
}

export type McpConnection = {
  tools: Tool[];
  close: () => Promise<void>;
};

/**
 * 连接全部已配置的 MCP server 并桥接为 pilot Tool。
 * 单个 server 失败只降级跳过，从不 reject。
 */
export async function connectMcpServers(workDir: string, onWarn?: (msg: string) => void): Promise<McpConnection> {
  const cfg = loadMcpConfig(workDir);
  const entries = Object.entries(cfg?.mcpServers ?? {});
  if (entries.length === 0) return { tools: [], close: async () => {} };

  const tools: Tool[] = [];
  const closers: Array<() => Promise<void>> = [];

  await Promise.all(
    entries.map(async ([serverName, entry]) => {
      let client: Client | null = null;
      try {
        client = new Client({ name: "wllm-pilot", version: "1.0.0" });
        const merged = { ...process.env, ...entry.env };
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(merged)) if (v !== undefined) env[k] = v;
        const transport = new StdioClientTransport({
          command: entry.command,
          args: entry.args ?? [],
          env,
          stderr: "pipe",
        });
        await client.connect(transport);
        const listed = await client.listTools();
        for (const t of (listed.tools ?? []) as McpToolDef[]) {
          tools.push(wrapMcpTool(serverName, t, client));
        }
        closers.push(async () => {
          try { await client!.close(); } catch { /* 已断开 */ }
          try { await transport.close(); } catch { /* 已关闭 */ }
        });
        // 进程退出兜底：stdio 子进程随父进程清理
        const pid = transport.pid;
        if (pid) {
          process.once("exit", () => {
            try { process.kill(pid, "SIGTERM"); } catch { /* 已退出 */ }
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        onWarn?.(`MCP server "${serverName}" 连接失败，已跳过：${msg}`);
        if (client) {
          try { await client.close(); } catch { /* 忽略 */ }
        }
      }
    }),
  );

  return {
    tools,
    close: async () => {
      await Promise.allSettled(closers.map((c) => c()));
    },
  };
}
