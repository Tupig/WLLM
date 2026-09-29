#!/usr/bin/env node
/** tests/fixtures/mcp-echo.mjs — 假 MCP server（stdio），供 e17 客户端测试 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "echo-fixture", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "回显文本",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "要回显的文本" } },
        required: ["text"],
      },
    },
    {
      name: "peek",
      description: "只读探测",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: "touch",
      description: "写操作",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "echo") {
    const text = req.params.arguments?.text ?? "";
    return { content: [{ type: "text", text: `echo:${text}` }] };
  }
  return { content: [{ type: "text", text: `ok:${req.params.name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
