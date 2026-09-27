/**
 * 包管理集成工具
 *
 * 支持 npm/pip/cargo 等包管理器的操作。
 * 灵感来自 SWE-agent 的 Tool Bundles。
 */
import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { defineTool } from "../Tool.js";
import { safePath } from "../utils/path.js";

const execFileAsync = promisify(execFile);

/**
 * 检测项目类型
 */
function detectProjectType(workDir: string): string | null {
  if (existsSync(join(workDir, "package.json"))) return "npm";
  if (existsSync(join(workDir, "requirements.txt")) || existsSync(join(workDir, "pyproject.toml"))) return "pip";
  if (existsSync(join(workDir, "Cargo.toml"))) return "cargo";
  if (existsSync(join(workDir, "go.mod"))) return "go";
  return null;
}

/**
 * 包安装工具
 */
export const PackageInstallTool = defineTool({
  name: "PackageInstall",
  description: "安装项目依赖包",
  input: z.object({
    packageName: z.string().describe("包名称"),
    packageManager: z.enum(["auto", "npm", "pip", "cargo", "go"]).optional().describe("包管理器（默认 auto）"),
    isDev: z.boolean().optional().describe("是否为开发依赖"),
  }),
  async execute(input, ctx) {
    const pm = input.packageManager === "auto" ? detectProjectType(ctx.workDir) : input.packageManager;
    if (!pm) return "无法检测项目类型，请指定包管理器";

    try {
      let cmd: string;
      let args: string[];

      switch (pm) {
        case "npm":
          cmd = "npm";
          args = ["install", input.isDev ? "--save-dev" : "--save", input.packageName];
          break;
        case "pip":
          cmd = "pip";
          args = ["install", input.packageName];
          break;
        case "cargo":
          cmd = "cargo";
          args = ["add", input.packageName];
          break;
        case "go":
          cmd = "go";
          args = ["get", input.packageName];
          break;
        default:
          return `不支持的包管理器：${pm}`;
      }

      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: ctx.workDir,
        timeout: 60000,
        encoding: "utf-8",
      });

      return `已安装 ${input.packageName}\n${stdout || stderr}`;
    } catch (err) {
      return `安装失败：${err instanceof Error ? err.message : err}`;
    }
  },
});

/**
 * 包卸载工具
 */
export const PackageUninstallTool = defineTool({
  name: "PackageUninstall",
  description: "卸载项目依赖包",
  input: z.object({
    packageName: z.string().describe("包名称"),
    packageManager: z.enum(["auto", "npm", "pip", "cargo", "go"]).optional().describe("包管理器（默认 auto）"),
  }),
  destructive: true,
  async execute(input, ctx) {
    const pm = input.packageManager === "auto" ? detectProjectType(ctx.workDir) : input.packageManager;
    if (!pm) return "无法检测项目类型，请指定包管理器";

    try {
      let cmd: string;
      let args: string[];

      switch (pm) {
        case "npm":
          cmd = "npm";
          args = ["uninstall", input.packageName];
          break;
        case "pip":
          cmd = "pip";
          args = ["uninstall", "-y", input.packageName];
          break;
        case "cargo":
          cmd = "cargo";
          args = ["remove", input.packageName];
          break;
        case "go":
          cmd = "go";
          args = ["get", `${input.packageName}@none`];
          break;
        default:
          return `不支持的包管理器：${pm}`;
      }

      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: ctx.workDir,
        timeout: 60000,
        encoding: "utf-8",
      });

      return `已卸载 ${input.packageName}\n${stdout || stderr}`;
    } catch (err) {
      return `卸载失败：${err instanceof Error ? err.message : err}`;
    }
  },
});

/**
 * 包列表工具
 */
export const PackageListTool = defineTool({
  name: "PackageList",
  description: "列出项目依赖包",
  input: z.object({
    packageManager: z.enum(["auto", "npm", "pip", "cargo", "go"]).optional().describe("包管理器（默认 auto）"),
    includeDev: z.boolean().optional().describe("包含开发依赖（默认 true）"),
  }),
  readOnly: true,
  async execute(input, ctx) {
    const pm = input.packageManager === "auto" ? detectProjectType(ctx.workDir) : input.packageManager;
    if (!pm) return "无法检测项目类型";

    try {
      let cmd: string;
      let args: string[];

      switch (pm) {
        case "npm":
          cmd = "npm";
          args = ["list", "--depth=0", input.includeDev !== false ? "--all" : ""].filter(Boolean);
          break;
        case "pip":
          cmd = "pip";
          args = ["list"];
          break;
        case "cargo":
          cmd = "cargo";
          args = ["tree", "--depth=1"];
          break;
        case "go":
          cmd = "go";
          args = ["list", "-m", "all"];
          break;
        default:
          return `不支持的包管理器：${pm}`;
      }

      const { stdout } = await execFileAsync(cmd, args, {
        cwd: ctx.workDir,
        timeout: 30000,
        encoding: "utf-8",
      });

      return stdout;
    } catch (err) {
      return `列出依赖失败：${err instanceof Error ? err.message : err}`;
    }
  },
});

/**
 * 运行脚本工具
 */
export const RunScriptTool = defineTool({
  name: "RunScript",
  description: "运行项目脚本（npm run / cargo run 等）",
  input: z.object({
    script: z.string().describe("脚本名称"),
    packageManager: z.enum(["auto", "npm", "pip", "cargo", "go"]).optional().describe("包管理器（默认 auto）"),
    args: z.array(z.string()).optional().describe("额外参数"),
  }),
  async execute(input, ctx) {
    const pm = input.packageManager === "auto" ? detectProjectType(ctx.workDir) : input.packageManager;
    if (!pm) return "无法检测项目类型";

    try {
      let cmd: string;
      let args: string[];

      switch (pm) {
        case "npm":
          cmd = "npm";
          args = ["run", input.script, ...(input.args || [])];
          break;
        case "pip":
          cmd = "python";
          args = ["-m", input.script, ...(input.args || [])];
          break;
        case "cargo":
          cmd = "cargo";
          args = ["run", input.script, ...(input.args || [])];
          break;
        case "go":
          cmd = "go";
          args = ["run", input.script, ...(input.args || [])];
          break;
        default:
          return `不支持的包管理器：${pm}`;
      }

      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: ctx.workDir,
        timeout: 120000,
        encoding: "utf-8",
      });

      return stdout || stderr || "脚本执行完成";
    } catch (err) {
      return `脚本执行失败：${err instanceof Error ? err.message : err}`;
    }
  },
});
