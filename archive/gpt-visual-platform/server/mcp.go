// Unity MCP 代理：modules/mcp.py 的 Go 移植。
// 平台将 /api/mcp/* 请求转发到 MCP_SERVER_URL（默认 http://localhost:8080/mcp）。
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func mcpServerURL() string {
	v := os.Getenv("MCP_SERVER_URL")
	if v == "" {
		v = "http://localhost:8080/mcp"
	}
	return strings.TrimRight(v, "/")
}

func mcpGet(endpoint string, params url.Values, timeout time.Duration) map[string]any {
	u := mcpServerURL() + endpoint
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(u)
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return map[string]any{"error": err.Error()}
	}
	return out
}

func mcpPost(endpoint string, data any, timeout time.Duration) map[string]any {
	body, _ := json.Marshal(data)
	client := &http.Client{Timeout: timeout}
	resp, err := client.Post(mcpServerURL()+endpoint, "application/json", bytes.NewReader(body))
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	defer resp.Body.Close()
	// 上游响应上限 10MB，防止异常上游打爆内存
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return map[string]any{"error": fmt.Sprintf("读取响应失败: %v", err)}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{"error": fmt.Sprintf("响应解析失败: %v", err)}
	}
	return out
}

func mcpAvailable() bool {
	resp := mcpGet("/resources/project_info", nil, 30*time.Second)
	_, hasErr := resp["error"]
	return !hasErr
}

// mcpMergeProps 合并必填参数与可选 properties（与 Python 版一致）。
func mcpMergeProps(base map[string]any, props map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range props {
		out[k] = v
	}
	return out
}
