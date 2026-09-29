/** 构建后把 gameqa 看板静态资源复制到 dist/gameqa/static（tsc 不处理非 TS 资产） */
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "gameqa"), { recursive: true });
cpSync(join(root, "src", "gameqa", "static"), join(root, "dist", "gameqa", "static"), { recursive: true });
console.log("[copy] src/gameqa/static → dist/gameqa/static");
