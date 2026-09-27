/**
 * 通用工具函数
 */
import { execFile } from "child_process";
import { promisify } from "util";

/**
 * promisify 的 execFile
 */
export const execFileAsync = promisify(execFile);
