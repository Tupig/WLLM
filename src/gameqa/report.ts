/**
 * gameqa/report.ts — 轻量测试报告：单文件 HTML（内联 CSS/SVG，零外部依赖）
 * 数据源：Store 历史 jobs 中 result.summary（NUnit 解析后的 total/passed/failed/failures）。
 */
import type { Job, Json } from "./store.js";

export type ReportRow = {
  id: number;
  ts: number;
  platform: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: Array<{ name: string; message: string }>;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(v: Json | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 提取带 summary.total 的已完成任务，按时间升序 */
export function collectReportRows(jobs: Job[]): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const j of jobs) {
    const result = j["result"] as Record<string, Json> | undefined;
    const summary = (result?.["summary"] ?? null) as Record<string, Json> | null;
    if (!summary) continue;
    const total = num(summary["total"]);
    const passed = num(summary["passed"]);
    if (total === null || passed === null) continue;
    const rawTs = num(j["created_at"]) ?? 0;
    const ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
    const failuresRaw = Array.isArray(summary["failures"]) ? (summary["failures"] as Json[]) : [];
    rows.push({
      id: num(j["job_id"]) ?? 0,
      ts,
      platform: typeof j["platform"] === "string" ? j["platform"] : "-",
      status: typeof j["status"] === "string" ? j["status"] : "-",
      total,
      passed,
      failed: num(summary["failed"]) ?? total - passed,
      skipped: num(summary["skipped"]) ?? 0,
      failures: failuresRaw
        .filter((f): f is Record<string, Json> => !!f && typeof f === "object")
        .map((f) => ({
          name: String(f["name"] ?? "(未命名用例)"),
          message: String(f["message"] ?? ""),
        })),
    });
  }
  rows.sort((a, b) => a.ts - b.ts);
  return rows;
}

function fmtTime(ts: number): string {
  if (!ts) return "-";
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

function passRate(row: ReportRow): string {
  return row.total > 0 ? `${Math.round((row.passed / row.total) * 100)}%` : "-";
}

/** 近 20 次通过率内联 SVG 折线 */
function trendSvg(rows: ReportRow[]): string {
  const data = rows.slice(-20);
  if (data.length === 0) return "";
  const W = 640, H = 140, PAD = 24;
  const stepX = data.length > 1 ? (W - PAD * 2) / (data.length - 1) : 0;
  const pts = data.map((r, i) => {
    const rate = r.total > 0 ? r.passed / r.total : 0;
    const x = PAD + i * stepX;
    const y = PAD + (1 - rate) * (H - PAD * 2);
    return { x: Math.round(x), y: Math.round(y), rate };
  });
  const polyline = pts.length > 1
    ? `<polyline fill="none" stroke="#2563eb" stroke-width="2" points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" />`
    : "";
  const circles = pts
    .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#2563eb"><title>${Math.round(p.rate * 100)}%</title></circle>`)
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="通过率趋势">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#f8fafc" stroke="#e2e8f0" rx="6"/>
    ${polyline}${circles}
  </svg>`;
}

/** 单文件 HTML 报告（无外链、无 <script src>） */
export function renderReportHtml(jobs: Job[]): string {
  const rows = collectReportRows(jobs);
  const latest = rows[rows.length - 1];

  const sumPassed = rows.reduce((s, r) => s + r.passed, 0);
  const sumTotal = rows.reduce((s, r) => s + r.total, 0);
  const overallRate = sumTotal > 0 ? `${Math.round((sumPassed / sumTotal) * 100)}%` : "-";

  const head = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>gameqa 测试报告</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f1f5f9;color:#0f172a}
  .wrap{max-width:960px;margin:0 auto;padding:24px}
  h1{font-size:22px;margin:0 0 16px}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;min-width:130px}
  .card .v{font-size:26px;font-weight:700}
  .card .k{font-size:12px;color:#64748b;margin-top:4px}
  .ok{color:#16a34a}.bad{color:#dc2626}
  section{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;margin-bottom:16px}
  h2{font-size:15px;margin:0 0 10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #f1f5f9}
  th{color:#64748b;font-weight:600}
  .empty{color:#94a3b8;text-align:center;padding:32px 0}
  code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:12px}
</style>
</head>
<body><div class="wrap">
<h1>gameqa 测试报告</h1>`;

  if (rows.length === 0) {
    return head + `<div class="empty">暂无测试数据</div></div></body></html>`;
  }

  const cards = `<div class="cards">
  <div class="card"><div class="v">${latest ? latest.passed + "/" + latest.total : "-"}</div><div class="k">最新一次 通过/总数</div></div>
  <div class="card"><div class="v ${latest && latest.failed > 0 ? "bad" : "ok"}">${latest ? latest.failed : 0}</div><div class="k">最新失败数</div></div>
  <div class="card"><div class="v">${overallRate}</div><div class="k">累计通过率（${sumPassed}/${sumTotal}）</div></div>
  <div class="card"><div class="v">${rows.length}</div><div class="k">历史次数</div></div>
</div>`;

  const trend = rows.length >= 1
    ? `<section><h2>通过率趋势（近 ${Math.min(rows.length, 20)} 次）</h2>${trendSvg(rows)}</section>`
    : "";

  const latestFailures = latest && latest.failures.length > 0
    ? `<section><h2>最新失败明细（job-${latest.id}）</h2><table>
      <tr><th>用例</th><th>错误</th></tr>
      ${latest.failures.map((f) => `<tr><td><code>${esc(f.name)}</code></td><td>${esc(f.message)}</td></tr>`).join("")}
    </table></section>`
    : "";

  const tableRows = [...rows]
    .reverse()
    .map((r) => {
      const st = r.status === "passed" ? `<span class="ok">通过</span>` : r.status === "failed" ? `<span class="bad">失败</span>` : esc(r.status);
      return `<tr><td>job-${r.id}</td><td>${fmtTime(r.ts)}</td><td>${esc(r.platform)}</td><td>${st}</td><td>${r.passed}/${r.total}</td><td>${passRate(r)}</td></tr>`;
    })
    .join("");

  const history = `<section><h2>历史任务</h2><table>
    <tr><th>任务</th><th>时间</th><th>平台</th><th>状态</th><th>通过/总数</th><th>通过率</th></tr>
    ${tableRows}
  </table></section>`;

  return head + cards + trend + latestFailures + history + `</div></body></html>`;
}
