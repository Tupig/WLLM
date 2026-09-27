// 失败任务通知：任务失败时向 NOTIFY_WEBHOOK_URL POST JSON（通用格式，
// 兼容企业微信/飞书/Slack/Discord 等 webhook 的自定义 bot 入口）。
// 尽力而为：异步发送、5s 超时、失败仅记日志，不影响任务主流程。
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// NotifyJobFailure 任务失败时发送 webhook 通知（异步）。
func NotifyJobFailure(job map[string]any, agentID string, summary map[string]any) {
	url := strings.TrimSpace(os.Getenv("NOTIFY_WEBHOOK_URL"))
	if url == "" {
		return
	}
	go func() {
		payload := map[string]any{
			"event":    "job_failed",
			"job_id":   jobIDOf(job),
			"platform": job["platform"],
			"agent_id": agentID,
			"summary":  summary,
			"time":     nowFloat(),
			"text": fmt.Sprintf("⚠️ 任务 #%d 失败（%v/%s）：%s",
				jobIDOf(job), job["platform"], agentID, summaryText(summary)),
		}
		b, err := json.Marshal(payload)
		if err != nil {
			log.Printf("[Notify] 序列化失败: %v", err)
			return
		}
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Post(url, "application/json", bytes.NewReader(b))
		if err != nil {
			log.Printf("[Notify] webhook 发送失败: %v", err)
			return
		}
		defer resp.Body.Close()
		log.Printf("[Notify] 失败通知已发送（任务 #%d，HTTP %d）", jobIDOf(job), resp.StatusCode)
	}()
}

func summaryText(summary map[string]any) string {
	if summary == nil {
		return ""
	}
	if m, ok := summary["message"].(string); ok && m != "" {
		return m
	}
	b, _ := json.Marshal(summary)
	out := string(b)
	if len(out) > 120 {
		out = out[:120] + "…"
	}
	return out
}
