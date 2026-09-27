//! ADB 命令执行共享工具（ai / unitylogs / gameperf 共用）。
use std::process::Command;
use std::time::{Duration, Instant};

/// 构造 adb 命令前缀（可带 -s 序列号）。
pub fn adb_base(serial: Option<&str>) -> Vec<String> {
    let mut v = vec!["adb".to_string()];
    if let Some(s) = serial.filter(|s| !s.is_empty()) {
        v.push("-s".into());
        v.push(s.to_string());
    }
    v
}

/// 执行 adb 命令并返回 stdout（非零退出返回错误）。
pub fn adb_output(args: &[String]) -> Result<Vec<u8>, String> {
    let out = Command::new(&args[0])
        .args(&args[1..])
        .output()
        .map_err(|e| format!("adb 执行失败: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "adb 退出码 {:?}: {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

/// 执行 adb shell 子命令。
pub fn adb_shell(serial: Option<&str>, shell_args: Vec<String>) -> Result<(), String> {
    let mut args = adb_base(serial);
    args.push("shell".into());
    args.extend(shell_args);
    adb_output(&args).map(|_| ())
}

/// 带超时的命令执行：超时 kill 并回收（防设备异常时挂死）。
#[allow(dead_code)] // 预留给需要超时保护的 adb 调用
pub fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("进程启动失败: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| format!("等待进程失败: {e}"))? {
            Some(status) => {
                let mut stdout = Vec::new();
                if let Some(mut io) = child.stdout.take() {
                    let _ = io.read_to_end(&mut stdout);
                }
                if !status.success() {
                    let mut stderr = Vec::new();
                    if let Some(mut io) = child.stderr.take() {
                        let _ = io.read_to_end(&mut stderr);
                    }
                    return Err(format!(
                        "退出码 {:?}: {}",
                        status.code(),
                        String::from_utf8_lossy(&stderr).trim()
                    ));
                }
                return Ok(stdout);
            }
            None if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait(); // 回收，避免僵尸进程
                return Err(format!("命令超时（超过 {timeout:?}）已终止"));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}
