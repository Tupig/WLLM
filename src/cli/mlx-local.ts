#!/usr/bin/env node
/**
 * cli/mlx-local.ts — MLX 服务管理入口（原 bin/mlx-local，服务管理已 TS 化）
 */
import { runMlxCmd } from "./mlxcmd.js";

await runMlxCmd(process.argv.slice(2));
