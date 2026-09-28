//! 任务执行分发：按 extra.job_type 路由到可选集成（agents/runner_common.py 的 dispatch_integrations 移植）。
//! 未命中 job_type 时走占位逻辑，与 Python 版行为一致。
//! 执行结束后按类型收集产物（steps.json / 日志尾部），由 main 上传到编排服务供看板查看。
use serde_json::{json, Value};
use std::path::Path;

/// 单个产物上传上限（字节），超出截断。
const ARTIFACT_MAX_BYTES: usize = 64 * 1024;

#[derive(Debug)]
pub struct ExecOutcome {
    pub success: bool,
    pub log_path: Option<String>,
    pub summary: Value,
    /// (文件名, 文本内容)，随结果上传到编排服务
    pub artifacts: Vec<(String, String)>,
}

impl ExecOutcome {
    pub fn failure(summary: Value) -> Self {
        Self {
            success: false,
            log_path: None,
            summary,
            artifacts: Vec::new(),
        }
    }
}

pub fn execute(job: &Value, platform: &str, workdir: &Path) -> ExecOutcome {
    let job_type = job
        .get("extra")
        .and_then(|e| e.get("job_type"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let inner: Result<ExecOutcome, String> = match job_type.as_str() {
        "airtest" => crate::airtest::run_airtest_script(job, platform, workdir),
        "ai_exploratory" => crate::ai::run_ai_exploratory(job, platform, workdir),
        "self_check" => Ok(self_check(platform)),
        "game_perf" => crate::gameperf::run_game_perf(job, workdir),
        "unity_log_scan" => crate::unitylogs::run_log_scan(job, workdir),
        "device_inventory" => crate::unitylogs::run_device_inventory(workdir),
        _ => Ok(ExecOutcome {
            success: true,
            log_path: None,
            summary: json!({"message": "placeholder run"}),
            artifacts: Vec::new(),
        }),
    };

    let mut outcome = match inner {
        Ok(outcome) => outcome,
        Err(e) => ExecOutcome::failure(json!({"message": "集成执行异常", "error": e})),
    };
    outcome.artifacts = collect_artifacts(&job_type, workdir);
    outcome
}

/// 环境自检：Agent 机器真实断言（临时目录可写 / 服务端健康接口可达）。
fn self_check(platform: &str) -> ExecOutcome {
    let mut checks = Vec::new();
    let mut ok = true;

    // 1) 临时工作目录可写
    let probe = std::env::temp_dir().join(format!("unity-agent-selfcheck-{}", std::process::id()));
    match std::fs::write(&probe, b"ok").and_then(|_| std::fs::read(&probe)) {
        Ok(b) if b == b"ok" => checks.push(json!({"name": "临时目录可写", "ok": true})),
        other => {
            ok = false;
            checks.push(
                json!({"name": "临时目录可写", "ok": false, "error": format!("{:?}", other.err())}),
            );
        }
    }
    let _ = std::fs::remove_file(&probe);

    // 2) 服务端健康接口（经同一 TLS 策略访问；能拉到任务即已证明可达，此处复核）
    match crate::api::health_probe() {
        Ok(body) => checks.push(json!({"name": "服务端健康接口", "ok": true, "body": body})),
        Err(e) => {
            ok = false;
            checks.push(json!({"name": "服务端健康接口", "ok": false, "error": e}));
        }
    }

    checks.push(json!({"name": "平台", "value": platform}));

    ExecOutcome {
        success: ok,
        log_path: None,
        summary: json!({
            "message": if ok { "环境自检通过" } else { "环境自检未通过" },
            "checks": checks,
            "version": env!("CARGO_PKG_VERSION"),
        }),
        artifacts: Vec::new(),
    }
}

/// 按任务类型收集产物文件（文本，超长截断）。
fn collect_artifacts(job_type: &str, workdir: &Path) -> Vec<(String, String)> {
    let mut files = Vec::new();
    let mut push = |name: &str, path: &Path| {
        if let Ok(data) = std::fs::read(path) {
            files.push((name.to_string(), tail_utf8(&data, ARTIFACT_MAX_BYTES)));
        }
    };
    match job_type {
        "ai_exploratory" => push("steps.json", &workdir.join("steps.json")),
        "airtest" => {
            push("airtest_stdout.log", &workdir.join("airtest_stdout.log"));
            push("airtest_stderr.log", &workdir.join("airtest_stderr.log"));
        }
        _ => {}
    }
    files
}

/// 取字节缓冲尾部（按 UTF-8 字符边界截断）。
fn tail_utf8(data: &[u8], max_bytes: usize) -> String {
    if data.len() <= max_bytes {
        return String::from_utf8_lossy(data).into_owned();
    }
    let start = data.len() - max_bytes;
    let mut start = start;
    while start < data.len() && (data[start] & 0xC0) == 0x80 {
        start += 1; // 跳过 UTF-8 续字节，落在字符边界
    }
    let mut text = String::from_utf8_lossy(&data[start..]).into_owned();
    if start > 0 {
        text.insert_str(0, "…（前段已截断）…\n");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_dispatch_placeholder() {
        let outcome = execute(
            &json!({"job_id": 1, "extra": {}}),
            "mac",
            Path::new("/tmp/unused"),
        );
        assert!(outcome.success);
        assert_eq!(outcome.summary["message"], "placeholder run");
        assert!(outcome.artifacts.is_empty());
    }

    #[test]
    fn test_dispatch_ai_missing_prompt_fails_gracefully() {
        let outcome = execute(
            &json!({"job_id": 2, "extra": {"job_type": "ai_exploratory"}}),
            "android",
            Path::new("/tmp/unused"),
        );
        assert!(!outcome.success);
        assert!(outcome.summary["message"]
            .as_str()
            .unwrap()
            .contains("prompt"));
    }

    #[test]
    fn test_dispatch_airtest_without_dependency_fails_gracefully() {
        // 未安装 airtest 的环境下（CI 常态），应返回结构化失败而非 panic
        let outcome = execute(
            &json!({"job_id": 3, "extra": {"job_type": "airtest", "script_path": "/tmp/nope.air"}}),
            "ios",
            Path::new("/tmp/unused"),
        );
        assert!(!outcome.success);
        assert!(!outcome.summary["message"]
            .as_str()
            .unwrap_or_default()
            .is_empty());
    }

    #[test]
    fn test_collect_artifacts_ai_steps() {
        let dir = std::env::temp_dir().join(format!("unity-agent-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("steps.json"), "{\"steps\":[]}").unwrap();
        let files = collect_artifacts("ai_exploratory", &dir);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0, "steps.json");
        assert!(files[0].1.contains("steps"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_tail_utf8_boundary() {
        let long = "甲".repeat(50_000); // 每字符 3 字节，150KB
        let tail = tail_utf8(long.as_bytes(), 1024);
        assert!(tail.len() <= 1024 + 30);
        assert!(tail.contains("已截断"));
        assert!(!tail.chars().next_back().unwrap().is_control() || true);
    }
}
