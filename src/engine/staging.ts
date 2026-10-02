/**
 * engine/staging.ts — plan 模式写操作暂存（issue #18）
 *
 * plan 模式下工作区内的 Write/Edit 不再 deny，而是重定向到
 * `.tupigcode/staging/<相对路径>`（复制种子：真文件首次拷入）；
 * 用户执行 /apply 才把暂存内容落盘到真实路径。
 */
import { existsSync } from "fs";
import { mkdir, writeFile, rm, readdir, copyFile } from "fs/promises";
import { dirname, join, relative, resolve, sep } from "path";

export function stagingRoot(workDir: string): string {
  return join(workDir, ".tupigcode", "staging");
}

function inside(workDir: string, target: string): boolean {
  const abs = resolve(workDir, target);
  const rel = relative(resolve(workDir), abs);
  return rel.length > 0 && !rel.startsWith("..") && !rel.startsWith(sep);
}

/**
 * plan 模式改写目标：工作区内非 spec 文件 → staging 路径；
 * spec 产物 / 越界路径 → null（spec 由调用方先走直写分支，越界走 deny）。
 */
export function planRerouteTarget(workDir: string, artifact: string): string | null {
  const abs = resolve(workDir, artifact);
  if (abs.includes(`/.tupigcode/specs/`)) return null;
  if (!inside(workDir, abs)) return null;
  const rel = relative(resolve(workDir), abs);
  if (rel.startsWith(`.tupigcode${sep}staging${sep}`)) return abs; // 已在暂存区
  return join(stagingRoot(workDir), rel);
}

/** 种子：staging 不存在且真文件存在 → 先拷入（保证 Edit 有基底） */
export async function ensureStagedSeed(realPath: string, stagedPath: string): Promise<void> {
  if (existsSync(stagedPath)) return;
  if (!existsSync(realPath)) return;
  await mkdir(dirname(stagedPath), { recursive: true });
  await copyFile(realPath, stagedPath);
}

/** 暂存写入（相对 workDir 路径） */
export async function stageWrite(workDir: string, relPath: string, content: string): Promise<void> {
  const target = resolve(stagingRoot(workDir), relPath);
  if (!inside(stagingRoot(workDir), target)) throw new Error(`非法暂存路径：${relPath}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf-8");
}

/** 列出暂存条目（相对路径，排序） */
export async function listStaged(workDir: string): Promise<string[]> {
  const root = stagingRoot(workDir);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p, rel);
      else out.push(rel);
    }
  };
  await walk(root, "");
  return out.sort();
}

/** apply：暂存内容 → 真实路径（越界拒绝），随后清空 staging */
export async function applyStaged(workDir: string): Promise<{ applied: string[]; skipped: string[] }> {
  const root = stagingRoot(workDir);
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const rel of await listStaged(workDir)) {
    const src = resolve(root, rel);
    const dst = resolve(workDir, rel);
    if (rel.includes("..") || dst.includes(`.tupigcode${sep}staging${sep}`) || !inside(workDir, dst)) {
      skipped.push(rel);
      continue;
    }
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    applied.push(rel);
  }
  await rm(root, { recursive: true, force: true });
  return { applied, skipped };
}

/** 放弃全部暂存（不动真文件） */
export async function discardStaged(workDir: string): Promise<void> {
  await rm(stagingRoot(workDir), { recursive: true, force: true });
}

