/**
 * services/api.ts — API 客户端
 * 支持三种模式：Anthropic / OpenAI 兼容 / Mock
 */
import Anthropic from "@anthropic-ai/sdk";
import { MAX_RETRIES, API_FETCH_TIMEOUT_MS, DEFAULT_MODEL } from "../engine/constants.js";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; inputJsonDelta: string }
  | { type: "tool_use_stop"; id: string }
  | { type: "message_start"; message: Anthropic.Message }
  | { type: "message_delta"; stopReason: string | null; usage: Anthropic.Usage }
  | { type: "message_stop" };

export type ApiClient = {
  type: "anthropic" | "openai" | "mock";
  anthropic?: Anthropic;
};

export type ProviderKind = "anthropic" | "openai" | "mock";

/**
 * 解析 provider 优先级：PILOT_MOCK > PILOT_PROVIDER(显式) > OpenAI env > Anthropic env
 * 配置缺失时抛中文错误（由调用方决定 exit 或传递）
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ProviderKind {
  if (env.PILOT_MOCK === "1") return "mock";
  const explicit = env.PILOT_PROVIDER;
  if (explicit) {
    if (explicit !== "openai" && explicit !== "anthropic" && explicit !== "mock")
      throw new Error(`PILOT_PROVIDER 非法：${explicit}（可选 openai / anthropic / mock）`);
    if (explicit === "openai" && (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY))
      throw new Error("PILOT_PROVIDER=openai 需要同时设置 OPENAI_BASE_URL 和 OPENAI_API_KEY");
    if (explicit === "anthropic" && !env.ANTHROPIC_API_KEY)
      throw new Error("PILOT_PROVIDER=anthropic 需要设置 ANTHROPIC_API_KEY");
    return explicit;
  }
  if (env.OPENAI_BASE_URL && env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  throw new Error("请设置 ANTHROPIC_API_KEY、OPENAI_BASE_URL+OPENAI_API_KEY、PILOT_PROVIDER 或 PILOT_MOCK=1");
}

/** baseURL 归一 → 统一 chat/completions 地址（避免 /v1/v1 重复） */
export function chatUrl(base: string): string {
  let b = base.replace(/\/+$/, "");
  if (!/\/v\d+$/.test(b) && !/\/v\d+\//.test(b)) b += "/v1";
  return `${b}/chat/completions`;
}

export function resolveModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.PILOT_MODEL || DEFAULT_MODEL;
}

export function createClient(): ApiClient {
  let kind: ProviderKind;
  try {
    kind = resolveProvider();
  } catch (e) {
    console.error(`错误：${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  if (kind === "mock") return { type: "mock" };
  if (kind === "openai") return { type: "openai" };
  return { type: "anthropic", anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }) };
}

function mockUsage(): Anthropic.Usage {
  return {
    input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  } as any;
}

function mockResponse(messages: Anthropic.MessageParam[]): Anthropic.Message {
  const lastMsg = messages[messages.length - 1];
  const ut =
    typeof lastMsg?.content === "string"
      ? lastMsg.content
      : Array.isArray(lastMsg?.content)
        ? ((lastMsg!.content as any[]).find((b: any) => b.type === "text") as any)?.text || ""
        : "";
  const hasTR =
    Array.isArray(lastMsg?.content) &&
    (lastMsg!.content as any[]).some((b: any) => b.type === "tool_result");

  if (hasTR) {
    return {
      id: `msg_${Date.now()}`, type: "message", role: "assistant",
      content: [{ type: "text", text: "\n\n已完成。还有其他需要吗？" }],
      model: "mock", stop_reason: "end_turn", stop_sequence: null, usage: mockUsage(),
    } as any;
  }

  const t = ut.toLowerCase(), n = Date.now();

  if (t.includes("读") || t.includes("read") || t.includes("看看")) {
    const fp = ut.match(/(?:读|read|看看)\s+(.+)/)?.[1] || "src/index.ts";
    return {
      id: `msg_${n}`, type: "message", role: "assistant",
      content: [{ type: "tool_use", id: `toolu_${n}`, name: "Read", input: { file_path: fp } }],
      model: "mock", stop_reason: "tool_use", stop_sequence: null, usage: mockUsage(),
    } as any;
  }
  if (t.includes("列") || t.includes("list") || t.includes("有什么")) {
    return {
      id: `msg_${n}`, type: "message", role: "assistant",
      content: [{ type: "tool_use", id: `toolu_${n}`, name: "Glob", input: { pattern: "src/**/*.ts", path: "." } }],
      model: "mock", stop_reason: "tool_use", stop_sequence: null, usage: mockUsage(),
    } as any;
  }
  if (t.includes("运行") || t.includes("run") || t.includes("执行")) {
    const cmd = ut.match(/(?:运行|run|执行)\s+(.+)/)?.[1] || "echo hello";
    return {
      id: `msg_${n}`, type: "message", role: "assistant",
      content: [{ type: "tool_use", id: `toolu_${n}`, name: "Bash", input: { command: cmd } }],
      model: "mock", stop_reason: "tool_use", stop_sequence: null, usage: mockUsage(),
    } as any;
  }
  if (t.includes("搜索") || t.includes("search") || t.includes("grep")) {
    const p = ut.match(/(?:搜索|search|grep)\s+(.+)/)?.[1] || "TODO";
    return {
      id: `msg_${n}`, type: "message", role: "assistant",
      content: [{ type: "tool_use", id: `toolu_${n}`, name: "Grep", input: { pattern: p, path: "src" } }],
      model: "mock", stop_reason: "tool_use", stop_sequence: null, usage: mockUsage(),
    } as any;
  }
  return {
    id: `msg_${n}`, type: "message", role: "assistant",
    content: [{ type: "text", text: '\n\nMock 模式。试试："读 src/index.ts"、"列 src"、"运行 echo hi"、"搜索 QueryEngine"' }],
    model: "mock", stop_reason: "end_turn", stop_sequence: null, usage: mockUsage(),
  } as any;
}

export async function* streamMessage(
  client: ApiClient, model: string, maxTokens: number, system: string,
  messages: Anthropic.MessageParam[], tools: Anthropic.Tool[],
): AsyncGenerator<StreamEvent> {
  if (client.type === "mock") {
    const msg = mockResponse(messages);
    yield { type: "message_start", message: msg };
    for (const block of msg.content) {
      if (block.type === "text") {
        for (const ch of (block as any).text) {
          yield { type: "text_delta", text: ch };
          await new Promise((r) => setTimeout(r, 5));
        }
      } else if (block.type === "tool_use") {
        const id = (block as any).id;
        yield { type: "tool_use_start", id, name: (block as any).name };
        yield { type: "tool_use_delta", id, inputJsonDelta: JSON.stringify((block as any).input) };
        yield { type: "tool_use_stop", id };
      }
    }
    yield { type: "message_delta", stopReason: msg.stop_reason, usage: msg.usage };
    yield { type: "message_stop" };
    return;
  }

  if (client.type === "anthropic" && client.anthropic) {
    const stream = client.anthropic.messages.stream({
      model, max_tokens: maxTokens, system, messages,
      tools: tools.length > 0 ? tools : undefined,
    });
    let curToolId = "";
    for await (const ev of stream) {
      if (ev.type === "message_start") { yield { type: "message_start", message: ev.message }; continue; }
      if (ev.type === "content_block_start") {
        if (ev.content_block.type === "tool_use") {
          curToolId = ev.content_block.id;
          yield { type: "tool_use_start", id: curToolId, name: ev.content_block.name };
        }
        continue;
      }
      if (ev.type === "content_block_delta") {
        if (ev.delta.type === "text_delta") yield { type: "text_delta", text: ev.delta.text };
        else if (ev.delta.type === "input_json_delta")
          yield { type: "tool_use_delta", id: curToolId, inputJsonDelta: ev.delta.partial_json };
        continue;
      }
      if (ev.type === "content_block_stop") {
        if (curToolId) { yield { type: "tool_use_stop", id: curToolId }; curToolId = ""; }
        continue;
      }
      if (ev.type === "message_delta") {
        yield { type: "message_delta", stopReason: ev.delta.stop_reason, usage: ev.usage as Anthropic.Usage };
        continue;
      }
      if (ev.type === "message_stop") { yield { type: "message_stop" }; continue; }
    }
    return;
  }

  if (client.type === "openai") { yield* streamOpenAI(model, maxTokens, system, messages, tools); }
}

async function* streamOpenAI(
  model: string, maxTokens: number, system: string,
  messages: Anthropic.MessageParam[], tools: Anthropic.Tool[],
): AsyncGenerator<StreamEvent> {
  const base = process.env.OPENAI_BASE_URL;
  const key = process.env.OPENAI_API_KEY;
  if (!base || !key) throw new Error("必须设置 OPENAI_BASE_URL 和 OPENAI_API_KEY 环境变量");

  const oaiMsgs: any[] = [{ role: "system", content: system }];

  for (const m of messages) {
    if (typeof m.content === "string") {
      oaiMsgs.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const toolUseBlocks = m.content.filter((b: any) => b.type === "tool_use");
      const toolResultBlocks = m.content.filter((b: any) => b.type === "tool_result");
      const textBlocks = m.content.filter((b: any) => b.type === "text");

      if (m.role === "assistant" && toolUseBlocks.length > 0) {
        const textContent = textBlocks.map((b: any) => b.text).join("\n");
        oaiMsgs.push({
          role: "assistant", content: textContent || null,
          tool_calls: toolUseBlocks.map((b: any) => ({
            id: b.id, type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          })),
        });
      } else if (m.role === "user" && toolResultBlocks.length > 0) {
        for (const tr of toolResultBlocks) {
          oaiMsgs.push({ role: "tool", tool_call_id: (tr as any).tool_use_id, content: (tr as any).content });
        }
        const textContent = textBlocks.map((b: any) => b.text).join("\n");
        if (textContent) oaiMsgs.push({ role: "user", content: textContent });
      } else {
        const textContent = m.content.map((b: any) => (b.type === "text" ? b.text : "")).join("\n");
        oaiMsgs.push({ role: m.role, content: textContent });
      }
    }
  }

  const oaiTools = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_FETCH_TIMEOUT_MS);

  const resp = await fetch(chatUrl(base), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, messages: oaiMsgs,
      tools: oaiTools.length > 0 ? oaiTools : undefined,
      max_tokens: maxTokens, stream: true,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!resp.ok) throw new Error(`OpenAI API 返回错误 ${resp.status}：${await resp.text()}`);

  yield* parseOpenAISSE(resp.body, model);
}

/**
 * OpenAI SSE → StreamEvent 解析（纯函数段，便于测试）
 * tool_calls 按 index 分片累积；首包缺 id 时自生成并全程保持一致。
 */
export async function* parseOpenAISSE(
  body: ReadableStream<Uint8Array> | null, model: string,
): AsyncGenerator<StreamEvent> {
  if (!body) throw new Error("响应体为空");
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const tcs = new Map<number, { id: string; name: string; args: string }>();
  const msgId = `msg_${Date.now()}`;

  yield {
    type: "message_start",
    message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as any,
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const p = JSON.parse(data);
        const ch = p.choices?.[0];
        if (!ch) continue;
        const d = ch.delta;
        if (d?.content) yield { type: "text_delta", text: d.content };
        if (d?.tool_calls) {
          for (const tc of d.tool_calls) {
            const idx = tc.index ?? 0;
            if (!tcs.has(idx)) {
              const id = tc.id || `toolu_${Date.now()}_${idx}`;
              tcs.set(idx, { id, name: tc.function?.name || "", args: "" });
              if (tc.function?.name) yield { type: "tool_use_start", id, name: tc.function.name };
            }
            const ex = tcs.get(idx)!;
            if (tc.function?.name) ex.name = tc.function.name;
            if (tc.function?.arguments) {
              ex.args += tc.function.arguments;
              yield { type: "tool_use_delta", id: ex.id, inputJsonDelta: tc.function.arguments };
            }
          }
        }
        if (ch.finish_reason) {
          for (const [, tc] of tcs) yield { type: "tool_use_stop", id: tc.id };
          yield {
            type: "message_delta",
            stopReason: ch.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
            usage: { input_tokens: 0, output_tokens: p.usage?.completion_tokens || 0 } as Anthropic.Usage,
          };
        }
      } catch { /* SSE 解析失败时跳过 */ }
    }
  }
  yield { type: "message_stop" };
}

export async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: Error | undefined;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (lastErr.message.includes("401") || lastErr.message.includes("403")) throw lastErr;
      if (i < MAX_RETRIES) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** i, 10000)));
    }
  }
  throw lastErr;
}
