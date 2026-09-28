//! 游戏测试专用执行器：
//!   - unity_log_scan   ：Unity Player.log / 自定义日志的错误与异常扫描（真机/本机均可）
//!   - device_inventory ：ADB 设备清单与关键属性（设备资产管理，Sonic/STF 思路）
//!
//! 设计为纯文本/命令行实现，无第三方依赖。
use crate::adb::{adb_base, adb_output};
use crate::executor::ExecOutcome;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};

// ---------- Unity 日志扫描 ----------

/// 各平台 Unity Player.log 默认路径。
fn default_player_log(platform: &str) -> Option<PathBuf> {
    match platform {
        "mac" => std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join("Library/Logs/Unity/Player.log")),
        "linux" => std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join(".config/unity3d/Player.log")),
        "windows" => std::env::var("LOCALAPPDATA")
            .ok()
            .map(|l| PathBuf::from(l).join("Low")),
        _ => None,
    }
}

/// 扫描日志文本：统计 Error/Exception/Fatal 行，返回 (总数, 明细行, 严重计数)。
fn scan_log_text(text: &str) -> (usize, Vec<String>, usize) {
    let mut details = Vec::new();
    let mut exceptions = 0;
    for (idx, raw) in text.lines().enumerate() {
        let line = raw.trim_end();
        let is_error = line.contains("Error") || line.contains("error");
        let is_exception = line.contains("Exception") || line.contains("exception");
        let is_fatal = line.contains("Fatal") || line.contains("abort");
        if is_error || is_exception || is_fatal {
            let snippet: String = line.chars().take(240).collect();
            details.push(format!("L{}: {}", idx + 1, snippet));
            if is_exception || is_fatal {
                exceptions += 1;
            }
        }
    }
    (details.len(), details, exceptions)
}

/// run_log_scan：扫描 Unity 日志（extra.log_path 优先，缺省用平台 Player.log）。
/// extra: {"job_type":"unity_log_scan", "log_path":"可选", "max_errors":0}
pub fn run_log_scan(job: &Value, workdir: &Path) -> Result<ExecOutcome, String> {
    let extra = job.get("extra").cloned().unwrap_or(json!({}));
    let platform = job.get("platform").and_then(Value::as_str).unwrap_or("mac");

    let explicit = extra
        .get("log_path")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let path = explicit.clone().or_else(|| default_player_log(platform));

    let Some(path) = path else {
        return Ok(ExecOutcome::failure(json!({
            "message": "无法确定日志路径，请通过 extra.log_path 显式指定"
        })));
    };
    if !path.exists() {
        return Ok(ExecOutcome::failure(json!({
            "message": format!("日志文件不存在: {}", path.display()),
            "hint": "Unity Player 首次运行前日志不存在；或用 extra.log_path 指定自定义日志"
        })));
    }

    // 大日志只读尾部（最多 5MB）
    let mut file = std::fs::File::open(&path).map_err(|e| format!("打开日志失败: {e}"))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .map_err(|e| format!("读取日志失败: {e}"))?;
    if buf.len() > 5 * 1024 * 1024 {
        buf = buf[buf.len() - 5 * 1024 * 1024..].to_vec();
    }
    let text = String::from_utf8_lossy(&buf).into_owned();

    let (count, details, exceptions) = scan_log_text(&text);
    let max_errors = extra.get("max_errors").and_then(Value::as_i64).unwrap_or(0) as usize;
    let success = count <= max_errors;
    let message = if success {
        format!("日志扫描通过（{count} 条错误/异常，阈值 {max_errors}）")
    } else {
        format!(
            "日志扫描未通过（{count} 条错误/异常 > 阈值 {max_errors}；Exception {exceptions} 条）"
        )
    };

    // 产物：错误明细
    std::fs::create_dir_all(workdir).ok();
    let artifact_path = workdir.join("log_errors.txt");
    let _ = std::fs::write(&artifact_path, details.join("\n"));

    Ok(ExecOutcome {
        success,
        log_path: Some(path.to_string_lossy().into_owned()),
        summary: json!({
            "message": message,
            "log": path.to_string_lossy(),
            "error_count": count,
            "exceptions": exceptions,
            "threshold": max_errors,
        }),
        artifacts: vec![("log_errors.txt".into(), details.join("\n"))],
    })
}

// ---------- 设备清单 ----------

/// run_device_inventory：枚举 adb 设备并采集关键属性（型号/Android 版本/分辨率/电量）。
pub fn run_device_inventory(workdir: &Path) -> Result<ExecOutcome, String> {
    let list = adb_output(&adb_base(None))?;
    let list = String::from_utf8_lossy(&list).into_owned();
    let mut devices = Vec::new();
    for line in list.lines().skip(1) {
        let mut it = line.split_whitespace();
        let (Some(serial), Some(state)) = (it.next(), it.next()) else {
            continue;
        };
        if state != "device" {
            devices.push(json!({"serial": serial, "state": state, "note": "不可用"}));
            continue;
        }
        let sh = |cmd: &str| -> String {
            let mut args = adb_base(Some(serial));
            args.push("shell".into());
            args.push(cmd.to_string());
            adb_output(&args)
                .map(|b| String::from_utf8_lossy(&b).trim().to_string())
                .unwrap_or_default()
        };
        let model = sh("getprop ro.product.model");
        let brand = sh("getprop ro.product.brand");
        let android = sh("getprop ro.build.version.release");
        let resolution = sh("wm size");
        let resolution = resolution
            .lines()
            .find(|l| l.contains("size"))
            .and_then(|l| l.split(':').nth(1))
            .unwrap_or("?")
            .trim()
            .to_string();
        let battery = sh("dumpsys battery")
            .lines()
            .find(|l| l.contains("level"))
            .and_then(|l| l.split(':').nth(1))
            .unwrap_or("?")
            .trim()
            .to_string();
        devices.push(json!({
            "serial": serial, "state": state, "online": true,
            "model": format!("{brand} {model}"),
            "android": android,
            "resolution": resolution,
            "battery": battery,
        }));
    }

    let online = devices
        .iter()
        .filter(|d| d["online"] == json!(true))
        .count();
    std::fs::create_dir_all(workdir).ok();
    let inv_path = workdir.join("devices.json");
    std::fs::write(
        &inv_path,
        serde_json::to_string_pretty(&devices).unwrap_or_default(),
    )
    .map_err(|e| format!("写入设备清单失败: {e}"))?;

    Ok(ExecOutcome {
        success: true,
        log_path: Some(inv_path.to_string_lossy().into_owned()),
        summary: json!({
            "message": format!("设备清单：共 {} 台，在线 {} 台", devices.len(), online),
            "devices": devices,
            "online": online,
        }),
        artifacts: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_log_text_counts() {
        let log = "Unity v2022\nInvalidOperationException: boom\nat Foo.Bar()\nError: failed to load\n== normal ==\nFatal: crash";
        let (count, details, exceptions) = scan_log_text(log);
        assert_eq!(count, 3);
        assert_eq!(exceptions, 2);
        assert_eq!(details.len(), 3);
        assert!(details[0].starts_with("L2:"));
    }

    #[test]
    fn test_scan_log_clean() {
        let (count, _, _) = scan_log_text("all good\nnothing here");
        assert_eq!(count, 0);
    }

    #[test]
    fn test_default_player_log_paths() {
        std::env::set_var("HOME", "/Users/tester");
        let p = default_player_log("mac").unwrap();
        assert!(p
            .to_string_lossy()
            .contains("Library/Logs/Unity/Player.log"));
        assert!(default_player_log("web").is_none());
    }
}
