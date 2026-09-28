// API 端点功能测试（与 tests/test_api.py 对应）+ 并发安全 + MCP 代理
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("初始化存储失败: %v", err)
	}
	return httptest.NewServer(NewServer(store, "../static"))
}

func postJSON(t *testing.T, url string, body any) (int, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	resp, err := http.Post(url, "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("POST %s 失败: %v", url, err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func getJSON(t *testing.T, url string) (int, map[string]any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s 失败: %v", url, err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

// newMCPStub 假 Unity MCP 上游：回显收到的路径与请求体。
func newMCPStub(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body == nil {
			body = map[string]any{}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"path": r.URL.Path, "received": body})
	}))
}

func TestHealthAndVersion(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	status, data := getJSON(t, ts.URL+"/api/health")
	if status != 200 || data["ok"] != true {
		t.Fatalf("health 异常: %d %v", status, data)
	}
	if _, ok := data["version"]; !ok {
		t.Fatalf("health 应包含 version: %v", data)
	}
	status, data = getJSON(t, ts.URL+"/api/version")
	if status != 200 || data["version"] == nil {
		t.Fatalf("version 异常: %d %v", status, data)
	}
}

func TestListSkills(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	status, data := getJSON(t, ts.URL+"/api/skills")
	if status != 200 {
		t.Fatalf("状态码 %d", status)
	}
	items := data["items"].([]any)
	total := int(data["total"].(float64))
	if total != len(items) || total != len(skills) {
		t.Fatalf("技能数量不一致: total=%d items=%d skills=%d", total, len(items), len(skills))
	}
	ids := map[string]bool{}
	for _, it := range items {
		ids[it.(map[string]any)["id"].(string)] = true
	}
	for _, want := range []string{"PlayMode", "Airtest", "Poco", "AIAgent"} {
		if !ids[want] {
			t.Fatalf("缺少技能 %s", want)
		}
	}
}

func TestAgentLifecycle(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	// 未注册 Agent 心跳 → 404
	status, _ := postJSON(t, ts.URL+"/api/agents/heartbeat", map[string]any{"agent_id": "ghost", "status": "idle"})
	if status != 404 {
		t.Fatalf("未注册心跳应 404，得到 %d", status)
	}

	status, data := postJSON(t, ts.URL+"/api/agents/register", map[string]any{
		"agent_id": "test-agent-1", "platform": "mac", "skills": []string{"PlayMode", "EditMode"},
	})
	if status != 200 || data["ok"] != true || data["agent_id"] != "test-agent-1" {
		t.Fatalf("注册失败: %d %v", status, data)
	}

	status, _ = postJSON(t, ts.URL+"/api/agents/heartbeat", map[string]any{"agent_id": "test-agent-1", "status": "idle"})
	if status != 200 {
		t.Fatalf("心跳失败: %d", status)
	}

	status, data = getJSON(t, ts.URL+"/api/agents")
	if status != 200 || int(data["total"].(float64)) != 1 {
		t.Fatalf("Agent 列表异常: %d %v", status, data)
	}
}

func TestJobLifecycle(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	// 注册具备 PlayMode 技能的 mac Agent
	postJSON(t, ts.URL+"/api/agents/register", map[string]any{"agent_id": "a1", "platform": "mac", "skills": []string{"PlayMode"}})

	// 创建任务
	status, data := postJSON(t, ts.URL+"/api/jobs", map[string]any{
		"platform": "mac", "required_skills": []string{"PlayMode"},
		"unity_project_path": "/path/to/project", "test_filter": "test*",
	})
	if status != 200 || data["ok"] != true {
		t.Fatalf("创建任务失败: %d %v", status, data)
	}
	jid := int(data["job_id"].(float64))

	// 任务列表
	_, data = getJSON(t, ts.URL+"/api/jobs")
	if int(data["total"].(float64)) != 1 {
		t.Fatalf("任务列表应为 1 条: %v", data)
	}

	// Agent 拉取
	_, data = getJSON(t, fmt.Sprintf("%s/api/jobs/poll/mac?skills=PlayMode", ts.URL))
	job := data["job"].(map[string]any)
	if int(job["job_id"].(float64)) != jid || job["status"] != "running" {
		t.Fatalf("拉取任务异常: %v", job)
	}

	// 上报成功结果
	logPath := "/tmp/test.log"
	status, _ = postJSON(t, ts.URL+"/api/jobs/result", map[string]any{
		"job_id": jid, "agent_id": "a1", "success": true, "log_path": logPath,
		"summary": map[string]any{"message": "placeholder run"},
	})
	if status != 200 {
		t.Fatalf("上报结果失败: %d", status)
	}

	// 任务详情：passed + result
	status, job = getJSON(t, fmt.Sprintf("%s/api/jobs/%d", ts.URL, jid))
	if status != 200 || job["status"] != "passed" {
		t.Fatalf("任务应为 passed: %d %v", status, job["status"])
	}
	result := job["result"].(map[string]any)
	if result["agent_id"] != "a1" || result["success"] != true || result["log_path"] != logPath {
		t.Fatalf("result 字段异常: %v", result)
	}
}

func TestPollSkillFiltering(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	postJSON(t, ts.URL+"/api/jobs", map[string]any{"platform": "mac", "required_skills": []string{"EditMode"}})

	// 技能不匹配 → 无任务
	_, data := getJSON(t, ts.URL+"/api/jobs/poll/mac?skills=PlayMode")
	if data["job"] != nil {
		t.Fatalf("技能不匹配不应派发任务: %v", data["job"])
	}
	// 匹配 → 派发
	_, data = getJSON(t, ts.URL+"/api/jobs/poll/mac?skills=PlayMode,EditMode")
	if data["job"] == nil {
		t.Fatalf("技能匹配应派发任务: %v", data)
	}
}

func TestPollWithoutSkillsGetsAnyJob(t *testing.T) {
	// Python 版行为：required_skills 非空但 Agent 未声明技能时仍可拉取
	ts := newTestServer(t)
	defer ts.Close()

	postJSON(t, ts.URL+"/api/jobs", map[string]any{"platform": "mac", "required_skills": []string{"PlayMode"}})
	_, data := getJSON(t, ts.URL+"/api/jobs/poll/mac")
	if data["job"] == nil {
		t.Fatalf("无技能 Agent 应能拉取任务（与 Python 版一致）: %v", data)
	}
}

func TestJobResultNotFound(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	// 未注册 Agent 上报 → 403（防匿名伪造结果）
	status, _ := postJSON(t, ts.URL+"/api/jobs/result", map[string]any{"job_id": 999, "agent_id": "x", "success": true})
	if status != 403 {
		t.Fatalf("未注册 Agent 上报应 403，得到 %d", status)
	}
	// 已注册 Agent 上报未知任务 → 404
	postJSON(t, ts.URL+"/api/agents/register", map[string]any{"agent_id": "known", "platform": "mac"})
	status, _ = postJSON(t, ts.URL+"/api/jobs/result", map[string]any{"job_id": 999, "agent_id": "known", "success": true})
	if status != 404 {
		t.Fatalf("未知任务应 404，得到 %d", status)
	}
}

func TestTokenAuth(t *testing.T) {
	t.Setenv("PLATFORM_TOKEN", "secret-token")
	ts := newTestServer(t)
	defer ts.Close()

	// 无 token → 401
	status, _ := getJSON(t, ts.URL+"/api/skills")
	if status != 401 {
		t.Fatalf("无 token 应 401，得到 %d", status)
	}
	// 错误 token → 401
	req, _ := http.NewRequest("GET", ts.URL+"/api/jobs", nil)
	req.Header.Set("X-Platform-Token", "wrong")
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("错误 token 应 401，得到 %d", resp.StatusCode)
	}
	// 健康与版本端点保持公开（探活无需凭据）
	status, _ = getJSON(t, ts.URL+"/api/health")
	if status != 200 {
		t.Fatalf("health 应公开: %d", status)
	}
	// 正确 token → 放行
	req, _ = http.NewRequest("GET", ts.URL+"/api/skills", nil)
	req.Header.Set("X-Platform-Token", "secret-token")
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("正确 token 应放行，得到 %d", resp2.StatusCode)
	}
	// 看板不走 token
	status, _ = getJSON(t, ts.URL+"/")
	if status != 200 {
		t.Fatalf("看板应公开: %d", status)
	}
}

func TestContentTypeEnforced(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	// text/plain 简单请求（CSRF 向量）→ 415
	resp, err := http.Post(ts.URL+"/api/jobs", "text/plain", bytes.NewReader([]byte(`{"platform":"mac"}`)))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("text/plain 应 415，得到 %d", resp.StatusCode)
	}
}

func TestMCPToolNameValidated(t *testing.T) {
	stub := newMCPStub(t)
	defer stub.Close()
	t.Setenv("MCP_SERVER_URL", stub.URL)

	ts := newTestServer(t)
	defer ts.Close()
	// 路径穿越注入 → 400
	status, _ := postJSON(t, ts.URL+"/api/mcp/execute-tool", map[string]any{"tool_name": "../../resources/project_info"})
	if status != 400 {
		t.Fatalf("tool_name 路径穿越应 400，得到 %d", status)
	}
	status, _ = postJSON(t, ts.URL+"/api/mcp/execute-tool", map[string]any{"tool_name": "run?cmd=x"})
	if status != 400 {
		t.Fatalf("tool_name 查询注入应 400，得到 %d", status)
	}
	// 合法名称 → 放行
	status, _ = postJSON(t, ts.URL+"/api/mcp/execute-tool", map[string]any{"tool_name": "run_tests", "tool_params": map[string]any{}})
	if status != 200 {
		t.Fatalf("合法 tool_name 应放行: %d", status)
	}
}

func TestGenerateTestWithoutKey(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")
	ts := newTestServer(t)
	defer ts.Close()
	status, data := postJSON(t, ts.URL+"/api/generate-test", map[string]any{"prompt": "主界面点击设置应打开设置面板"})
	if status != 200 {
		t.Fatalf("状态码 %d", status)
	}
	// 与 Python 版一致：code/error 为空时是 null 而不是空字符串
	if data["code"] != nil {
		t.Fatalf("未配置 key 时 code 应为 null: %v", data)
	}
	if data["error"] == nil || data["error"] == "" {
		t.Fatalf("未配置 key 时应返回非空 error: %v", data)
	}
}

func TestGenerateTestWithStub(t *testing.T) {
	// 假 OpenAI 上游：验证 generate-test 全链路与 code/error 的 null 约定
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := "{\"choices\":[{\"message\":{\"content\":\"```csharp\\npublic class Generated_LoginTest { [Test] public void T() {} }\\n```\"}}]}"
		_, _ = w.Write([]byte(resp))
	}))
	defer stub.Close()
	t.Setenv("OPENAI_API_KEY", "sk-test")
	t.Setenv("OPENAI_BASE_URL", stub.URL)

	ts := newTestServer(t)
	defer ts.Close()
	status, data := postJSON(t, ts.URL+"/api/generate-test", map[string]any{"prompt": "登录测试"})
	if status != 200 {
		t.Fatalf("状态码 %d", status)
	}
	code, _ := data["code"].(string)
	if code == "" {
		t.Fatalf("应有生成代码: %v", data)
	}
	if want := "public class Generated_LoginTest"; !contains(code, want) {
		t.Fatalf("围栏应被剥离: %q", code)
	}
	if data["error"] != nil {
		t.Fatalf("成功时 error 应为 null: %v", data)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestIndexPage(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	index := filepath.Join("..", "static", "index.html")
	if _, statErr := os.Stat(index); statErr == nil {
		if resp.StatusCode != 200 {
			t.Fatalf("看板应 200，得到 %d", resp.StatusCode)
		}
	} else if resp.StatusCode != 404 {
		t.Fatalf("无 index.html 应 404，得到 %d", resp.StatusCode)
	}
}

func TestStoreFileFormatCompat(t *testing.T) {
	// 验证与 Python 版写出的文件格式互相兼容：读旧文件 + 写出可被解析
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "jobs.json"), []byte(`[{"job_id": 49, "platform": "mac", "status": "passed", "extra": {}, "result": null}]`), 0o644)
	os.WriteFile(filepath.Join(dir, "job_id.txt"), []byte("49"), 0o644)

	store, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := store.NextJobID(); got != 50 {
		t.Fatalf("应从旧计数续增，得到 %d", got)
	}
	jobJSON, err := store.FindJobJSON(49)
	if err != nil || jobJSON == nil {
		t.Fatalf("应能读到旧任务: %v %v", jobJSON, err)
	}
	var job map[string]any
	if err := json.Unmarshal(jobJSON, &job); err != nil || job["platform"] != "mac" {
		t.Fatalf("旧任务内容异常: %s", jobJSON)
	}
}

// TestConcurrentAccess 并发读写混合：在 -race 下验证锁内序列化改造无数据竞争。
// 运行：go test -race ./...
func TestConcurrentAccess(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	postJSON(t, ts.URL+"/api/agents/register", map[string]any{"agent_id": "c1", "platform": "mac", "skills": []string{"PlayMode"}})

	var wg sync.WaitGroup
	for i := 1; i <= 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			postJSON(t, ts.URL+"/api/jobs", map[string]any{"platform": "mac", "required_skills": []string{"PlayMode"}})
			getJSON(t, ts.URL+"/api/jobs")                          // 锁外 Marshal 列表
			getJSON(t, ts.URL+"/api/agents")                        // 与心跳并发
			getJSON(t, ts.URL+"/api/jobs/poll/mac?skills=PlayMode") // 与结果上报并发写同一任务
			postJSON(t, ts.URL+"/api/agents/heartbeat", map[string]any{"agent_id": "c1", "status": "running"})
			postJSON(t, ts.URL+"/api/jobs/result", map[string]any{
				"job_id": n, "agent_id": "c1", "success": n%2 == 0,
				"summary": map[string]any{"n": n},
			})
			getJSON(t, fmt.Sprintf("%s/api/jobs/%d", ts.URL, n))
		}(i)
	}
	wg.Wait()
}

// TestMCPProxy 用假上游覆盖 MCP 代理端点（此前零覆盖）。
func TestMCPProxy(t *testing.T) {
	stub := newMCPStub(t)
	defer stub.Close()
	t.Setenv("MCP_SERVER_URL", stub.URL)

	ts := newTestServer(t)
	defer ts.Close()

	// execute-tool：缺 tool_params 应补空对象（Python 版行为）
	status, data := postJSON(t, ts.URL+"/api/mcp/execute-tool", map[string]any{"tool_name": "run_tests"})
	if status != 200 {
		t.Fatalf("execute-tool 状态码 %d: %v", status, data)
	}
	if data["path"] != "/tools/run_tests" {
		t.Fatalf("上游路径错误: %v", data)
	}
	received := data["received"].(map[string]any)
	if len(received) != 0 {
		t.Fatalf("缺 tool_params 应发空对象: %v", received)
	}

	// batch-execute：缺 tools 键按空列表执行（Python 版行为）
	status, data = postJSON(t, ts.URL+"/api/mcp/batch-execute", map[string]any{})
	if status != 200 {
		t.Fatalf("batch-execute 缺键应放行: %d %v", status, data)
	}
	// tools 非列表 → 400
	status, _ = postJSON(t, ts.URL+"/api/mcp/batch-execute", map[string]any{"tools": "abc"})
	if status != 400 {
		t.Fatalf("tools 非列表应 400: %d", status)
	}

	// manage-scene：缺 action/scene_path → 400
	status, _ = postJSON(t, ts.URL+"/api/mcp/manage-scene", map[string]any{"action": "open"})
	if status != 400 {
		t.Fatalf("manage-scene 缺 scene_path 应 400: %d", status)
	}
	status, data = postJSON(t, ts.URL+"/api/mcp/manage-scene", map[string]any{"action": "open", "scene_path": "Assets/Scenes/Main.unity"})
	if status != 200 || data["path"] != "/tools/manage_scene" {
		t.Fatalf("manage-scene 异常: %d %v", status, data)
	}

	// set-active-instance / execute-menu-item 缺参数 → 400
	status, _ = postJSON(t, ts.URL+"/api/mcp/set-active-instance", map[string]any{})
	if status != 400 {
		t.Fatalf("set-active-instance 缺参数应 400: %d", status)
	}
	status, _ = postJSON(t, ts.URL+"/api/mcp/execute-menu-item", map[string]any{})
	if status != 400 {
		t.Fatalf("execute-menu-item 缺参数应 400: %d", status)
	}

	// status 端点：恒返回 instances 键
	status, data = getJSON(t, ts.URL+"/api/mcp/status")
	if status != 200 {
		t.Fatalf("mcp status %d", status)
	}
	if _, ok := data["instances"]; !ok {
		t.Fatalf("mcp/status 应恒包含 instances 键: %v", data)
	}

	// project-info / scene-info
	status, _ = getJSON(t, ts.URL+"/api/mcp/project-info")
	if status != 200 {
		t.Fatalf("project-info %d", status)
	}
	status, _ = getJSON(t, ts.URL+"/api/mcp/scene-info")
	if status != 200 {
		t.Fatalf("scene-info %d", status)
	}
}

func TestRequestBodyTooLarge(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	big := bytes.Repeat([]byte("a"), 2<<20)
	body := append(append([]byte(`{"agent_id": "`), big...), []byte(`"}`)...)
	resp, err := http.Post(ts.URL+"/api/agents/register", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("超大请求体应 413，得到 %d", resp.StatusCode)
	}
}

func TestCancelAndDeleteJob(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	// ios 平台无 Agent，任务保持 pending
	_, data := postJSON(t, ts.URL+"/api/jobs", map[string]any{"platform": "ios"})
	jid := int(data["job_id"].(float64))

	// 取消
	var status int
	status, data = postJSON(t, ts.URL+fmt.Sprintf("/api/jobs/%d/cancel", jid), map[string]any{})
	if status != 200 || data["status"] != "cancelled" {
		t.Fatalf("取消失败: %d %v", status, data)
	}
	_, job := getJSON(t, fmt.Sprintf("%s/api/jobs/%d", ts.URL, jid))
	if job["status"] != "cancelled" {
		t.Fatalf("状态应为 cancelled: %v", job["status"])
	}

	// 已通过/失败不可取消：先造一个 passed（注册 agent 上报）
	postJSON(t, ts.URL+"/api/agents/register", map[string]any{"agent_id": "a9", "platform": "mac"})
	_, data = postJSON(t, ts.URL+"/api/jobs", map[string]any{"platform": "mac"})
	jid2 := int(data["job_id"].(float64))
	postJSON(t, ts.URL+"/api/jobs/result", map[string]any{"job_id": jid2, "agent_id": "a9", "success": true})
	status, _ = postJSON(t, ts.URL+fmt.Sprintf("/api/jobs/%d/cancel", jid2), map[string]any{})
	if status != 409 {
		t.Fatalf("终态任务取消应 409，得到 %d", status)
	}

	// 已取消任务的结果上报被静默接受、状态不覆盖
	status, _ = postJSON(t, ts.URL+"/api/jobs/result", map[string]any{"job_id": jid, "agent_id": "a9", "success": true})
	if status != 200 {
		t.Fatalf("已取消任务上报应 200（幂等）: %d", status)
	}
	_, job = getJSON(t, fmt.Sprintf("%s/api/jobs/%d", ts.URL, jid))
	if job["status"] != "cancelled" {
		t.Fatalf("已取消任务状态不应被覆盖: %v", job["status"])
	}

	// 删除
	status, _ = postJSON(t, ts.URL+fmt.Sprintf("/api/jobs/%d/delete", jid), map[string]any{})
	_ = status // DELETE 方法走 http.Delete
	req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/api/jobs/%d", ts.URL, jid), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("删除应 200，得到 %d", resp.StatusCode)
	}
	status, _ = getJSON(t, fmt.Sprintf("%s/api/jobs/%d", ts.URL, jid))
	if status != 404 {
		t.Fatalf("删除后应 404，得到 %d", status)
	}
}

func TestJobArtifacts(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	postJSON(t, ts.URL+"/api/agents/register", map[string]any{"agent_id": "art-agent", "platform": "android"})
	_, data := postJSON(t, ts.URL+"/api/jobs", map[string]any{"platform": "android"})
	jid := int(data["job_id"].(float64))

	// 未注册 Agent 上传 → 403
	status, _ := postJSON(t, ts.URL+"/api/jobs/artifacts", map[string]any{
		"job_id":   jid,
		"agent_id": "ghost", "files": []map[string]any{{"name": "steps.json", "content": "{}"}},
	})
	if status != 403 {
		t.Fatalf("未注册上传应 403: %d", status)
	}

	// 正常上传两个文件
	status, data = postJSON(t, ts.URL+"/api/jobs/artifacts", map[string]any{
		"job_id":   jid,
		"agent_id": "art-agent",
		"files": []map[string]any{
			{"name": "steps.json", "content": `{"steps":[1,2]}`},
			{"name": "airtest_stdout.log", "content": "step 1 ok\nstep 2 ok"},
		},
	})
	if status != 200 || int(data["stored"].(float64)) != 2 {
		t.Fatalf("上传失败: %d %v", status, data)
	}

	// 列表
	status, data = getJSON(t, fmt.Sprintf("%s/api/jobs/artifacts?job_id=%d", ts.URL, jid))
	files := data["files"].([]any)
	if status != 200 || len(files) != 2 {
		t.Fatalf("产物列表异常: %d %v", status, data)
	}

	// 读取内容（路径穿越名 → 404）
	resp, err := http.Get(fmt.Sprintf("%s/api/jobs/artifacts/steps.json?job_id=%d", ts.URL, jid))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !contains(string(body), `"steps"`) {
		t.Fatalf("产物内容异常: %d %s", resp.StatusCode, body)
	}
	resp, err = http.Get(fmt.Sprintf("%s/api/jobs/artifacts/..%%2f..%%2fagents.json?job_id=%d", ts.URL, jid))
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode == 200 {
			t.Fatalf("路径穿越应被拒绝")
		}
	}

	// 删除任务后产物随目录保留在磁盘（快照删除不影响 artifacts 目录断言略）
}
