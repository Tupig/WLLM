# gameqa — Unity3D 游戏自动化测试平台（TS 版）

跨环境（Mac / Linux / Windows / iOS / Android）的 Unity3D 游戏自动化测试编排与结果收集。
本模块是原 `gpt-visual-platform`（Go server + Rust agent + Python legacy）的 TypeScript 统一重写，
API、`data/` 数据格式与旧版完全兼容；历史设计文档见 `docs/history/gameqa/`。

## 快速开始

```bash
npm run build                 # tsc + 拷贝看板静态资源到 dist/gameqa/static

# 编排服务（看板 + API + 内置执行器 worker，默认 HTTPS 自签名）
node dist/cli/gameqa.js serve -p 9111 -d data
# 明文（仅限可信内网）：node dist/cli/gameqa.js serve --tls off

# 测试 Agent（另开终端；连自签名服务端）
PLATFORM_URL=https://localhost:9111 AGENT_ID=agent-1 PLATFORM=mac \
  AGENT_SKILLS=PlayMode,AIAgent PLATFORM_INSECURE_TLS=1 \
  node dist/cli/gameqa.js agent
```

浏览器打开 `https://localhost:9111`（首次点「高级 → 继续前往」；macOS 证书信任可用
`./scripts/trust-cert-macos.sh`）。开发态可用 `npm run gameqa:serve` / `npm run gameqa:agent`（tsx 免构建）。

## 环境变量

| 变量 | 侧 | 说明 |
|---|---|---|
| `PORT` / `DATA_DIR` / `STATIC_DIR` | serve | 端口（默认 9111）/ 数据目录 / 看板目录（缺省自动定位） |
| `TLS_MODE` | serve | `auto`（自签名/用户证书，默认）\| `off`（明文，仅限可信内网） |
| `TLS_CERT` / `TLS_KEY` | serve | 用户证书（优先于自签名；自签名存 `data/tls/`，跨重启复用） |
| `PLATFORM_TOKEN` | serve | 启用 `X-Platform-Token` API 认证（公网部署必设） |
| `STALE_MINUTES` | serve | running 任务超该时长判 Agent 失联标失败（默认 30） |
| `PLATFORM_URL` | agent | 编排服务地址（默认 `http://localhost:9111`） |
| `AGENT_ID` / `AGENT_SKILLS` / `AGENT_WORKDIR` | agent | 标识 / 技能（逗号分隔，任务 required_skills 须为其子集）/ 工作目录 |
| `PLATFORM_INSECURE_TLS` | agent | `1` = 信任自签名服务端；或 `PLATFORM_TLS_CERT=<cert.pem>` 指定 CA |
| `UNITY_PATH` | agent | Unity 可执行文件（缺省探测 Unity Hub 安装目录 / PATH） |
| `ADB_PATH` / `ANDROID_SERIAL` | agent | adb 可执行覆盖 / 默认设备序列号 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_VISION_MODEL` | agent | AI 探索测试（`ai_exploratory`）视觉模型 |

## 任务与执行器

创建任务 `POST /api/jobs`：`platform` + `required_skills` + `unity_project_path` + `extra`。
`extra.job_type` 分发（Agent 侧）：

| job_type | 执行内容 |
|---|---|
| （缺省）/ `generate_and_run` | **Unity batchmode 真执行**：`-runTests -testPlatform PlayMode/EditMode -testResults xml`，NUnit3 XML 解析；`generate_and_run` 把 `extra.generated_test_csharp` 写入 `Assets/Tests/Generated/` 后带 `-testFilter Generated` 执行（默认执行后清理，`keep_generated` 保留） |
| `use_mcp: true` | 直连 Unity MCP `/tools/run_tests` |
| `self_check` | Agent 环境自检 |
| `airtest` | Airtest CLI 跑 `.air` 图像识别脚本（Android/Windows 设备 URI） |
| `ai_exploratory` | 视觉大模型「截图 → 决策 → 执行」循环（Android，动作校验防注入） |
| `game_perf` | 帧率/卡顿/内存采样 + 阈值断言（dumpsys gfxinfo/meminfo） |
| `unity_log_scan` | Unity Player.log 错误/异常扫描（阈值 `max_errors`） |
| `device_inventory` | ADB 设备清单（型号/版本/分辨率/电量） |

**内置执行器（服务端，无需 Agent，platform=web）**：`web_check` / `api_check` / `api_load` /
`api_flow` / `self_check` / `port_check` / `cert_check` / `dns_check`；`extra.repeat_minutes`
开启循环监控（写入 `extra`，服务端 worker 读取）。

## 模块结构（旧→新）

| 旧（gpt-visual-platform，已删） | 新（src/gameqa） |
|---|---|
| `server/main.go` + `static/` | `server.ts` + `cli/gameqa.ts` + `static/` |
| `server/store.go` | `store.ts` |
| `server/builtin.go` / `webcheck.go` / `selfcheck.go` / `diagnostics.go` | `builtin.ts` |
| `server/tls.go` | `tls.ts`（openssl 生成 ECDSA P-256 自签） |
| `server/mcp.go` / `openai.go` / `notify.go` / `skills_gen.go` | `mcp.ts` / `openai.ts` / `notify.ts` / `skills.ts` |
| `agent/src/main.rs` + `api.rs` + `executor.rs` | `agent.ts` |
| `agent/src/unitylogs.rs` + `adb.rs` | `executors.ts` + `adb.ts` |
| `agent/src/airtest.rs` | `airtest.ts` |
| `agent/src/gameperf.rs` | `gameperf.ts` |
| `agent/src/ai.rs` | `ai.ts` |
| `legacy/agents/runner_*.py`（Unity 执行占位注释） | `unity.ts`（batchmode 真执行） |

## 运维

```bash
./scripts/e2e.sh              # 全链路冒烟（HTTPS + Agent + 内置执行器 + 取消/删除）
./scripts/start.sh            # 前台启动（已注册系统服务则走 launchd/systemd）
./scripts/install-service.sh  # 注册开机自启；stop.sh / status.sh / uninstall-service.sh 配套
docker compose up -d          # 容器部署（数据与证书持久化在 gameqa-data 卷）
```

## 测试

```bash
npx vitest run tests/g1-gameqa-*.test.ts tests/g2-gameqa-*.test.ts \
  tests/g3-gameqa-*.test.ts tests/g4-gameqa-*.test.ts tests/g5-gameqa-*.test.ts
```

g1 store/server 合同、g2 内置执行器、g3 Unity 真执行与全链路、g4 airtest/game_perf/ai 集成、
g5 TLS/CLI。运行时依赖 Node ≥ 20（fetch / AbortSignal.timeout）与 openssl（自签证书）。
