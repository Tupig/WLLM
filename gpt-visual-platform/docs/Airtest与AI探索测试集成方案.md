# Airtest 执行引擎与 AI 探索测试集成方案

> **v2（Rust Agent）说明**：`agent/` 原生实现了 `ai_exploratory`（Android 端用 adb 截图/操作 + OpenAI 兼容视觉接口，无需 Python/Airtest）与 `airtest`（调用 airtest CLI，需 Python 侧安装 airtest）。任务协议、动作空间与本文档完全一致；Python 实现（`integrations/`）保留为 legacy。Rust 版动作解析/校验/坐标换算的单测见 `agent/src/ai.rs`。

在现有「编排服务 + Agent」架构上增强执行层，不改变平台协议：Agent 端按 `extra.job_type` 分发两类可选集成任务，编排服务仅同步新增 Skills 与文档。

## 一、目标

1. **Airtest 执行引擎**（`integrations/airtest_executor.py`）：Agent 直接运行 Airtest 的 `.air` 图像识别脚本，覆盖 Android 真机/模拟器与 Windows 桌面（Unity 独立 Player）。
2. **AI 探索测试**（`integrations/ai_agent.py`）：Agent 内置「截图 → 视觉大模型决策 → 执行动作」循环，一句自然语言目标即可进行探索性测试，无需预先编写脚本。

两者均为**可选依赖**（`pip install -r requirements-airtest.txt`，含 airtest、pocoui、openai）；未安装时任务返回明确错误提示，不影响其他功能。
选型说明：Airtest 为网易开源（Apache-2.0），Python 技术栈与本平台 Agent 天然契合；视觉决策模式参考 X-PLUG/MobileAgent（MIT）。

## 二、总体流程

```
编排服务(FastAPI)                        Agent（android / windows）
任务 extra.job_type ──poll──▶  runner_*.py
                                      │ dispatch_integrations()  (agents/runner_common.py)
                                      ├─ airtest ───────▶ airtest run <script.air> --device <uri>
                                      └─ ai_exploratory ─▶ 循环：snapshot() ─▶ 视觉模型决策 ─▶ touch/swipe/text/key
结果 (success, log_path, summary) ──submit──▶  编排服务 → data/runs/job_<id>.json
```

## 三、任务协议

### 3.1 Airtest 任务（`extra.job_type = "airtest"`）

```bash
curl -X POST http://localhost:9111/api/jobs -H 'Content-Type: application/json' -d '{
  "platform": "android",
  "required_skills": ["Airtest"],
  "extra": {"job_type": "airtest", "script_path": "/opt/scripts/login.air", "device_serial": "emulator-5554"}
}'
```

| extra 字段 | 必填 | 说明 |
|---|---|---|
| job_type | 是 | 固定 `airtest` |
| script_path | 是 | Agent 本机上的 `.air` 脚本目录 |
| device_serial | 否 | Android 设备序列号；缺省用环境变量 `ANDROID_SERIAL`，再缺省取 `adb devices` 默认设备 |
| window_title / window_title_re | 否 | Windows 窗口标题匹配（后者为正则，优先级更高）；均缺省连接整个桌面 |
| timeout | 否 | 脚本超时秒数，默认 3600 |

`.air` 脚本内可自行使用 Poco（需游戏集成 Poco-SDK，Unity 下 `from poco.drivers.unity import UnityPoco`），本模块只负责设备连接与脚本运行。

### 3.2 AI 探索测试任务（`extra.job_type = "ai_exploratory"`）

```bash
curl -X POST http://localhost:9111/api/jobs -H 'Content-Type: application/json' -d '{
  "platform": "android",
  "required_skills": ["AIAgent"],
  "extra": {"job_type": "ai_exploratory", "prompt": "登录游戏并打开设置面板", "max_steps": 15}
}'
```

| extra 字段 | 必填 | 说明 |
|---|---|---|
| job_type | 是 | 固定 `ai_exploratory` |
| prompt | 是 | 自然语言测试目标 |
| max_steps | 否 | 最大操作步数，默认 12 |
| device_serial / window_title 等 | 否 | 设备参数，同 Airtest 任务 |

每步流程：设备截图（压缩为长边 1024 的 JPEG）+ 任务描述 + 最近 8 步历史 → 视觉模型输出动作 JSON → Agent 校验并执行。动作空间（坐标归一化 0~1，与设备分辨率无关）：

| 动作 | 参数 | 说明 |
|---|---|---|
| tap | x, y | 点击 |
| swipe | x1, y1, x2, y2 | 滑动 |
| text | text | 输入文本（需先点击输入框） |
| key | key | Android 按键：BACK/HOME/MENU/ENTER 等 |
| wait | seconds | 等待 1~30 秒 |
| finish | success, reason | 任务完成或确认无法完成，并给出结论 |

模型输出非法 JSON 或非法动作时该步跳过（会把错误反馈进历史让模型重试）；达到 `max_steps` 仍未 finish 视为未达成（`success=false`）。

## 四、Agent 侧要求

- **平台**：android / windows（Airtest 无 macOS/Linux 桌面驱动；iOS 计划经 WDA 接入）。
- **依赖**：`pip install -r requirements-airtest.txt`；AI 探索另需配置 `OPENAI_API_KEY`，模型需支持视觉输入（建议 `OPENAI_VISION_MODEL=gpt-4o`；支持 `OPENAI_BASE_URL` 指向 OpenAI 兼容接口）。
- **技能声明**：`export AGENT_SKILLS=ADB,Airtest,AIAgent`，任务按 `required_skills` 匹配。
- **产物目录** `data/agent_runs/job_<id>/`：AI 测试生成 `step_NN.png`（每步截图）与 `steps.json`（步骤记录）；Airtest 生成 `airtest_log/`（运行日志）。

## 五、改动清单

| 位置 | 内容 |
|---|---|
| `integrations/airtest_executor.py` | 设备 URI 构造 + `.air` 脚本运行（CLI 方式，带超时） |
| `integrations/ai_agent.py` | 视觉模型决策循环（动作解析/校验/坐标换算为纯函数，可单测） |
| `agents/runner_common.py` | `dispatch_integrations()`：按 job_type 分发，未命中走 runner 原逻辑 |
| `agents/runner_android.py` / `runner_windows.py` | 接入分发入口 |
| `modules/skills.py` | 新增 Skills：`Airtest`、`Poco`（mobile 类）、`AIAgent`（ai 类） |
| `static/js/services/renderService.js` | 看板技能分组标签新增 `ai: 'AI 测试'` |
| `requirements-airtest.txt` / `config/.env.example` | 可选依赖与环境变量示例 |
| `tests/test_integrations.py` | 纯逻辑单元测试 |

## 六、限制与后续

- AI 探索质量依赖视觉模型能力；坐标归一化已适配分辨率差异，但小字体、暗色 UI 或强动画场景识别可能不稳，建议配合 `max_steps` 上限控制成本。
- iOS：Airtest 本身支持 iOS（tidevice + WDA），为后续接入计划；macOS/Linux 桌面驱动暂无。
- Windows 端 AI 探索以整屏桌面截图决策，若游戏窗口非前台，结果会受影响；建议配合 `window_title` 使用。
