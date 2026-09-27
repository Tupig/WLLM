//! 游戏性能测试：帧率 / 卡顿 / 内存（Android，dumpsys gfxinfo + meminfo）。
//! 能力对标 PerfDog 精简版：可选拉起应用 → 重置帧统计 → 采样窗口 → 解析帧率/卡顿率/百分位/内存 → 阈值断言。
use crate::adb::{adb_base, adb_output, adb_shell};
use crate::executor::ExecOutcome;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

/// run_game_perf 游戏性能测试主流程。
/// extra: {"job_type":"game_perf", "package":"com.x.y", "duration_s":30,
///         "launch_activity":"com.x.y/.MainActivity"(可选), "max_jank_pct":20,
///         "min_fps":30, "max_mem_mb":600}
pub fn run_game_perf(job: &Value, workdir: &Path) -> Result<ExecOutcome, String> {
    let extra = job.get("extra").cloned().unwrap_or(json!({}));
    let package = extra
        .get("package")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if package.is_empty() {
        return Ok(ExecOutcome::failure(json!({
            "message": "缺少 extra.package（游戏包名，如 com.example.game）"
        })));
    }

    let serial = extra
        .get("device_serial")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .or_else(|| std::env::var("ANDROID_SERIAL").ok())
        .filter(|s| !s.is_empty());

    let duration = extra
        .get("duration_s")
        .and_then(Value::as_i64)
        .unwrap_or(30)
        .clamp(5, 300) as u64;
    let max_jank_pct = extra
        .get("max_jank_pct")
        .and_then(Value::as_f64)
        .unwrap_or(20.0);
    let min_fps = extra.get("min_fps").and_then(Value::as_f64).unwrap_or(30.0);
    let max_mem_mb = extra
        .get("max_mem_mb")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    // 可选：拉起游戏
    if let Some(act) = extra
        .get("launch_activity")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        adb_shell(
            serial.as_deref(),
            vec!["am".into(), "start".into(), "-n".into(), act],
        )
        .map_err(|e| format!("拉起应用失败: {e}"))?;
        std::thread::sleep(Duration::from_secs(3));
    }

    // 重置帧统计，开始采样窗口（每秒采一次内存）
    adb_shell(
        serial.as_deref(),
        vec![
            "dumpsys".into(),
            "gfxinfo".into(),
            package.clone(),
            "reset".into(),
        ],
    )
    .map_err(|e| format!("重置帧统计失败: {e}"))?;

    let mut mem_samples: Vec<f64> = Vec::new();
    for _ in 0..duration {
        std::thread::sleep(Duration::from_secs(1));
        if let Ok(out) = adb_output(&adb_meminfo_args(serial.as_deref(), &package)) {
            if let Some(mb) = parse_meminfo_total(&String::from_utf8_lossy(&out)) {
                mem_samples.push(mb);
            }
        }
    }

    // 采集帧统计
    let dump = adb_output(&adb_gfxinfo_args(serial.as_deref(), &package))?;
    let dump_text = String::from_utf8_lossy(&dump).into_owned();
    let stats = parse_gfxinfo(&dump_text);

    let fps = if duration > 0 {
        stats.frames as f64 / duration as f64
    } else {
        0.0
    };
    let mem_avg = if mem_samples.is_empty() {
        0.0
    } else {
        mem_samples.iter().sum::<f64>() / mem_samples.len() as f64
    };
    let mem_max = mem_samples.iter().cloned().fold(0.0_f64, f64::max);

    let jank_ok = stats.jank_pct <= max_jank_pct;
    let fps_ok = stats.frames > 0 && fps >= min_fps;
    let mem_ok = max_mem_mb <= 0.0 || mem_max <= max_mem_mb;
    let app_running = stats.frames > 0;
    let success = jank_ok && fps_ok && mem_ok && app_running;

    let message = if !app_running {
        "应用未运行（帧统计为 0），请确认包名与游戏已启动".to_string()
    } else {
        let mut parts = vec![
            format!("平均帧率 {:.1} FPS", fps),
            format!("卡顿率 {:.1}%（阈值 {:.1}%）", stats.jank_pct, max_jank_pct),
            format!("p95 帧耗时 {}ms", stats.p95),
            format!("内存峰值 {:.0}MB", mem_max),
        ];
        if !jank_ok {
            parts.insert(0, "卡顿率超限".into());
        }
        if !fps_ok {
            parts.insert(0, "帧率低于下限".into());
        }
        parts.join("，")
    };

    // 产物：原始 dumpsys 数据
    let _ = std::fs::create_dir_all(workdir);
    let raw_path = workdir.join("gfxinfo.txt");
    let _ = std::fs::write(&raw_path, &dump);

    Ok(ExecOutcome {
        success,
        log_path: Some(raw_path.to_string_lossy().into_owned()),
        summary: json!({
            "message": message,
            "package": package,
            "duration_s": duration,
            "fps": (fps * 10.0).round() / 10.0,
            "frames": stats.frames,
            "janky": stats.janky,
            "jank_pct": stats.jank_pct,
            "p50_ms": stats.p50,
            "p95_ms": stats.p95,
            "p99_ms": stats.p99,
            "mem_avg_mb": (mem_avg * 10.0).round() / 10.0,
            "mem_max_mb": (mem_max * 10.0).round() / 10.0,
            "thresholds": {"max_jank_pct": max_jank_pct, "min_fps": min_fps, "max_mem_mb": max_mem_mb},
        }),
        artifacts: vec![("gfxinfo.txt".into(), dump_text)],
    })
}

fn adb_gfxinfo_args(serial: Option<&str>, package: &str) -> Vec<String> {
    let mut args = adb_base(serial);
    args.extend([
        "shell".into(),
        "dumpsys".into(),
        "gfxinfo".into(),
        package.into(),
    ]);
    args
}

fn adb_meminfo_args(serial: Option<&str>, package: &str) -> Vec<String> {
    let mut args = adb_base(serial);
    args.extend([
        "shell".into(),
        "dumpsys".into(),
        "meminfo".into(),
        package.into(),
    ]);
    args
}

// ---------- 纯解析函数（可单测） ----------

#[derive(Debug, PartialEq)]
pub struct GfxStats {
    pub frames: u64,
    pub janky: u64,
    pub jank_pct: f64,
    pub p50: u64,
    pub p90: u64,
    pub p95: u64,
    pub p99: u64,
}

/// 解析 `dumpsys gfxinfo <pkg>` 摘要。
pub fn parse_gfxinfo(text: &str) -> GfxStats {
    let mut stats = GfxStats {
        frames: 0,
        janky: 0,
        jank_pct: 0.0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
    };
    for line in text.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("Total frames rendered:") {
            stats.frames = v.trim().parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("Janky frames:") {
            // 形如 "5 (4.76%)"
            let mut it = v.split_whitespace();
            stats.janky = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            if let Some(pct) = it.next().and_then(|x| {
                x.trim_start_matches('(')
                    .trim_end_matches(')')
                    .trim_end_matches('%')
                    .parse::<f64>()
                    .ok()
            }) {
                stats.jank_pct = pct;
            }
        } else if let Some((label, v)) = split_percentile(line) {
            match label {
                50 => stats.p50 = v,
                90 => stats.p90 = v,
                95 => stats.p95 = v,
                99 => stats.p99 = v,
                _ => {}
            }
        }
    }
    stats
}

/// "50th percentile: 5ms" → (50, 5)
fn split_percentile(line: &str) -> Option<(u64, u64)> {
    let idx = line.find("th percentile")?;
    let label = line[..idx].trim().parse::<u64>().ok()?;
    let v = line[idx..]
        .split(':')
        .nth(1)?
        .trim()
        .trim_end_matches("ms")
        .trim()
        .parse::<u64>()
        .ok()?;
    Some((label, v))
}

/// 解析 `dumpsys meminfo <pkg>` 的 TOTAL PSS（kB → MB）。
pub fn parse_meminfo_total(text: &str) -> Option<f64> {
    for line in text.lines().rev() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("TOTAL PSS:") {
            let kb: f64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kb / 1024.0);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
*** GPU INFO ***
Total frames rendered: 900
Janky frames: 45 (5.00%)
50th percentile: 6ms
90th percentile: 11ms
95th percentile: 16ms
99th percentile: 28ms
Number Missed Vsync: 3
";

    #[test]
    fn test_parse_gfxinfo() {
        let s = parse_gfxinfo(SAMPLE);
        assert_eq!(s.frames, 900);
        assert_eq!(s.janky, 45);
        assert_eq!(s.jank_pct, 5.0);
        assert_eq!(s.p50, 6);
        assert_eq!(s.p95, 16);
        assert_eq!(s.p99, 28);
    }

    #[test]
    fn test_parse_gfxinfo_empty() {
        let s = parse_gfxinfo("no stats here");
        assert_eq!(s.frames, 0);
    }

    #[test]
    fn test_parse_meminfo_total() {
        let mem = "Apps Summary\nTOTAL PSS: 512000 kB\nOther line";
        assert_eq!(parse_meminfo_total(mem), Some(500.0));
        assert_eq!(parse_meminfo_total("nothing"), None);
    }
}
