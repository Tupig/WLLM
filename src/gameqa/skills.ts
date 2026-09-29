/**
 * gameqa/skills.ts — 平台技能表（skills_gen.go / legacy modules/skills.py 同步生成）
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  platforms: string[];
}

export const SKILLS: Skill[] = [
  { id: "PlayMode", name: "Unity PlayMode", description: "Play Mode 测试", category: "unity", platforms: ["windows","mac","linux"] },
  { id: "EditMode", name: "Unity EditMode", description: "Edit Mode 测试", category: "unity", platforms: ["windows","mac","linux"] },
  { id: "AltTester", name: "AltTester UI", description: "UI 自动化（AltTester）", category: "unity", platforms: ["windows","mac","android","ios"] },
  { id: "GPTTestGen", name: "GPT 生成测试", description: "根据自然语言生成 Unity 测试用例并执行", category: "unity", platforms: ["windows","mac","linux"] },
  { id: "UnityMCP", name: "Unity MCP", description: "通过 Model Context Protocol 与 Unity 编辑器交互", category: "unity", platforms: ["windows","mac","linux"] },
  { id: "UnityAutomatedQA", name: "Unity Automated QA", description: "Unity 官方自动化测试工具", category: "unity", platforms: ["windows","mac","linux","android","ios"] },
  { id: "UnityPerformanceTest", name: "Unity 性能测试", description: "Unity 性能测试工具", category: "unity", platforms: ["windows","mac","linux","android","ios"] },
  { id: "UnityTestFrameworkExt", name: "UTF 扩展", description: "Unity Test Framework 扩展", category: "unity", platforms: ["windows","mac","linux"] },
  { id: "UnityNetworkTest", name: "Unity 网络测试", description: "Unity 网络功能测试", category: "unity", platforms: ["windows","mac","linux","android","ios"] },
  { id: "UnityVRTest", name: "Unity VR 测试", description: "Unity VR 功能测试", category: "unity", platforms: ["windows","mac","linux"] },
  { id: "UnityARTest", name: "Unity AR 测试", description: "Unity AR 功能测试", category: "unity", platforms: ["windows","mac","linux","android","ios"] },
  { id: "UnityUIAnimationTest", name: "Unity UI 动画测试", description: "Unity UI 动画效果测试", category: "unity", platforms: ["windows","mac","linux","android","ios"] },
  { id: "UnityAssetBundleTest", name: "Unity AssetBundle 测试", description: "Unity AssetBundle 功能测试", category: "unity", platforms: ["windows","mac","linux","android","ios"] },
  { id: "ADB", name: "ADB", description: "Android 设备/模拟器", category: "mobile", platforms: ["android"] },
  { id: "XCUITest", name: "XCUITest", description: "iOS 模拟器/真机", category: "mobile", platforms: ["ios"] },
  { id: "Appium", name: "Appium", description: "跨平台移动应用测试", category: "mobile", platforms: ["android","ios","windows","mac","linux"] },
  { id: "Airtest", name: "Airtest", description: "Airtest 图像识别自动化，可运行 .air 脚本（Android/Windows）", category: "mobile", platforms: ["android","windows"] },
  { id: "Poco", name: "Poco 控件", description: "Poco 控件级自动化（需游戏集成 Poco-SDK，可配合 Airtest 脚本）", category: "mobile", platforms: ["android","windows"] },
  { id: "MobilePerformance", name: "移动性能测试", description: "移动设备性能测试", category: "mobile", platforms: ["android","ios"] },
  { id: "MobileSecurityTest", name: "移动安全测试", description: "移动应用安全测试", category: "mobile", platforms: ["android","ios"] },
  { id: "MobileNetworkTest", name: "移动网络测试", description: "移动网络功能测试", category: "mobile", platforms: ["android","ios"] },
  { id: "MobileBatteryTest", name: "移动电池测试", description: "移动设备电池消耗测试", category: "mobile", platforms: ["android","ios"] },
  { id: "MobileStorageTest", name: "移动存储测试", description: "移动设备存储使用测试", category: "mobile", platforms: ["android","ios"] },
  { id: "WebChrome", name: "Chrome/Chromium", description: "Chrome/Chromium 浏览器测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "WebFirefox", name: "Firefox", description: "Firefox 浏览器测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "WebSafari", name: "Safari", description: "Safari 浏览器测试（Mac）", category: "web", platforms: ["web","mac"] },
  { id: "WebEdge", name: "Microsoft Edge", description: "Edge 浏览器测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "Playwright", name: "Playwright", description: "Playwright 多浏览器自动化", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "Selenium", name: "Selenium WebDriver", description: "Selenium 浏览器自动化", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "Cypress", name: "Cypress", description: "Cypress E2E 测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "WebHeadless", name: "无头浏览器", description: "Headless Chrome/Firefox 等", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "APITest", name: "接口测试", description: "内置接口测试（Method/Headers/Body/断言），无需 Agent", category: "web", platforms: ["web"] },
  { id: "APIFlow", name: "接口流程", description: "内置多步骤接口链 + 变量提取，无需 Agent", category: "web", platforms: ["web"] },
  { id: "LoadSmoke", name: "性能冒烟", description: "内置并发压测（p95 延迟断言），无需 Agent", category: "web", platforms: ["web"] },
  { id: "GamePerf", name: "游戏性能测试", description: "帧率/卡顿率/内存（Android dumpsys，PerfDog 思路），需 Agent", category: "web", platforms: ["android"] },
  { id: "PortCheck", name: "端口检查", description: "内置 TCP 端口连通性检查（登录服/网关监控），无需 Agent", category: "web", platforms: ["web"] },
  { id: "CertCheck", name: "证书检查", description: "内置 TLS 证书到期检查（天数阈值断言），无需 Agent", category: "web", platforms: ["web"] },
  { id: "DnsCheck", name: "DNS 检查", description: "内置域名解析检查（期望 IP 命中），无需 Agent", category: "web", platforms: ["web"] },
  { id: "WebCheck", name: "网站/接口检查", description: "内置 HTTP 可用性检查（状态码/关键词/延迟），无需 Agent", category: "web", platforms: ["web"] },
  { id: "WebPerformance", name: "Web 性能测试", description: "Web 应用性能测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "WebAccessibility", name: "Web 无障碍测试", description: "Web 应用无障碍测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "WebSecurityTest", name: "Web 安全测试", description: "Web 应用安全测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "WebCompatibilityTest", name: "Web 兼容性测试", description: "Web 应用兼容性测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "WebLocalizationTest", name: "Web 本地化测试", description: "Web 应用本地化测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "WebPWA", name: "Web PWA 测试", description: "PWA 应用测试", category: "web", platforms: ["web","windows","mac","linux"] },
  { id: "AIAgent", name: "AI 探索测试", description: "视觉大模型驱动设备自动探索（截图→决策→操作循环）", category: "ai", platforms: ["android","windows"] },
  { id: "CIIntegration", name: "CI 集成", description: "与 CI/CD 系统集成", category: "devops", platforms: ["windows","mac","linux"] },
  { id: "TestReporting", name: "测试报告", description: "生成详细测试报告", category: "devops", platforms: ["windows","mac","linux"] },
  { id: "TestCoverage", name: "测试覆盖率", description: "代码测试覆盖率分析", category: "devops", platforms: ["windows","mac","linux"] },
  { id: "TestAutomation", name: "测试自动化", description: "自动化测试流程管理", category: "devops", platforms: ["windows","mac","linux"] },
  { id: "TestEnvironment", name: "测试环境管理", description: "测试环境配置与管理", category: "devops", platforms: ["windows","mac","linux"] },
  { id: "TestDataManagement", name: "测试数据管理", description: "测试数据的准备与管理", category: "devops", platforms: ["windows","mac","linux"] },
  { id: "TestMonitoring", name: "测试监控", description: "测试过程监控与分析", category: "devops", platforms: ["windows","mac","linux"] },
];
