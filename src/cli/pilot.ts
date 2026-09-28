/**
 * cli/pilot.ts — pilot 启动器（原 bin/pilot shell）
 * 无显式凭据时确保本地代理 :4100 就绪，再进入主程序。
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { cliRoot, die, ensureMlxScript, ensureService, info, portListening } from "./common.js";

const PORT = Number(process.env.MLX_UNIFIED_PORT ?? 4100);

async function main(): Promise<void> {
  const root = cliRoot();
  const hasCreds = !!(process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_API_KEY);

  if (!hasCreds) {
    ensureMlxScript("pilot");
    await ensureService("pilot", PORT, [], 60);
    if (!(await portListening(PORT))) die("pilot", `等待 :${PORT} 就绪超时`);
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "mlx-local";
  }

  const entry = join(root, "dist", "index.js");
  if (!existsSync(entry)) {
    info("pilot", "dist/ 不存在，先构建…");
    const r = spawnSync("npm", ["run", "--silent", "build"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) die("pilot", "构建失败");
  }

  const r = spawnSync("node", [entry, ...process.argv.slice(2)], { stdio: "inherit" });
  if (r.error) die("pilot", r.error.message);
  process.exit(r.status ?? 1);
}

main().catch((e) => die("pilot", e instanceof Error ? e.message : String(e)));
