# 安全策略

## 支持版本

| 版本 | 支持状态 |
|---|---|
| 最新 release | ✅ 支持 |
| 更早版本 | ❌ 不支持 |

## 报告漏洞

请通过 GitHub Security Advisories（仓库 → Security → Report a vulnerability）私密报告安全问题，
**不要**为安全漏洞创建公开 issue。

我们承诺在 72 小时内确认收到，并在修复发布前与报告者协调披露时间。

## 部署安全边界（重要）

当前版本设计为**运行在可信内网/本机环境**：

1. **API 无鉴权**：`/api/agents/*`、`/api/jobs/*` 等接口没有任何认证，任何能访问该端口的
   主机都可以注册 Agent、伪造任务结果、消耗 `OPENAI_API_KEY`（`/api/generate-test`）。
   请勿将其直接暴露到公网；如需公网部署，请在前面加反向代理 + 认证（如 mTLS / OAuth2 proxy）。
2. **Agent 信任模型**：Agent 会执行编排服务下发的指令（运行 `.air` 脚本、adb 操作等）。
   请确保只有可控的客户端能连到编排服务。
3. **明文 HTTP**：服务默认无 TLS，凭据（如 `OPENAI_API_KEY` 仅在服务端使用，不下发给 Agent）
   与任务内容在链路上均为明文，内网部署请自行评估。
4. **AI 探索测试的数据外发**：`ai_exploratory` 任务会把设备截图上传到 OpenAI 兼容接口
   （`OPENAI_BASE_URL` 指定的第三方云服务），截图与 `steps.json`（含任务描述、设备信息）
   会保留在 Agent 的 `data/agent_runs/` 目录。若游戏构建含敏感内容，请自行评估外发面、
   及时清理产物，或将 `OPENAI_BASE_URL` 指向自托管模型。
5. **推荐加固**：公网/不可信网络部署时，服务端与全部 Agent 设置相同的 `PLATFORM_TOKEN`
   环境变量（所有 `/api/*` 请求需携带 `X-Platform-Token` 头）；或在前置反向代理上做认证与 TLS。
