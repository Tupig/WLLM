/**
 * search/index.ts — repo 地图：符号索引 + 预算 + mtime 缓存（N9 / A18）
 * 不引 tree-sitter：正则抽定义行，控制在本机小模型上下文预算内。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";

export const REPO_SKIP_DIRS = [
  "node_modules", ".git", ".svn", ".hg", "dist", "build", "out",
  "venv", ".venv", "models", "logs", "state", ".tupigcode", "coverage",
  "__pycache__", ".pytest_cache", "target",
];

export const REPO_MAP_BUDGET = 6_000;
export const REPO_MAX_FILE_BYTES = 512 * 1024;
export const REPO_CODE_EXTS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs",
  ".java", ".rb", ".sh", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs",
];

export type RepoSymbol = {
  path: string;
  name: string;
  kind: string;
  line: number;
};

type LocalSymbol = { name: string; kind: string; line: number };

const TS_PATTERNS: Array<[RegExp, string]> = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, "function"],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
  [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"],
  [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, "type"],
  [/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, "enum"],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/, "const"],
];

const PY_PATTERNS: Array<[RegExp, string]> = [
  [/^def\s+([A-Za-z_]\w*)/, "function"],
  [/^class\s+([A-Za-z_]\w*)/, "class"],
];

const GO_PATTERNS: Array<[RegExp, string]> = [
  [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, "function"],
  [/^type\s+([A-Za-z_]\w*)/, "type"],
];

function patternsFor(filePath: string): Array<[RegExp, string]> {
  if (filePath.endsWith(".py")) return PY_PATTERNS;
  if (filePath.endsWith(".go")) return GO_PATTERNS;
  if (/\.(rs|java|rb)$/.test(filePath)) {
    return [
      [/(?:^|\s)(?:pub\s+)?(?:fn|def)\s+([A-Za-z_]\w*)/, "function"],
      [/(?:^|\s)(?:pub\s+)?(?:class|struct)\s+([A-Za-z_]\w*)/, "class"],
      [/(?:^|\s)(?:pub\s+)?(?:interface|trait)\s+([A-Za-z_]\w*)/, "interface"],
    ];
  }
  return TS_PATTERNS;
}

export function extractSymbols(code: string, filePath: string): LocalSymbol[] {
  const out: LocalSymbol[] = [];
  const patterns = patternsFor(filePath);
  const lines = code.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|#|\*)/.test(line)) continue;
    for (const [re, kind] of patterns) {
      const m = line.match(re);
      if (m) {
        out.push({ name: m[1], kind, line: i + 1 });
        break;
      }
    }
  }
  return out;
}

function walk(dir: string, workDir: string, out: Array<{ rel: string; abs: string; mtimeMs: number }>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (REPO_SKIP_DIRS.includes(e.name)) continue;
      walk(abs, workDir, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (!REPO_CODE_EXTS.some((ext) => e.name.endsWith(ext))) continue;
    try {
      const st = statSync(abs);
      if (st.size > REPO_MAX_FILE_BYTES) continue;
      out.push({ rel: relative(workDir, abs), abs, mtimeMs: st.mtimeMs });
    } catch {
      continue;
    }
  }
}

type CacheShape = { files: Record<string, number>; symbols: RepoSymbol[] };

function readCache(cacheFile: string): CacheShape | null {
  try {
    const parsed = JSON.parse(readFileSync(cacheFile, "utf-8"));
    if (parsed && typeof parsed === "object" && parsed.files && Array.isArray(parsed.symbols)) return parsed;
  } catch {}
  return null;
}

function sameFiles(files: Array<{ rel: string; mtimeMs: number }>, cached: Record<string, number>): boolean {
  const keys = Object.keys(cached);
  if (keys.length !== files.length) return false;
  for (const f of files) {
    if (cached[f.rel] !== f.mtimeMs) return false;
  }
  return true;
}

function render(symbols: RepoSymbol[], budget: number): { text: string; truncated: boolean } {
  if (symbols.length === 0) return { text: "（无可索引符号：仓库为空或只含非代码文件）", truncated: false };
  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  for (const s of symbols) {
    const line = `${s.path}:${s.line} [${s.kind}] ${s.name}`;
    if (used + line.length + 1 > budget) break;
    lines.push(line);
    used += line.length + 1;
    shown++;
  }
  const truncated = shown < symbols.length;
  let text = `# 仓库符号地图（${shown}/${symbols.length}）\n${lines.join("\n")}`;
  if (truncated) {
    text += `\n…（截断：只显示前 ${shown} 个符号，共 ${symbols.length} 个。用 path 参数缩小目录，或提高 budget）`;
  }
  return { text, truncated };
}

export function buildRepoMap(
  workDir: string,
  opts: { budget?: number; path?: string; useCache?: boolean } = {},
): { text: string; symbols: number; truncated: boolean; fromCache: boolean } {
  const budget = Math.max(200, opts.budget ?? REPO_MAP_BUDGET);
  const start = resolve(workDir, opts.path || ".");
  const files: Array<{ rel: string; abs: string; mtimeMs: number }> = [];
  walk(start, workDir, files);
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const cacheFile = join(workDir, ".tupigcode", "cache", "repomap.json");
  let symbols: RepoSymbol[] = [];
  let fromCache = false;
  const cache = opts.useCache === false ? null : readCache(cacheFile);

  if (cache && sameFiles(files, cache.files)) {
    symbols = cache.symbols;
    fromCache = true;
  } else {
    for (const f of files) {
      try {
        const code = readFileSync(f.abs, "utf-8");
        for (const s of extractSymbols(code, f.rel)) {
          symbols.push({ path: f.rel, name: s.name, kind: s.kind, line: s.line });
        }
      } catch {
        continue;
      }
    }
    try {
      const fileMap: Record<string, number> = {};
      for (const f of files) fileMap[f.rel] = f.mtimeMs;
      mkdirSync(join(workDir, ".tupigcode", "cache"), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ files: fileMap, symbols }, null, 0));
    } catch {
      /* 缓存写失败不影响结果 */
    }
  }

  if (opts.path) symbols = symbols.filter((s) => s.path.startsWith(relative(workDir, start)) || s.path.includes(opts.path!));
  const { text, truncated } = render(symbols, budget);
  return { text, symbols: symbols.length, truncated, fromCache };
}
