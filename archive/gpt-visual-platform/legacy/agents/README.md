# Agent 脚本

各环境 Agent 用 Python 调用本目录下对应脚本，向编排服务注册（含 **Skills**）、拉取任务、执行 Unity/ADB、上报结果。

## Skills（集成测试能力）

Agent 注册时可声明 `skills`，任务可指定 `required_skills`；仅具备全部所需技能的 Agent 会拉取到该任务。Skill ID 含 **Unity**：`PlayMode`、`EditMode`、`AltTester`；**Web**（测试所有 web）：`WebChrome`、`WebFirefox`、`WebSafari`、`WebEdge`、`Playwright`、`Selenium`、`Cypress`、`WebHeadless`；**Mobile**：`ADB`、`XCUITest`、`Appium`、`Airtest`、`Poco`；**AI**：`AIAgent`。见编排服务 `GET /api/skills`。

## 环境与脚本

| 环境     | 脚本（示例）     | 说明 |
|----------|------------------|------|
| Windows  | `runner_windows.py` | 调用 Unity Editor 或 Player 跑 Test Framework |
| Mac      | `runner_mac.py`     | 同上；iOS 需 Xcode/模拟器 |
| Linux    | `runner_linux.py`   | 无头可用 `xvfb-run` + Unity `-batchmode -nographics` |
| **Web**  | `runner_web.py`     | 多浏览器/Playwright/Selenium，支持测试所有 Web |
| Android  | `runner_android.py` | ADB 安装/启动 APK，拉日志 |
| iOS      | `runner_ios.py`     | Mac 上跑，模拟器或真机 |

## 环境变量

- `PLATFORM_URL`：编排服务地址，如 `http://localhost:9111`
- `AGENT_ID`：本机唯一 ID，如 `my-mac-1`
- `PLATFORM`：`windows` | `mac` | `linux` | `web` | `android` | `ios`
- `AGENT_SKILLS`：可选，逗号分隔的技能 ID，如 `PlayMode,EditMode` 或 `Playwright,WebChrome,WebHeadless`

## 运行示例（Mac/Linux）

```bash
export PLATFORM_URL=http://localhost:9111
export AGENT_ID=agent-mac-1
export PLATFORM=mac
export AGENT_SKILLS=PlayMode,EditMode
python3 agents/runner_mac.py
```

## Web 测试示例

```bash
export PLATFORM_URL=http://localhost:9111
export AGENT_ID=agent-web-1
# runner_web.py 固定 platform=web；不设 PLATFORM
export AGENT_SKILLS=Playwright,WebChrome,WebFirefox,WebHeadless   # 可选，默认含上述
python3 agents/runner_web.py
```

## 可选集成任务（Airtest / AI 探索测试）

`runner_android.py` 与 `runner_windows.py` 支持两类集成任务，按 `extra.job_type` 自动分发（见 `runner_common.dispatch_integrations`），未命中时仍走原占位逻辑：

- `airtest`：运行 `.air` 图像识别脚本（Android/Windows）；
- `ai_exploratory`：视觉大模型驱动的探索测试（截图 → 决策 → 操作循环）。

```bash
# Android Agent 示例
pip install -r requirements-airtest.txt          # 可选依赖：airtest、pocoui、openai
export PLATFORM_URL=http://localhost:9111
export AGENT_ID=agent-android-1
export AGENT_SKILLS=ADB,Airtest,AIAgent
python3 agents/runner_android.py
```

AI 探索测试需配置 `OPENAI_API_KEY`（视觉模型建议 `OPENAI_VISION_MODEL=gpt-4o`）。任务创建示例、字段与动作空间见 **docs/Airtest与AI探索测试集成方案.md**。
