/**
 * Web 搜索与抓取工具
 *
 * 提供 Web 搜索和页面抓取能力。
 * 灵感来自 Continue 的 @Web 上下文和 Cline 的 WebSearch。
 */
import { z } from "zod";
import { defineTool } from "../engine/Tool.js";

/**
 * Web 搜索工具
 */
export const WebSearchTool = defineTool({
  name: "WebSearch",
  description: "搜索互联网获取最新信息",
  input: z.object({
    query: z.string().describe("搜索查询"),
    numResults: z.number().optional().describe("返回结果数量（默认 5）"),
  }),
  readOnly: true,
  async execute(input) {
    const numResults = input.numResults ?? 5;

    try {
      // 使用 DuckDuckGo 搜索（无需 API Key）
      const encoded = encodeURIComponent(input.query);
      const response = await fetch(
        `https://html.duckduckgo.com/html/?q=${encoded}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; PilotAgent/1.0)",
          },
          signal: AbortSignal.timeout(10000),
        },
      );

      const html = await response.text();
      const results = parseSearchResults(html, numResults);

      if (results.length === 0) {
        return "未找到相关结果";
      }

      const lines: string[] = [`搜索「${input.query}」的结果：`];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`\n${i + 1}. ${r.title}`);
        lines.push(`   ${r.url}`);
        if (r.snippet) {
          lines.push(`   ${r.snippet}`);
        }
      }

      return lines.join("\n");
    } catch (err) {
      return `搜索失败：${err instanceof Error ? err.message : err}`;
    }
  },
});

/**
 * Web 抓取工具
 */
export const WebFetchTool = defineTool({
  name: "WebFetch",
  description: "抓取网页内容",
  input: z.object({
    url: z.string().url().describe("要抓取的 URL"),
    format: z.enum(["text", "markdown"]).optional().describe("输出格式（默认 text）"),
    maxLength: z.number().optional().describe("最大字符数（默认 10000）"),
  }),
  readOnly: true,
  async execute(input) {
    const maxLength = input.maxLength ?? 10000;

    try {
      const response = await fetch(input.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PilotAgent/1.0)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return `请求失败：${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return `不支持的内容类型：${contentType}`;
      }

      let content = await response.text();

      // 简单的 HTML 转文本
      if (contentType.includes("text/html")) {
        content = htmlToText(content);
      }

      // 截断
      if (content.length > maxLength) {
        content = content.slice(0, maxLength) + "\n\n[已截断，原始长度 " + content.length + " 字符]";
      }

      return content;
    } catch (err) {
      return `抓取失败：${err instanceof Error ? err.message : err}`;
    }
  },
});

/**
 * 解析 DuckDuckGo 搜索结果
 */
function parseSearchResults(html: string, maxResults: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // 简单的正则解析
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;

  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const url = decodeUrl(match[1]);
    const title = stripHtml(match[2]);
    const snippet = stripHtml(match[3]);

    if (url && title) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

/**
 * 解码 DuckDuckGo URL
 */
function decodeUrl(encoded: string): string {
  const match = encoded.match(/uddg=([^&]+)/);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  return encoded;
}

/**
 * 移除 HTML 标签
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * HTML 转纯文本
 */
function htmlToText(html: string): string {
  // 移除 script 和 style
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

  // 移除标签
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]*>/g, "");

  // 解码 HTML 实体
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 清理多余空白
  text = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  return text;
}
