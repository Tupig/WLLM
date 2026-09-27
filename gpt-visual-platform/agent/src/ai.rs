//! AI 探索测试：视觉大模型驱动的「截图 → 决策 → 执行」循环。
//! Android 端为**原生实现**（adb screencap/input + OpenAI 兼容视觉接口），目标机无需 Python/Airtest。
//! 纯逻辑函数（parse_action / validate_action / to_pixels / parse_wm_size / escape_input_text）与
//! Python 版 integrations/ai_agent.py 行为一致，均有单元测试。
use crate::executor::ExecOutcome;
use base64::Engine;
use serde_json::{json, Map, Value};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

/// 模型可输出的动作空间（与 Python 版 integrations/ai_agent.py 对应，供文档与校验参考）。
#[allow(dead_code)]
pub const ALLOWED_ACTIONS: [&str; 6] = ["tap", "swipe", "text", "key", "wait", "finish"];

pub const SYSTEM_PROMPT: &str = r#"你是一个游戏 QA 自动化测试 Agent，通过观察屏幕截图来操作设备完成测试任务。
每一步你只能输出一个 JSON 对象（不要 markdown 代码块、不要解释），动作为以下之一：
{"action": "tap", "x": 0.5, "y": 0.3}          # 点击，坐标为归一化 0~1（相对截图宽高）
{"action": "swipe", "x1": 0.5, "y1": 0.8, "x2": 0.5, "y2": 0.2}   # 滑动
{"action": "text", "text": "hello"}             # 向输入框输入文本（需先点击输入框）
{"action": "key", "key": "BACK"}                # Android 按键：BACK/HOME/MENU/ENTER 等
{"action": "wait", "seconds": 3}                # 等待 1~30 秒
{"action": "finish", "success": true, "reason": "设置面板已打开"}   # 任务完成或确认无法完成
要求：
1. x/y 坐标必须来自当前截图观察，不要凭空猜测。
2. 任务目标未完成且仍有可尝试的操作时，不要输出 finish。
3. 界面明显无法继续（卡死、报错、找不到入口）时，输出 finish 且 success=false，并说明原因。"#;

// ---------- 纯逻辑（可单测） ----------

/// 从模型输出中提取首个 JSON 对象；解析失败返回 None。
pub fn parse_action(text_out: &str) -> Option<Value> {
    let mut s = text_out.trim();
    if s.is_empty() {
        return None;
    }
    if let Some(fence_start) = s.find("```") {
        let after = &s[fence_start + 3..];
        let after = after.strip_prefix("json").unwrap_or(after);
        if let Some(fence_end) = after.find("```") {
            s = after[..fence_end].trim();
        }
    }
    let start = s.find('{')?;
    let end = s.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<Value>(&s[start..=end])
        .ok()
        .filter(|v| v.is_object())
}

fn coord_ok(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64)
        .map(|f| (0.0..=1.0).contains(&f))
        .unwrap_or(false)
}

/// 校验按键名：仅允许字母/数字/下划线（如 BACK、KEYCODE_WAKEUP、数字键码）。
/// `adb shell` 会把参数拼给设备端 sh 解释，放行 shell 元字符等于设备端任意命令执行。
fn key_ok(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str)
        .map(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        .unwrap_or(false)
}

/// 校验动作合法性：action 在动作空间内、坐标/参数类型正确。
pub fn validate_action(act: &Value) -> bool {
    let Some(action) = act.get("action").and_then(Value::as_str) else {
        return false;
    };
    match action {
        "tap" => coord_ok(act.get("x")) && coord_ok(act.get("y")),
        "swipe" => ["x1", "y1", "x2", "y2"]
            .iter()
            .all(|k| coord_ok(act.get(*k))),
        "text" => act
            .get("text")
            .and_then(Value::as_str)
            .map(|s| !s.is_empty())
            .unwrap_or(false),
        "key" => key_ok(act.get("key")),
        "wait" => match act.get("seconds") {
            None | Some(Value::Null) => true, // 缺省 1 秒
            Some(v) => v.as_f64().map(|w| w > 0.0 && w <= 30.0).unwrap_or(false),
        },
        "finish" => act.get("success").map(Value::is_boolean).unwrap_or(false),
        _ => false,
    }
}

/// 归一化坐标 → 设备像素坐标（与 Python 版 to_pixels 一致：截断取整）。
pub fn to_pixels(act: &Value, width: u32, height: u32) -> Value {
    let px = |k: &str| (act.get(k).and_then(Value::as_f64).unwrap_or(0.0) * width as f64) as i64;
    let py = |k: &str| (act.get(k).and_then(Value::as_f64).unwrap_or(0.0) * height as f64) as i64;
    match act.get("action").and_then(Value::as_str) {
        Some("tap") => json!({"action": "tap", "x": px("x"), "y": py("y")}),
        Some("swipe") => json!({
            "action": "swipe",
            "x1": px("x1"), "y1": py("y1"), "x2": px("x2"), "y2": py("y2"),
            "duration": act.get("duration").and_then(Value::as_f64).unwrap_or(0.5).clamp(0.1, 10.0),
        }),
        _ => act.clone(),
    }
}

/// 从 PNG 字节解析 IHDR 宽高。必须以截图实际尺寸做坐标换算——横屏时 screencap 输出
/// 已旋转的帧缓冲，与 `wm size` 的自然朝向分辨率不一致（Unity 游戏大量横屏）。
pub fn parse_png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.len() < 24 || bytes[0..8] != PNG_MAGIC || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    (w > 0 && h > 0).then_some((w, h))
}

/// 解析 `adb shell wm size` 输出；Override 优先于 Physical。单行解析失败不放弃其余行。
pub fn parse_wm_size(output: &str) -> Option<(u32, u32)> {
    let mut physical = None;
    let mut override_size = None;
    for line in output.lines() {
        let line = line.trim();
        let rest = if let Some(r) = line.strip_prefix("Physical size:") {
            r
        } else if let Some(r) = line.strip_prefix("Override size:") {
            r
        } else {
            continue;
        };
        let mut it = rest.trim().split(['x', 'X']);
        let parsed = (|| {
            let w = it.next()?.trim().parse::<u32>().ok()?;
            let h = it.next()?.trim().parse::<u32>().ok()?;
            Some((w, h))
        })();
        match parsed {
            Some((w, h)) if line.starts_with("Override") => override_size = Some((w, h)),
            Some((w, h)) => physical = Some((w, h)),
            None => continue,
        }
    }
    override_size.or(physical)
}

/// adb input text 只接受有限字符：空格转 %s，其余 shell 敏感字符丢弃。
pub fn escape_input_text(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        match c {
            ' ' => out.push_str("%s"),
            c if c.is_ascii_alphanumeric() || "-._%".contains(c) => out.push(c),
            _ => {}
        }
    }
    out
}

/// 构造每步请求的文本消息（图片由调用方以 image_url 追加到最后一条 user 消息）。
pub fn build_step_messages(task: &str, history: &[Value]) -> Vec<Value> {
    let hist = if history.is_empty() {
        "历史步骤：无，这是第一步。".to_string()
    } else {
        let mut lines: Vec<String> = Vec::new();
        let start = history.len().saturating_sub(8);
        for h in &history[start..] {
            let mut desc = Map::new();
            for k in ["step", "action", "result", "error"] {
                if let Some(v) = h.get(k) {
                    desc.insert(k.to_string(), v.clone());
                }
            }
            lines.push(format!(
                "{}. {}",
                lines.len() + 1,
                serde_json::to_string(&Value::Object(desc)).unwrap_or_default()
            ));
        }
        format!("历史步骤（最近 8 条）：\n{}", lines.join("\n"))
    };
    let user = format!("测试任务：{task}\n\n{hist}\n\n请观察当前截图，输出下一步动作 JSON。");
    vec![
        json!({"role": "system", "content": SYSTEM_PROMPT}),
        json!({"role": "user", "content": user}),
    ]
}

// ---------- adb / OpenAI ----------

fn adb_base(serial: Option<&str>) -> Vec<String> {
    let mut v = vec!["adb".to_string()];
    if let Some(s) = serial.filter(|s| !s.is_empty()) {
        v.push("-s".into());
        v.push(s.to_string());
    }
    v
}

use std::sync::atomic::{AtomicU64, Ordering};
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 带超时的子进程执行：stdout/stderr 落临时文件规避管道缓冲死锁；
/// 超时 kill 并 wait 回收（防止设备死机/USB 异常时挂死 Agent 主循环，防僵尸进程）。
fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Vec<u8>, String> {
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let out_path =
        std::env::temp_dir().join(format!("unity-agent-out-{}-{seq}", std::process::id()));
    let err_path =
        std::env::temp_dir().join(format!("unity-agent-err-{}-{seq}", std::process::id()));
    let cleanup = || {
        let _ = std::fs::remove_file(&out_path);
        let _ = std::fs::remove_file(&err_path);
    };
    let stdout_f = match std::fs::File::create(&out_path) {
        Ok(f) => f,
        Err(e) => return Err(format!("创建临时文件失败: {e}")),
    };
    let stderr_f = match std::fs::File::create(&err_path) {
        Ok(f) => f,
        Err(e) => {
            cleanup();
            return Err(format!("创建临时文件失败: {e}"));
        }
    };
    cmd.stdout(Stdio::from(stdout_f))
        .stderr(Stdio::from(stderr_f));
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            cleanup();
            return Err(format!("进程启动失败: {e}"));
        }
    };
    let start = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait(); // 回收，避免僵尸进程
                cleanup();
                return Err(format!("命令超时（超过 {timeout:?}）已终止"));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(e) => {
                cleanup();
                return Err(format!("等待进程失败: {e}"));
            }
        }
    };
    let stdout = std::fs::read(&out_path).unwrap_or_default();
    let stderr = std::fs::read(&err_path).unwrap_or_default();
    cleanup();
    match status {
        Some(st) if st.success() => Ok(stdout),
        Some(st) => Err(format!(
            "退出码 {:?}: {}",
            st.code(),
            String::from_utf8_lossy(&stderr).trim()
        )),
        None => Err("进程未正常退出".into()),
    }
}

const ADB_TIMEOUT: Duration = Duration::from_secs(30);

fn adb_output(args: &[String]) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new(&args[0]);
    cmd.args(&args[1..]);
    run_with_timeout(cmd, ADB_TIMEOUT)
}

fn adb_shell(serial: Option<&str>, shell_args: Vec<String>) -> Result<(), String> {
    let mut args = adb_base(serial);
    args.push("shell".into());
    args.extend(shell_args);
    adb_output(&args).map(|_| ())
}

fn adb_screencap(serial: Option<&str>) -> Result<Vec<u8>, String> {
    let mut args = adb_base(serial);
    args.extend(["exec-out".into(), "screencap".into(), "-p".into()]);
    adb_output(&args)
}

fn adb_screen_size(serial: Option<&str>) -> (u32, u32) {
    let mut args = adb_base(serial);
    args.extend(["shell".into(), "wm".into(), "size".into()]);
    match adb_output(&args) {
        Ok(bytes) => parse_wm_size(&String::from_utf8_lossy(&bytes)).unwrap_or((1080, 1920)),
        Err(_) => (1080, 1920),
    }
}

fn openai_model() -> String {
    std::env::var("OPENAI_VISION_MODEL")
        .or_else(|_| std::env::var("OPENAI_MODEL"))
        .unwrap_or_else(|_| "gpt-4o-mini".into())
}

/// 调用 OpenAI 兼容视觉接口；返回模型文本输出。
/// `http` 由调用方创建并复用（连接池），避免每步重新 TLS 握手。
fn openai_chat(
    http: &ureq::Agent,
    messages: &[Value],
    image_data_url: &str,
) -> Result<String, String> {
    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    if api_key.trim().is_empty() {
        return Err("OPENAI_API_KEY 未配置".into());
    }
    let base = std::env::var("OPENAI_BASE_URL")
        .unwrap_or_else(|_| "https://api.openai.com/v1".into())
        .trim_end_matches('/')
        .to_string();
    let model = openai_model();
    let mut msgs = messages.to_vec();
    if let Some(last) = msgs.last_mut() {
        let text = last
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        last["content"] = json!([
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ]);
    }
    let resp = http
        .post(&format!("{base}/chat/completions"))
        .set("Authorization", &format!("Bearer {}", api_key.trim()))
        .send_json(json!({"model": model, "messages": msgs, "temperature": 0.2}))
        .map_err(|e| format!("模型调用失败: {e}"))?;
    let v: Value = resp
        .into_json()
        .map_err(|e| format!("模型响应解析失败: {e}"))?;
    let text = v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_string();
    if text.is_empty() {
        return Err("模型返回为空".into());
    }
    Ok(text)
}

fn execute_action(px: &Value, serial: Option<&str>) -> String {
    let action = px["action"].as_str().unwrap_or_default();
    let r = match action {
        "tap" => adb_shell(
            serial,
            vec![
                "input".into(),
                "tap".into(),
                px["x"].to_string(),
                px["y"].to_string(),
            ],
        ),
        "swipe" => {
            let ms = (px["duration"].as_f64().unwrap_or(0.5) * 1000.0) as i64;
            adb_shell(
                serial,
                vec![
                    "input".into(),
                    "swipe".into(),
                    px["x1"].to_string(),
                    px["y1"].to_string(),
                    px["x2"].to_string(),
                    px["y2"].to_string(),
                    ms.to_string(),
                ],
            )
        }
        "text" => {
            let raw = px["text"].as_str().unwrap_or_default();
            let text = escape_input_text(raw);
            if text.is_empty() && !raw.is_empty() {
                // 明确告知模型输入被丢弃，避免其误以为输入成功
                Err("不支持非 ASCII 文本输入（adb input text 限制，仅支持 ASCII）".into())
            } else {
                adb_shell(serial, vec!["input".into(), "text".into(), text])
            }
        }
        "key" => adb_shell(
            serial,
            vec![
                "input".into(),
                "keyevent".into(),
                px["key"].as_str().unwrap_or_default().to_string(),
            ],
        ),
        "wait" => {
            std::thread::sleep(Duration::from_secs_f64(
                px["seconds"].as_f64().unwrap_or(1.0).min(30.0),
            ));
            Ok(())
        }
        _ => Err("未知动作".into()),
    };
    match r {
        Ok(()) => "ok".into(),
        Err(e) => format!("执行失败: {e}"),
    }
}

// ---------- 主循环 ----------

pub fn run_ai_exploratory(
    job: &Value,
    platform: &str,
    workdir: &Path,
) -> Result<ExecOutcome, String> {
    let extra = job.get("extra").cloned().unwrap_or(json!({}));
    let task = extra
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if task.is_empty() {
        return Ok(ExecOutcome::failure(
            json!({"message": "缺少 extra.prompt（AI 探索测试目标）"}),
        ));
    }
    if std::env::var("OPENAI_API_KEY")
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return Ok(ExecOutcome::failure(
            json!({"message": "OPENAI_API_KEY 未配置"}),
        ));
    }
    if platform != "android" {
        return Ok(ExecOutcome::failure(json!({
            "message": format!("AI 探索测试当前仅支持 android 平台（收到 {platform}），Windows 桌面驱动待接入")
        })));
    }
    let serial = extra
        .get("device_serial")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .or_else(|| std::env::var("ANDROID_SERIAL").ok())
        .filter(|s| !s.is_empty());

    std::fs::create_dir_all(workdir).map_err(|e| format!("创建工作目录失败: {e}"))?;
    let device = format!("Android:///{}", serial.as_deref().unwrap_or(""));
    let model = openai_model();
    // 复用连接池：整个探索循环共享一个 HTTP 客户端（避免每步完整 TLS 握手）
    let http = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(120))
        .build();
    let max_steps = extra
        .get("max_steps")
        .and_then(Value::as_i64)
        .unwrap_or(12)
        .clamp(1, 200); // 上限防御：超大 max_steps 会长期占用 Agent 并消耗模型费用

    // 唤醒屏幕（Python 版 connect_device 后 wake 的等价物），锁屏时避免在黑屏上空耗步数
    if platform == "android" {
        let _ = adb_shell(
            serial.as_deref(),
            vec!["input".into(), "keyevent".into(), "WAKEUP".into()],
        );
    }

    let mut history: Vec<Value> = Vec::new();
    let mut success = false;
    let mut reason = "达到最大步数".to_string();

    for i in 1..=max_steps {
        // 截图 → base64 data URL
        let png = workdir.join(format!("step_{i:02}.png"));
        let bytes = match adb_screencap(serial.as_deref()) {
            Ok(b) => b,
            Err(e) => {
                reason = format!("截图失败: {e}");
                break;
            }
        };
        if bytes.is_empty() {
            reason = "截图为空（设备可能处于异常状态）".into();
            break;
        }
        if std::fs::write(&png, &bytes).is_err() {
            reason = format!("写入截图失败: {}", png.display());
            break;
        }
        // 以截图实际尺寸换算坐标（横屏时与 wm size 的自然朝向不同）
        let (w, h) = parse_png_size(&bytes)
            .or_else(|| Some(adb_screen_size(serial.as_deref())))
            .unwrap_or((1080, 1920));
        let data_url = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );

        // 视觉模型决策
        let messages = build_step_messages(&task, &history);
        let out = match openai_chat(&http, &messages, &data_url) {
            Ok(o) => o,
            Err(e) => {
                reason = e;
                break;
            }
        };

        let Some(act) = parse_action(&out).filter(validate_action) else {
            let raw: String = out.chars().take(200).collect();
            history.push(json!({"step": i, "raw": raw, "error": "动作解析失败，请重新输出 JSON"}));
            continue;
        };

        if act["action"] == "finish" {
            success = act["success"].as_bool().unwrap_or(false);
            reason = act["reason"].as_str().unwrap_or_default().to_string();
            history.push(json!({"step": i, "action": act, "result": "finish"}));
            break;
        }

        let px = to_pixels(&act, w, h);
        let result = execute_action(&px, serial.as_deref());
        history.push(json!({
            "step": i, "action": act, "result": result,
            "screenshot": png.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        }));
        std::thread::sleep(Duration::from_secs(1));
    }

    let steps_path = workdir.join("steps.json");
    let record = json!({"task": task, "success": success, "reason": reason, "steps": history});
    std::fs::write(
        &steps_path,
        serde_json::to_string_pretty(&record).unwrap_or_default(),
    )
    .map_err(|e| format!("写入步骤记录失败: {e}"))?;

    let summary = json!({
        "message": if success { "AI 探索测试达成" } else { "AI 探索测试未达成" },
        "model": model,
        "device": device,
        "steps": history.len(),
        "reason": reason,
    });
    Ok(ExecOutcome {
        success,
        log_path: Some(steps_path.to_string_lossy().into_owned()),
        summary,
        artifacts: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_action_plain_json() {
        let act = parse_action(r#"{"action":"tap","x":0.5,"y":0.3}"#).unwrap();
        assert_eq!(act["action"], "tap");
        assert_eq!(act["x"], 0.5);
    }

    #[test]
    fn test_parse_action_code_fence() {
        let text = "```json\n{\"action\":\"finish\",\"success\":true,\"reason\":\"ok\"}\n```";
        assert_eq!(parse_action(text).unwrap()["action"], "finish");
    }

    #[test]
    fn test_parse_action_with_noise() {
        let text = "好的，下一步：{\"action\":\"tap\",\"x\":0.1,\"y\":0.2} 请确认";
        assert_eq!(parse_action(text).unwrap()["action"], "tap");
    }

    #[test]
    fn test_parse_action_invalid() {
        assert!(parse_action("我觉得应该点击设置按钮").is_none());
        assert!(parse_action("").is_none());
        assert!(parse_action("[1,2,3]").is_none()); // 非 JSON 对象
    }

    #[test]
    fn test_validate_action() {
        assert!(validate_action(
            &json!({"action": "tap", "x": 0.1, "y": 0.9})
        ));
        assert!(!validate_action(
            &json!({"action": "tap", "x": 1.5, "y": 0.1})
        ));
        assert!(!validate_action(
            &json!({"action": "fly", "x": 0.1, "y": 0.1})
        ));
        assert!(validate_action(
            &json!({"action": "swipe", "x1": 0, "y1": 0, "x2": 1, "y2": 1})
        ));
        assert!(validate_action(
            &json!({"action": "finish", "success": false})
        ));
        assert!(!validate_action(
            &json!({"action": "finish", "success": "yes"})
        ));
        assert!(!validate_action(&json!({"action": "wait", "seconds": 999})));
        assert!(validate_action(&json!({"action": "wait"}))); // 缺省 1 秒
        assert!(validate_action(&json!({"action": "key", "key": "BACK"})));
        assert!(validate_action(
            &json!({"action": "key", "key": "KEYCODE_WAKEUP"})
        ));
        // shell 元字符必须被拒（adb shell 会把参数交给设备端 sh 解释）
        assert!(!validate_action(
            &json!({"action": "key", "key": "; reboot"})
        ));
        assert!(!validate_action(&json!({"action": "key", "key": "a b"})));
        assert!(!validate_action(&json!({"action": "key", "key": "$(id)"})));
    }

    #[test]
    fn test_to_pixels() {
        let px = to_pixels(&json!({"action": "tap", "x": 0.5, "y": 0.25}), 1080, 1920);
        assert_eq!(px["x"], 540);
        assert_eq!(px["y"], 480);
        let sw = to_pixels(
            &json!({"action": "swipe", "x1": 0, "y1": 0, "x2": 1, "y2": 1}),
            1000,
            2000,
        );
        assert_eq!(sw["x1"], 0);
        assert_eq!(sw["y2"], 2000);
        assert_eq!(sw["duration"], 0.5);
    }

    #[test]
    fn test_parse_wm_size() {
        assert_eq!(
            parse_wm_size("Physical size: 1080x1920"),
            Some((1080, 1920))
        );
        assert_eq!(
            parse_wm_size("Physical size: 1080x1920\r\nOverride size: 900x1600"),
            Some((900, 1600))
        );
        assert_eq!(parse_wm_size("nothing"), None);
        // 单行解析失败不放弃其余行
        assert_eq!(
            parse_wm_size("Physical size: bad\nOverride size: 1080x1920"),
            Some((1080, 1920))
        );
    }

    #[test]
    fn test_parse_png_size() {
        // 最小合法 PNG 头：magic + IHDR 长度 + "IHDR" + 宽高（大端）
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend_from_slice(&[0, 0, 0, 13]);
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&1920u32.to_be_bytes());
        png.extend_from_slice(&1080u32.to_be_bytes());
        assert_eq!(parse_png_size(&png), Some((1920, 1080)));
        assert_eq!(parse_png_size(&[]), None);
        assert_eq!(parse_png_size(b"not a png at all....."), None);
    }

    #[test]
    fn test_escape_input_text() {
        assert_eq!(escape_input_text("hello world"), "hello%sworld");
        // 允许 -._% 与字母数字；分号、斜杠等 shell 敏感字符被丢弃
        assert_eq!(escape_input_text("abc; rm -rf /"), "abc%srm%s-rf%s");
        assert_eq!(escape_input_text("user-1.name"), "user-1.name");
        assert_eq!(escape_input_text("192.168.1.1"), "192.168.1.1");
    }

    #[test]
    fn test_build_step_messages() {
        let history = vec![
            json!({"step": 1, "action": {"action": "tap"}, "result": "ok", "screenshot": "step_01.png"}),
        ];
        let msgs = build_step_messages("打开设置面板", &history);
        assert_eq!(msgs[0]["role"], "system");
        let user = msgs[1]["content"].as_str().unwrap();
        assert!(user.contains("打开设置面板"));
        assert!(user.contains("历史步骤"));
        assert!(user.contains("tap"));
    }
}
