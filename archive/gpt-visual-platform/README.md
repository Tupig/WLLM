# Unity3D MMORPG 自动化测试平台

跨环境（**Mac / Linux / Windows / iOS / Android**）的 Unity3D 游戏自动化测试编排与结果收集平台。

> ## v2 架构：编排服务 Go + Agent Rust（推荐）
>
> API、Web 看板、`data/` 数据格式与 Python 版完全兼容；双端均为**单二进制**，Agent 目标机**无需 Python 运行时**。
>
> | 组件 | 命令 | 说明 |
> |---|---|---|
> | 编排服务（Go） | `./scripts/start.sh`（或 `cd server && go run .`） | **HTTPS**（自签名证书自动生成，首次访问点「高级→继续前往」）；`PORT`/`DATA_DIR`/`TLS_CERT`/`TLS_KEY`/`TLS_MODE=off` 可覆盖 |
> | Agent（Rust） | `cd agent && cargo build --release` | 产物 `target/release/unity-agent`；连自签名服务端设 `PLATFORM_INSECURE_TLS=1` 或 `PLATFORM_TLS_CERT=data/tls/cert.pem` |
> | Agent 运行 | `PLATFORM_URL=http://localhost:9111 AGENT_ID=agent-1 PLATFORM=mac AGENT_SKILLS=PlayMode,AIAgent ./unity-agent` | 环境变量与 Python Agent 完全一致 |
>
> Python 版（FastAPI + Python Agent）保留为 **legacy**，见下文；文档中未特别标注的内容三端通用。

> **内置测试能力（无需 Agent）**：创建任务选「网站检查 / 接口测试 / 接口流程 / 性能冒烟」——编排服务内置执行器直接执行（吸收 MeterSphere/k6/Robot Framework/Uptime Kuma 核心能力），`repeat_minutes` 可开启循环监控。
>
> **系统服务 + 开机自启**：`scripts/install-service.sh`（macOS launchd / Linux systemd）；多平台二进制一键构建 `scripts/release-build.sh`；停止/状态用 `scripts/stop.sh` / `scripts/status.sh`。**完整部署指南（含 Docker / Agent 部署 / 证书 / 排障）见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**。
>
> **安全提示**：平台默认**全站 HTTPS**（自动自签名证书，SAN 覆盖本机与内网 IP）；API 无强制鉴权，公网部署请设置
> `PLATFORM_TOKEN`（服务端与全部 Agent 相同值，启用 `X-Platform-Token` 认证）并加反向代理 TLS，详见 [SECURITY.md](SECURITY.md)。

## 技术栈与架构

- **编排服务**：Python 3.10+ / FastAPI，提供任务队列、Agent 注册/心跳、结果上报、Web 看板。
- **Agent**：各环境 Python 脚本（Windows / Mac / Linux / Android / iOS），拉取任务、执行 Unity/ADB、上报结果。
- **Unity 侧**：Unity Test Framework（NUnit）；可选 AltTester、GameCI。
- 详见 **docs/技术方案.md**。

## 环境要求

- **编排服务**：Mac / Linux / Windows，Python 3.9+（源码运行）或无需 Python（使用构建出的可执行文件）。
- **Agent**：各 OS 需安装 Python 3；Windows/Mac/Linux 需安装 Unity；Android 需 ADB；iOS 需 Mac + Xcode。

## 在 Linux / Windows / Mac 上运行（Python legacy 版）

### 方式一：源码运行（需本机安装 Python）

在**项目根目录**执行：

| 系统 | 命令 |
|------|------|
| **Mac / Linux** | `./scripts/run.sh`（需 `chmod +x scripts/run.sh`）或 `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python run_server.py` |
| **Windows** | 执行 `scripts\run.bat` |

### 方式二：构建可执行文件后运行（无需目标机安装 Python）

在**目标系统**的**项目根目录**执行构建，得到该平台可执行文件，拷贝到任意目录即可运行：

| 系统 | 构建命令 | 产出 | 运行 |
|------|----------|------|------|
| **Mac** | `./scripts/build.sh`（需 `chmod +x scripts/build.sh`） | `dist/unity-test-platform` | `./dist/unity-test-platform` |
| **Linux** | `./scripts/build.sh` | `dist/unity-test-platform` | `./dist/unity-test-platform` |
| **Windows** | `scripts\build.bat` | `dist\unity-test-platform.exe` | 双击或 `dist\unity-test-platform.exe` |

构建前需安装 Python 与依赖：`pip install -r requirements-build.txt`（build 脚本会自动创建 venv 并安装）。  
运行后，数据目录 `data/` 会创建在**可执行文件所在目录**下；静态资源已打入包内。

### 访问

浏览器打开 **https://localhost:9111**（看板：工作台 / 任务 / Agent / 技能 / 创建任务）。端口固定为 9111。

> 首次访问会出现自签名证书警告（「您的连接不是私密连接」），点「高级 → 继续前往 localhost」即可，仅此一次。
> 想彻底消除警告：钥匙串访问 → 导入 `data/tls/cert.pem` → 设置为「始终信任」。

## 项目结构

```
├── server/                  # Go 版编排服务（v2 主程序，单二进制、内置执行器、全站 HTTPS）
│   ├── main.go              # 路由 / 中间件 / TLS / 优雅停机
│   ├── store.go             # 任务与 Agent 存储（兼容 v1 数据文件）
│   ├── builtin.go           # 内置执行器：接口测试 / 性能冒烟 / 接口流程 / 监控循环
│   ├── webcheck.go          # 网站可用性检查
│   ├── tls.go               # 自签名证书自动生成
│   ├── openai.go / mcp.go   # GPT 用例生成 / Unity MCP 代理
│   └── skills_gen.go        # 技能表（与 legacy/modules/skills.py 同步生成）
├── agent/                   # Rust 版 Agent（v2，单二进制、无需 Python 运行时）
│   └── src/                 # main / api / executor / ai / airtest
├── static/                  # Web 工作台看板（原生 JS，两端共用）
├── scripts/                 # 构建 / 启动 / 服务化 / E2E
│   ├── start.sh|.bat        # 一键启动（自动构建 + HTTPS）
│   ├── build_go.sh|.bat     # 构建服务端
│   ├── build_agent.sh|.bat  # 构建 Agent
│   ├── release-build.sh     # 多平台产物矩阵
│   ├── install-service.sh   # 注册系统服务 + 开机自启（launchd/systemd）
│   ├── uninstall-service.sh # 卸载服务
│   └── e2e.sh               # 端到端冒烟（CI 同款）
├── config/.env.example      # 环境变量示例（复制到根目录为 .env）
├── data/                    # 运行时数据（jobs/agents/证书/产物，自动创建）
├── dist/                    # 构建产物
├── docs/                    # 文档（技术方案 / 说明 / 规则 / 集成方案 / archive）
└── legacy/                  # Python v1 完整实现（保留可用）
    ├── main.py / run_server.py   # 编排服务（FastAPI）
    ├── agents/                   # 各环境 Python Agent
    ├── modules/ integrations/    # 技能表 / GPT 用例生成 / Airtest / AI 探索
    ├── tests/ requirements*.txt  # 测试（59 用例）与依赖
    └── build.spec                # PyInstaller 打包
```

以下章节为 **legacy（Python v1）** 的详细说明，v2 用户可跳过（API 与数据格式两端完全兼容）。

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | Web 看板 |
| GET | `/api/skills` | Skills 列表（集成测试能力） |
| POST | `/api/agents/register` | Agent 注册（可带 skills） |
| POST | `/api/agents/heartbeat` | Agent 心跳 |
| GET | `/api/agents` | Agent 列表 |
| POST | `/api/jobs` | 创建任务（可带 required_skills；extra.job_type 支持 generate_and_run / airtest / ai_exploratory） |
| POST | `/api/generate-test` | 可选：GPT 生成 Unity 测试代码（需 openai + OPENAI_API_KEY） |
| GET | `/api/jobs` | 任务列表 |
| GET | `/api/jobs/{id}` | 任务详情 |
| GET | `/api/jobs/poll/{platform}?skills=...` | Agent 拉取该平台下一条匹配任务 |
| POST | `/api/jobs/result` | Agent 上报任务结果 |

## 运行 Agent（示例：Mac，Python legacy 版）

```bash
export PLATFORM_URL=http://localhost:9111
export AGENT_ID=agent-mac-1
export PLATFORM=mac
export AGENT_SKILLS=PlayMode,EditMode   # 可选，逗号分隔
python3 agents/runner_mac.py
```

其他环境：`runner_linux.py`、`runner_windows.py`、`runner_web.py`、`runner_android.py`、`runner_ios.py`，环境变量同上。**Web 测试**：平台选 `web`，运行 `runner_web.py`，可指定技能如 `Playwright,WebChrome,WebHeadless`，支持测试所有 Web（多浏览器、Playwright/Selenium 等）。任务可指定 **required_skills**，仅具备该技能的 Agent 会拉取到任务。

**Airtest / AI 探索测试**（Android 示例）：

```bash
pip install -r requirements-airtest.txt   # 可选依赖
export PLATFORM_URL=http://localhost:9111
export AGENT_ID=agent-android-1
export AGENT_SKILLS=ADB,Airtest,AIAgent
python3 agents/runner_android.py
```

详细说明见 **docs/说明文档.md**，项目约定见 **docs/规则文档.md**。环境变量示例：复制 `config/.env.example` 到项目根目录为 `.env`。

## 可选：GPT 自动生成 Unity 测试用例

平台支持「自然语言 → GPT 生成 C# UTF 测试代码 → Agent 执行」流程。需配置 `OPENAI_API_KEY` 并安装 `pip install openai`。  
- **POST /api/generate-test**：请求体 `{ "prompt": "主界面点击设置应打开设置面板", "assembly": "Assembly-CSharp" }`，返回 `{ "code": "...", "error": null }`。  
- **创建任务时**：`extra` 传 `{ "job_type": "generate_and_run", "prompt": "…" }`，编排服务会先调用 GPT 生成代码并写入 `extra.generated_test_csharp`，再由具备 **GPTTestGen** 技能的 Agent 拉取并执行。  
完整设计见 **docs/GPT生成测试用例集成方案.md**。

## 可选：Airtest 执行引擎与 AI 探索测试

在 Windows / Android Agent 上支持两类集成任务（`pip install -r requirements-airtest.txt` 安装可选依赖，未安装时任务返回明确提示）：

- **Airtest 任务**（`extra.job_type = "airtest"`）：Agent 运行 Airtest（网易开源，Apache-2.0）的 `.air` 图像识别脚本，覆盖 Android 真机/模拟器与 Windows 桌面（Unity 独立包）。Agent 声明 `AGENT_SKILLS=Airtest`。
- **AI 探索测试**（`extra.job_type = "ai_exploratory"`）：Agent 循环「截图 → 视觉大模型决策 → 执行点击/滑动/输入」，只需一句自然语言目标（`extra.prompt`）即可探索测试，无需预写脚本。Agent 声明 `AGENT_SKILLS=AIAgent`，并配置 `OPENAI_API_KEY`（视觉模型用 `OPENAI_VISION_MODEL` 指定）。

```bash
# 示例：创建 AI 探索测试任务
curl -X POST http://localhost:9111/api/jobs -H 'Content-Type: application/json' -d '{
  "platform": "android",
  "required_skills": ["AIAgent"],
  "extra": {"job_type": "ai_exploratory", "prompt": "登录游戏并打开设置面板", "max_steps": 15}
}'
```

任务协议、动作空间与产物说明见 **docs/Airtest与AI探索测试集成方案.md**。
