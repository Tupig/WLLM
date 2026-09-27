/**
 * utils/path.ts — 路径安全工具
 */
import { resolve, relative, isAbsolute } from "path";

export function safePath(workDir: string, filePath: string): string {
  const resolved = resolve(workDir, filePath);
  const rel = relative(workDir, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `检测到路径遍历攻击：「${filePath}」解析后位于工作目录之外`,
    );
  }
  return resolved;
}
