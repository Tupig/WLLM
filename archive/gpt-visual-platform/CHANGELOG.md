# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式与
[语义化版本](https://semver.org/lang/zh-CN/)（1.0 前：破坏性 API 变更升 minor）。

## [Unreleased]

### Added（v2 架构）

- **编排服务 Go 版**（`server/`）：与 Python 版 API、`data/` 文件格式、Web 看板完全兼容；仅标准库单二进制；内置请求日志、panic 恢复、健康检查（`/api/health`）与版本端点（`/api/version`，构建时 `-ldflags "-X main.version=..."` 注入）。
- **Agent Rust 版**（`agent/`）：单二进制、目标机无需 Python 运行时；Android AI 探索测试为原生实现（adb 截图/操作 + OpenAI 兼容视觉接口）；`airtest` 任务调用 airtest CLI。
- AI 探索测试 / Airtest 执行引擎集成（`extra.job_type = ai_exploratory / airtest`），新增技能 `Airtest`、`Poco`、`AIAgent`。
- **安全增强**：可选共享令牌认证（`PLATFORM_TOKEN`，`X-Platform-Token` 头，常量时间比较）；POST 请求体强制 `application/json`（防 CSRF 简单请求）与 1MB 上限；MCP `tool_name` 白名单（防路径穿越）；结果上报校验 Agent 已注册；AI 动作 `key` 白名单（防设备端 shell 注入）；adb/airtest 子进程全部带超时并回收。
- CI（三端测试 + 竞态检测 + 覆盖率门禁 + Windows 构建 + 前端语法检查 + 端到端冒烟）与 tag 触发的跨平台 Release 流水线。
- **工作台看板改版**：侧边导航五视图（工作台/任务/Agent/技能/创建任务）；任务类型表单化创建；任务筛选/搜索/分页/详情展开/一键重试/取消/删除；Agent 在线状态；执行记录上传与查看；首次接入引导；一键启动脚本（`scripts/start.sh`）。
- 新增 API：`POST /api/jobs/{id}/cancel`、`DELETE /api/jobs/{id}`、`POST/GET /api/jobs/artifacts`（执行记录）、`POST /api/jobs/cleanup`（数据管理）；`GET /api/health`、`GET /api/version`。
- **内置测试执行器族**（吸收主流开源工具核心能力，无需 Agent、服务端直接执行）：
  - `api_check` 接口测试：Method/Headers/Body/状态码/关键词/延迟三重断言（← MeterSphere/Postman）；
  - `api_load` 性能冒烟：并发 + 总请数 + p95 延迟断言（← k6 简化版）；
  - `api_flow` 接口流程：多步骤链 + JSON 提取 + `{{变量}}` 替换 + fail-fast（← Robot Framework/Karate）；
  - `web_check` 网站检查 + `repeat_minutes` 监控循环，完成后自动排下一次（← Uptime Kuma）；
  - `self_check` 环境自检（存储/证书/技能表/磁盘真实断言，内置与 Agent 双端实现）；
  - `unity_log_scan` Unity Player.log 错误/异常扫描（阈值断言，← 游戏 QA 实践）；
  - `device_inventory` ADB 设备清单（型号/系统/分辨率/电量，← Sonic/STF 思路）；
  - `game_perf` 游戏性能测试：平均帧率/卡顿率/p95 帧耗时/内存峰值，支持拉起游戏与阈值断言（← PerfDog 精简版，Android dumpsys 原生实现）。

- **视觉精修**：shadcn/Linear 风格——卡片细边框微阴影、统计卡彩色饰条与等宽数字、任务卡状态色条、中性黑主按钮、视图切换淡入、favicon。
- **可靠性机制**：`started_at` 追踪 + 失联超时兜底（running 超时自动标失败，列表不再永久卡死）；内置 worker panic 恢复（单任务异常不影响服务）；API 响应 no-store 防缓存。
- **全站 HTTPS**：自动生成自签名证书（ECDSA P-256，SAN 覆盖 localhost/内网 IP，存 `data/tls/` 跨重启复用），支持 `TLS_CERT`/`TLS_KEY` 正式证书与 `TLS_MODE=off` 逃生口；Agent 侧三种证书策略（`PLATFORM_TLS_CERT` 信任 / `PLATFORM_INSECURE_TLS=1` 跳过 / 公网 CA）。
- **系统服务化 + 全生命周期脚本**：`install-service.sh`（macOS launchd / Linux systemd，开机自启 + 崩溃自动拉起，支持 `PLATFORM_TOKEN` 透传）、`stop.sh`（自适应 launchd/systemd/手动进程，优雅停机）、`status.sh`（运行方式/进程/健康/证书指纹）、`start.sh`（自动识别服务路径）、Windows `stop.bat`；`release-build.sh`（Go 5 平台矩阵 + Agent 本机产物）。
- **Docker 部署**：多阶段 `Dockerfile`（alpine 非 root + HEALTHCHECK）+ `docker-compose.yml`（数据卷持久化）+ `.dockerignore`。
- **工作台改版**：侧边导航五视图（工作台/任务/Agent/技能/创建任务）；任务类型表单化创建（8 种）；筛选/搜索/分页/详情展开/一键重试/取消/删除/清理；Agent 在线状态；执行记录查看；首次接入引导。

### Changed

- Web 看板修复不可用问题：`main.js` 改为 ES module 加载；Tailwind 本地化（`static/js/vendor/tailwind.js`），不再依赖外网 CDN；滚动动画改为默认可见（内容不再被 `opacity:0` 隐藏）。

### Removed

### Changed

- **目录结构极简化**：`server/`（Go 编排服务）、`agent/`（Rust Agent）、`legacy/`（Python v1 完整实现，含测试与依赖清单）、`static/`（看板）、`scripts/`、`config/`、`docs/`；根目录仅保留 5 个 Markdown 与以上目录。

### Removed

- 移除历史遗留的 axum 版编排服务半成品与空目录。

### Legacy

- Python 实现（`main.py`、`agents/`、`integrations/`）保留可用，标记为 legacy。
