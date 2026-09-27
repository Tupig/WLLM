# 测试方法说明文件

## 1. 测试概述

本测试方法说明文件详细阐述了Unity MMORPG自动化测试平台的测试实施步骤、测试环境要求、测试工具使用方法及结果判定标准。测试覆盖单元测试、集成测试及关键业务流程测试，确保系统功能的正确性、稳定性和可靠性。

## 2. 测试环境要求

### 2.1 硬件环境

| 硬件类型 | 最低要求 | 推荐配置 |
|---------|---------|---------|
| CPU | Intel Core i5 或同等性能 | Intel Core i7 或同等性能 |
| 内存 | 8GB RAM | 16GB RAM |
| 存储 | 50GB 可用空间 | 100GB 可用空间 |
| 网络 | 宽带互联网连接 | 高速互联网连接 |
| 显示 | 1024x768 分辨率 | 1920x1080 分辨率 |

### 2.2 软件环境

| 软件名称 | 版本要求 | 用途 |
|---------|---------|------|
| 操作系统 | Windows 10/11, macOS 10.15+, Linux Ubuntu 18.04+ | 运行测试平台 |
| Python | 3.10+ | 运行编排服务和Agent |
| FastAPI | 0.115.0+ | 构建编排服务的API |
| Uvicorn | 0.32.0+ | ASGI服务器 |
| Pydantic | 2.0.0+ | 数据验证 |
| Unity Editor | 2020.3+ | 执行Unity测试 |
| 浏览器 | Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ | 执行Web测试 |
| Playwright | 1.30.0+ | Web测试自动化 |
| Selenium | 4.0.0+ | Web测试自动化 |
| Appium | 2.0.0+ | 移动应用测试 |

### 2.3 网络环境

| 网络类型 | 要求 |
|---------|------|
| 本地网络 | 局域网连接，支持设备间通信 |
| 互联网 | 可访问外部资源（如Web测试） |
| 端口 | 9111（编排服务）、8080（MCP服务） |

### 2.4 环境变量配置

| 环境变量 | 用途 | 默认值 | 配置方法 |
|---------|------|--------|----------|
| PLATFORM_URL | 编排服务URL | http://localhost:9111 | 命令行：`export PLATFORM_URL=http://localhost:9111` |
| AGENT_ID | Agent ID | 随机生成 | 命令行：`export AGENT_ID=test_agent_1` |
| PLATFORM | 平台类型 | mac | 命令行：`export PLATFORM=mac` |
| AGENT_SKILLS | Agent技能 | 空 | 命令行：`export AGENT_SKILLS=PlayMode,EditMode` |
| MCP_SERVER_URL | MCP服务器URL | http://localhost:8080/mcp | 命令行：`export MCP_SERVER_URL=http://localhost:8080/mcp` |

## 3. 测试工具使用方法

### 3.1 编排服务

#### 启动编排服务

```bash
# 方法1：直接运行
python3 main.py

# 方法2：使用uvicorn
uvicorn main:app --host 0.0.0.0 --port 9111 --reload
```

#### 停止编排服务

```bash
# 方法1：按Ctrl+C

# 方法2：查找并终止进程
lsof -i :9111
kill <PID>
```

### 3.2 Agent运行器

#### 启动Mac Agent

```bash
# 设置环境变量
export AGENT_ID=mac_agent_1
export PLATFORM=mac
export AGENT_SKILLS=PlayMode,EditMode

# 运行Agent
python3 agents/runner_mac.py
```

#### 启动Web Agent

```bash
# 设置环境变量
export AGENT_ID=web_agent_1
export PLATFORM=web
export AGENT_SKILLS=Playwright,WebChrome

# 运行Agent
python3 agents/runner_web.py
```

### 3.3 测试执行工具

#### 使用curl执行API测试

```bash
# 获取技能列表
curl -X GET http://localhost:9111/api/skills

# 注册Agent
curl -X POST http://localhost:9111/api/agents/register -H "Content-Type: application/json" -d '{"agent_id":"test_agent_1","platform":"mac","skills":["PlayMode","EditMode"]}'

# 创建任务
curl -X POST http://localhost:9111/api/jobs -H "Content-Type: application/json" -d '{"platform":"mac","required_skills":["PlayMode"],"test_filter":"TestSuite.*"}'

# 拉取任务
curl -X GET "http://localhost:9111/api/jobs/poll/mac?skills=PlayMode,EditMode"

# 上报任务结果
curl -X POST http://localhost:9111/api/jobs/result -H "Content-Type: application/json" -d '{"job_id":1,"agent_id":"test_agent_1","success":true,"summary":{"tests_run":5,"tests_passed":5}}'

# 检查MCP状态
curl -X GET http://localhost:9111/api/mcp/status
```

#### 使用Unity执行测试

```bash
# 批量模式执行Unity测试
Unity -batchmode -projectPath <project_path> -runTests -testPlatform PlayMode -testResults <results_path>

# 使用MCP执行Unity测试
# 通过API调用
curl -X POST http://localhost:9111/api/mcp/execute-tool -H "Content-Type: application/json" -d '{"tool_name":"run_tests","tool_params":{"test_filter":"TestSuite.*"}}'
```

#### 使用Playwright执行Web测试

```python
# 示例代码
from playwright.sync_api import sync_playwright

def run_web_test(url, browser="chromium", headless=True):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page()
        page.goto(url)
        # 执行测试操作
        title = page.title()
        print(f"Page title: {title}")
        browser.close()
        return {"title": title}
```

## 4. 测试实施步骤

### 4.1 单元测试实施步骤

#### 4.1.1 技能管理模块测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动

2. **执行测试**：
   - 测试获取所有技能：`curl -X GET http://localhost:9111/api/skills`
   - 测试按类别获取技能：调用`get_skills_by_category`函数
   - 测试按ID获取技能：调用`get_skill_by_id`函数
   - 测试按平台获取技能：调用`get_skills_by_platform`函数

3. **验证结果**：
   - 检查返回的技能列表是否完整
   - 检查按类别/ID/平台获取的技能是否正确

#### 4.1.2 MCP模块测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动

2. **执行测试**：
   - 测试MCP服务状态：`curl -X GET http://localhost:9111/api/mcp/status`

3. **验证结果**：
   - 检查返回的MCP服务状态是否正确

#### 4.1.3 Agent公共模块测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动

2. **执行测试**：
   - 测试Agent注册：调用`register`函数
   - 测试Agent心跳：调用`heartbeat`函数

3. **验证结果**：
   - 检查Agent注册是否成功
   - 检查心跳是否发送成功

### 4.2 集成测试实施步骤

#### 4.2.1 Agent注册与任务创建流程测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动

2. **执行测试**：
   - 注册Agent
   - 创建任务
   - 验证Agent注册和任务创建是否成功

3. **验证结果**：
   - 检查Agent注册返回值
   - 检查任务创建返回值
   - 检查任务是否已添加到队列

#### 4.2.2 任务拉取与执行流程测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动
   - Agent已注册
   - 任务已创建

2. **执行测试**：
   - Agent拉取任务
   - Agent执行任务
   - Agent上报任务结果

3. **验证结果**：
   - 检查任务拉取是否成功
   - 检查任务执行是否成功
   - 检查任务结果上报是否成功

#### 4.2.3 MCP工具执行流程测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动
   - 确保MCP服务已启动

2. **执行测试**：
   - 调用MCP工具执行API
   - 验证MCP工具执行是否成功

3. **验证结果**：
   - 检查MCP工具执行返回值
   - 检查工具执行是否达到预期效果

#### 4.2.4 Web Agent执行流程测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动

2. **执行测试**：
   - 注册Web Agent
   - 创建Web测试任务
   - Web Agent拉取任务
   - Web Agent执行任务

3. **验证结果**：
   - 检查Web Agent注册是否成功
   - 检查Web测试任务创建是否成功
   - 检查Web Agent拉取任务是否成功
   - 检查Web Agent执行任务是否成功

### 4.3 关键业务流程测试实施步骤

#### 4.3.1 完整的Unity测试流程测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动
   - 确保Unity Editor已安装

2. **执行测试**：
   - 创建Unity测试任务
   - 注册Mac Agent
   - Mac Agent拉取任务
   - Mac Agent执行Unity测试
   - Mac Agent上报测试结果

3. **验证结果**：
   - 检查任务创建是否成功
   - 检查Agent注册是否成功
   - 检查任务拉取是否成功
   - 检查Unity测试执行是否成功
   - 检查任务结果上报是否成功

#### 4.3.2 完整的Web测试流程测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动
   - 确保浏览器已安装

2. **执行测试**：
   - 创建Web测试任务
   - 注册Web Agent
   - Web Agent拉取任务
   - Web Agent执行Web测试
   - Web Agent上报测试结果

3. **验证结果**：
   - 检查任务创建是否成功
   - 检查Web Agent注册是否成功
   - 检查任务拉取是否成功
   - 检查Web测试执行是否成功
   - 检查任务结果上报是否成功

#### 4.3.3 MCP集成测试流程测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动
   - 确保MCP服务已启动
   - 确保Unity Editor已安装

2. **执行测试**：
   - 创建MCP测试任务
   - 注册Mac Agent
   - Mac Agent拉取任务
   - Mac Agent通过MCP执行Unity测试
   - Mac Agent上报测试结果

3. **验证结果**：
   - 检查任务创建是否成功
   - 检查Agent注册是否成功
   - 检查任务拉取是否成功
   - 检查MCP执行Unity测试是否成功
   - 检查任务结果上报是否成功

#### 4.3.4 错误处理流程测试

1. **准备环境**：
   - 安装所有依赖
   - 确保编排服务已启动

2. **执行测试**：
   - 创建需要不存在技能的任务
   - 注册只有部分技能的Agent
   - Agent尝试拉取任务

3. **验证结果**：
   - 检查任务创建是否成功
   - 检查Agent注册是否成功
   - 检查Agent拉取任务是否返回空（因为技能不匹配）

## 5. 结果判定标准

### 5.1 测试结果状态

| 状态 | 描述 | 判定条件 |
|------|------|----------|
| ✅ 成功 | 测试用例执行完成，预期输出与实际输出一致 | 所有测试步骤执行成功，返回值符合预期 |
| ❌ 失败 | 测试用例执行完成，预期输出与实际输出不一致 | 任何测试步骤执行失败，返回值不符合预期 |
| ⏳ 待测试 | 测试用例尚未执行 | 测试用例未执行 |
| ⚠️ 警告 | 测试用例执行完成，但存在非致命问题 | 测试步骤执行成功，但存在警告信息 |

### 5.2 功能测试判定标准

| 功能 | 判定标准 |
|------|----------|
| 技能管理 | 能够正确获取、查询和验证技能 |
| Agent注册 | 能够成功注册Agent并返回Agent ID |
| Agent心跳 | 能够成功发送心跳并更新Agent状态 |
| 任务创建 | 能够成功创建任务并返回job_id |
| 任务拉取 | 能够成功拉取任务并更新任务状态为running |
| 任务执行 | 能够成功执行任务并获取执行结果 |
| 任务结果上报 | 能够成功上报任务结果并更新任务状态 |
| MCP状态检查 | 能够正确检查MCP服务状态 |
| MCP工具执行 | 能够成功执行MCP工具并返回执行结果 |

### 5.3 性能测试判定标准

| 性能指标 | 判定标准 |
|---------|----------|
| 响应时间 | API响应时间不超过1秒 |
| 并发处理 | 能够同时处理至少10个Agent的请求 |
| 稳定性 | 连续运行24小时无崩溃 |
| 资源使用 | CPU使用率不超过50%，内存使用率不超过70% |

### 5.4 安全性测试判定标准

| 安全指标 | 判定标准 |
|---------|----------|
| 身份验证 | 能够正确验证API调用者身份 |
| 授权 | 能够正确控制API访问权限 |
| 输入验证 | 能够正确验证输入数据，防止注入攻击 |
| 数据保护 | 能够正确保护敏感数据 |
| 网络安全 | 能够正确处理网络安全问题 |

## 6. 测试报告生成

### 6.1 测试报告内容

| 部分 | 内容 |
|------|------|
| 测试执行摘要 | 测试执行时间、测试用例数量、成功/失败数量 |
| 测试用例执行结果 | 详细的测试用例执行结果表格 |
| 测试覆盖率分析 | 代码测试覆盖率、功能测试覆盖率 |
| 发现的问题及建议 | 测试过程中发现的问题、解决方案建议 |
| 测试环境信息 | 测试环境配置、硬件/软件信息 |

### 6.2 测试报告格式

#### 6.2.1 文本格式

```markdown
# 测试报告

## 测试执行摘要

- 测试执行时间：2024-01-01 10:00:00
- 测试用例总数：20
- 成功：18
- 失败：2
- 待测试：0
- 警告：0

## 测试用例执行结果

| 测试用例ID | 测试名称 | 结果 | 执行时间 |
|-----------|---------|------|----------|
| UT-001 | 测试技能管理模块 - 获取所有技能 | ✅ 成功 | 0.1秒 |
| UT-002 | 测试技能管理模块 - 按类别获取技能 | ✅ 成功 | 0.1秒 |
| ... | ... | ... | ... |

## 测试覆盖率分析

- 代码测试覆盖率：85%
- 功能测试覆盖率：90%

## 发现的问题及建议

| 问题ID | 问题描述 | 严重程度 | 建议解决方案 |
|--------|---------|---------|------------|
| ISSUE-001 | 端口9111可能被占用 | 中等 | 添加端口占用检测和自动处理机制 |
| ISSUE-002 | MCP服务依赖问题 | 中等 | 添加MCP服务状态检测和错误处理机制 |

## 测试环境信息

- 操作系统：macOS 14.0
- Python版本：3.10.10
- FastAPI版本：0.115.0
- Uvicorn版本：0.32.0
- Pydantic版本：2.0.0
```

#### 6.2.2 JSON格式

```json
{
  "test_report": {
    "summary": {
      "execution_time": "2024-01-01 10:00:00",
      "total_test_cases": 20,
      "passed": 18,
      "failed": 2,
      "pending": 0,
      "warning": 0
    },
    "test_cases": [
      {
        "id": "UT-001",
        "name": "测试技能管理模块 - 获取所有技能",
        "result": "passed",
        "execution_time": "0.1秒"
      },
      {
        "id": "UT-002",
        "name": "测试技能管理模块 - 按类别获取技能",
        "result": "passed",
        "execution_time": "0.1秒"
      }
    ],
    "coverage": {
      "code_coverage": "85%",
      "function_coverage": "90%"
    },
    "issues": [
      {
        "id": "ISSUE-001",
        "description": "端口9111可能被占用",
        "severity": "medium",
        "suggestion": "添加端口占用检测和自动处理机制"
      },
      {
        "id": "ISSUE-002",
        "description": "MCP服务依赖问题",
        "severity": "medium",
        "suggestion": "添加MCP服务状态检测和错误处理机制"
      }
    ],
    "environment": {
      "operating_system": "macOS 14.0",
      "python_version": "3.10.10",
      "fastapi_version": "0.115.0",
      "uvicorn_version": "0.32.0",
      "pydantic_version": "2.0.0"
    }
  }
}
```

## 7. 测试管理

### 7.1 测试计划

| 阶段 | 测试内容 | 时间估计 |
|------|---------|----------|
| 准备阶段 | 环境搭建、依赖安装 | 1天 |
| 单元测试 | 测试各个模块的核心功能 | 1天 |
| 集成测试 | 测试模块之间的交互 | 1天 |
| 业务流程测试 | 测试完整的业务流程 | 1天 |
| 性能测试 | 测试系统性能 | 1天 |
| 安全性测试 | 测试系统安全性 | 1天 |
| 报告阶段 | 生成测试报告、分析问题 | 1天 |

### 7.2 测试资源管理

| 资源类型 | 资源名称 | 用途 |
|---------|---------|------|
| 人员 | 测试工程师 | 执行测试、分析结果 |
| 硬件 | 测试服务器 | 运行编排服务和Agent |
| 软件 | 测试工具 | 执行各类测试 |
| 数据 | 测试数据 | 用于测试的输入数据 |

### 7.3 测试风险管理

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|---------|------|----------|
| 环境配置错误 | 高 | 测试失败 | 提供详细的环境配置文档 |
| 依赖服务不可用 | 中 | 测试失败 | 添加依赖服务状态检测和错误处理 |
| 测试数据不足 | 中 | 测试覆盖不全面 | 准备充分的测试数据 |
| 时间不足 | 中 | 测试不充分 | 制定合理的测试计划，优先测试核心功能 |
| 技术难题 | 低 | 测试延迟 | 提前识别技术难题，寻求解决方案 |

## 8. 附录

### 8.1 常用命令

#### 环境搭建

```bash
# 安装依赖
pip install -r requirements.txt

# 检查Python版本
python --version

# 检查端口占用
lsof -i :9111

# 终止进程
kill <PID>
```

#### 服务管理

```bash
# 启动编排服务
python3 main.py

# 启动Mac Agent
export AGENT_ID=mac_agent_1
export PLATFORM=mac
export AGENT_SKILLS=PlayMode,EditMode
python3 agents/runner_mac.py

# 启动Web Agent
export AGENT_ID=web_agent_1
export PLATFORM=web
export AGENT_SKILLS=Playwright,WebChrome
python3 agents/runner_web.py
```

#### 测试执行

```bash
# 获取技能列表
curl -X GET http://localhost:9111/api/skills

# 注册Agent
curl -X POST http://localhost:9111/api/agents/register -H "Content-Type: application/json" -d '{"agent_id":"test_agent_1","platform":"mac","skills":["PlayMode","EditMode"]}'

# 创建任务
curl -X POST http://localhost:9111/api/jobs -H "Content-Type: application/json" -d '{"platform":"mac","required_skills":["PlayMode"],"test_filter":"TestSuite.*"}'

# 拉取任务
curl -X GET "http://localhost:9111/api/jobs/poll/mac?skills=PlayMode,EditMode"

# 上报任务结果
curl -X POST http://localhost:9111/api/jobs/result -H "Content-Type: application/json" -d '{"job_id":1,"agent_id":"test_agent_1","success":true,"summary":{"tests_run":5,"tests_passed":5}}'

# 检查MCP状态
curl -X GET http://localhost:9111/api/mcp/status
```

### 8.2 故障排除

| 问题 | 症状 | 原因 | 解决方案 |
|------|------|------|----------|
| 端口占用 | 服务启动失败，提示"Address already in use" | 端口9111已被其他进程占用 | 查找并终止占用端口的进程 |
| 依赖缺失 | 服务启动失败，提示"ModuleNotFoundError" | 缺少依赖包 | 安装缺失的依赖包 |
| MCP服务不可用 | MCP状态检查返回"available: false" | MCP服务未启动 | 启动Unity Editor并确保MCP服务已启用 |
| Agent注册失败 | 注册Agent返回错误 | 编排服务未启动或网络连接问题 | 检查编排服务状态和网络连接 |
| 任务拉取失败 | 拉取任务返回"job: null" | 没有匹配的任务或Agent技能不匹配 | 创建匹配的任务或确保Agent具备所需技能 |
| 测试执行失败 | 任务执行返回错误 | 测试环境配置错误或依赖服务不可用 | 检查测试环境配置和依赖服务状态 |

### 8.3 参考文档

| 文档名称 | 用途 | 链接 |
|---------|------|------|
| FastAPI文档 | FastAPI框架使用指南 | https://fastapi.tiangolo.com/
| Uvicorn文档 | Uvicorn服务器使用指南 | https://www.uvicorn.org/
| Pydantic文档 | Pydantic数据验证使用指南 | https://docs.pydantic.dev/
| Unity测试框架文档 | Unity测试框架使用指南 | https://docs.unity3d.com/Manual/testing.html
| Playwright文档 | PlaywrightWeb测试使用指南 | https://playwright.dev/
| Selenium文档 | SeleniumWeb测试使用指南 | https://www.selenium.dev/
| Appium文档 | Appium移动测试使用指南 | https://appium.io/
