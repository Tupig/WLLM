/**
 * harness.ts — 本地小模型工具调用兜底（XML 注入）
 * 原生 tool call 不稳时，把工具说明写进 system prompt，
 * 并从模型文本输出中解析 <tool name="...">{json}</tool> 块。
 */
import type Anthropic from "@anthropic-ai/sdk";

export type XmlToolCall = {
  name: string;
  input: Record<string, unknown>;
  parseError?: boolean;
};

export type HarnessMode = "xml" | "native" | "off";

const TOOL_BLOCK_RE = /<tool\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/tool>/g;

export function parseXmlToolCalls(text: string): XmlToolCall[] {
  const out: XmlToolCall[] = [];
  for (const m of text.matchAll(TOOL_BLOCK_RE)) {
    const name = (m[1] || "").trim();
    if (!name) continue;
    try {
      const body = m[2].trim();
      out.push({ name, input: body ? JSON.parse(body) : {} });
    } catch {
      out.push({ name, input: {}, parseError: true });
    }
  }
  return out;
}

export function buildXmlToolSection(tools: Anthropic.Tool[]): string {
  if (tools.length === 0) return "";
  const parts = tools.map((t) => {
    return `<tool name="${t.name}">\n${t.description}\n参数 JSON Schema：${JSON.stringify(t.input_schema)}\n</tool>`;
  });
  return [
    "你可以通过输出以下 XML 块来调用工具（一次可输出多个，按顺序执行）：",
    '<tool name="工具名">\n{"参数":"值"}\n</tool>',
    "",
    "可用工具：",
    ...parts,
  ].join("\n");
}

export function resolveHarness(env: NodeJS.ProcessEnv = process.env): HarnessMode {
  if (env.TUPIG_HARNESS === "off") return "off";
  if (env.TUPIG_HARNESS === "xml") return "xml";
  if (env.TUPIG_MOCK === "1") return "native";
  if (env.ANTHROPIC_API_KEY && !env.OPENAI_BASE_URL) return "native";
  if (env.OPENAI_BASE_URL && env.OPENAI_API_KEY) return "xml";
  return "native";
}
