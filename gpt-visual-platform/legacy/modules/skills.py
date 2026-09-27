"""
Skills 模块
管理平台支持的所有技能（集成测试能力）
"""
from typing import List, Dict, Any, Optional


# ---------- Skills：集成测试能力（Agent 声明、任务可指定所需） ----------
# category: unity | web | mobile | devops，便于看板分组展示
DEFAULT_SKILLS: List[dict] = [
    # Unity
    {
        "id": "PlayMode",
        "name": "Unity PlayMode",
        "description": "Play Mode 测试",
        "platforms": ["windows", "mac", "linux"],
        "category": "unity"
    },
    {
        "id": "EditMode",
        "name": "Unity EditMode",
        "description": "Edit Mode 测试",
        "platforms": ["windows", "mac", "linux"],
        "category": "unity"
    },
    {
        "id": "AltTester",
        "name": "AltTester UI",
        "description": "UI 自动化（AltTester）",
        "platforms": ["windows", "mac", "android", "ios"],
        "category": "unity"
    },
    {
        "id": "GPTTestGen",
        "name": "GPT 生成测试",
        "description": "根据自然语言生成 Unity 测试用例并执行",
        "platforms": ["windows", "mac", "linux"],
        "category": "unity"
    },
    {
        "id": "UnityMCP",
        "name": "Unity MCP",
        "description": "通过 Model Context Protocol 与 Unity 编辑器交互",
        "platforms": ["windows", "mac", "linux"],
        "category": "unity"
    },
    {
        "id": "UnityAutomatedQA",
        "name": "Unity Automated QA",
        "description": "Unity 官方自动化测试工具",
        "platforms": ["windows", "mac", "linux", "android", "ios"],
        "category": "unity"
    },
    {
        "id": "UnityPerformanceTest",
        "name": "Unity 性能测试",
        "description": "Unity 性能测试工具",
        "platforms": ["windows", "mac", "linux", "android", "ios"],
        "category": "unity"
    },
    {
        "id": "UnityTestFrameworkExt",
        "name": "UTF 扩展",
        "description": "Unity Test Framework 扩展",
        "platforms": ["windows", "mac", "linux"],
        "category": "unity"
    },
    {
        "id": "UnityNetworkTest",
        "name": "Unity 网络测试",
        "description": "Unity 网络功能测试",
        "platforms": ["windows", "mac", "linux", "android", "ios"],
        "category": "unity"
    },
    {
        "id": "UnityVRTest",
        "name": "Unity VR 测试",
        "description": "Unity VR 功能测试",
        "platforms": ["windows", "mac", "linux"],
        "category": "unity"
    },
    {
        "id": "UnityARTest",
        "name": "Unity AR 测试",
        "description": "Unity AR 功能测试",
        "platforms": ["windows", "mac", "linux", "android", "ios"],
        "category": "unity"
    },
    {
        "id": "UnityUIAnimationTest",
        "name": "Unity UI 动画测试",
        "description": "Unity UI 动画效果测试",
        "platforms": ["windows", "mac", "linux", "android", "ios"],
        "category": "unity"
    },
    {
        "id": "UnityAssetBundleTest",
        "name": "Unity AssetBundle 测试",
        "description": "Unity AssetBundle 功能测试",
        "platforms": ["windows", "mac", "linux", "android", "ios"],
        "category": "unity"
    },
    # Mobile
    {
        "id": "ADB",
        "name": "ADB",
        "description": "Android 设备/模拟器",
        "platforms": ["android"],
        "category": "mobile"
    },
    {
        "id": "XCUITest",
        "name": "XCUITest",
        "description": "iOS 模拟器/真机",
        "platforms": ["ios"],
        "category": "mobile"
    },
    {
        "id": "Appium",
        "name": "Appium",
        "description": "跨平台移动应用测试",
        "platforms": ["android", "ios", "windows", "mac", "linux"],
        "category": "mobile"
    },
    {
        "id": "Airtest",
        "name": "Airtest",
        "description": "Airtest 图像识别自动化，可运行 .air 脚本（Android/Windows）",
        "platforms": ["android", "windows"],
        "category": "mobile"
    },
    {
        "id": "Poco",
        "name": "Poco 控件",
        "description": "Poco 控件级自动化（需游戏集成 Poco-SDK，可配合 Airtest 脚本）",
        "platforms": ["android", "windows"],
        "category": "mobile"
    },
    {
        "id": "MobilePerformance",
        "name": "移动性能测试",
        "description": "移动设备性能测试",
        "platforms": ["android", "ios"],
        "category": "mobile"
    },
    {
        "id": "MobileSecurityTest",
        "name": "移动安全测试",
        "description": "移动应用安全测试",
        "platforms": ["android", "ios"],
        "category": "mobile"
    },
    {
        "id": "MobileNetworkTest",
        "name": "移动网络测试",
        "description": "移动网络功能测试",
        "platforms": ["android", "ios"],
        "category": "mobile"
    },
    {
        "id": "MobileBatteryTest",
        "name": "移动电池测试",
        "description": "移动设备电池消耗测试",
        "platforms": ["android", "ios"],
        "category": "mobile"
    },
    {
        "id": "MobileStorageTest",
        "name": "移动存储测试",
        "description": "移动设备存储使用测试",
        "platforms": ["android", "ios"],
        "category": "mobile"
    },
    # Web：覆盖所有主流浏览器与自动化工具，支持"测试所有 web"
    {
        "id": "WebChrome",
        "name": "Chrome/Chromium",
        "description": "Chrome/Chromium 浏览器测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "WebFirefox",
        "name": "Firefox",
        "description": "Firefox 浏览器测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "WebSafari",
        "name": "Safari",
        "description": "Safari 浏览器测试（Mac）",
        "platforms": ["web", "mac"],
        "category": "web"
    },
    {
        "id": "WebEdge",
        "name": "Microsoft Edge",
        "description": "Edge 浏览器测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "Playwright",
        "name": "Playwright",
        "description": "Playwright 多浏览器自动化",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "Selenium",
        "name": "Selenium WebDriver",
        "description": "Selenium 浏览器自动化",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "Cypress",
        "name": "Cypress",
        "description": "Cypress E2E 测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "WebHeadless",
        "name": "无头浏览器",
        "description": "Headless Chrome/Firefox 等",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "APITest",
        "name": "接口测试",
        "description": "内置接口测试（Method/Headers/Body/断言），无需 Agent",
        "platforms": ["web"],
        "category": "web"
    },
    {
        "id": "APIFlow",
        "name": "接口流程",
        "description": "内置多步骤接口链 + 变量提取，无需 Agent",
        "platforms": ["web"],
        "category": "web"
    },
    {
        "id": "LoadSmoke",
        "name": "性能冒烟",
        "description": "内置并发压测（p95 延迟断言），无需 Agent",
        "platforms": ["web"],
        "category": "web"
    },
    {
        "id": "GamePerf",
        "name": "游戏性能测试",
        "description": "帧率/卡顿率/内存（Android dumpsys，PerfDog 思路），需 Agent",
        "platforms": ["android"],
        "category": "web"
    },
    {
        "id": "PortCheck",
        "name": "端口检查",
        "description": "内置 TCP 端口连通性检查（登录服/网关监控），无需 Agent",
        "platforms": ["web"],
        "category": "web"
    },
    {
        "id": "CertCheck",
        "name": "证书检查",
        "description": "内置 TLS 证书到期检查（天数阈值断言），无需 Agent",
        "platforms": ["web"],
        "category": "web"
    },
    {
        "id": "DnsCheck",
        "name": "DNS 检查",
        "description": "内置域名解析检查（期望 IP 命中），无需 Agent",
        "platforms": ["web"],
        "category": "web"
    },
    {
        "id": "WebCheck",
        "name": "网站/接口检查",
        "description": "内置 HTTP 可用性检查（状态码/关键词/延迟），无需 Agent",
        "platforms": ["web"],
        "category": "web"
    },
    {
        "id": "WebPerformance",
        "name": "Web 性能测试",
        "description": "Web 应用性能测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "WebAccessibility",
        "name": "Web 无障碍测试",
        "description": "Web 应用无障碍测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "WebSecurityTest",
        "name": "Web 安全测试",
        "description": "Web 应用安全测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "WebCompatibilityTest",
        "name": "Web 兼容性测试",
        "description": "Web 应用兼容性测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "WebLocalizationTest",
        "name": "Web 本地化测试",
        "description": "Web 应用本地化测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    {
        "id": "WebPWA",
        "name": "Web PWA 测试",
        "description": "PWA 应用测试",
        "platforms": ["web", "windows", "mac", "linux"],
        "category": "web"
    },
    # AI：视觉大模型驱动的探索式测试
    {
        "id": "AIAgent",
        "name": "AI 探索测试",
        "description": "视觉大模型驱动设备自动探索（截图→决策→操作循环）",
        "platforms": ["android", "windows"],
        "category": "ai"
    },
    # DevOps
    {
        "id": "CIIntegration",
        "name": "CI 集成",
        "description": "与 CI/CD 系统集成",
        "platforms": ["windows", "mac", "linux"],
        "category": "devops"
    },
    {
        "id": "TestReporting",
        "name": "测试报告",
        "description": "生成详细测试报告",
        "platforms": ["windows", "mac", "linux"],
        "category": "devops"
    },
    {
        "id": "TestCoverage",
        "name": "测试覆盖率",
        "description": "代码测试覆盖率分析",
        "platforms": ["windows", "mac", "linux"],
        "category": "devops"
    },
    {
        "id": "TestAutomation",
        "name": "测试自动化",
        "description": "自动化测试流程管理",
        "platforms": ["windows", "mac", "linux"],
        "category": "devops"
    },
    {
        "id": "TestEnvironment",
        "name": "测试环境管理",
        "description": "测试环境配置与管理",
        "platforms": ["windows", "mac", "linux"],
        "category": "devops"
    },
    {
        "id": "TestDataManagement",
        "name": "测试数据管理",
        "description": "测试数据的准备与管理",
        "platforms": ["windows", "mac", "linux"],
        "category": "devops"
    },
    {
        "id": "TestMonitoring",
        "name": "测试监控",
        "description": "测试过程监控与分析",
        "platforms": ["windows", "mac", "linux"],
        "category": "devops"
    },
]


def get_all_skills() -> List[Dict[str, Any]]:
    """获取所有支持的技能"""
    return DEFAULT_SKILLS


def get_skills_by_category(category: str) -> List[Dict[str, Any]]:
    """按类别获取技能"""
    return [skill for skill in DEFAULT_SKILLS
            if skill.get("category") == category]


def get_skill_by_id(skill_id: str) -> Optional[Dict[str, Any]]:
    """通过 ID 获取技能"""
    return next(
        (skill for skill in DEFAULT_SKILLS if skill.get("id") == skill_id),
        None
    )


def get_skills_by_platform(platform: str) -> List[Dict[str, Any]]:
    """按平台获取技能"""
    return [skill for skill in DEFAULT_SKILLS
            if platform in skill.get("platforms", [])]


def validate_skills(skill_ids: List[str]) -> List[Dict[str, Any]]:
    """验证技能列表是否有效"""
    return [skill for skill in DEFAULT_SKILLS if skill.get("id") in skill_ids]
