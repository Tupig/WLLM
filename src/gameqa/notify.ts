/**
 * gameqa/notify.ts — 失败任务 webhook 通知（notify.go 移植）
 * NOTIFY_WEBHOOK_URL 配置后，任务失败时 POST JSON；尽力而为：异步、5s 超时、失败仅记日志。
 */
import type { Json, Job } from "./store.js";

function summaryText(summary: Record<string, Json> | null | undefined): string {
  if (!summary) return "";
  if (typeof summary["message"] === "string" && summary["message"] !== "") return summary["message"];
  const s = JSON.stringify(summary);
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

export function notifyJobFailure(job: Job, agentId: string, summary: Record<string, Json> | null | undefined): void {
  const url = (process.env["NOTIFY_WEBHOOK_URL"] ?? "").trim();
  if (url === "") return;
  const jobId = typeof job["job_id"] === "number" ? job["job_id"] : 0;
  const payload = {
    event: "job_failed",
    job_id: jobId,
    platform: job["platform"],
    agent_id: agentId,
    summary: summary ?? {},
    time: Date.now() / 1000,
    text: `⚠️ 任务 #${jobId} 失败（${String(job["platform"])}/${agentId}）：${summaryText(summary)}`,
  };
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  })
    .then((resp) => console.log(`[Notify] 失败通知已发送（任务 #${jobId}，HTTP ${resp.status}）`))
    .catch((err: unknown) => console.warn("[Notify] webhook 发送失败:", err));
}
