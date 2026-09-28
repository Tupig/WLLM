/**
 * cli/mlx-local.ts — 入口转交 mlx/mlx-local.sh（原 bin/mlx-local）
 */
import { die, ensureMlxScript, mlxScript, passthrough } from "./common.js";

const NAME = "mlx-local";
ensureMlxScript(NAME);
passthrough(NAME, mlxScript(), process.argv.slice(2));
