/**
 * gameqa/allure.ts — Allure 风格富报告（单文件 HTML）
 * 参考 allure2 经典布局（Apache-2.0，仅参考结构思路，代码为本仓 TS 重写）：
 * 四区块 Overview / Suites / Categories / 用例详情，tab 与树展开用 radio-tabs + <details>（零 JS），
 * 仅历史 job 下拉带一行内联 onchange；无外链资源。
 * 数据源：Store 历史 jobs 的 result.summary（G1a 的 cases 全量用例明细）。
 */
import type { Job, Json } from "./store.js";

export type AllureCase = {
  fullname: string;
  name: string;
  classname: string;
  result: string;
  duration: number;
  message: string | null;
  stack: string | null;
  stdout: string | null;
};

type AllureJob = {
  id: number;
  ts: number;
  platform: string;
  summary: Record<string, Json>;
  cases: AllureCase[];
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toNum(v: Json | undefined, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

function collectAllureJobs(jobs: Job[]): AllureJob[] {
  const out: AllureJob[] = [];
  for (const j of jobs) {
    const result = j["result"] as Record<string, Json> | undefined;
    const summary = (result?.["summary"] ?? null) as Record<string, Json> | null;
    if (!summary || typeof summary["total"] !== "number") continue;
    const rawTs = toNum(j["created_at"]);
    const casesRaw = Array.isArray(summary["cases"]) ? (summary["cases"] as Json[]) : [];
    const cases: AllureCase[] = [];
    for (const c of casesRaw) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, Json>;
      cases.push({
        fullname: String(o["fullname"] ?? "(unknown)"),
        name: String(o["name"] ?? ""),
        classname: String(o["classname"] ?? "(未分类)"),
        result: String(o["result"] ?? "Unknown"),
        duration: toNum(o["duration"]),
        message: o["message"] === null || o["message"] === undefined ? null : String(o["message"]),
        stack: o["stack"] === null || o["stack"] === undefined ? null : String(o["stack"]),
        stdout: o["stdout"] === null || o["stdout"] === undefined ? null : String(o["stdout"]),
      });
    }
    out.push({
      id: toNum(j["job_id"]),
      ts: rawTs > 1e12 ? rawTs : rawTs * 1000,
      platform: typeof j["platform"] === "string" ? j["platform"] : "-",
      summary,
      cases,
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function fmtDur(sec: number): string {
  if (sec <= 0) return "0 ms";
  if (sec < 1) return `${Math.round(sec * 1000)} ms`;
  return `${sec.toFixed(2)} s`;
}

function fmtTime(ts: number): string {
  if (!ts) return "-";
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

function statusBadge(result: string): string {
  const cls = result === "Passed" ? "st-pass" : result === "Failed" ? "st-fail" : "st-skip";
  const label = result === "Passed" ? "通过" : result === "Failed" ? "失败" : result === "Skipped" ? "跳过" : esc(result);
  return `<span class="badge ${cls}">${label}</span>`;
}

function donutSvg(passed: number, total: number): string {
  const rate = total > 0 ? passed / total : 0;
  const R = 44, C = 2 * Math.PI * R;
  const dash = (C * rate).toFixed(1);
  return `<svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="通过率">
    <circle cx="60" cy="60" r="${R}" fill="none" stroke="#e2e8f0" stroke-width="12"/>
    <circle cx="60" cy="60" r="${R}" fill="none" stroke="#16a34a" stroke-width="12"
      stroke-dasharray="${dash} ${C.toFixed(1)}" stroke-linecap="round"
      transform="rotate(-90 60 60)"/>
    <text x="60" y="66" text-anchor="middle" font-size="22" font-weight="700" fill="#0f172a">${Math.round(rate * 100)}%</text>
  </svg>`;
}

const CSS = `
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f1f5f9;color:#0f172a}
.wrap{max-width:1000px;margin:0 auto;padding:24px}
.top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px}
h1{font-size:20px;margin:0}
select{padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;font-size:13px}
.tabs input{display:none}
.tabbar{display:flex;gap:4px;border-bottom:2px solid #e2e8f0;margin-bottom:16px}
.tabbar label{padding:8px 16px;font-size:14px;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px}
.tabbar label:hover{color:#2563eb}
.panels>section{display:none}
#tab-o:checked~.tabbar label[for=tab-o],#tab-s:checked~.tabbar label[for=tab-s],#tab-c:checked~.tabbar label[for=tab-c]{color:#2563eb;border-bottom-color:#2563eb;font-weight:600}
#tab-o:checked~.panels>#p-o,#tab-s:checked~.panels>#p-s,#tab-c:checked~.panels>#p-c{display:block}
.cards{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;min-width:110px}
.card .v{font-size:26px;font-weight:700}
.card .k{font-size:12px;color:#64748b;margin-top:4px}
.pass{color:#16a34a}.fail{color:#dc2626}.skip{color:#ca8a04}
.card svg{display:block}
section.block{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;margin-bottom:14px}
h2{font-size:15px;margin:0 0 10px}
details{border:1px solid #f1f5f9;border-radius:6px;margin-bottom:6px;background:#fff}
details[open]{border-color:#e2e8f0}
summary{cursor:pointer;padding:8px 12px;font-size:13px;display:flex;gap:10px;align-items:center;list-style:none}
summary::-webkit-details-marker{display:none}
summary:hover{background:#f8fafc}
.muted{color:#94a3b8;font-size:12px}
.badge{font-size:11px;padding:2px 8px;border-radius:10px;color:#fff}
.st-pass{background:#16a34a}.st-fail{background:#dc2626}.st-skip{background:#ca8a04}
.casebody{padding:4px 14px 12px 34px;font-size:13px}
.casebody pre{background:#0f172a;color:#e2e8f0;padding:10px 12px;border-radius:6px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word}
.casebody .lbl{font-size:11px;color:#64748b;font-weight:600;margin:10px 0 4px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #f1f5f9}
th{color:#64748b;font-weight:600}
.empty{color:#94a3b8;text-align:center;padding:40px 0}
.cat-name{font-weight:600}
`;

const HEAD = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>gameqa Allure 报告</title>
<style>${CSS}</style>
</head>
<body><div class="wrap">`;

function renderTabs(job: AllureJob, history: AllureJob[]): string {
  const passed = toNum(job.summary["passed"]);
  const failed = toNum(job.summary["failed"]);
  const skipped = toNum(job.summary["skipped"]);
  const total = toNum(job.summary["total"], passed + failed + skipped);
  const durationSum = job.cases.reduce((s, c) => s + c.duration, 0);

  const jobOptions = history
    .map((h) => `<option value="${h.id}" ${h.id === job.id ? "selected" : ""}>job-${h.id} · ${fmtTime(h.ts)}</option>`)
    .join("");

  const header = `<div class="top">
  <h1>gameqa Allure 报告 <span class="muted">job-${esc(String(job.id))} · ${esc(job.platform)} · ${fmtTime(job.ts)}</span></h1>
  <label class="muted">历史
    <select onchange="location.href='/allure?job='+this.value">${jobOptions}</select>
  </label>
</div>`;

  // Overview
  const overview = `<section id="p-o">
  <div class="cards">
    <div class="card">${donutSvg(passed, total)}</div>
    <div class="card"><div class="v pass">${passed}</div><div class="k">通过</div></div>
    <div class="card"><div class="v fail">${failed}</div><div class="k">失败</div></div>
    <div class="card"><div class="v skip">${skipped}</div><div class="k">跳过</div></div>
    <div class="card"><div class="v">${total}</div><div class="k">总数</div></div>
    <div class="card"><div class="v">${fmtDur(durationSum)}</div><div class="k">总耗时</div></div>
  </div>
</section>`;

  // Suites：按 classname 分组 → case details
  const byClass = new Map<string, AllureCase[]>();
  for (const c of job.cases) {
    const arr = byClass.get(c.classname) ?? [];
    arr.push(c);
    byClass.set(c.classname, arr);
  }
  const suiteBlocks = [...byClass.entries()]
    .map(([cls, cases]) => {
      const items = cases
        .map((c) => {
          const body = [c.message ? `<div class="lbl">错误消息</div><pre>${esc(c.message)}</pre>` : "",
            c.stack ? `<div class="lbl">堆栈</div><pre>${esc(c.stack)}</pre>` : "",
            c.stdout ? `<div class="lbl">标准输出</div><pre>${esc(c.stdout)}</pre>` : ""].join("");
          return `<details>
  <summary>${statusBadge(c.result)} <span>${esc(c.fullname)}</span> <span class="muted">${fmtDur(c.duration)}</span></summary>
  ${body ? `<div class="casebody">${body}</div>` : ""}
</details>`;
        })
        .join("\n");
      return `<details open>
  <summary><b>${esc(cls)}</b> <span class="muted">${cases.length} 个用例</span></summary>
  <div style="padding:0 8px 8px">${items}</div>
</details>`;
    })
    .join("\n");
  const suites = `<section id="p-s">
  <div class="block"><h2>Suites 组（按 class 分组，点击展开用例与详情）</h2>${suiteBlocks}</div>
</section>`;

  // Categories：失败分类
  const failedByClass = [...byClass.entries()].filter(([, cs]) => cs.some((c) => c.result === "Failed"));
  const categories =
    failedByClass.length === 0
      ? `<section id="p-c"><div class="block"><h2>Categories</h2><div class="muted">无失败分类 🎉</div></div></section>`
      : `<section id="p-c"><div class="block"><h2>Categories（按 class 的失败分类）</h2><table>
  <tr><th>分类</th><th>失败/总数</th><th>失败用例</th></tr>
  ${failedByClass
    .map(([cls, cs]) => {
      const f = cs.filter((c) => c.result === "Failed");
      return `<tr><td class="cat-name">${esc(cls)}</td><td>${f.length}/${cs.length}</td><td>${f.map((c) => esc(c.name)).join("、")}</td></tr>`;
    })
    .join("")}
</table></div></section>`;

  return `${header}
<input type="radio" name="tab" id="tab-o" checked>
<input type="radio" name="tab" id="tab-s">
<input type="radio" name="tab" id="tab-c">
<div class="tabbar">
  <label for="tab-o">Overview</label>
  <label for="tab-s">Suites</label>
  <label for="tab-c">Categories</label>
</div>
<div class="panels">${overview}${suites}${categories}</div>`;
}

/** 单文件 Allure 风格报告；jobId 指定历史，默认最新带明细的 job */
export function renderAllureHtml(jobs: Job[], jobId?: number): string {
  const all = collectAllureJobs(jobs);
  if (all.length === 0) {
    return HEAD + `<div class="empty">暂无测试数据</div></div></body></html>`;
  }

  const withCases = all.filter((j) => j.cases.length > 0);
  const target =
    (jobId !== undefined ? all.find((j) => j.id === jobId) : undefined) ??
    withCases[withCases.length - 1] ??
    all[all.length - 1];

  if (!target || target.cases.length === 0) {
    const t = target!;
    const passed = toNum(t.summary["passed"]);
    const failed = toNum(t.summary["failed"]);
    const total = toNum(t.summary["total"]);
    return `${HEAD}
<div class="top"><h1>gameqa Allure 报告 <span class="muted">job-${esc(String(t.id))} · ${fmtTime(t.ts)}</span></h1></div>
<div class="empty">该任务无用例明细（G1a 之前的历史数据）</div>
<div class="cards">
  <div class="card"><div class="v pass">${passed}</div><div class="k">通过</div></div>
  <div class="card"><div class="v fail">${failed}</div><div class="k">失败</div></div>
  <div class="card"><div class="v">${total}</div><div class="k">总数</div></div>
</div></div></body></html>`;
  }

  return HEAD + renderTabs(target, withCases.length > 0 ? withCases : all) + `</div></body></html>`;
}
