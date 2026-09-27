# 部署指南

本平台支持三种部署形态，按场景选择。所有形态均提供 **HTTPS**（自签名证书自动生成，或接入正式证书）。

| 形态 | 适用场景 | 依赖 |
|---|---|---|
| 一键脚本（本机/单机） | 个人使用、团队内网单机 | Go（构建）或现成二进制 |
| 系统服务（launchd / systemd） | 长期运行、开机自启 | 同上 |
| Docker / Docker Compose | 服务器部署、环境隔离、升级回滚 | Docker |

---

## 一、一键脚本部署（推荐起步）

### 1. 构建与启动

```bash
# macOS / Linux
./scripts/build_go.sh          # 构建服务端 → dist/unity-orchestrator
./scripts/start.sh             # 启动（前台，Ctrl+C 停止）
```

```bat
:: Windows
scripts\build_go.bat
scripts\start.bat
```

启动后访问 **https://localhost:9111**（自签名证书，首次点「高级 → 继续前往」）。

### 2. 停止 / 状态

```bash
./scripts/stop.sh              # 停止（识别 launchd/systemd/手动进程，优雅 SIGTERM）
./scripts/status.sh            # 运行方式 / 进程 / 健康 / 证书指纹与有效期
```

---

## 二、系统服务部署（开机自启，生产推荐）

### macOS（launchd）

```bash
./scripts/build_go.sh
./scripts/install-service.sh   # 写入 ~/Library/LaunchAgents + 立即启动
```

- 开机自启：plist 中 `RunAtLoad` + `KeepAlive`（崩溃自动拉起）
- 日志：`data/orchestrator.log` / `data/orchestrator.err.log`
- 卸载：`./scripts/uninstall-service.sh`

### Linux（systemd）

```bash
./scripts/build_go.sh
sudo PLATFORM_TOKEN=你的令牌 ./scripts/install-service.sh
sudo systemctl status unity-orchestrator
journalctl -u unity-orchestrator -f      # 实时日志
```

- `Restart=always`（3 秒后自动拉起）；`NoNewPrivileges=true` 加固
- 卸载：`./scripts/uninstall-service.sh`

### Windows

- 方式一（任务计划，开机自启）：`schtasks /create /tn UnityTestPlatform-Orchestrator /sc onstart /ru SYSTEM /tr "C:\path\dist\unity-orchestrator.exe"`
- 方式二（推荐服务化体验）：安装 [NSSM](https://nssm.cc/) 后 `nssm install UnityTestPlatform dist\unity-orchestrator.exe`
- 停止：`scripts\stop.bat`

### 公网/不可信网络部署

在服务环境变量中设置 `PLATFORM_TOKEN=<长随机串>`（脚本会透传到 launchd/systemd），所有 Agent 同名设置——此后 API 全部要求 `X-Platform-Token` 头。更进一步建议前置 nginx/Caddy 做 TLS 终结与 Basic Auth。

---

## 三、Docker 部署

```bash
PLATFORM_TOKEN=你的令牌 docker compose up -d
docker compose logs -f
```

- 镜像多阶段构建（最终基于 alpine，非 root 运行）
- 数据持久化：`unity-data` 卷（任务数据 + TLS 证书）
- 健康检查内置；升级：`git pull && docker compose build && docker compose up -d`

> Dockerfile 使用本仓库 `server/` 与 `static/` 构建；数据目录挂载卷后，证书跨容器重建保持不变。

---

## 四、Agent 部署

### 产物

`scripts/release-build.sh` 产出多平台二进制（`dist/`）：

| 文件 | 平台 |
|---|---|
| `unity-orchestrator-darwin-arm64/amd64` | macOS（Apple Silicon / Intel） |
| `unity-orchestrator-linux-amd64/arm64` | Linux 服务器 |
| `unity-orchestrator-windows-amd64.exe` | Windows |
| `unity-agent-<target>` | Rust Agent（与构建机同平台；全平台矩阵见 Release 工作流） |

### 启动示例（Android 执行机）

```bash
PLATFORM_URL=https://192.168.1.10:9111 \
AGENT_ID=android-1 \
AGENT_SKILLS=ADB,AIAgent \
PLATFORM_INSECURE_TLS=1 \            # 自签名服务端；正式环境用 PLATFORM_TLS_CERT
PLATFORM_TOKEN=与服务端一致的令牌 \   # 服务端启用认证时必填
./unity-agent
```

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `PLATFORM_URL` | 是 | 服务端地址（HTTPS） |
| `AGENT_ID` | 建议 | 唯一 ID，缺省随机生成 |
| `PLATFORM` | 是 | mac / windows / linux / android / ios / web |
| `AGENT_SKILLS` | 建议 | 技能 ID，逗号分隔 |
| `PLATFORM_TOKEN` | 视部署 | 与服务端一致的访问令牌 |
| `PLATFORM_INSECURE_TLS` | 视部署 | `1` = 跳过自签名证书校验 |
| `PLATFORM_TLS_CERT` | 可选 | 信任指定证书 PEM（推荐替代 INSECURE） |
| `AGENT_WORKDIR` | 可选 | 产物目录（默认 `data/agent_runs`） |

---

## 五、HTTPS 证书

服务端默认**自动生成自签名证书**（ECDSA P-256，SAN 覆盖 localhost / 127.0.0.1 / ::1 / 主机名 / 所有网卡 IP），存放 `data/tls/cert.pem` + `key.pem`，跨重启复用。启动日志打印 SHA-256 指纹。

### 消除浏览器警告（三选一）

1. **一次性接受**：首次访问点「高级 → 继续前往 localhost」。
2. **钥匙串信任（macOS，推荐）**：运行 `./scripts/trust-cert-macos.sh` —— 自动弹出系统授权框，输入开机密码点「始终允许」即可（脚本会自动验证生效；效果覆盖 Safari 等系统证书链浏览器）。也可手动：钥匙串访问 → 导入 `data/tls/cert.pem` → 双击证书 → 信任 → 始终信任。
3. **正式证书**：申请 Let's Encrypt / 企业证书后设置 `TLS_CERT`/`TLS_KEY` 环境变量（或反向代理终结 TLS）。

### Agent 侧

自签名目标：`PLATFORM_INSECURE_TLS=1`（快捷）或 `PLATFORM_TLS_CERT=<cert.pem 路径>`（推荐，完整校验链）。

---

## 六、失败通知（Webhook）

设置服务环境变量 `NOTIFY_WEBHOOK_URL` 后，任何任务失败都会异步 POST 一条 JSON（含 job_id / 平台 / 执行 Agent / 失败原因），兼容企业微信、飞书、Slack、Discord 的自定义 bot：

```bash
# 企业微信机器人示例
NOTIFY_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
# 系统服务场景：写入 install-service.sh 运行前 export，或直接编辑 plist/unit 文件
```

结合 `repeat_minutes` 监控循环，即可实现「定时检查 + 失败告警」的完整监控闭环（端口/证书/DNS/接口）。

---

## 六·二、内置诊断任务速查

| 类型 | 关键参数 | 用途 |
|---|---|---|
| web_check | url / keyword / expected_status | 网站可用性 |
| api_check | method/url/headers/body + 三重断言 | 接口测试 |
| api_flow | steps_json（save/expect/`{{var}}`） | 多步骤接口链 |
| api_load | total/concurrency/p95_ms | 性能冒烟 |
| port_check | host/port/latency_ms | 登录服/网关端口 |
| cert_check | host/min_days_valid | 证书到期 |
| dns_check | hostname/expected_ips | 解析断言 |
| self_check | 无 | Agent/服务端环境自检 |
| game_perf | package/duration_s/launch_activity/max_jank_pct/min_fps/max_mem_mb | Android 游戏性能：帧率/卡顿率/p95 帧耗时/内存峰值（dumpsys） |

---

## 六、升级与回滚

```bash
# 升级（服务形态）
git pull
./scripts/build_go.sh                      # 产出新二进制
sudo systemctl restart unity-orchestrator  # launchd: ./scripts/stop.sh && ./scripts/start.sh

# 回滚：dist/ 保留上一版二进制时，直接覆盖后重启即可
```

数据兼容承诺：`data/` 目录格式跨版本向前兼容；重大格式变更会在 CHANGELOG 标注。

---

## 七、故障排查

| 现象 | 排查 |
|---|---|
| 端口被占用 | `lsof -i :9111`；`PORT=xxxx ./scripts/start.sh` 换端口 |
| 浏览器证书警告 | 见第五节；或访问时点「高级 → 继续」 |
| Agent 领不到任务 | 核对 `AGENT_SKILLS` 与任务 `required_skills` 匹配；`scripts/status.sh` 看 Agent 是否在线 |
| Agent 连不上（HTTPS） | 确认 `PLATFORM_INSECURE_TLS=1` 或 `PLATFORM_TLS_CERT` 已设置；`curl -vk https://服务端/api/health` |
| systemd 服务起不来 | `journalctl -u unity-orchestrator -n 50`；检查 `ExecStart` 路径与权限 |
| macOS 服务不随开机启动 | `launchctl list \| grep unity-test-platform`；确认 plist 在 `~/Library/LaunchAgents/` |
| AI 探索任务失败 | Agent 机需 `PLATFORM_INSECURE_TLS=1`（自签名）+ `OPENAI_API_KEY`；看任务详情「执行记录」 |
