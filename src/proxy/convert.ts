/**
 * proxy/convert.ts — 统一协议转换（unified_proxy.py 对译，零第三方依赖）
 * Anthropic Messages ↔ OpenAI Chat ↔ OpenAI Responses
 */
import { randomUUID } from "crypto";

export const BACKEND_MODEL = process.env.MLX_MODEL || "default_model";

const STOP_MAP: Record<string, string> = { tool_calls: "tool_use", length: "max_tokens", stop: "end_turn" };

const hex = (n: number) => randomUUID().replace(/-/g, "").slice(0, n);

/** Anthropic content（str 或 block 列表）压成纯文本 */
export function textOf(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (typeof b === "string") parts.push(b);
      else if (b && typeof b === "object") {
        const blk = b as any;
        if (blk.type === "text") parts.push(blk.text ?? "");
        else if (blk.type === "tool_result") parts.push(textOf(blk.content));
      }
    }
    return parts.filter(Boolean).join("\n");
  }
  return String(content);
}

/** Anthropic Messages 请求 → OpenAI Chat Completions 请求 */
export function anthropicToOpenAI(body: any): any {
  const msgs: any[] = [];
  const sysParts: string[] = [];

  if (body.system) sysParts.push(textOf(body.system));

  for (const m of body.messages ?? []) {
    const role = m.role ?? "user";
    const content = m.content;

    if (role === "system") {
      sysParts.push(textOf(content));
      continue;
    }

    if (typeof content === "string") {
      msgs.push({ role, content });
      continue;
    }

    const texts: string[] = [];
    const toolCalls: any[] = [];
    const toolResults: any[] = [];
    for (const b of content ?? []) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text") texts.push(b.text ?? "");
      else if (b.type === "tool_use") {
        toolCalls.push({
          id: b.id || `call_${hex(16)}`,
          type: "function",
          function: { name: b.name || "", arguments: JSON.stringify(b.input ?? {}) },
        });
      } else if (b.type === "tool_result") {
        toolResults.push({ role: "tool", tool_call_id: b.tool_use_id || "", content: textOf(b.content) });
      }
    }

    if (toolResults.length) {
      msgs.push(...toolResults);
      if (texts.length) msgs.push({ role: "user", content: texts.join("\n") });
      continue;
    }

    const msg: any = { role };
    if (toolCalls.length) {
      msg.content = texts.length ? texts.join("\n") : "";
      msg.tool_calls = toolCalls;
    } else {
      msg.content = texts.join("\n");
    }
    msgs.push(msg);
  }

  const merged = sysParts.filter(Boolean).join("\n\n");
  if (merged) msgs.unshift({ role: "system", content: merged });

  const req: any = {
    model: BACKEND_MODEL,
    messages: msgs,
    max_tokens: body.max_tokens || 4096,
  };
  if (body.temperature != null) req.temperature = body.temperature;
  if (body.top_p != null) req.top_p = body.top_p;
  if (body.stop_sequences) req.stop = body.stop_sequences;

  if (body.tools) {
    req.tools = body.tools.map((t: any) => ({
      type: "function",
      function: {
        name: t.name || "",
        description: t.description || "",
        parameters: t.input_schema || { type: "object", properties: {} },
      },
    }));
  }

  const tc = body.tool_choice;
  if (tc && typeof tc === "object") {
    if (tc.type === "auto") req.tool_choice = "auto";
    else if (tc.type === "any") req.tool_choice = "required";
    else if (tc.type === "none") req.tool_choice = "none";
    else if (tc.type === "tool" && tc.name) req.tool_choice = { type: "function", function: { name: tc.name } };
  }

  return req;
}

/** OpenAI Chat 响应 → Anthropic Messages 响应（非流式） */
export function openaiToAnthropic(data: any, body: any): any {
  const ch = (data.choices ?? [{}])[0];
  const m = ch.message ?? {};
  const content: any[] = [];

  if (m.content) content.push({ type: "text", text: m.content });

  for (const tcall of m.tool_calls ?? []) {
    const fn = tcall.function ?? {};
    let args: any = {};
    try {
      args = JSON.parse(fn.arguments || "{}");
    } catch {
      args = {};
    }
    content.push({ type: "tool_use", id: tcall.id || `toolu_${hex(16)}`, name: fn.name || "", input: args });
  }

  const u = data.usage ?? {};
  return {
    id: data.id || `msg_${hex(24)}`,
    type: "message",
    role: "assistant",
    model: body.model || BACKEND_MODEL,
    content,
    stop_reason: STOP_MAP[String(ch.finish_reason ?? "")] || "end_turn",
    stop_sequence: null,
    usage: { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0 },
  };
}

/** OpenAI Responses 请求 → OpenAI Chat Completions 请求 */
export function responsesToChat(body: any): any {
  let inputText = "";
  const inputData = body.input;

  if (typeof inputData === "string") inputText = inputData;
  else if (Array.isArray(inputData)) {
    const parts: string[] = [];
    for (const item of inputData) {
      if (typeof item === "string") parts.push(item);
      else if (item && typeof item === "object") {
        if (item.type === "message") {
          const content = item.content;
          if (typeof content === "string") parts.push(content);
          else if (Array.isArray(content)) {
            for (const c of content) {
              if (c && typeof c === "object" && c.type === "input_text") parts.push(c.text ?? "");
            }
          }
        }
      }
    }
    inputText = parts.join("\n");
  }

  const msgs: any[] = [{ role: "user", content: inputText }];
  if (body.instructions) msgs.unshift({ role: "system", content: body.instructions });

  const req: any = {
    model: BACKEND_MODEL,
    messages: msgs,
    max_tokens: body.max_output_tokens || 4096,
  };
  if (body.temperature != null) req.temperature = body.temperature;
  if (body.top_p != null) req.top_p = body.top_p;
  if (body.stop) req.stop = body.stop;

  if (body.tools) {
    req.tools = [];
    for (const t of body.tools) {
      if (t.type === "function") {
        req.tools.push({
          type: "function",
          function: {
            name: t.name || "",
            description: t.description || "",
            parameters: t.parameters || { type: "object", properties: {} },
          },
        });
      }
    }
  }

  const tc = body.tool_choice;
  if (typeof tc === "string") req.tool_choice = tc;
  else if (tc && typeof tc === "object") {
    if (tc.type === "auto") req.tool_choice = "auto";
    else if (tc.type === "required") req.tool_choice = "required";
    else if (tc.type === "none") req.tool_choice = "none";
    else if (tc.type === "function" && tc.name) req.tool_choice = { type: "function", function: { name: tc.name } };
  }

  return req;
}

/** OpenAI Chat 响应 → OpenAI Responses 响应（非流式） */
export function chatToResponses(data: any, body: any): any {
  const ch = (data.choices ?? [{}])[0];
  const m = ch.message ?? {};
  const u = data.usage ?? {};
  const output: any[] = [];

  const outputText = m.content ?? "";
  if (outputText) {
    output.push({
      type: "message",
      id: `msg_${hex(24)}`,
      role: "assistant",
      content: [{ type: "output_text", text: outputText }],
      status: "completed",
    });
  }

  for (const tcall of m.tool_calls ?? []) {
    const fn = tcall.function ?? {};
    let args: any = {};
    try {
      args = JSON.parse(fn.arguments || "{}");
    } catch {
      args = {};
    }
    output.push({
      type: "function_call",
      id: `fc_${hex(16)}`,
      call_id: tcall.id || `call_${hex(16)}`,
      name: fn.name || "",
      arguments: JSON.stringify(args),
      status: "completed",
    });
  }

  const resp: any = {
    id: data.id || `resp_${hex(24)}`,
    object: "response",
    created_at: data.created || 0,
    status: ch.finish_reason === "length" ? "incomplete" : "completed",
    output,
    usage: {
      input_tokens: u.prompt_tokens ?? 0,
      output_tokens: u.completion_tokens ?? 0,
      total_tokens: u.total_tokens ?? 0,
    },
  };
  if (body.model) resp.model = body.model;
  return resp;
}

export { STOP_MAP };
