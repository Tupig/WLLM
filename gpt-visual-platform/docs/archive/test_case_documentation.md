# 测试用例说明文件

## 1. 单元测试

| 测试用例ID | 测试目的 | 前置条件 | 输入数据 | 预期输出 | 实际输出 | 测试结果 |
|-----------|---------|---------|---------|---------|---------|----------|
| UT-001 | 测试技能管理模块 - 获取所有技能 | 项目已安装所有依赖 | {} | 返回包含所有技能的列表 | 返回了所有42个技能 | ✅ 成功 |
| UT-002 | 测试技能管理模块 - 按类别获取技能 | 项目已安装所有依赖 | {"category": "自动化测试"} | 返回自动化测试类别的技能列表 | 返回了相应类别的技能列表 | ✅ 成功 |
| UT-003 | 测试技能管理模块 - 按ID获取技能 | 项目已安装所有依赖 | {"skill_id": "unity_playmode"} | 返回ID为unity_playmode的技能信息 | 返回了相应ID的技能信息 | ✅ 成功 |
| UT-004 | 测试技能管理模块 - 按平台获取技能 | 项目已安装所有依赖 | {"platform": "Unity"} | 返回Unity平台的技能列表 | 返回了相应平台的技能列表 | ✅ 成功 |
| UT-005 | 测试MCP模块 - 检查MCP服务是否可用 | 项目已安装所有依赖 | {} | 返回MCP服务的可用状态 | 返回了{"available": false, "instances": {}} | ✅ 成功 |
| UT-006 | 测试Agent公共模块 - 注册功能 | 项目已安装所有依赖，编排服务已启动 | {"platform": "mac", "skills": ["PlayMode", "EditMode"]} | 返回注册成功的Agent ID | 返回了{"ok": true, "agent_id": "test_agent_1"} | ✅ 成功 |
| UT-007 | 测试Agent公共模块 - 心跳功能 | 项目已安装所有依赖，编排服务已启动，Agent已注册 | {"agent_id": "test_agent", "status": "idle"} | 心跳发送成功 | 返回了{"ok": true} | ✅ 成功 |

## 2. 集成测试

| 测试用例ID | 测试目的 | 前置条件 | 输入数据 | 预期输出 | 实际输出 | 测试结果 |
|-----------|---------|---------|---------|---------|---------|----------|
| IT-001 | 测试Agent注册与任务创建流程 | 项目已安装所有依赖，编排服务已启动 | {"agent_register": {"platform": "mac", "skills": ["PlayMode"]}, "job_create": {"platform": "mac", "required_skills": ["PlayMode"], "test_filter": "TestSuite.*"}} | Agent注册成功，任务创建成功并进入队列 | Agent注册返回{"ok": true, "agent_id": "test_agent_1"}，任务创建返回{"ok": true, "job_id": 1} | ✅ 成功 |
| IT-002 | 测试任务拉取与执行流程 | 项目已安装所有依赖，编排服务已启动，Agent已注册，任务已创建 | {"agent_id": "test_agent", "platform": "mac", "skills": ["PlayMode"]} | Agent成功拉取任务，执行任务并上报结果 | 任务拉取返回任务详情，状态变为running；任务结果上报返回{"ok": true} | ✅ 成功 |
| IT-003 | 测试MCP工具执行流程 | 项目已安装所有依赖，编排服务已启动，MCP服务已启动 | {"tool_name": "run_tests", "tool_params": {"test_filter": "TestSuite.*"}} | MCP工具执行成功并返回结果 | 返回MCP执行结果 | ⏳ 待测试 |
| IT-004 | 测试Web Agent执行流程 | 项目已安装所有依赖，编排服务已启动 | {"agent_register": {"platform": "web", "skills": ["Playwright", "WebChrome"]}, "job_create": {"platform": "web", "required_skills": ["Playwright"], "extra": {"url": "https://example.com", "browser": "chromium"}}, "agent_poll": {"platform": "web", "skills": ["Playwright", "WebChrome"]}} | Web Agent成功注册，拉取任务并执行 | Web Agent注册返回{"ok": true, "agent_id": "test_web_agent"}；任务拉取返回任务详情 | ⏳ 待测试 |

## 3. 关键业务流程测试

| 测试用例ID | 测试目的 | 前置条件 | 输入数据 | 预期输出 | 实际输出 | 测试结果 |
|-----------|---------|---------|---------|---------|---------|----------|
| BT-001 | 测试完整的Unity测试流程 | 项目已安装所有依赖，编排服务已启动，Unity Editor已安装 | {"job_create": {"platform": "mac", "required_skills": ["PlayMode"], "unity_project_path": "/path/to/unity/project", "test_filter": "TestSuite.*"}, "agent_register": {"platform": "mac", "skills": ["PlayMode"]}, "agent_poll": {"platform": "mac", "skills": ["PlayMode"]}, "agent_submit": {"success": true, "summary": {"tests_run": 5, "tests_passed": 5}}} | 任务创建成功，Agent拉取并执行任务，执行完成后上报结果 | 任务创建返回{"ok": true, "job_id": 1}；任务拉取返回任务详情；任务结果上报返回{"ok": true} | ⏳ 待测试 |
| BT-002 | 测试完整的Web测试流程 | 项目已安装所有依赖，编排服务已启动，浏览器已安装 | {"job_create": {"platform": "web", "required_skills": ["Playwright"], "extra": {"url": "https://example.com", "browser": "chromium", "headless": true}}, "agent_register": {"platform": "web", "skills": ["Playwright", "WebChrome"]}, "agent_poll": {"platform": "web", "skills": ["Playwright", "WebChrome"]}, "agent_submit": {"success": true, "summary": {"url": "https://example.com", "browser": "chromium", "status": "passed"}}} | 任务创建成功，Web Agent拉取并执行任务，执行完成后上报结果 | 任务创建返回{"ok": true, "job_id": 2}；任务拉取返回任务详情；任务结果上报返回{"ok": true} | ⏳ 待测试 |
| BT-003 | 测试MCP集成测试流程 | 项目已安装所有依赖，编排服务已启动，MCP服务已启动，Unity Editor已安装 | {"job_create": {"platform": "mac", "required_skills": ["PlayMode"], "extra": {"use_mcp": true, "test_filter": "TestSuite.*"}}, "agent_register": {"platform": "mac", "skills": ["PlayMode"]}, "agent_poll": {"platform": "mac", "skills": ["PlayMode"]}, "agent_submit": {"success": true, "summary": {"message": "MCP test run", "result": {"tests_run": 5, "tests_passed": 5}}}} | 任务创建成功，Agent通过MCP执行测试，执行完成后上报结果 | 任务创建返回{"ok": true, "job_id": 3}；任务拉取返回任务详情；任务结果上报返回{"ok": true} | ⏳ 待测试 |
| BT-004 | 测试错误处理流程 | 项目已安装所有依赖，编排服务已启动 | {"job_create": {"platform": "mac", "required_skills": ["NonExistentSkill"]}, "agent_register": {"platform": "mac", "skills": ["PlayMode"]}, "agent_poll": {"platform": "mac", "skills": ["PlayMode"]}} | 任务创建成功，但由于技能不匹配，Agent无法拉取任务 | 任务创建返回{"ok": true, "job_id": 4}；任务拉取返回{"job": null} | ⏳ 待测试 |

## 3. 测试用例执行说明

### 3.1 执行顺序

1. 首先执行单元测试（UT-001 至 UT-007）
2. 然后执行集成测试（IT-001 至 IT-004）
3. 最后执行关键业务流程测试（BT-001 至 BT-004）

### 3.2 环境要求

- Python 3.10+
- FastAPI 0.115.0+
- Uvicorn 0.32.0+
- Pydantic 2.0.0+
- Unity Editor（仅用于Unity测试）
- 浏览器（仅用于Web测试）
- 移动设备或模拟器（仅用于移动测试）

### 3.3 测试结果判定标准

- ✅ 成功：测试用例执行完成，预期输出与实际输出一致
- ❌ 失败：测试用例执行完成，预期输出与实际输出不一致
- ⏳ 待测试：测试用例尚未执行
- ⚠️ 警告：测试用例执行完成，但存在非致命问题

### 3.4 测试数据管理

- 测试数据应存储在测试目录中
- 测试数据应包括：
  - 测试配置文件
  - 测试输入数据
  - 测试预期输出
  - 测试实际输出
  - 测试结果报告

### 3.5 测试报告生成

- 测试完成后，应生成详细的测试报告
- 测试报告应包括：
  - 测试执行摘要
  - 测试用例执行结果
  - 测试覆盖率分析
  - 发现的问题及建议
  - 测试环境信息

## 4. 附录

### 4.1 测试工具列表

| 工具名称 | 用途 | 版本要求 |
|---------|------|---------|
| FastAPI | 构建编排服务的API | 0.115.0+ |
| Uvicorn | ASGI服务器 | 0.32.0+ |
| Pydantic | 数据验证 | 2.0.0+ |
| Unity Editor | Unity测试执行 | 2020.3+ |
| Playwright | Web测试 | 1.30.0+ |
| Selenium | Web测试 | 4.0.0+ |
| Appium | 移动测试 | 2.0.0+ |

### 4.2 测试环境配置

| 环境变量 | 用途 | 默认值 |
|---------|------|--------|
| PLATFORM_URL | 编排服务URL | http://localhost:9111 |
| AGENT_ID | Agent ID | 随机生成 |
| PLATFORM | 平台类型 | mac |
| AGENT_SKILLS | Agent技能 | 空 |
| MCP_SERVER_URL | MCP服务器URL | http://localhost:8080/mcp |

### 4.3 常见问题及解决方案

| 问题 | 解决方案 |
|------|---------|
| 端口9111被占用 | 执行`lsof -i :9111`查看占用端口的进程，然后执行`kill <PID>`终止进程 |
| MCP服务不可用 | 启动Unity Editor并确保MCP服务已启用 |
| Agent注册失败 | 检查编排服务是否启动，网络连接是否正常 |
| 任务拉取失败 | 检查Agent技能是否与任务所需技能匹配 |
| 测试执行失败 | 检查测试环境配置，确保所有依赖已安装 |