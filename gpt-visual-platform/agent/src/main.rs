//! Unity3D 自动化测试平台 - Rust Agent
//! 循环：心跳 → 拉取任务（按 skills 匹配）→ 执行 → 上报结果。
//! 环境变量与 Python 版 Agent 一致：PLATFORM_URL、AGENT_ID、PLATFORM、AGENT_SKILLS、AGENT_WORKDIR。
mod adb;
mod ai;
mod airtest;
mod api;
mod executor;
mod gameperf;
mod unitylogs;

use serde_json::Value;
use std::time::Duration;

const POLL_INTERVAL_SECS: u64 = 15;
const MAX_BACKOFF_SECS: u64 = 120;
const VERSION: &str = env!("CARGO_PKG_VERSION");

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn skills_from_env() -> Vec<String> {
    std::env::var("AGENT_SKILLS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn random_agent_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 ^ d.as_secs())
        .unwrap_or(0);
    // 混入进程 ID，降低同机多实例/同刻启动的碰撞概率
    format!(
        "{:08x}",
        (nanos ^ (std::process::id() as u64)) & 0xffff_ffff
    )
}

fn main() {
    // --version（避免为此引入 clap）
    if std::env::args().any(|a| a == "--version" || a == "-V") {
        println!("unity-agent {VERSION}");
        return;
    }

    let platform = env_or("PLATFORM", "mac");
    let base_url = env_or("PLATFORM_URL", "http://localhost:9111");
    let agent_id = std::env::var("AGENT_ID").unwrap_or_else(|_| random_agent_id());
    let skills = skills_from_env();

    let client = api::PlatformClient::new(&base_url, &agent_id);
    if let Err(e) = client.register(&platform, &skills) {
        eprintln!("[Agent] 注册失败: {e}");
        std::process::exit(1);
    }
    println!("[Agent] 已注册 agent_id={agent_id} platform={platform} skills={skills:?}");

    let workroot = env_or("AGENT_WORKDIR", "data/agent_runs");
    // 连续失败时指数退避（服务端重启/网络抖动时避免固定频率打请求），成功后复位
    let mut interval = POLL_INTERVAL_SECS;
    loop {
        if let Err(e) = client.heartbeat("idle", None) {
            eprintln!("[Agent] 心跳失败: {e}");
        }
        match client.poll(&platform, &skills) {
            Ok(Some(job)) => {
                interval = POLL_INTERVAL_SECS;
                let Some(job_id) = job.get("job_id").and_then(Value::as_i64) else {
                    eprintln!("[Agent] 任务缺少合法 job_id，跳过执行");
                    continue;
                };
                println!("[Agent] 领取任务 job_id={job_id}");
                let _ = client.heartbeat("running", Some(job_id));
                let workdir = std::path::Path::new(&workroot).join(format!("job_{job_id}"));
                let outcome = executor::execute(&job, &platform, &workdir);
                println!("[Agent] 任务结果: {}", outcome.summary);
                // 上报失败重试 3 次：poll 只认 pending，一次丢失任务将永久卡在 running
                for attempt in 1..=3 {
                    match client.submit_result(
                        job_id,
                        outcome.success,
                        outcome.log_path.as_deref(),
                        &outcome.summary,
                    ) {
                        Ok(()) => break,
                        Err(e) if attempt < 3 => {
                            eprintln!("[Agent] 结果上报失败（第 {attempt} 次）: {e}");
                            std::thread::sleep(Duration::from_secs(2));
                        }
                        Err(e) => eprintln!("[Agent] 结果上报失败（已重试 3 次）: {e}"),
                    }
                }
                // 上传执行记录（steps.json / 日志尾部），供看板直接查看
                if let Err(e) = client.upload_artifacts(job_id, &outcome.artifacts) {
                    eprintln!("[Agent] 执行记录上传失败: {e}");
                }
                let _ = client.heartbeat("idle", None);
            }
            Ok(None) => {
                // 空轮询也复位退避：一次网络抖动不应让后续轮询永远停留在 120s
                interval = POLL_INTERVAL_SECS;
                std::thread::sleep(Duration::from_secs(interval));
            }
            Err(e) => {
                eprintln!("[Agent] 错误: {e}（{interval}s 后重试）");
                std::thread::sleep(Duration::from_secs(interval));
                interval = (interval * 2).min(MAX_BACKOFF_SECS);
            }
        }
    }
}
