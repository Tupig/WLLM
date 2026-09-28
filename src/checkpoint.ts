/**
 * checkpoint.ts — 会话检查点（A4：gemini-cli shadow Git 思路）
 * 快照：commit→存 refs/wllm/checkpoints/<id>→mixed reset 还原用户工作区（不污染分支）
 * 回滚：先自动生成安全检查点，再硬重置到目标
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, appendFile } from "fs/promises";
import { join } from "path";

const execFileAsync = promisify(execFile);

const CKPT_REF_PREFIX = "refs/wllm/checkpoints/";

export type CheckpointRecord = {
  id: string;
  sha: string;
  label: string;
  createdAt: string;
};

async function git(workDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: workDir, encoding: "utf-8" });
  return stdout.trim();
}

async function isGitRepo(workDir: string): Promise<boolean> {
  try {
    await git(workDir, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

function jsonlPath(workDir: string): string {
  return join(workDir, ".wllm", "checkpoints.jsonl");
}

async function appendRecord(workDir: string, rec: CheckpointRecord): Promise<void> {
  await mkdir(join(workDir, ".wllm"), { recursive: true });
  await appendFile(jsonlPath(workDir), JSON.stringify(rec) + "\n", "utf-8");
}

export async function listCheckpoints(workDir: string): Promise<CheckpointRecord[]> {
  try {
    const raw = await readFile(jsonlPath(workDir), "utf-8");
    const recs = raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as CheckpointRecord);
    return recs.reverse();
  } catch {
    return [];
  }
}

export async function snapshot(workDir: string, label: string): Promise<CheckpointRecord | null> {
  if (!(await isGitRepo(workDir))) return null;
  const status = await git(workDir, ["status", "--porcelain"]);
  if (!status) return null;

  const base = await git(workDir, ["rev-parse", "HEAD"]);
  await git(workDir, ["add", "-A"]);
  await git(workDir, ["commit", "-qm", `[wllm] ${label}`]);
  const sha = await git(workDir, ["rev-parse", "HEAD"]);
  const id = `${Date.now().toString(36)}-${sha.slice(0, 7)}`;
  await git(workDir, ["update-ref", CKPT_REF_PREFIX + id, sha]);
  await git(workDir, ["reset", "-q", base]);

  const rec: CheckpointRecord = { id, sha, label, createdAt: new Date().toISOString() };
  await appendRecord(workDir, rec);
  return rec;
}

export async function rollbackCheckpoint(
  workDir: string,
  id: string,
): Promise<{ ok: boolean; message: string }> {
  if (!(await isGitRepo(workDir))) {
    return { ok: false, message: "不是 git 仓库，无法回滚" };
  }
  const recs = await listCheckpoints(workDir);
  const target = recs.find((r) => r.id === id);
  if (!target) {
    return { ok: false, message: `检查点不存在：${id}` };
  }

  await snapshot(workDir, "safety before rollback");

  await git(workDir, ["reset", "--hard", target.sha]);
  return { ok: true, message: `已回滚到检查点 ${id}（${target.label}）` };
}
