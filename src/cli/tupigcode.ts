#!/usr/bin/env node
/**
 * cli/tupigcode.ts — tupigcode 启动器（原 bin/tupigcode shell）
 * 无显式凭据时确保本地代理 :4100 就绪，再进入主程序。
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { cliRoot, die, ensureService, info, portListening } from "./common.js";

const PORT = Number(process.env.MLX_UNIFIED_PORT ?? 4100);

async function main(): Promise<void> {
  const root = cliRoot();
  const hasCreds = !!(process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_API_KEY);

  if (!hasCreds) {
    await ensureService("tupigcode", PORT, [], 60);
    if (!(await portListening(PORT))) die("tupigcode", `等待 :${PORT} 就绪超时`);
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "mlx-local";
  }

  const entry = join(root, "dist", "index.js");
  if (!existsSync(entry)) {
    info("tupigcode", "dist/ 不存在，先构建…");
    const r = spawnSync("npm", ["run", "--silent", "build"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) die("tupigcode", "构建失败");
  }

  const r = spawnSync("node", [entry, ...process.argv.slice(2)], { stdio: "inherit" });
  if (r.error) die("tupigcode", r.error.message);
  process.exit(r.status ?? 1);
}

main().catch((e) => die("tupigcode", e instanceof Error ? e.message : String(e)));
