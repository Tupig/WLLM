/**
 * engine/mcp.ts — MCP 客户端工具桥（协议/握手交给 @modelcontextprotocol/sdk）
 * 配置：workDir/.tupigcode/mcp.json（Claude Code 兼容 { mcpServers: { name: { command, args, env } } }）
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";
import { buildTool, type Tool, type ToolUseContext, type CanUseToolFn } from "./Tool.js";

export type McpApproval = "allow" | "ask" | "deny";
export type McpServerEntry = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** callTool 单次调用超时（毫秒，issue #60）；未配走 SDK 默认 */
  timeout?: number;
  /** server 级审批：allow=白名单放行 / ask=强制问 / deny=阻断；未配置=沿用通用链 */
  approval?: McpApproval;
  /** per-tool 覆盖 server 级，key 为 MCP 原始工具名 */
  tools?: Record<string, McpApproval>;
};
export type McpConfigFile = { mcpServers?: Record<string, McpServerEntry> };

// ---------- 审批表（连接时填充；permissions.canUseTool 查询） ----------
type ApprovalDecision = McpApproval | "default";
const approvalTable = new Map<string, ApprovalDecision>();

/** 查询 MCP 工具审批决策；非 MCP 工具返回 undefined */
export function getMcpApproval(toolName: string): ApprovalDecision | undefined {
  return approvalTable.get(toolName);
}

/** 清空审批表（重连/测试隔离用） */
export function clearMcpApprovals(): void {
  approvalTable.clear();
}

/** 读取 .tupigcode/mcp.json；不存在/非法 → null（不抛） */
export function loadMcpConfig(workDir: string): McpConfigFile | null {
  try {
    const raw = readFileSync(join(workDir, ".tupigcode", "mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as McpConfigFile;
    return parsed && typeof parsed === "object" && parsed.mcpServers ? parsed : null;
  } catch {
    return null;
  }
}

export type McpAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpToolDef = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: McpAnnotations;
};

/**
 * 把 MCP 工具桥接为 tupigcode Tool（issue #58）：
 * annotations 全量消费——readOnlyHint 决定只读分级；显式 destructiveHint=true
 * 且非只读 → 审批登记时升为 ask（deny 优先、allow 被覆盖）；annotations 缺省不强制。
 */
export function wrapMcpTool(serverName: string, def: McpToolDef, client: Pick<Client, "callTool">, entry: McpServerEntry): Tool {
  const toolName = `mcp_${serverName}_${def.name}`;
  const an = def.annotations ?? {};
  const readOnly = an.readOnlyHint === true;
  // 审批登记：per-tool 覆盖 server 级，均未配置 = default（走通用权限链）
  let approval: McpApproval | "default" = entry.tools?.[def.name] ?? entry.approval ?? "default";
  if (approval !== "deny" && !readOnly && an.destructiveHint === true) {
    approval = "ask"; // 破坏性标注强制确认（issue #58）
  }
  approvalTable.set(toolName, approval);
  const jsonSchema = def.inputSchema ?? { type: "object", properties: {} };
  const title = def.annotations?.title ?? def.title;
  const desc = (title ? `${title} — ` : "") + (def.description || "MCP 工具（无描述）");
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
      // 与审批表对齐（主链路判定在 permissions.canUseTool；此处为防御一致性）
      const d = getMcpApproval(toolName);
      if (d === "deny") return { behavior: "deny" as const, message: `MCP 工具「${toolName}」已被 mcp.json 审批禁止` };
      if (d === "ask") return { behavior: "ask" as const, message: `MCP 工具「${toolName}」需要用户确认（mcp.json 审批）` };
      return { behavior: "allow" as const };
    },
    async call(input, _ctx: ToolUseContext, _canUseTool: CanUseToolFn) {
      try {
        const opts = typeof entry.timeout === "number" && entry.timeout > 0 ? { timeout: entry.timeout } : undefined;
        const r = await client.callTool(
          { name: def.name, arguments: (input ?? {}) as Record<string, unknown> },
          undefined,
          opts,
        );
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

/** transport.onclose：摘除断开 server 的全部工具（issue #60），模型不再看到死工具 */
export function handleServerDrop(
  serverName: string,
  serverTools: Map<string, Tool[]>,
  fireChanged: () => void,
  onWarn?: (msg: string) => void,
): void {
  if (!serverTools.has(serverName)) return;
  serverTools.delete(serverName);
  onWarn?.(`MCP server "${serverName}" 连接断开，已摘除其工具（重连中）`);
  fireChanged();
}

/** 退避延迟（issue #60）：1s 起指数翻倍，30s 封顶 */
export function backoffDelayMs(attempt: number): number {
  const exp = 1_000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(exp, 30_000);
}

/**
 * 断开重连循环（issue #60）：退避重试，成功返回 true；
 * 耗尽 maxAttempts 调 onGaveUp 返回 false。
 */
export async function reconnectLoop(opts: {
  tryConnect: () => Promise<boolean>;
  maxAttempts?: number;
  delayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  onGaveUp?: () => void;
}): Promise<boolean> {
  const max = opts.maxAttempts ?? 5;
  const delay = opts.delayMs ?? backoffDelayMs;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; attempt <= max; attempt++) {
    await sleep(delay(attempt));
    try {
      if (await opts.tryConnect()) return true;
    } catch {
      /* 单次重连失败 → 继续退避 */
    }
  }
  opts.onGaveUp?.();
  return false;
}

export type McpConnection = {
  tools: Tool[];
  /** 全量重拉所有 server 的 tools/list 并 diff 同步（issue #59） */
  refresh: () => Promise<{ added: string[]; removed: string[] }>;
  close: () => Promise<void>;
};

type RefreshableClient = Pick<Client, "callTool"> & { listTools?: () => Promise<{ tools?: McpToolDef[] }> };

/**
 * 构建单 server 的 tools/list 重拉器（issue #59）：
 * 重拉 → 重 wrap 全量 → diff added/removed → 写回 serverTools；
 * 变更才 fireChanged + onWarn；失败保留旧工具只告警。
 */
export function makeServerRefresher(opts: {
  serverName: string;
  entry: McpServerEntry;
  client: RefreshableClient;
  serverTools: Map<string, Tool[]>;
  fireChanged: () => void;
  onWarn?: (msg: string) => void;
}): () => Promise<{ added: string[]; removed: string[] }> {
  const { serverName, entry, client, serverTools, fireChanged, onWarn } = opts;
  return async () => {
    const old = serverTools.get(serverName) ?? [];
    try {
      const listed = await client.listTools?.();
      const fresh = (listed?.tools ?? []).map((t) => wrapMcpTool(serverName, t, client, entry));
      const oldNames = new Set(old.map((t) => t.name));
      const newNames = new Set(fresh.map((t) => t.name));
      const added = [...newNames].filter((n) => !oldNames.has(n));
      const removed = [...oldNames].filter((n) => !newNames.has(n));
      serverTools.set(serverName, fresh);
      if (added.length || removed.length) {
        onWarn?.(
          `MCP server "${serverName}" 工具列表已变更：+${added.join(", ") || "无"} -${removed.join(", ") || "无"}`,
        );
        fireChanged();
      }
      return { added, removed };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onWarn?.(`MCP server "${serverName}" tools/list 刷新失败（保留旧工具）：${msg}`);
      return { added: [], removed: [] };
    }
  };
}

/** 订阅 notifications/tools/list_changed → 触发刷新（issue #59）；不支持则静默 */
export function registerListChanged(
  client: Pick<Client, "setNotificationHandler">,
  refresh: () => Promise<unknown>,
): void {
  try {
    client.setNotificationHandler(ToolListChangedNotificationSchema as never, async () => {
      await refresh();
    });
  } catch {
    /* client 不支持通知处理器 */
  }
}

/**
 * 连接全部已配置的 MCP server 并桥接为 tupigcode Tool。
 * 单个 server 失败只降级跳过，从不 reject。
 * onToolsChanged：任一 server list_changed/refresh 后回调全量工具集（issue #59）。
 */
export async function connectMcpServers(
  workDir: string,
  onWarn?: (msg: string) => void,
  onToolsChanged?: (tools: Tool[]) => void,
): Promise<McpConnection> {
  const cfg = loadMcpConfig(workDir);
  const entries = Object.entries(cfg?.mcpServers ?? {});
  if (entries.length === 0) return { tools: [], refresh: async () => ({ added: [], removed: [] }), close: async () => {} };

  const serverTools = new Map<string, Tool[]>();
  const refresherMap = new Map<string, () => Promise<{ added: string[]; removed: string[] }>>();
  const closers: Array<() => Promise<void>> = [];
  const fireChanged = () => onToolsChanged?.([...serverTools.values()].flat());

  let closed = false; // connection close 后不再重连（issue #60）

  await Promise.all(
    entries.map(async ([serverName, entry]) => {
      let curClient: Client | null = null;
      let curTransport: StdioClientTransport | null = null;

      // 首连与退避重连复用（issue #60）：新 client/transport 就位后重 wrap 全量工具
      const connectOnce = async (): Promise<void> => {
        const client = new Client({ name: "tupigcode-tupigcode", version: "1.0.0" });
        curClient = client;
        const merged = { ...process.env, ...entry.env };
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(merged)) if (v !== undefined) env[k] = v;
        const transport = new StdioClientTransport({
          command: entry.command,
          args: entry.args ?? [],
          env,
          stderr: "pipe",
        });
        curTransport = transport;
        await client.connect(transport);
        const listed = await client.listTools();
        serverTools.set(
          serverName,
          ((listed.tools ?? []) as McpToolDef[]).map((t) => wrapMcpTool(serverName, t, client, entry)),
        );
        const refreshOne = makeServerRefresher({ serverName, entry, client, serverTools, fireChanged, onWarn });
        refresherMap.set(serverName, refreshOne);
        registerListChanged(client, refreshOne);
        // stdio 断开 → 立即摘除死工具 + 退避重连（issue #60）
        transport.onclose = () => {
          if (closed) return;
          handleServerDrop(serverName, serverTools, fireChanged, onWarn);
          void reconnectLoop({
            tryConnect: async () => {
              if (closed) return true;
              await connectOnce();
              onWarn?.(`MCP server "${serverName}" 已重连，工具恢复`);
              fireChanged();
              return true;
            },
            onGaveUp: () => onWarn?.(`MCP server "${serverName}" 重连放弃（最多 5 次退避重试）`),
          });
        };
        // 进程退出兜底：stdio 子进程随父进程清理
        const pid = transport.pid;
        if (pid) {
          process.once("exit", () => {
            try { process.kill(pid, "SIGTERM"); } catch { /* 已退出 */ }
          });
        }
      };

      closers.push(async () => {
        try { await curClient?.close(); } catch { /* 已断开 */ }
        try { await curTransport?.close(); } catch { /* 已关闭 */ }
      });

      try {
        await connectOnce(); // 首连失败只降级跳过，不自动重连（与既有语义一致）
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        onWarn?.(`MCP server "${serverName}" 连接失败，已跳过：${msg}`);
        const failed = curClient as Client | null;
        if (failed) {
          try { await failed.close(); } catch { /* 忽略 */ }
        }
      }
    }),
  );

  return {
    tools: [...serverTools.values()].flat(),
    refresh: async () => {
      const results = await Promise.all([...refresherMap.values()].map((r) => r()));
      const added = results.flatMap((r) => r.added);
      const removed = results.flatMap((r) => r.removed);
      return { added, removed };
    },
    close: async () => {
      closed = true;
      await Promise.allSettled(closers.map((c) => c()));
    },
  };
}
