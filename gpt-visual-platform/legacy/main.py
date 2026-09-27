"""
Unity3D MMORPG 自动化测试平台 - 编排服务
提供：任务队列、Agent 注册/心跳、结果上报、简单 Web 看板。
支持 Linux / Windows / Mac 运行；可源码运行或 PyInstaller 打包后运行。
"""
import os
import sys
import time
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from modules.skills import get_all_skills
from modules.mcp import (
    is_mcp_available, get_unity_instances, set_active_instance,
    execute_unity_tool, batch_execute_tools,
    manage_scene, manage_asset, manage_material, execute_menu_item,
    get_project_info, get_scene_info
)
from modules.services.data_service import DataService

app = FastAPI(
    title="Unity MMORPG 自动化测试平台",
    description="跨环境（Mac/Linux/Windows/iOS/Android）测试编排与结果收集",
)


def _base_dir() -> Path:
    """运行根目录：打包后为可执行文件所在目录（便于 data 可写），否则为项目根目录。"""
    return Path(sys.executable).parent.resolve() if getattr(sys, "frozen", False) else Path(__file__).parent.resolve()


def _static_dir() -> Path:
    """静态资源目录：打包后来自 _MEIPASS；源码运行时 ./static，legacy 子目录布局回退 ../static。"""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS).resolve() / "static"
    here = _base_dir() / "static"
    if here.exists():
        return here
    return _base_dir().parent / "static"


def _data_dir() -> Path:
    """数据目录：优先 DATA_DIR 环境变量（测试隔离/自定义），否则为可执行文件同目录下 data。"""
    env = os.getenv("DATA_DIR")
    if env:
        return Path(env)
    return _base_dir() / "data"


BASE_DIR = _base_dir()
STATIC_DIR = _static_dir()
DATA_DIR = _data_dir()
RUNS_DIR = DATA_DIR / "runs"
DATA_DIR.mkdir(parents=True, exist_ok=True)
RUNS_DIR.mkdir(parents=True, exist_ok=True)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# 获取技能列表
DEFAULT_SKILLS = get_all_skills()

# ---------- 数据存储 ----------

# 创建数据服务实例
data_service = DataService(DATA_DIR)


def _next_job_id() -> int:
    return data_service.next_job_id()


def _save_job(job: dict) -> None:
    """任务结果落盘到 data/runs/job_{id}.json。"""
    data_service.save_job(job)


def _find_job(job_id: int) -> Optional[dict]:
    """按 job_id 查找任务，未找到返回 None。"""
    return data_service.find_job(job_id)


class AgentRegister(BaseModel):
    agent_id: str
    platform: str  # windows | mac | linux | web | android | ios
    skills: Optional[List[str]] = None  # 如 ["PlayMode", "EditMode"] 或 ["Playwright", "WebChrome"]
    extra: Optional[dict] = None


class AgentHeartbeat(BaseModel):
    agent_id: str
    status: str = "idle"
    current_job_id: Optional[int] = None


class JobCreate(BaseModel):
    platform: str
    required_skills: Optional[List[str]] = None  # 任务所需技能，仅匹配具备全部技能的 Agent
    unity_project_path: Optional[str] = None
    test_filter: Optional[str] = None
    extra: Optional[dict] = None


class JobResult(BaseModel):
    job_id: int
    agent_id: str
    success: bool
    log_path: Optional[str] = None
    summary: Optional[dict] = None


class GenerateTestRequest(BaseModel):
    """GPT 生成测试用例请求。需配置 OPENAI_API_KEY 与 pip install openai。"""
    prompt: str
    assembly: Optional[str] = None


@app.get("/api/skills")
async def list_skills() -> dict:
    """列出平台支持的 Skills（集成测试能力）。"""
    return {"items": DEFAULT_SKILLS, "total": len(DEFAULT_SKILLS)}


@app.post("/api/agents/register")
async def register_agent(body: AgentRegister) -> dict:
    """Agent 注册，上报自身平台与技能。"""
    data_service.agents[body.agent_id] = {
        "agent_id": body.agent_id,
        "platform": body.platform,
        "skills": body.skills or [],
        "extra": body.extra or {},
        "last_seen": time.time(),
        "status": "idle",
        "current_job_id": None
    }
    data_service.save_data()
    return {"ok": True, "agent_id": body.agent_id}


@app.post("/api/agents/heartbeat")
async def agent_heartbeat(body: AgentHeartbeat) -> dict:
    """Agent 心跳。"""
    if body.agent_id not in data_service.agents:
        raise HTTPException(status_code=404, detail="agent not registered")
    data_service.agents[body.agent_id].update({"last_seen": time.time(), "status": body.status, "current_job_id": body.current_job_id})
    data_service.save_data()
    return {"ok": True}


@app.get("/api/agents")
async def list_agents() -> dict:
    """列出已注册 Agent。"""
    return {"items": list(data_service.agents.values()), "total": len(data_service.agents)}


@app.post("/api/generate-test")
async def generate_test(body: GenerateTestRequest) -> dict:
    """可选：根据自然语言生成 Unity UTF 测试代码。需 OPENAI_API_KEY 与 pip install openai。详见 docs/GPT生成测试用例集成方案.md。"""
    try:
        from integrations.gpt_testgen import generate as gpt_generate
        out = gpt_generate(body.prompt, body.assembly)
        return {"code": out.get("code"), "error": out.get("error")}
    except ImportError:
        return {"code": None, "error": "未安装 integrations 或 openai"}


@app.post("/api/jobs")
async def create_job(body: JobCreate) -> dict:
    """创建测试任务，进入队列；可指定 required_skills 仅由具备该技能的 Agent 执行。若 extra.job_type 为 generate_and_run 且含 prompt，将尝试调用 GPT 生成代码并写入 extra.generated_test_csharp。"""
    extra = body.extra or {}
    if extra.get("job_type") == "generate_and_run" and extra.get("prompt"):
        try:
            from integrations.gpt_testgen import generate as gpt_generate
            out = gpt_generate(extra.get("prompt"), extra.get("unity_assembly"))
            if out.get("code"):
                extra = {**extra, "generated_test_csharp": out["code"]}
            elif out.get("error"):
                extra = {**extra, "generate_error": out["error"]}
        except ImportError:
            extra = {**extra, "generate_error": "未安装 openai 或未配置 OPENAI_API_KEY"}
    jid = _next_job_id()
    job = {
        "job_id": jid,
        "platform": body.platform,
        "required_skills": body.required_skills or [],
        "unity_project_path": body.unity_project_path,
        "test_filter": body.test_filter,
        "extra": extra,
        "status": "pending",
        "created_at": time.time(),
        "result": None
    }
    data_service.jobs.append(job)
    _save_job(job)
    data_service.save_data()
    return {"ok": True, "job_id": jid}


@app.get("/api/jobs")
async def list_jobs() -> dict:
    """列出任务列表。"""
    return {"items": data_service.jobs, "total": len(data_service.jobs)}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: int) -> dict:
    """获取单任务详情。"""
    job = _find_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.post("/api/jobs/result")
async def submit_job_result(body: JobResult) -> dict:
    """Agent 上报任务结果。"""
    job = _find_job(body.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    job["status"] = "passed" if body.success else "failed"
    job["result"] = {
        "agent_id": body.agent_id,
        "success": body.success,
        "log_path": body.log_path,
        "summary": body.summary or {}
    }
    _save_job(job)
    data_service.save_data()
    return {"ok": True}


@app.get("/api/jobs/poll/{platform}")
async def poll_job(platform: str, skills: Optional[str] = None) -> dict:
    """Agent 拉取该平台下一条 pending 任务；可选 skills 逗号分隔，仅返回所需技能为 agent 技能子集的任务。"""
    agent_skills = set(s.strip() for s in (skills or "").split(",") if s.strip())
    for j in data_service.jobs:
        if j.get("platform") != platform or j.get("status") != "pending":
            continue
        required = set(j.get("required_skills") or [])
        if required and agent_skills and not required.issubset(agent_skills):
            continue
        j["status"] = "running"
        _save_job(j)
        data_service.save_data()
        return {"job": j}
    return {"job": None}


@app.get("/", response_class=HTMLResponse)
async def index():
    """Web 看板。"""
    html = STATIC_DIR / "index.html"
    if not html.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return HTMLResponse(content=html.read_text(encoding="utf-8"))


# MCP API 错误处理装饰器
def mcp_error_handler(func):
    """MCP API 错误处理装饰器"""
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return wrapper


@app.get("/api/mcp/status")
async def get_mcp_status():
    """检查 MCP 服务状态"""
    try:
        is_available = is_mcp_available()
        instances = get_unity_instances() if is_available else {}
        return {"available": is_available, "instances": instances}
    except Exception as e:
        return {"available": False, "error": str(e)}


@app.post("/api/mcp/execute-tool")
@mcp_error_handler
async def execute_mcp_tool(body: dict):
    """执行 MCP 工具"""
    tool_name = body.get("tool_name")
    tool_params = body.get("tool_params", {})
    if not tool_name:
        raise HTTPException(status_code=400, detail="tool_name 是必需的")
    result = execute_unity_tool(tool_name, tool_params)
    return result


@app.post("/api/mcp/batch-execute")
@mcp_error_handler
async def batch_execute_mcp_tools(body: dict):
    """批量执行 MCP 工具"""
    tools = body.get("tools", [])
    if not isinstance(tools, list):
        raise HTTPException(status_code=400, detail="tools 必须是列表")
    result = batch_execute_tools(tools)
    return result


@app.post("/api/mcp/set-active-instance")
@mcp_error_handler
async def set_active_mcp_instance(body: dict):
    """设置活动的 Unity 实例"""
    instance_id = body.get("instance_id")
    if not instance_id:
        raise HTTPException(status_code=400, detail="instance_id 是必需的")
    result = set_active_instance(instance_id)
    return result


@app.post("/api/mcp/manage-scene")
@mcp_error_handler
async def manage_mcp_scene(body: dict):
    """管理 Unity 场景"""
    action = body.get("action")
    scene_path = body.get("scene_path")
    properties = body.get("properties", {})
    if not action or not scene_path:
        raise HTTPException(status_code=400, detail="action 和 scene_path 是必需的")
    result = manage_scene(action, scene_path, properties)
    return result


@app.post("/api/mcp/manage-asset")
@mcp_error_handler
async def manage_mcp_asset(body: dict):
    """管理 Unity 资产"""
    action = body.get("action")
    asset_path = body.get("asset_path")
    properties = body.get("properties", {})
    if not action or not asset_path:
        raise HTTPException(status_code=400, detail="action 和 asset_path 是必需的")
    result = manage_asset(action, asset_path, properties)
    return result


@app.post("/api/mcp/manage-material")
@mcp_error_handler
async def manage_mcp_material(body: dict):
    """管理 Unity 材质"""
    action = body.get("action")
    material_path = body.get("material_path")
    properties = body.get("properties", {})
    if not action or not material_path:
        raise HTTPException(status_code=400, detail="action 和 material_path 是必需的")
    result = manage_material(action, material_path, properties)
    return result


@app.post("/api/mcp/execute-menu-item")
@mcp_error_handler
async def execute_mcp_menu_item(body: dict):
    """执行 Unity 菜单命令"""
    menu_path = body.get("menu_path")
    if not menu_path:
        raise HTTPException(status_code=400, detail="menu_path 是必需的")
    result = execute_menu_item(menu_path)
    return result


@app.get("/api/mcp/project-info")
@mcp_error_handler
async def get_mcp_project_info():
    """获取项目信息"""
    result = get_project_info()
    return result


@app.get("/api/mcp/scene-info")
@mcp_error_handler
async def get_mcp_scene_info():
    """获取场景信息"""
    result = get_scene_info()
    return result


def check_and_release_port(port: int) -> bool:
    """检查并释放指定端口

    Args:
        port: 要检查的端口号

    Returns:
        bool: 端口是否成功释放
    """
    import subprocess
    import os
    import signal

    print(f"[端口检查] 检查端口 {port} 是否被占用...")

    try:
        # 使用 lsof 命令检查端口占用情况
        result = subprocess.run(
            ["lsof", "-i", f":{port}"],
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            # 端口被占用，提取进程信息
            output = result.stdout
            print(f"[端口检查] 端口 {port} 已被占用，进程信息：")
            print(output)

            # 提取 PID
            pids = set()
            for line in output.strip().split('\n')[1:]:  # 跳过表头
                parts = line.split()
                if len(parts) >= 2:
                    pid = parts[1]
                    pids.add(pid)

            if pids:
                print(f"[端口检查] 尝试终止占用端口 {port} 的进程：{', '.join(pids)}")

                for pid in pids:
                    try:
                        os.kill(int(pid), signal.SIGTERM)
                        print(f"[端口检查] 成功终止进程 {pid}")
                    except Exception as e:
                        print(f"[端口检查] 终止进程 {pid} 失败：{e}")
                        return False

                # 等待一段时间确保进程完全终止
                import time
                time.sleep(1)

                # 再次检查端口是否释放
                result = subprocess.run(
                    ["lsof", "-i", f":{port}"],
                    capture_output=True,
                    text=True
                )

                if result.returncode == 0:
                    print(f"[端口检查] 端口 {port} 仍被占用，可能需要手动处理")
                    return False
                else:
                    print(f"[端口检查] 端口 {port} 已成功释放")
                    return True
            else:
                print(f"[端口检查] 未找到占用端口 {port} 的进程")
                return True
        else:
            print(f"[端口检查] 端口 {port} 未被占用")
            return True

    except Exception as e:
        print(f"[端口检查] 检查端口 {port} 时发生错误：{e}")
        return False


if __name__ == "__main__":
    import uvicorn
    
    # 检查并释放端口
    PORT = 9111
    if check_and_release_port(PORT):
        print(f"[启动] 开始启动服务器，监听端口 {PORT}...")
        uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
    else:
        print(f"[启动] 端口 {PORT} 无法释放，启动失败")
        exit(1)
