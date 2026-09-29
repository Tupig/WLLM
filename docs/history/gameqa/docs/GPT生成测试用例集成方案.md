# Unity + GPT 自动编写测试用例并自动执行 - 集成方案

本文档描述如何在本平台中接入「用 GPT 根据自然语言/需求自动生成 Unity 测试用例，并下发到 Agent 自动执行」的完整流程。

---

## 一、目标流程

```
用户在看板/API 输入「测试需求」或「自然语言描述」
        ↓
编排服务（可选）调用 GPT 生成 C# UTF 测试代码
        ↓
将生成的代码写入任务 extra 或通过存储下发
        ↓
Mac/Linux/Windows Agent 拉取任务，将代码写入 Unity 项目并执行 UTF
        ↓
上报通过/失败、日志与摘要
```

- **生成**：自然语言 → GPT → C# Unity Test Framework 用例（NUnit 风格）。
- **执行**：与现有「创建任务 → Agent 拉取 → 执行 Unity → 上报」一致，任务 `extra` 中携带生成代码或生成结果路径。

---

## 二、角色与扩展点

| 角色 | 职责 | 扩展方式 |
|------|------|----------|
| **编排服务** | 接收「生成测试」请求；可选：调用 GPT、将生成结果写入任务/存储；创建「执行测试」任务 | 新增/复用 `extra.prompt`、`extra.generated_test_csharp`、`extra.test_script_path` |
| **GPT 生成模块** | 根据 prompt 调用 OpenAI API，返回符合 UTF 的 C# 测试代码 | 可选模块 `integrations/gpt_testgen.py`，依赖 `openai`，需 `OPENAI_API_KEY` |
| **Unity Agent** | 拉取任务；若任务带 `generated_test_csharp` 或 `test_script_path`，写入项目并执行 Unity 测试 | 现有 `runner_mac/linux/windows` 中根据 `job.extra` 分支逻辑 |

---

## 三、数据与 API 设计

### 3.1 任务 extra 字段约定

| 字段 | 说明 | 谁写入 |
|------|------|--------|
| `prompt` | 自然语言测试需求，如「登录界面点击登录按钮后 3 秒内应进入主界面」 | 看板/API 创建任务时 |
| `generated_test_csharp` | GPT 生成的完整 C# 测试类代码（UTF 风格） | 编排服务在调用 GPT 后 |
| `test_script_path` | 生成代码已落盘后的相对路径或绝对路径（可选） | 编排服务或 Agent |
| `unity_assembly` | 要挂载测试的程序集名，如 `Assembly-CSharp` | 创建任务或生成时 |
| `scene_name` | 需加载的场景名（可选） | 创建任务或生成时 |

### 3.2 两种使用方式

**方式 A：仅生成，不执行**

- 请求：`POST /api/jobs`，`platform: "mac"`（或任意），`extra: { "prompt": "…", "job_type": "generate_only" }`。
- 编排服务若集成了 GPT 模块：调用 `integrations.gpt_testgen.generate(prompt)`，将返回的 C# 写入 `extra.generated_test_csharp`，并可选落盘到 `data/generated/`，任务状态标记为「已生成」；不创建执行任务。

**方式 B：生成并执行（推荐）**

1. 请求：`POST /api/jobs`，`platform: "mac"`，`required_skills: ["PlayMode", "GPTTestGen"]`，`extra: { "prompt": "…", "job_type": "generate_and_run" }`。
2. 编排服务：若配置了 GPT，则先调用生成模块得到 C# 代码，将代码写入 `extra.generated_test_csharp`，并创建一条「执行」任务（或在本任务上标记可执行），`extra` 中带上 `generated_test_csharp` 或 `test_script_path`。
3. Agent：拉取到任务后，将 `generated_test_csharp` 写入 Unity 项目指定目录（如 `Assets/Tests/Generated/`），然后调用 Unity 执行该测试（如 `-runTests -testFilter "Generated"`），上报结果。

### 3.3 可选 API：直接生成接口

- `POST /api/generate-test`（可选）：请求体 `{ "prompt": "…", "assembly": "Assembly-CSharp" }`，返回 `{ "code": "…", "path": "data/generated/xxx.cs" }`。  
- 实现方式：编排服务内调用 `integrations.gpt_testgen.generate(prompt, assembly)`，依赖可选安装的 `openai` 与 `OPENAI_API_KEY`。

---

## 四、GPT 生成模块设计（可选）

### 4.1 职责

- 输入：自然语言 prompt、可选程序集名/场景名。
- 输出：符合 Unity Test Framework（NUnit）的 C# 测试类字符串，可直接放入 `Assets/Tests/Generated/` 下编译运行。

### 4.2 Prompt 模板要点

- 要求模型输出**仅 C# 代码**，无 markdown 包裹或解释。
- 约定：使用 `UnityEngine.TestTools`、`NUnit.Framework`，`[UnityTest]` 用于 Play Mode，`[Test]` 用于 Edit Mode；可要求类名 `Generated_*` 便于过滤。
- 示例系统 prompt（见下方「示例 Prompt」）。

### 4.3 示例 Prompt（系统提示）

```text
你是一个 Unity 测试工程师。根据用户的测试需求，生成符合 Unity Test Framework（NUnit）的 C# 测试代码。
要求：
1. 仅输出可编译的 C# 代码，不要 markdown 代码块或解释。
2. 使用 UnityEngine.TestTools、NUnit.Framework；Play Mode 用 [UnityTest] 返回 IEnumerator，Edit Mode 用 [Test]。
3. 类名以 Generated_ 开头，命名空间可省略或使用项目默认。
4. 如需加载场景，使用 UnityEngine.SceneManagement.SceneManager.LoadSceneAsync。
5. 断言使用 Assert.IsTrue/AreEqual 等。
```

### 4.4 用户 Prompt 示例

- 「主界面点击设置按钮应打开设置面板」
- 「玩家血量小于等于 0 时，3 秒内应触发死亡并播放死亡动画」
- 「登录界面输入错误密码时，应显示错误提示且不跳转」

### 4.5 依赖与配置

- 可选依赖：`openai`（或 `httpx` 直接调 OpenAI API）。
- 环境变量：`OPENAI_API_KEY`（必填）、可选 `OPENAI_MODEL`（默认 `gpt-4o-mini` 或 `gpt-4o`）。
- 未配置时：不注册 `/api/generate-test`，创建任务时若为「生成并执行」则仅将 `prompt` 写入 `extra`，由 Agent 侧本地脚本或人工根据 prompt 生成代码后再执行（降级流程）。

---

## 五、Agent 侧执行逻辑（扩展现有 runner）

### 5.1 收到带生成代码的任务时

1. 从 `job.extra.generated_test_csharp` 取字符串；若无则从 `job.extra.test_script_path` 或 URL 拉取文件。
2. 写入 Unity 项目目录，例如：`{unity_project_path}/Assets/Tests/Generated/Generated_{job_id}.cs`。
3. 调用 Unity 命令行，例如：  
   `Unity -batchmode -projectPath {path} -runTests -testPlatform PlayMode -testFilter "Generated_" -testResults {results_path}`  
   或使用已有 `test_filter` 覆盖。
4. 解析测试结果（Unity 生成的 XML/JSON），写入 `summary`（通过数、失败数、错误信息），并上报 `log_path`、`success`。

### 5.2 与现有 runner 的衔接

- 现有 `runner_mac/linux/windows` 已支持 `job.extra`（如 `unity_project_path`、`test_filter`）。
- 在 `run_unity_test(job)` 内增加分支：若存在 `extra.get("generated_test_csharp")` 或 `extra.get("test_script_path")`，先写文件再执行上述 Unity 命令；否则走原有「指定项目 + test_filter」逻辑。

---

## 六、技能与看板

- **新增 Skill**：`GPTTestGen` — 「GPT 生成 Unity 测试用例」，platforms：`["windows", "mac", "linux"]`，category：`unity`。  
- Agent 若声明该技能，表示本机可执行「带生成代码」的任务（即能写文件并跑 Unity）。
- 看板创建任务时：可选「测试需求（自然语言）」输入框，提交后 `extra.prompt` + `job_type: "generate_and_run"` 或仅 `generate_only`；若后端配置了 GPT，则自动生成并写入 `extra.generated_test_csharp` 或落盘后写入 `test_script_path`。

---

## 七、实施步骤建议

1. **文档与约定**：确认本方案中 `extra` 字段与两种方式 A/B，与现有 `JobCreate`、`runner_*` 兼容。
2. **可选 GPT 模块**：实现 `integrations/gpt_testgen.py`（见下一节），提供 `generate(prompt, assembly=None)`，返回 `{"code": "...", "error": None}`；在编排服务中可选调用，并写入任务 `extra` 或落盘。
3. **编排服务**：可选注册 `POST /api/generate-test`；创建任务时若 `extra.job_type == "generate_and_run"` 且配置了 GPT，则先生成再创建/更新任务。
4. **Agent**：在 `runner_mac/linux/windows` 的 `run_unity_test` 中，根据 `extra.generated_test_csharp` / `test_script_path` 写文件并执行 Unity，解析结果上报。
5. **看板**：增加「测试需求」输入与「仅生成 / 生成并执行」选项，便于联调与演示。

---

## 八、安全与成本

- **API Key**：`OPENAI_API_KEY` 仅保存在服务端环境变量或配置中，不写入前端或任务内容。
- **生成代码**：建议在 Agent 或编排服务侧做简单校验（如仅允许 `Generated_` 类名、禁止 `System.IO.File.Delete` 等危险调用），再写入项目；或先在沙箱/临时项目执行。
- **成本**：按 OpenAI 按量计费；可限制单用户/单日生成次数，或仅内网开放生成接口。

以上为「Unity + GPT 自动编写测试用例 + 自动执行」的完整集成方案；实现时可按步骤分阶段落地，先支持「仅生成」或「手动粘贴生成代码再执行」，再打通全自动流程。
