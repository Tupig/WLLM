#!/usr/bin/env node
/**
 * index.ts — CLI 入口 + REPL
 */
import { Command } from "commander";
import chalk from "chalk";
import { parseOptimizeCommand, optimizePrompt, needsClarification, appendPromptStyle } from "./promptOptimize.js";
import { join } from "path";
import { createInterface, Interface } from "readline";
import { snapshot, listCheckpoints, rollbackCheckpoint } from "./checkpoint.js";
import { saveSessionMessages, loadSessionMessages, listSessions, forkMessages } from "./session.js";
import { stageMemory, commitMemory, loadMemories, formatMemoriesForPrompt } from "./memory.js";
import { loadSkills, resolveSkill } from "./skills/index.js";
import { createSpec, listSpecs, loadSpec, buildWaves, parseTasks, approveSpec } from "./spec/index.js";
import { runDoctor, renderDoctor, initAgentMd, buildReviewPrompt, isValidRef } from "./diag/index.js";
import { promptUser } from "./services/permissions.js";
import type Anthropic from "@anthropic-ai/sdk";
import { query, type SDKMessage } from "./QueryEngine.js";
import { appStore } from "./state/AppState.js";

import { createRequire } from "module";
const requirePkg = createRequire(import.meta.url);
const VERSION: string = (requirePkg("../package.json") as { version: string }).version;

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
  /checkpoint [new|list|rollback <id>]  会话检查点/回滚
  /skills  技能目录
  /skill <name>  加载技能全文
  /remember [内容]  查看/存入记忆（存入需确认）
  /spec new|list|show|waves|approve  spec 三件套与计划批准
  /doctor  环境与配置体检
  /init [--force]  生成 AGENTS.md
  /review [ref]  只读评审未提交改动（或对某 ref 的 diff）
  /sessions  历史会话列表
  /resume <id>        恢复会话
  /fork <id> <条数>   从历史分叉
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
  let sessionHistory: Anthropic.MessageParam[] = [];
  let sessionId = `s-${Date.now().toString(36)}`;

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
    if (input === "/skills") {
      const skills = loadSkills(appStore.getState().workDir);
      if (skills.length === 0) console.log(chalk.gray("暂无技能（.wllm/skills/<name>/SKILL.md）。\n"));
      else {
        for (const sk of skills) console.log(chalk.gray(`  ${sk.name}  —  ${sk.description}`));
        console.log(chalk.gray("\n加载：/skill <name>\n"));
      }
      rl.prompt();
      return;
    }
    if (input === "/skill" || input.startsWith("/skill ")) {
      const name = input.split(/\s+/)[1];
      if (!name) { console.log(chalk.gray("用法：/skill <name>\n")); rl.prompt(); return; }
      const pkg = resolveSkill(appStore.getState().workDir, name);
      if (!pkg) { console.log(chalk.red(`技能不存在或被门禁拒绝：${name}\n`)); rl.prompt(); return; }
      console.log(chalk.cyan(`\n# ${pkg.name} — ${pkg.description}\n`) + pkg.body + "\n");
      rl.prompt();
      return;
    }
    if (input === "/spec" || input.startsWith("/spec ")) {
      const workDir = appStore.getState().workDir;
      const [, sub, ...rest] = input.split(/\s+/);
      try {
        if (sub === "new") {
          const name = rest[0];
          if (!name) { console.log(chalk.gray("用法：/spec new <name> [目标]\n")); rl.prompt(); return; }
          const goal = rest.slice(1).join(" ") || "（待补充目标）";
          const spec = createSpec(workDir, name, goal);
          console.log(chalk.gray(`已创建 spec：${spec.name}（写需求→设计→任务→plan.md，再 /spec approve 批准）\n`));
        } else if (sub === "list" || !sub) {
          const specs = listSpecs(workDir);
          if (specs.length === 0) console.log(chalk.gray("暂无 spec。用法：/spec new <name> [目标]\n"));
          else {
            for (const s of specs) console.log(chalk.gray(`  ${s.name}  [${s.status}] 任务 ${s.tasksDone}/${s.tasksTotal}`));
            console.log("");
          }
        } else if (sub === "show") {
          const spec = loadSpec(workDir, rest[0] || "");
          console.log(chalk.cyan(`\n=== requirements ===\n`) + spec.requirements);
          console.log(chalk.cyan(`=== design ===\n`) + spec.design);
          console.log(chalk.cyan(`=== tasks ===\n`) + spec.tasks);
          console.log(chalk.cyan(`=== plan [${spec.status}] ===\n`) + (spec.plan || "（空）") + "\n");
        } else if (sub === "waves") {
          const spec = loadSpec(workDir, rest[0] || "");
          const waves = buildWaves(parseTasks(spec.tasks));
          waves.forEach((w, i) => {
            console.log(chalk.gray(`  wave ${i + 1}（可并行）：` + w.map((t) => `${t.id} ${t.content}`).join(" | ")));
          });
          console.log("");
        } else if (sub === "approve") {
          const r = approveSpec(workDir, rest[0] || "");
          if (r.ok) {
            console.log(chalk.green(`已批准。切 /plan 探索已可省略，/act 进入执行。\n`));
          } else {
            console.log(chalk.red("批准失败（阶段③自校验未过）："));
            for (const e of r.errors) console.log(chalk.gray(`  - ${e}`));
            console.log("");
          }
        } else {
          console.log(chalk.gray("用法：/spec new|list|show|waves|approve\n"));
        }
      } catch (e) {
        console.log(chalk.red(`${e instanceof Error ? e.message : String(e)}\n`));
      }
      rl.prompt();
      return;
    }
    if (input === "/doctor") {
      const workDir = appStore.getState().workDir;
      console.log(renderDoctor(runDoctor(workDir)) + "\n");
      rl.prompt();
      return;
    }
    if (input === "/init" || input.startsWith("/init ")) {
      const force = input.includes("--force");
      try {
        const out = initAgentMd(appStore.getState().workDir, { force });
        console.log(chalk.green(`已生成 ${out.path}\n`));
        console.log(chalk.gray(out.content));
      } catch (e) {
        console.log(chalk.red(`${e instanceof Error ? e.message : String(e)}\n`));
      }
      rl.prompt();
      return;
    }
    if (input === "/review" || input.startsWith("/review ")) {
      const workDir = appStore.getState().workDir;
      const ref = input.split(/\s+/)[1];
      if (ref && !isValidRef(ref)) {
        console.log(chalk.red(`非法 ref：${ref}\n`));
        rl.prompt();
        return;
      }
      let diff = "";
      try {
        const { execSync } = await import("child_process");
        diff = execSync(ref ? `git diff --no-color ${ref}` : "git diff HEAD --no-color", {
          cwd: workDir, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        console.log(chalk.red(`收集 diff 失败：${e instanceof Error ? e.message : String(e)}\n`));
        rl.prompt();
        return;
      }
      const prompt = buildReviewPrompt(diff);
      if (prompt.startsWith("没有可评审")) {
        console.log(chalk.gray(prompt + "\n"));
        rl.prompt();
        return;
      }
      try {
        for await (const msg of query({
          prompt,
          initialMessages: sessionHistory,
          options: { cwd: workDir, model: process.env.PILOT_MODEL, initialMode: "plan" },
        })) {
          if (msg.type === "session") { sessionHistory = msg.messages; continue; }
          handleSDKMessage(msg);
        }
      } catch (err) {
        console.error(chalk.red(`\n错误：${err instanceof Error ? err.message : err}\n`));
      }
      rl.prompt();
      return;
    }
    if (input === "/remember" || input.startsWith("/remember ")) {
      const content = input.slice("/remember".length).trim();
      if (!content) {
        const mems = await loadMemories(appStore.getState().workDir);
        if (mems.length === 0) console.log(chalk.gray("暂无记忆。用法：/remember <内容>\n"));
        else console.log(formatMemoriesForPrompt(mems) + "\n");
        rl.prompt();
        return;
      }
      const staged = stageMemory({ content });
      console.log(chalk.yellow("\n将存入记忆："));
      console.log(chalk.gray(`  [${staged.category}] ${staged.content}\n`));
      const ok = await promptUser("remember", { content: staged.content });
      if (ok) {
        await commitMemory(appStore.getState().workDir, staged, true);
        console.log(chalk.gray("已存入记忆。\n"));
      } else {
        console.log(chalk.gray("已放弃。\n"));
      }
      rl.prompt();
      return;
    }
    if (input === "/sessions") {
      const list = await listSessions(appStore.getState().workDir);
      if (list.length === 0) console.log(chalk.gray("暂无历史会话。\n"));
      else {
        for (const s of list.slice(0, 20)) {
          console.log(chalk.gray(`  ${s.id}  ${s.updatedAt.slice(0, 19)}  ${s.messageCount} 条  ${s.preview}`));
        }
        console.log(chalk.gray("恢复：/resume <id> | 分叉：/fork <id> <条数>\n"));
      }
      rl.prompt();
      return;
    }
    if (input === "/resume" || input.startsWith("/resume ")) {
      const id = input.split(/\s+/)[1];
      if (!id) { console.log(chalk.gray("用法：/resume <id>\n")); rl.prompt(); return; }
      const msgs = await loadSessionMessages(appStore.getState().workDir, id);
      if (!msgs) { console.log(chalk.red(`会话不存在：${id}\n`)); rl.prompt(); return; }
      sessionHistory = msgs as Anthropic.MessageParam[];
      sessionId = id;
      console.log(chalk.gray(`已恢复会话 ${id}（${msgs.length} 条历史）\n`));
      rl.prompt();
      return;
    }
    if (input.startsWith("/fork ")) {
      const [, fid, nRaw] = input.split(/\s+/);
      const n = parseInt(nRaw ?? "", 10);
      if (!fid || !Number.isFinite(n)) { console.log(chalk.gray("用法：/fork <id> <条数>\n")); rl.prompt(); return; }
      const msgs = await loadSessionMessages(appStore.getState().workDir, fid);
      if (!msgs) { console.log(chalk.red(`会话不存在：${fid}\n`)); rl.prompt(); return; }
      const forked = forkMessages(msgs as Anthropic.MessageParam[], n);
      sessionId = `fork-${Date.now().toString(36)}`;
      sessionHistory = forked;
      await saveSessionMessages(appStore.getState().workDir, sessionId, sessionHistory);
      console.log(chalk.gray(`已分叉 ${fid} 前 ${n} 条 → 新会话 ${sessionId}（${forked.length} 条）\n`));
      rl.prompt();
      return;
    }
    if (input === "/checkpoint" || input.startsWith("/checkpoint ")) {
      const workDir = appStore.getState().workDir;
      const parts = input.split(/\s+/).slice(1);
      const sub = parts[0] ?? "list";
      try {
        if (sub === "new" || sub === "save") {
          const label = parts.slice(1).join(" ") || "手动检查点";
          const rec = await snapshot(workDir, label);
          if (rec) console.log(chalk.gray(`已创建检查点 ${rec.id}（${rec.label}）\n`));
          else console.log(chalk.gray("无改动或非 git 仓库，未创建检查点。\n"));
        } else if (sub === "rollback") {
          const id = parts[1];
          if (!id) { console.log(chalk.gray("用法：/checkpoint rollback <id>\n")); rl.prompt(); return; }
          const r = await rollbackCheckpoint(workDir, id);
          console.log(chalk.gray(r.message + "\n"));
        } else {
          const list = await listCheckpoints(workDir);
          if (list.length === 0) console.log(chalk.gray("暂无检查点。\n"));
          else {
            for (const c of list.slice(0, 20)) {
              console.log(chalk.gray(`  ${c.id}  ${c.createdAt.slice(0, 19)}  ${c.label}`));
            }
            console.log(chalk.gray("回滚：/checkpoint rollback <id>\n"));
          }
        }
      } catch (e: any) {
        console.log(chalk.red(`checkpoint 错误：${e.message}\n`));
      }
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
      const opts = { cwd: process.cwd(), model: process.env.PILOT_MODEL };
      for await (const msg of query({
        prompt: finalInput ?? input,
        initialMessages: sessionHistory,
        options: opts,
      })) {
        if (msg.type === "session") {
          sessionHistory = msg.messages;
          await saveSessionMessages(appStore.getState().workDir, sessionId, sessionHistory).catch(() => {});
          continue;
        }
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
    .option("-p, --prompt <message>", "单次执行模式")
    .option("--yolo", "跳过所有权限确认（bypassPermissions）")
    .option("--plan", "计划模式（只允许只读操作）")
    .option("--permission-mode <mode>", "权限模式：default|acceptEdits|bypassPermissions|plan|dontAsk");

  program.parse();
  const opts = program.opts();
  if (opts.model) process.env.PILOT_MODEL = opts.model;

  const permMode = opts.yolo ? "bypassPermissions" : opts.plan ? "plan" : opts.permissionMode;
  if (permMode) {
    const valid = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"];
    if (!valid.includes(permMode)) {
      console.error(chalk.red(`错误：无效权限模式 ${permMode}（可选：${valid.join("|")}）`));
      process.exit(1);
    }
    appStore.setState((s) => ({
      ...s,
      toolPermissionContext: { ...s.toolPermissionContext, mode: permMode as any },
    }));
  }

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
