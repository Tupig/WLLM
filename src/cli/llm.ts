/**
 * cli/llm.ts — 统一本地大模型 CLI（原 bin/llm shell）
 * 服务管理委托 mlx-local.sh；对话走 fetch（替代原 curl+python 构造 JSON）。
 */
import readline from "readline";
import { die, ensureMlxScript, ensureService, mlxScript, passthrough } from "./common.js";

const NAME = "llm";
const PORT = Number(process.env.MLX_UNIFIED_PORT ?? 4100);

export function buildChatPayload(prompt: string): string {
  return JSON.stringify({
    model: "default_model",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4096,
  });
}

export function parseChatResponse(body: string): string {
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    die(NAME, "解析响应失败：非合法 JSON");
  }
  if (data?.error) die(NAME, `错误: ${data.error.message ?? "未知错误"}`);
  return data?.choices?.[0]?.message?.content ?? "";
}

async function chat(prompt: string): Promise<void> {
  await ensureService(NAME, PORT);
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: buildChatPayload(prompt),
    signal: AbortSignal.timeout(1800 * 1000),
  }).catch((e) => die(NAME, `请求失败：${e instanceof Error ? e.message : String(e)}`));

  if (!res.ok) die(NAME, `HTTP错误: ${res.status}`);
  const body = await res.text();
  if (!body) die(NAME, "无响应（服务可能未启动）");
  process.stdout.write(parseChatResponse(body) + "\n");
}

async function interactive(): Promise<void> {
  console.log("本地大模型对话（输入 exit 退出）\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  for await (const line of rl) {
    const input = line.trim();
    if (input === "exit" || input === "quit") break;
    if (!input) continue;
    process.stdout.write("\x1b[0;34mAI: \x1b[0m");
    await chat(input);
    process.stdout.write("\n");
  }
  rl.close();
  console.log("再见！");
}

const HELP = `用法: llm [命令|问题]

命令:
  (无参数)              启动交互式对话
  "你的问题"            单次提问
  start [模型]          启动服务
  stop                  停止服务
  restart [模型]        重启服务
  status                查看状态
  doctor                健康检查
  use [模型]            切换模型
  model list            列出模型
  model info 别名       查看模型详情
  logs [类型]           查看日志 (server/proxy)
  help                  显示帮助

可用模型:
  14b          Qwen3-14B-4bit         7.8G   默认
  8b           Qwen3-8B-4bit          4.3G   轻量快速
  30b          Qwen3-Coder-30B-A3B    16G    代码专精 (需高GPU上限)
  qwen-vl-8b   Qwen3-VL-8B            5.5G   视觉语言模型

示例:
  llm "什么是闭包？"
  llm use 8b              # 切换到 8B
  llm use qwen-vl-8b      # 切换到视觉模型
  llm start 30b
  llm status`;

export async function main(argv: string[]): Promise<void> {
  ensureMlxScript(NAME);
  const [cmd, ...rest] = argv;
  const sh = (args: string[]): never => passthrough(NAME, mlxScript(), args);

  switch (cmd) {
    case undefined:
      return interactive();
    case "start":
      return sh(["start", ...rest]);
    case "stop":
      return sh(["stop"]);
    case "restart":
      return sh(["restart"]);
    case "status":
      return sh(["status"]);
    case "doctor":
      return sh(["doctor"]);
    case "use":
      if (!rest[0]) die(NAME, "用法: llm use <模型别名>");
      return sh(["use", ...rest]);
    case "model":
      return sh(["model", ...rest]);
    case "logs":
      return sh(["logs", ...rest[0] ?? "server"]);
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return;
    default:
      if (cmd.startsWith("-")) die(NAME, `未知选项: ${cmd}`);
      await chat(argv.join(" "));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => die(NAME, e instanceof Error ? e.message : String(e)));
}
