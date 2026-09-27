#!/usr/bin/env node
/**
 * index.ts — CLI 入口 + REPL
 */
import { Command } from "commander";
import chalk from "chalk";
import { parseOptimizeCommand, optimizePrompt, needsClarification, appendPromptStyle } from "./promptOptimize.js";
import { join } from "path";
import { createInterface, Interface } from "readline";
import { query, type SDKMessage } from "./QueryEngine.js";
import { appStore } from "./state/AppState.js";

const VERSION = "2.0.0";

function printBanner(): void {
  console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════╗
║     🤖 Pilot Agent v${VERSION}              ║
║     AI 编程助手（Claude Code 架构）       ║
╚══════════════════════════════════════════╝
`));
  console.log(chalk.gray("输入您的需求。命令：/help /clear /cost /model /quit\n"));
}

function printHelp(): void {
  console.log(chalk.cyan(`
命令：
  /help     显示帮助
  /clear    清空对话历史
  /cost     查看 Token 用量
  /model    查看当前模型
  /quit     退出

或直接用自然语言描述您的任务。
`));
}

function handleSDKMessage(msg: SDKMessage): void {
  switch (msg.type) {
    case "text":
      process.stdout.write(chalk.cyan(`\n${msg.text}\n`));
      break;
    case "tool_use": break;
    case "tool_result": break;
    case "result":
      if (msg.subtype === "error") {
        process.stdout.write(chalk.red(`\n❌ ${msg.result}\n`));
      }
      break;
    case "system":
      if (msg.subtype === "init") {
        process.stdout.write(chalk.gray(`模型：${msg.model} | 工具：${msg.tools.join(", ")}\n\n`));
      }
      break;
  }
}

async function startREPL(): Promise<void> {
  printBanner();

  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("❯ "),
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === "/quit" || input === "/exit") {
      console.log(chalk.gray("\n再见！"));
      process.exit(0);
    }
    if (input === "/help") { printHelp(); rl.prompt(); return; }
    if (input === "/clear") {
      appStore.setState((s) => ({
        ...s,
        tokenUsage: { input: 0, output: 0 },
        compactionCount: 0,
        turnCount: 0,
      }));
      console.log(chalk.gray("对话历史已清空。\n"));
      rl.prompt();
      return;
    }
    if (input === "/cost") {
      const s = appStore.getState();
      console.log(chalk.gray(`Token 用量：输入 ${s.tokenUsage.input} | 输出 ${s.tokenUsage.output} | 上下文压缩 ${s.compactionCount} 次\n`));
      rl.prompt();
      return;
    }
    if (input === "/model") {
      const s = appStore.getState();
      console.log(chalk.gray(`模型：${s.mainLoopModel} | 模式：${s.toolPermissionContext.mode}\n`));
      rl.prompt();
      return;
    }

    const styleDir = join(process.cwd(), ".wllm", "memory");
    let finalInput: string | undefined;
    const optCmd = parseOptimizeCommand(input);
    if (optCmd !== null) {
      if (!optCmd) {
        console.log(chalk.gray("用法：/optimize <你的指令>  —— 补全结构后回填输入框，可编辑再发送\n"));
        rl.prompt();
        return;
      }
      if (needsClarification(optCmd)) {
        console.log(chalk.gray("提示：信息较模糊，建议补充目标/约束/验收；已自动补最小结构。"));
      }
      const optimized = optimizePrompt(optCmd);
      if (optimized === optCmd) {
        console.log(chalk.gray("已足够结构化，直接发送。\n"));
      } else {
        console.log(chalk.cyan("\n--- 优化预览（已回填，可编辑后回车；清空=放弃） ---"));
        console.log(optimized);
        console.log(chalk.cyan("------------------------------------------------\n"));
        appendPromptStyle(styleDir, { action: "accept", prompt: optCmd, reason: "用户触发 /optimize" });
        rl.pause();
        rl.write(null, { ctrl: true, name: "u" } as any);
        rl.write(optimized);
        rl.resume();
        return;
      }
    } else if (process.env.PILOT_PROMPT_OPT === "1" && needsClarification(input)) {
      const auto = optimizePrompt(input);
      if (auto !== input) {
        console.log(chalk.gray("[auto-optimize] 已自动补结构（PILOT_PROMPT_OPT=1）"));
        appendPromptStyle(styleDir, { action: "accept", prompt: input, reason: "auto 模式" });
        finalInput = auto;
      }
    }

    try {
      for await (const msg of query({
        prompt: finalInput ?? input,
        options: { cwd: process.cwd(), model: process.env.PILOT_MODEL },
      })) {
        handleSDKMessage(msg);
      }
    } catch (err) {
      console.error(chalk.red(`\n错误：${err instanceof Error ? err.message : err}\n`));
    }
    rl.prompt();
  });

  rl.on("close", () => { console.log(chalk.gray("\n再见！")); process.exit(0); });
}

async function runSingle(prompt: string): Promise<void> {
  for await (const msg of query({
    prompt,
    options: { cwd: process.cwd(), model: process.env.PILOT_MODEL },
  })) {
    handleSDKMessage(msg);
  }
}

function main(): void {
  const program = new Command();
  program
    .name("pilot")
    .description("🤖 Pilot Agent — AI 编程助手（Claude Code 架构）")
    .version(VERSION);

  program
    .option("-m, --model <model>", "指定模型（留空自动路由）")
    .option("-t, --max-tokens <tokens>", "最大输出 Token 数", (v) => parseInt(v, 10), 8192)
    .option("--max-turns <turns>", "最大工具调用轮次", (v) => parseInt(v, 10), 20)
    .option("-w, --work-dir <dir>", "工作目录", process.cwd())
    .option("-p, --prompt <message>", "单次执行模式");

  program.parse();
  const opts = program.opts();
  if (opts.model) process.env.PILOT_MODEL = opts.model;

  if (!process.env.ANTHROPIC_API_KEY && !process.env.PILOT_MOCK && !process.env.OPENAI_BASE_URL) {
    console.error(chalk.red("错误：请设置 ANTHROPIC_API_KEY、OPENAI_BASE_URL+OPENAI_API_KEY 或 PILOT_MOCK=1"));
    process.exit(1);
  }

  if (opts.prompt) {
    runSingle(opts.prompt).catch((err) => {
      console.error(chalk.red(`错误：${err.message}`));
      process.exit(1);
    });
  } else {
    startREPL().catch((err) => {
      console.error(chalk.red(`错误：${err.message}`));
      process.exit(1);
    });
  }
}

main();
