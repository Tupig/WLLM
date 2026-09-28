// 内置执行器族测试：接口测试 / 关键字流程 / 性能冒烟 / 任务领取规则
package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestExecuteAPICheck(t *testing.T) {
	var gotMethod, gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotToken = r.Header.Get("X-Token")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	success, summary := executeAPICheck(map[string]any{
		"extra": map[string]any{
			"method":  "POST",
			"url":     srv.URL,
			"headers": "X-Token: abc\nContent-Type: application/json",
			"body":    `{"a":1}`,
			"keyword": `"ok"`,
		},
	})
	if gotMethod != "POST" || gotToken != "abc" {
		t.Fatalf("method/headers 未生效: %s %q", gotMethod, gotToken)
	}
	if !success {
		t.Fatalf("应通过: %v", summary)
	}
	checks := summary["checks"].(map[string]any)
	if checks["status_code"].(int) != 200 || checks["keyword_found"] != true {
		t.Fatalf("断言结果异常: %v", checks)
	}

	// 关键词不匹配 → 失败且给出原因
	success, summary = executeAPICheck(map[string]any{
		"extra": map[string]any{"url": srv.URL, "keyword": "不存在的词"},
	})
	if success {
		t.Fatalf("关键词不匹配应失败")
	}
	if msg, _ := summary["message"].(string); msg == "" {
		t.Fatalf("失败原因缺失")
	}
}

func TestExecuteAPIFlow(t *testing.T) {
	var gotToken atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login":
			_, _ = io.WriteString(w, `{"data":{"token":"T-123"}}`)
		case "/me":
			gotToken.Store(r.URL.Query().Get("token"))
			_, _ = io.WriteString(w, `{"name":"tester"}`)
		}
	}))
	defer srv.Close()

	steps := `[
		{"name":"登录","request":{"method":"POST","url":"` + srv.URL + `/login"},
		 "save":{"token":"data.token"}},
		{"name":"查资料","request":{"method":"GET","url":"` + srv.URL + `/me?token={{token}}"},
		 "expect":{"status":200,"keyword":"tester"}}
	]`
	success, summary := executeAPIFlow(map[string]any{
		"extra": map[string]any{"steps_json": steps, "insecure_tls": false},
	})
	if !success {
		t.Fatalf("流程应通过: %v", summary)
	}
	if got := gotToken.Load(); got != "T-123" {
		t.Fatalf("变量提取/替换失败: got %v", got)
	}
	if stepsOut, ok := summary["steps"].([]map[string]any); !ok || len(stepsOut) != 2 {
		t.Fatalf("应有两个步骤结果: %v", summary["steps"])
	}

	// 步骤失败 → fail-fast
	badSteps := `[
		{"name":"登录","request":{"method":"GET","url":"` + srv.URL + `/login"},"expect":{"status":404}},
		{"name":"不会执行","request":{"method":"GET","url":"` + srv.URL + `/me"}}
	]`
	success, summary = executeAPIFlow(map[string]any{
		"extra": map[string]any{"steps_json": badSteps},
	})
	if success {
		t.Fatalf("失败流程不应通过")
	}
	if stepsOut, ok := summary["steps"].([]map[string]any); !ok || len(stepsOut) != 1 {
		t.Fatalf("fail-fast 应只执行到失败步骤: %v", summary["steps"])
	} else if msg, _ := summary["message"].(string); msg == "" {
		t.Fatalf("失败原因缺失")
	}
}

func TestExecuteAPILoad(t *testing.T) {
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
	}))
	defer srv.Close()

	success, summary := executeAPILoad(map[string]any{
		"extra": map[string]any{"url": srv.URL, "total": 20, "concurrency": 4},
	})
	if !success {
		t.Fatalf("应全部成功: %v", summary)
	}
	if hits.Load() != 20 {
		t.Fatalf("应发出 20 个请求: %d", hits.Load())
	}
	if asInt := func(v any) int { i, _ := v.(int); return i }; asInt(summary["total"]) != 20 || asInt(summary["http_ok"]) != 20 || hits.Load() != 20 {
		t.Fatalf("统计异常: %v", summary)
	}

	// p95 断言：目标加 80ms 延迟，p95 上限设 1ms → 必然超限失败
	slowSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(80 * time.Millisecond)
	}))
	defer slowSrv.Close()
	success, summary = executeAPILoad(map[string]any{
		"extra": map[string]any{"url": slowSrv.URL, "total": 6, "concurrency": 2, "p95_ms": 1},
	})
	if success {
		t.Fatalf("p95 超限应失败: %v", summary)
	}
}

func TestClaimBuiltin(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mk := func(platform, jobType string) int {
		id := store.NextJobID()
		store.AppendJob(map[string]any{
			"job_id": id, "platform": platform, "status": "pending",
			"extra": map[string]any{"job_type": jobType}, "result": nil,
		})
		return id
	}
	idWeb := mk("web", "web_check")
	idAPI := mk("web", "api_check")
	idBasic := mk("web", "")
	idMac := mk("mac", "web_check")

	// 只领 web 平台的内置类型
	if j := store.ClaimBuiltin(); j == nil || jobIDOf(j) != idWeb {
		t.Fatalf("应先领取 web_check: %v", j)
	}
	if j := store.ClaimBuiltin(); j == nil || jobIDOf(j) != idAPI {
		t.Fatalf("应领取 api_check: %v", j)
	}
	if j := store.ClaimBuiltin(); j != nil {
		t.Fatalf("basic/mac 任务不应被内置执行器领取: %v", j)
	}
	_ = idBasic
	_ = idMac
}
