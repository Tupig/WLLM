// 内置 Web 检查执行器：直接在编排服务内执行 HTTP 可用性测试（状态码 / 关键词 / 延迟）。
// 零依赖、无需 Agent —— 平台开箱即有的真实测试能力，也可当轻量接口监控用。
// 任务协议：extra = {"job_type": "web_check", "url": "…" 或 "urls": ["…", "…"],
//
//	"expected_status": 200, "keyword": "可选包含文本", "timeout_ms": 5000}
package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const builtinWebAgentID = "builtin-web"

// executeWebCheck 执行检查：多 URL 全部通过才算通过。返回 (success, summary)。
func executeWebCheck(job map[string]any) (bool, map[string]any) {
	extra, _ := job["extra"].(map[string]any)

	// URL 列表：urls 优先，兼容单数 url
	var urls []string
	if arr, ok := extra["urls"].([]any); ok {
		for _, u := range arr {
			if s, ok := u.(string); ok && strings.TrimSpace(s) != "" {
				urls = append(urls, strings.TrimSpace(s))
			}
		}
	}
	if u, ok := extra["url"].(string); ok && strings.TrimSpace(u) != "" {
		urls = append([]string{strings.TrimSpace(u)}, urls...)
	}
	if len(urls) == 0 {
		return false, map[string]any{"message": "缺少检查地址", "hint": "extra.url 或 extra.urls 需至少一个 URL"}
	}

	expected := 200
	if v, ok := extra["expected_status"].(float64); ok && v > 0 {
		expected = int(v)
	}
	keyword, _ := extra["keyword"].(string)
	timeoutMS := 5000.0
	if v, ok := extra["timeout_ms"].(float64); ok && v >= 1000 && v <= 30000 {
		timeoutMS = v
	}

	client := &http.Client{Timeout: time.Duration(timeoutMS) * time.Millisecond}
	if insecureTLS, ok := extra["insecure_tls"].(bool); ok && insecureTLS {
		// 检查目标为自签名 HTTPS 服务时，由任务创建者显式选择跳过校验
		client.Transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}} //nolint:gosec // 用户显式指定
	}
	type urlResult struct {
		URL          string `json:"url"`
		StatusCode   int    `json:"status_code"`
		LatencyMS    int64  `json:"latency_ms"`
		KeywordFound bool   `json:"keyword_found"`
		OK           bool   `json:"ok"`
		Error        string `json:"error,omitempty"`
	}
	results := make([]urlResult, 0, len(urls))
	passed := 0
	for _, u := range urls {
		res := urlResult{URL: u}
		req, err := http.NewRequest("GET", u, nil)
		if err != nil {
			res.Error = err.Error()
			results = append(results, res)
			continue
		}
		start := time.Now()
		resp, err := client.Do(req)
		res.LatencyMS = time.Since(start).Milliseconds()
		if err != nil {
			res.Error = err.Error()
			results = append(results, res)
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 最多读 1MB 做关键词匹配
		resp.Body.Close()
		res.StatusCode = resp.StatusCode
		if keyword != "" {
			res.KeywordFound = strings.Contains(string(body), keyword)
		}
		res.OK = resp.StatusCode == expected && (keyword == "" || res.KeywordFound)
		if res.OK {
			passed++
		}
		results = append(results, res)
	}

	success := passed == len(urls) && len(urls) > 0
	summary := map[string]any{
		"message": fmt.Sprintf("Web 检查通过 %d/%d", passed, len(urls)),
		"results": results,
		"total":   len(urls),
		"passed":  passed,
	}
	// 序列化轮转成 map 兼容 summary 类型
	b, _ := json.Marshal(summary)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	out["message"] = summary["message"]
	return success, out
}
