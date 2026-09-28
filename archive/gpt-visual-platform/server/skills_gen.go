// Code generated from legacy/modules/skills.py (DEFAULT_SKILLS)。请勿手改；改动需同步 Python 侧。
package main

// Skill 平台支持的集成测试能力（Agent 声明、任务可指定 required_skills）
type Skill struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Platforms   []string `json:"platforms"`
}

// skills 与 Python 版 legacy/modules/skills.py 的 DEFAULT_SKILLS 完全一致
var skills = []Skill{
	{ID: "PlayMode", Name: "Unity PlayMode", Description: "Play Mode 测试", Category: "unity", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "EditMode", Name: "Unity EditMode", Description: "Edit Mode 测试", Category: "unity", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "AltTester", Name: "AltTester UI", Description: "UI 自动化（AltTester）", Category: "unity", Platforms: []string{"windows", "mac", "android", "ios"}},
	{ID: "GPTTestGen", Name: "GPT 生成测试", Description: "根据自然语言生成 Unity 测试用例并执行", Category: "unity", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "UnityMCP", Name: "Unity MCP", Description: "通过 Model Context Protocol 与 Unity 编辑器交互", Category: "unity", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "UnityAutomatedQA", Name: "Unity Automated QA", Description: "Unity 官方自动化测试工具", Category: "unity", Platforms: []string{"windows", "mac", "linux", "android", "ios"}},
	{ID: "UnityPerformanceTest", Name: "Unity 性能测试", Description: "Unity 性能测试工具", Category: "unity", Platforms: []string{"windows", "mac", "linux", "android", "ios"}},
	{ID: "UnityTestFrameworkExt", Name: "UTF 扩展", Description: "Unity Test Framework 扩展", Category: "unity", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "UnityNetworkTest", Name: "Unity 网络测试", Description: "Unity 网络功能测试", Category: "unity", Platforms: []string{"windows", "mac", "linux", "android", "ios"}},
	{ID: "UnityVRTest", Name: "Unity VR 测试", Description: "Unity VR 功能测试", Category: "unity", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "UnityARTest", Name: "Unity AR 测试", Description: "Unity AR 功能测试", Category: "unity", Platforms: []string{"windows", "mac", "linux", "android", "ios"}},
	{ID: "UnityUIAnimationTest", Name: "Unity UI 动画测试", Description: "Unity UI 动画效果测试", Category: "unity", Platforms: []string{"windows", "mac", "linux", "android", "ios"}},
	{ID: "UnityAssetBundleTest", Name: "Unity AssetBundle 测试", Description: "Unity AssetBundle 功能测试", Category: "unity", Platforms: []string{"windows", "mac", "linux", "android", "ios"}},
	{ID: "ADB", Name: "ADB", Description: "Android 设备/模拟器", Category: "mobile", Platforms: []string{"android"}},
	{ID: "XCUITest", Name: "XCUITest", Description: "iOS 模拟器/真机", Category: "mobile", Platforms: []string{"ios"}},
	{ID: "Appium", Name: "Appium", Description: "跨平台移动应用测试", Category: "mobile", Platforms: []string{"android", "ios", "windows", "mac", "linux"}},
	{ID: "Airtest", Name: "Airtest", Description: "Airtest 图像识别自动化，可运行 .air 脚本（Android/Windows）", Category: "mobile", Platforms: []string{"android", "windows"}},
	{ID: "Poco", Name: "Poco 控件", Description: "Poco 控件级自动化（需游戏集成 Poco-SDK，可配合 Airtest 脚本）", Category: "mobile", Platforms: []string{"android", "windows"}},
	{ID: "MobilePerformance", Name: "移动性能测试", Description: "移动设备性能测试", Category: "mobile", Platforms: []string{"android", "ios"}},
	{ID: "MobileSecurityTest", Name: "移动安全测试", Description: "移动应用安全测试", Category: "mobile", Platforms: []string{"android", "ios"}},
	{ID: "MobileNetworkTest", Name: "移动网络测试", Description: "移动网络功能测试", Category: "mobile", Platforms: []string{"android", "ios"}},
	{ID: "MobileBatteryTest", Name: "移动电池测试", Description: "移动设备电池消耗测试", Category: "mobile", Platforms: []string{"android", "ios"}},
	{ID: "MobileStorageTest", Name: "移动存储测试", Description: "移动设备存储使用测试", Category: "mobile", Platforms: []string{"android", "ios"}},
	{ID: "WebChrome", Name: "Chrome/Chromium", Description: "Chrome/Chromium 浏览器测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "WebFirefox", Name: "Firefox", Description: "Firefox 浏览器测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "WebSafari", Name: "Safari", Description: "Safari 浏览器测试（Mac）", Category: "web", Platforms: []string{"web", "mac"}},
	{ID: "WebEdge", Name: "Microsoft Edge", Description: "Edge 浏览器测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "Playwright", Name: "Playwright", Description: "Playwright 多浏览器自动化", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "Selenium", Name: "Selenium WebDriver", Description: "Selenium 浏览器自动化", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "Cypress", Name: "Cypress", Description: "Cypress E2E 测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "WebHeadless", Name: "无头浏览器", Description: "Headless Chrome/Firefox 等", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "APITest", Name: "接口测试", Description: "内置接口测试（Method/Headers/Body/断言），无需 Agent", Category: "web", Platforms: []string{"web"}},
	{ID: "APIFlow", Name: "接口流程", Description: "内置多步骤接口链 + 变量提取，无需 Agent", Category: "web", Platforms: []string{"web"}},
	{ID: "LoadSmoke", Name: "性能冒烟", Description: "内置并发压测（p95 延迟断言），无需 Agent", Category: "web", Platforms: []string{"web"}},
	{ID: "GamePerf", Name: "游戏性能测试", Description: "帧率/卡顿率/内存（Android dumpsys，PerfDog 思路），需 Agent", Category: "web", Platforms: []string{"android"}},
	{ID: "PortCheck", Name: "端口检查", Description: "内置 TCP 端口连通性检查（登录服/网关监控），无需 Agent", Category: "web", Platforms: []string{"web"}},
	{ID: "CertCheck", Name: "证书检查", Description: "内置 TLS 证书到期检查（天数阈值断言），无需 Agent", Category: "web", Platforms: []string{"web"}},
	{ID: "DnsCheck", Name: "DNS 检查", Description: "内置域名解析检查（期望 IP 命中），无需 Agent", Category: "web", Platforms: []string{"web"}},
	{ID: "WebCheck", Name: "网站/接口检查", Description: "内置 HTTP 可用性检查（状态码/关键词/延迟），无需 Agent", Category: "web", Platforms: []string{"web"}},
	{ID: "WebPerformance", Name: "Web 性能测试", Description: "Web 应用性能测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "WebAccessibility", Name: "Web 无障碍测试", Description: "Web 应用无障碍测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "WebSecurityTest", Name: "Web 安全测试", Description: "Web 应用安全测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "WebCompatibilityTest", Name: "Web 兼容性测试", Description: "Web 应用兼容性测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "WebLocalizationTest", Name: "Web 本地化测试", Description: "Web 应用本地化测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "WebPWA", Name: "Web PWA 测试", Description: "PWA 应用测试", Category: "web", Platforms: []string{"web", "windows", "mac", "linux"}},
	{ID: "AIAgent", Name: "AI 探索测试", Description: "视觉大模型驱动设备自动探索（截图→决策→操作循环）", Category: "ai", Platforms: []string{"android", "windows"}},
	{ID: "CIIntegration", Name: "CI 集成", Description: "与 CI/CD 系统集成", Category: "devops", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "TestReporting", Name: "测试报告", Description: "生成详细测试报告", Category: "devops", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "TestCoverage", Name: "测试覆盖率", Description: "代码测试覆盖率分析", Category: "devops", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "TestAutomation", Name: "测试自动化", Description: "自动化测试流程管理", Category: "devops", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "TestEnvironment", Name: "测试环境管理", Description: "测试环境配置与管理", Category: "devops", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "TestDataManagement", Name: "测试数据管理", Description: "测试数据的准备与管理", Category: "devops", Platforms: []string{"windows", "mac", "linux"}},
	{ID: "TestMonitoring", Name: "测试监控", Description: "测试过程监控与分析", Category: "devops", Platforms: []string{"windows", "mac", "linux"}},
}
