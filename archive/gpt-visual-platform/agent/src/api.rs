//! 与编排服务的 HTTP 通信：注册、心跳、拉取、上报（agents/runner_common.py 的 Rust 移植）。
//! TLS 证书策略（三选一，按优先级）：
//! 1. `PLATFORM_INSECURE_TLS=1`：跳过证书校验（自签名快速路径，仅限可信内网，配合 PLATFORM_TOKEN）；
//! 2. `PLATFORM_TLS_CERT=<PEM 路径>`：信任指定证书（服务端 data/tls/cert.pem，推荐）；
//! 3. 默认：公网 CA 校验。
use base64::Engine;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

/// 模块级健康探测：按环境变量构建 TLS 配置，访问 {PLATFORM_URL}/api/health。
pub fn health_probe() -> Result<String, String> {
    let base = std::env::var("PLATFORM_URL")
        .unwrap_or_else(|_| "http://localhost:9111".into())
        .trim_end_matches('/')
        .to_string();
    let insecure = std::env::var("PLATFORM_INSECURE_TLS")
        .unwrap_or_default()
        .trim()
        == "1";
    let mut builder = ureq::AgentBuilder::new().timeout(Duration::from_secs(10));
    if insecure {
        builder = builder.tls_config(Arc::new(build_tls_config()));
    }
    let agent = builder.build();
    let resp = agent
        .get(&format!("{base}/api/health"))
        .call()
        .map_err(|e| e.to_string())?;
    resp.into_string().map_err(|e| e.to_string())
}

pub struct PlatformClient {
    pub base_url: String,
    pub agent_id: String,
    token: Option<String>,
    agent: ureq::Agent,
}

/// 跳过服务端证书校验的 Verifier（签名算法仍走标准 provider 校验，握手完整性不受影响）。
#[derive(Debug)]
struct SkipServerVerification(rustls::crypto::CryptoProvider);

impl ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// 按环境变量构建 TLS 配置（与编排服务的自签名证书体系配套）。
fn build_tls_config() -> rustls::ClientConfig {
    let builder = rustls::ClientConfig::builder_with_provider(
        rustls::crypto::ring::default_provider().into(),
    )
    .with_protocol_versions(&[&rustls::version::TLS12, &rustls::version::TLS13])
    .expect("TLS 版本配置应可用");

    // 1) 显式跳过校验（自签名快速路径）
    if std::env::var("PLATFORM_INSECURE_TLS")
        .unwrap_or_default()
        .trim()
        == "1"
    {
        let provider = rustls::crypto::ring::default_provider();
        return builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(SkipServerVerification(provider)))
            .with_no_client_auth();
    }

    // 2) 信任指定证书（推荐：拷贝服务端 data/tls/cert.pem 给 Agent）
    if let Ok(cert_path) = std::env::var("PLATFORM_TLS_CERT") {
        if !cert_path.trim().is_empty() {
            let mut roots = rustls::RootCertStore::empty();
            let pem = std::fs::read(cert_path.trim())
                .unwrap_or_else(|e| panic!("读取 PLATFORM_TLS_CERT 失败: {e}"));
            for der in pem_certs(&pem) {
                roots
                    .add(der)
                    .expect("PLATFORM_TLS_CERT 证书加入信任链失败");
            }
            return builder.with_root_certificates(roots).with_no_client_auth();
        }
    }

    // 3) 默认：公网 CA（Mozilla roots）
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    builder.with_root_certificates(roots).with_no_client_auth()
}

/// 极简 PEM → DER 提取（仅 CERTIFICATE 块，复用已有 base64 依赖）。
fn pem_certs(pem: &[u8]) -> Vec<CertificateDer<'static>> {
    let text = String::from_utf8_lossy(pem);
    let mut out = Vec::new();
    let mut it = text.lines().peekable();
    while let Some(line) = it.find(|l| l.trim() == "-----BEGIN CERTIFICATE-----") {
        let _ = line;
        let mut b64 = String::new();
        for l in it.by_ref() {
            let t = l.trim();
            if t == "-----END CERTIFICATE-----" {
                break;
            }
            b64.push_str(t);
        }
        if let Ok(der) = base64::engine::general_purpose::STANDARD.decode(b64) {
            out.push(CertificateDer::from(der));
        }
    }
    out
}

impl PlatformClient {
    pub fn new(base_url: &str, agent_id: &str) -> Self {
        let token = std::env::var("PLATFORM_TOKEN")
            .ok()
            .filter(|t| !t.is_empty());
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            agent_id: agent_id.to_string(),
            token,
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(10))
                .tls_config(Arc::new(build_tls_config()))
                .build(),
        }
    }

    fn post(&self, path: &str, body: Value) -> Result<(), String> {
        let mut req = self.agent.post(&format!("{}{path}", self.base_url));
        if let Some(t) = &self.token {
            req = req.set("X-Platform-Token", t);
        }
        req.send_json(body).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn register(&self, platform: &str, skills: &[String]) -> Result<(), String> {
        self.post(
            "/api/agents/register",
            json!({"agent_id": self.agent_id, "platform": platform, "skills": skills, "extra": {}}),
        )
    }

    pub fn heartbeat(&self, status: &str, current_job_id: Option<i64>) -> Result<(), String> {
        self.post(
            "/api/agents/heartbeat",
            json!({"agent_id": self.agent_id, "status": status, "current_job_id": current_job_id}),
        )
    }

    /// 拉取该平台下一条匹配任务；skills 用于与任务的 required_skills 匹配（查询参数需编码）。
    pub fn poll(&self, platform: &str, skills: &[String]) -> Result<Option<Value>, String> {
        let mut url = format!("{}/api/jobs/poll/{}", self.base_url, platform);
        if !skills.is_empty() {
            url.push_str(&format!(
                "?skills={}",
                crate::airtest::urlencode(&skills.join(","))
            ));
        }
        let mut req = self.agent.get(&url);
        if let Some(t) = &self.token {
            req = req.set("X-Platform-Token", t);
        }
        let resp = req.call().map_err(|e| e.to_string())?;
        let v: Value = resp.into_json().map_err(|e| e.to_string())?;
        Ok(v.get("job").cloned().filter(|j| !j.is_null()))
    }

    pub fn submit_result(
        &self,
        job_id: i64,
        success: bool,
        log_path: Option<&str>,
        summary: &Value,
    ) -> Result<(), String> {
        self.post(
            "/api/jobs/result",
            json!({
                "job_id": job_id,
                "agent_id": self.agent_id,
                "success": success,
                "log_path": log_path,
                "summary": summary,
            }),
        )
    }

    /// 上传任务产物（执行记录）到编排服务，供看板直接查看。尽力而为，失败由调用方记录。
    pub fn upload_artifacts(&self, job_id: i64, files: &[(String, String)]) -> Result<(), String> {
        if files.is_empty() {
            return Ok(());
        }
        let payload: Vec<Value> = files
            .iter()
            .map(|(name, content)| json!({"name": name, "content": content}))
            .collect();
        // 扁平路径：job_id 在请求体中（与 Go 版服务端一致）
        self.post(
            "/api/jobs/artifacts",
            json!({"job_id": job_id, "agent_id": self.agent_id, "files": payload}),
        )
    }
}
