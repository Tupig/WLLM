//! Airtest 执行引擎（integrations/airtest_executor.py 的 Rust 移植）：
//! 定位 airtest CLI（Python 侧可选安装）运行 .air 图像识别脚本，支持 Android / Windows 设备 URI。
use crate::executor::ExecOutcome;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// 根据平台与任务参数构造 Airtest 设备 URI（与 Python 版 build_device_uri 一致）。
pub fn build_device_uri(platform: &str, extra: &Value) -> Result<String, String> {
    match platform {
        "android" => {
            let serial = extra
                .get("device_serial")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .or_else(|| std::env::var("ANDROID_SERIAL").ok())
                .unwrap_or_default();
            Ok(format!("Android:///{serial}"))
        }
        "windows" => {
            let title_re = extra
                .get("window_title_re")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let title = extra
                .get("window_title")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !title_re.is_empty() {
                return Ok(format!("Windows:///?title_re={}", urlencode(title_re)));
            }
            if !title.is_empty() {
                return Ok(format!(
                    "Windows:///?title_re={}",
                    urlencode(&regex_escape(title))
                ));
            }
            Ok("Windows:///".into())
        }
        other => Err(format!(
            "Airtest 暂不支持 platform={other}（当前支持 android / windows，iOS/Mac 驱动待接入）"
        )),
    }
}

/// 定位 airtest CLI：优先当前可执行文件同目录，其次 PATH，最后 python3 -m 兜底。
pub fn find_airtest_cmd() -> Vec<String> {
    let exe_name = if cfg!(windows) {
        "airtest.exe"
    } else {
        "airtest"
    };
    if let Ok(exe) = std::env::current_exe() {
        let local = exe.parent().unwrap_or(Path::new(".")).join(exe_name);
        if local.exists() {
            return vec![local.to_string_lossy().into_owned()];
        }
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let cand = dir.join(exe_name);
            if cand.exists() {
                return vec![cand.to_string_lossy().into_owned()];
            }
        }
    }
    // Windows 无 python3 命令（微软 Store 别名陷阱），用 py 启动器；Unix 用 python3
    if cfg!(windows) {
        vec!["py".into(), "-3".into(), "-m".into(), "airtest".into()]
    } else {
        vec!["python3".into(), "-m".into(), "airtest".into()]
    }
}

pub fn run_airtest_script(
    job: &Value,
    platform: &str,
    workdir: &Path,
) -> Result<ExecOutcome, String> {
    let extra = job.get("extra").cloned().unwrap_or(json!({}));
    let script = extra
        .get("script_path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let script_path = PathBuf::from(&script);
    if script.is_empty() || !script_path.exists() {
        return Ok(ExecOutcome::failure(json!({
            "message": format!("脚本不存在: {script}"),
            "hint": "script_path 需为 Agent 本机上的 .air 目录",
        })));
    }
    let uri = match build_device_uri(platform, &extra) {
        Ok(u) => u,
        Err(e) => return Ok(ExecOutcome::failure(json!({"message": e}))),
    };
    let log_dir = workdir.join("airtest_log");
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("创建日志目录失败: {e}"))?;

    let cmd = find_airtest_cmd();
    let timeout = Duration::from_secs(
        extra
            .get("timeout")
            .and_then(Value::as_f64)
            .unwrap_or(3600.0)
            .clamp(60.0, 86_400.0) as u64, // 防御非法值（负数/NaN 饱和为 0 会导致脚本立即被杀）
    );
    println!(
        "[Airtest] 执行: {} run {} --device {} --log {}",
        cmd.join(" "),
        script,
        uri,
        log_dir.display()
    );

    let mut run_args = cmd[1..].to_vec();
    run_args.extend([
        "run".to_string(),
        script.clone(),
        "--device".to_string(),
        uri.clone(),
        "--log".to_string(),
        log_dir.to_string_lossy().into_owned(),
    ]);
    let mut command = Command::new(&cmd[0]);
    command.args(&run_args);
    // 输出重定向到文件，避免管道缓冲阻塞
    let stdout_f = std::fs::File::create(workdir.join("airtest_stdout.log"))
        .map_err(|e| format!("创建输出文件失败: {e}"))?;
    let stderr_f = std::fs::File::create(workdir.join("airtest_stderr.log"))
        .map_err(|e| format!("创建输出文件失败: {e}"))?;
    command
        .stdout(Stdio::from(stdout_f))
        .stderr(Stdio::from(stderr_f));
    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 airtest 失败: {e}"))?;

    let start = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| format!("等待进程失败: {e}"))? {
            Some(st) => break st,
            None if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait(); // 回收子进程，避免 Agent 长驻运行中僵尸进程累积
                return Ok(ExecOutcome {
                    success: false,
                    log_path: Some(log_dir.to_string_lossy().into_owned()),
                    summary: json!({"message": "脚本执行超时", "timeout": timeout.as_secs(), "device": uri}),
                    artifacts: Vec::new(),
                });
            }
            None => std::thread::sleep(Duration::from_millis(500)),
        }
    };

    let success = status.success();
    let log_txt = log_dir.join("log.txt");
    let log_path = if log_txt.exists() {
        log_txt
    } else {
        log_dir.clone()
    };
    Ok(ExecOutcome {
        success,
        log_path: Some(log_path.to_string_lossy().into_owned()),
        summary: json!({
            "message": if success { "airtest 脚本执行成功" } else { "airtest 脚本执行失败" },
            "script": script,
            "device": uri,
            "exit_code": status.code(),
        }),
        artifacts: Vec::new(),
    })
}

/// URL 查询参数编码（非保留字符外的字节全部转 %XX）。
pub(crate) fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn regex_escape(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if !c.is_ascii_alphanumeric() {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_device_uri_android() {
        assert_eq!(
            build_device_uri("android", &json!({"device_serial": "emulator-5554"})).unwrap(),
            "Android:///emulator-5554"
        );
        assert_eq!(
            build_device_uri("android", &json!({})).unwrap(),
            "Android:///"
        );
    }

    #[test]
    fn test_device_uri_windows() {
        let uri =
            build_device_uri("windows", &json!({"window_title": "My Game (32-bit)"})).unwrap();
        assert!(uri.starts_with("Windows:///?title_re="));
        assert_eq!(
            build_device_uri("windows", &json!({})).unwrap(),
            "Windows:///"
        );
    }

    #[test]
    fn test_device_uri_unsupported() {
        let err = build_device_uri("mac", &json!({})).unwrap_err();
        assert!(err.contains("不支持"));
    }
}
