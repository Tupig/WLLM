// 内置测试执行器族（无需 Agent，服务端直接执行）——吸收主流开源测试工具的核心能力：
//   - api_check：接口测试（Method/Headers/Body/状态码/关键词/延迟断言）← MeterSphere / Postman
//   - api_load ：性能冒烟（并发 + 总请数 + p95 延迟断言）              ← k6（简化版）
//   - api_flow ：关键字流程（多步骤接口链 + JSON 提取 + {{变量}} 替换）← Robot Framework / Karate
//   - web_check：网站可用性检查（见 webcheck.go）                       ← Uptime Kuma
//   - repeat_minutes：任意内置任务可设定循环间隔，完成后自动创建下一次（监控模式）← Uptime Kuma
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// tlsConfigInsecure 跳过证书校验的传输层（仅用于任务显式指定 insecure_tls 的自签名目标）。
func tlsConfigInsecure() *http.Transport {
	return &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}} //nolint:gosec // 用户显式指定
}

// builtinTypes 内置执行器支持的任务类型（platform 固定为 web）。
var builtinTypes = map[string]bool{
	"web_check":  true,
	"api_check":  true,
	"api_load":   true,
	"api_flow":   true,
	"self_check": true,
	"port_check": true,
	"cert_check": true,
	"dns_check":  true,
}

// StartBuiltinWorker 启动内置执行器：周期领取 pending 的内置任务并执行。
// stale 为失联超时阈值（running 超过该时长的任务标记失败）。
func StartBuiltinWorker(store *Store, interval, stale time.Duration) (stop func()) {
	ctx, cancel := context.WithCancel(context.Background())
	store.SetAgent(builtinWebAgentID, map[string]any{
		"agent_id":       builtinWebAgentID,
		"platform":       "web",
		"skills":         []string{"WebCheck", "APITest", "APIFlow", "LoadSmoke"},
		"extra":          map[string]any{"builtin": true},
		"last_seen":      nowFloat(),
		"status":         "idle",
		"current_job_id": nil,
	})
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// 失联超时兜底：running 任务超过阈值（Agent 挂死/失联）标记失败，保证列表不永久卡死
				if reaped := store.ReapStale(stale); len(reaped) > 0 {
					log.Printf("[Builtin] 失联超时清理: %v", reaped)
				}
				job := store.ClaimBuiltin()
				if job == nil {
					continue
				}
				runBuiltinJob(store, job)
			}
		}
	}()
	return cancel
}

// runBuiltinJob 执行单个内置任务：panic 恢复（防止单任务异常击穿 worker 常驻协程）、
// 结果落盘、监控循环续排。
func runBuiltinJob(store *Store, job map[string]any) {
	id := jobIDOf(job)
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Builtin] 任务 #%d panic: %v", id, r)
			store.SetJobResult(id, builtinWebAgentID, false, nil, map[string]any{
				"message": "内置执行器内部错误",
				"panic":   fmt.Sprint(r),
			})
		}
		store.Heartbeat(builtinWebAgentID, "idle", nil, nowFloat())
	}()
	log.Printf("[Builtin] 执行任务 #%d", id)
	store.Heartbeat(builtinWebAgentID, "running", &id, nowFloat())
	success, summary := executeBuiltin(job, store)
	store.SetJobResult(id, builtinWebAgentID, success, nil, summary)
	if !success {
		NotifyJobFailure(job, builtinWebAgentID, summary)
	}
	// 监控循环（Uptime Kuma 模式）：repeat_minutes > 0 时完成后自动排下一次
	if rm := summaryInt(summary, "repeat_minutes"); rm > 0 {
		next := map[string]any{
			"job_id":          store.NextJobID(),
			"platform":        job["platform"],
			"required_skills": job["required_skills"],
			"extra":           job["extra"],
			"status":          "pending",
			"created_at":      nowFloat(),
			"result":          nil,
		}
		store.AppendJob(next)
		log.Printf("[Builtin] 监控循环: #%d 完成，已排 #%d（%d 分钟后）", id, next["job_id"], rm)
	}
	log.Printf("[Builtin] 任务 #%d 完成: %v", id, success)
}

func summaryInt(summary map[string]any, key string) int {
	switch v := summary[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}

// executeBuiltin 按任务类型分发。
func executeBuiltin(job map[string]any, store *Store) (bool, map[string]any) {
	extra, _ := job["extra"].(map[string]any)
	jt, _ := extra["job_type"].(string)
	switch jt {
	case "web_check":
		return executeWebCheck(job)
	case "api_check":
		return executeAPICheck(job)
	case "api_load":
		return executeAPILoad(job)
	case "api_flow":
		return executeAPIFlow(job)
	case "self_check":
		return executeSelfCheck(job, store)
	case "port_check":
		return executePortCheck(job)
	case "cert_check":
		return executeCertCheck(job)
	case "dns_check":
		return executeDNSCheck(job)
	}
	return false, map[string]any{"message": "未知内置任务类型: " + jt}
}

// numFromAny 数值兼容读取：JSON 反序列化为 float64，Go 内部调用可能是 int。
func numFromAny(extra map[string]any, key string, def float64) float64 {
	switch v := extra[key].(type) {
	case float64:
		if v > 0 {
			return v
		}
	case int:
		if v > 0 {
			return float64(v)
		}
	}
	return def
}

// ---------- 共享请求工具 ----------

type httpResult struct {
	StatusCode   int    `json:"status_code"`
	LatencyMS    int64  `json:"latency_ms"`
	Body         string `json:"-"`
	KeywordFound bool   `json:"keyword_found"`
}

func doRequest(method, url string, headers map[string]string, body string, timeout time.Duration, insecure bool) (httpResult, error) {
	res := httpResult{}
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		return res, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if body != "" && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	transport := &http.Transport{}
	if insecure {
		transport.TLSClientConfig = tlsConfigInsecure().TLSClientConfig //nolint:gosec // 用户显式选择跳过校验
	}
	client := &http.Client{Timeout: timeout, Transport: transport}
	start := time.Now()
	resp, err := client.Do(req)
	res.LatencyMS = time.Since(start).Milliseconds()
	if err != nil {
		return res, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return res, err
	}
	res.StatusCode = resp.StatusCode
	res.Body = string(b)
	return res, nil
}

// parseHeaders 解析 "Key: Value" 行式请求头文本。
func parseHeaders(text string) map[string]string {
	h := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if i := strings.Index(line, ":"); i > 0 {
			h[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
		}
	}
	return h
}

// ---------- api_check：接口测试 ----------

// executeAPICheck 单接口断言：状态码 / 关键词 / 延迟上限。
func executeAPICheck(job map[string]any) (bool, map[string]any) {
	extra, _ := job["extra"].(map[string]any)
	url, _ := extra["url"].(string)
	if strings.TrimSpace(url) == "" {
		return false, map[string]any{"message": "缺少 url"}
	}
	method, _ := extra["method"].(string)
	if method == "" {
		method = "GET"
	}
	headersText, _ := extra["headers"].(string)
	body, _ := extra["body"].(string)
	keyword, _ := extra["keyword"].(string)
	expected := int(numFromAny(extra, "expected_status", 200))
	maxLatency := int64(numFromAny(extra, "latency_ms", 0))
	timeoutMS := numFromAny(extra, "timeout_ms", 10000)
	if timeoutMS < 1000 {
		timeoutMS = 1000
	}
	if timeoutMS > 60000 {
		timeoutMS = 60000
	}
	insecure, _ := extra["insecure_tls"].(bool)

	res, err := doRequest(method, url, parseHeaders(headersText), body, time.Duration(timeoutMS)*time.Millisecond, insecure)
	checks := map[string]any{}
	failed := []string{}
	if err != nil {
		failed = append(failed, "请求失败: "+err.Error())
	} else {
		statusOK := res.StatusCode == expected
		checks["status_code"] = res.StatusCode
		checks["status_ok"] = statusOK
		if !statusOK {
			failed = append(failed, fmt.Sprintf("状态码 %d ≠ 期望 %d", res.StatusCode, expected))
		}
		if keyword != "" {
			kwOK := strings.Contains(res.Body, keyword)
			checks["keyword_found"] = kwOK
			if !kwOK {
				failed = append(failed, "响应未包含关键词: "+keyword)
			}
		}
		if maxLatency > 0 {
			latOK := res.LatencyMS <= maxLatency
			checks["latency_ms"] = res.LatencyMS
			checks["latency_ok"] = latOK
			if !latOK {
				failed = append(failed, fmt.Sprintf("延迟 %dms > 上限 %dms", res.LatencyMS, maxLatency))
			}
		}
		bodySnip := res.Body
		if len(bodySnip) > 200 {
			bodySnip = bodySnip[:200] + "…"
		}
		checks["body_snippet"] = bodySnip
	}
	checks["method"] = method
	checks["url"] = url
	checks["latency_ms"] = res.LatencyMS
	success := len(failed) == 0
	msg := "接口检查通过"
	if !success {
		msg = "接口检查失败: " + strings.Join(failed, "；")
	}
	return success, map[string]any{"message": msg, "checks": checks}
}

// ---------- api_load：性能冒烟 ----------

// executeAPILoad 并发压测：total 总请数 / concurrency 并发 / p95 延迟断言（k6 简化版）。
func executeAPILoad(job map[string]any) (bool, map[string]any) {
	extra, _ := job["extra"].(map[string]any)
	url, _ := extra["url"].(string)
	if strings.TrimSpace(url) == "" {
		return false, map[string]any{"message": "缺少 url"}
	}
	total := int(numFromAny(extra, "total", 50))
	if total > 1000 {
		total = 1000
	}
	concurrency := int(numFromAny(extra, "concurrency", 5))
	if concurrency > 50 {
		concurrency = 50
	}
	expected := int(numFromAny(extra, "expected_status", 200))
	p95MaxF := numFromAny(extra, "p95_ms", 0)
	insecure, _ := extra["insecure_tls"].(bool)

	type outcome struct {
		latencyMS int64
		ok        bool
		err       string
	}
	results := make(chan outcome, total)
	sem := make(chan struct{}, concurrency)
	for i := 0; i < total; i++ {
		sem <- struct{}{}
		go func() {
			defer func() { <-sem }()
			res, err := doRequest("GET", url, nil, "", 10*time.Second, insecure)
			if err != nil {
				results <- outcome{err: err.Error()}
				return
			}
			results <- outcome{latencyMS: res.LatencyMS, ok: res.StatusCode == expected}
		}()
	}
	latencies := []int64{}
	okCount := 0
	errSample := ""
	for i := 0; i < total; i++ {
		o := <-results
		if o.err != "" && errSample == "" {
			errSample = o.err
		}
		if o.ok {
			okCount++
			latencies = append(latencies, o.latencyMS)
		}
	}

	sortInts(latencies)
	pct := func(p float64) int64 {
		if len(latencies) == 0 {
			return 0
		}
		idx := int(float64(len(latencies)) * p)
		if idx >= len(latencies) {
			idx = len(latencies) - 1
		}
		return latencies[idx]
	}
	latMax := int64(0)
	if len(latencies) > 0 {
		latMax = latencies[len(latencies)-1]
	}

	success := okCount == total && (p95MaxF == 0 || float64(pct(0.95)) <= p95MaxF)
	msg := fmt.Sprintf("性能冒烟: 成功 %d/%d，p50=%dms，p95=%dms，max=%dms", okCount, total, pct(0.5), pct(0.95), latMax)
	if errSample != "" {
		msg += "，错误样本: " + errSample
	}
	return success, map[string]any{
		"message":     msg,
		"total":       total,
		"http_ok":     okCount,
		"p50_ms":      pct(0.5),
		"p95_ms":      pct(0.95),
		"latency_max": latMax,
		"err_sample":  errSample,
	}
}

// ---------- api_flow：关键字流程 ----------

// executeAPIFlow 多步骤接口链：前序步骤可提取 JSON 字段到变量（{{name}}）供后续步骤使用。
// extra.steps_json 示例：
// [
//
//	{"name":"登录","request":{"method":"POST","url":"https://x/login","body":"{\"u\":\"a\"}"},
//	 "save":{"token":"data.token"}},
//	{"name":"查资料","request":{"method":"GET","url":"https://x/me?token={{token}}"},
//	 "expect":{"status":200,"keyword":"ok"}}
//
// ]
func executeAPIFlow(job map[string]any) (bool, map[string]any) {
	extra, _ := job["extra"].(map[string]any)
	raw, _ := extra["steps_json"].(string)
	if strings.TrimSpace(raw) == "" {
		return false, map[string]any{"message": "缺少 steps_json（步骤定义）"}
	}
	var steps []map[string]any
	if err := json.Unmarshal([]byte(raw), &steps); err != nil {
		return false, map[string]any{"message": "steps_json 解析失败: " + err.Error()}
	}
	vars := map[string]string{}
	stepResults := []map[string]any{}
	success := true
	failedStep := ""
	for i, st := range steps {
		name, _ := st["name"].(string)
		if name == "" {
			name = fmt.Sprintf("步骤 %d", i+1)
		}
		reqCfg, _ := st["request"].(map[string]any)
		method, url, headers, body := "GET", "", "", ""
		if reqCfg != nil {
			method, _ = reqCfg["method"].(string)
			url, _ = reqCfg["url"].(string)
			if h, ok := reqCfg["headers"].(map[string]any); ok {
				for k, v := range h {
					headers += k + ": " + fmt.Sprintf("%v", v) + "\n"
				}
			}
			if b, ok := reqCfg["body"].(string); ok {
				body = b
			}
		}
		// {{变量}} 替换
		for k, v := range vars {
			url = strings.ReplaceAll(url, "{{"+k+"}}", v)
			body = strings.ReplaceAll(body, "{{"+k+"}}", v)
			headers = strings.ReplaceAll(headers, "{{"+k+"}}", v)
		}
		insecure, _ := extra["insecure_tls"].(bool)
		res, err := doRequest(method, url, parseHeaders(headers), body, 15*time.Second, insecure)
		stepOK := err == nil
		stepErr := ""
		if err != nil {
			stepErr = err.Error()
			stepOK = false
		} else {
			if expect, ok := st["expect"].(map[string]any); ok {
				if ev, ok := expect["status"].(float64); ok && res.StatusCode != int(ev) {
					stepOK = false
					stepErr = fmt.Sprintf("状态码 %d ≠ %d", res.StatusCode, int(ev))
				}
				if kw, ok := expect["keyword"].(string); ok && kw != "" && !strings.Contains(res.Body, kw) {
					stepOK = false
					stepErr = "未包含关键词: " + kw
				}
			}
			// save：从响应 JSON 提取变量（点路径，如 data.token）
			if save, ok := st["save"].(map[string]any); ok && stepOK {
				for varName, jsonPath := range save {
					if jp, ok := jsonPath.(string); ok {
						if v, err := extractJSONPath(res.Body, jp); err == nil {
							vars[varName] = v
						} else {
							stepOK = false
							stepErr = "提取 " + jp + " 失败: " + err.Error()
						}
					}
				}
			}
		}
		if !stepOK && success {
			success = false
			failedStep = name
		}
		stepResults = append(stepResults, map[string]any{
			"step": i + 1, "name": name, "ok": stepOK,
			"status_code": res.StatusCode, "latency_ms": res.LatencyMS,
			"error": stepErr,
		})
		if !stepOK {
			break // 失败即止（fail-fast，与主流流程引擎一致）
		}
	}
	msg := fmt.Sprintf("流程通过（%d 步）", len(stepResults))
	if !success {
		msg = fmt.Sprintf("流程失败于「%s」: %s", failedStep, stepResults[len(stepResults)-1]["error"])
	}
	return success, map[string]any{"message": msg, "steps": stepResults}
}

func sortInts(a []int64) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j-1] > a[j]; j-- {
			a[j-1], a[j] = a[j], a[j-1]
		}
	}
}

// extractJSONPath 极简点路径取值：data.list.0.token
func extractJSONPath(body, path string) (string, error) {
	var root any
	if err := json.Unmarshal([]byte(body), &root); err != nil {
		return "", fmt.Errorf("响应非 JSON: %w", err)
	}
	cur := root
	for _, seg := range strings.Split(strings.TrimSpace(path), ".") {
		switch node := cur.(type) {
		case map[string]any:
			v, ok := node[seg]
			if !ok {
				return "", fmt.Errorf("路径段 %q 不存在", seg)
			}
			cur = v
		case []any:
			idx, err := strconv.Atoi(seg)
			if err != nil || idx < 0 || idx >= len(node) {
				return "", fmt.Errorf("数组下标 %q 越界", seg)
			}
			cur = node[idx]
		default:
			return "", fmt.Errorf("路径段 %q 无法下钻", seg)
		}
	}
	return fmt.Sprintf("%v", cur), nil
}
