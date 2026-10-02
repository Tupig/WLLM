/**
 * gameqa/tls.ts — TLS 证书管理（Go server/tls.go 移植）
 * 优先用户证书（TLS_CERT/TLS_KEY）> 数据目录已生成自签名证书 > openssl 生成
 * （ECDSA P-256，SAN 覆盖 localhost/127.0.0.1/::1/主机名/所有网卡 IP），跨重启复用，
 * 启动时打印 SHA-256 指纹（与 Go 版同格式：大写 hex 冒号分隔）供 Agent 侧核对。
 */
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface TLSCertPaths {
  certFile: string;
  keyFile: string;
  fingerprint: string;
  selfSigned: boolean;
}

/** 证书 PEM → SHA-256 指纹（大写 hex 冒号分隔，对齐 Go fingerprintFromDER） */
export function fingerprintFromPem(pemBytes: Buffer | string): string {
  const cert = new X509Certificate(pemBytes);
  return cert.fingerprint256;
}

function fingerprintFromCertFile(certFile: string): string {
  return fingerprintFromPem(fs.readFileSync(certFile));
}

function tlsCertPaths(dataDir: string): { certPath: string; keyPath: string } {
  const dir = path.join(dataDir, "tls");
  return { certPath: path.join(dir, "cert.pem"), keyPath: path.join(dir, "key.pem") };
}

/** SAN 条目：localhost / 回环 / 主机名 / 全部网卡 IP */
export function buildSubjectAltName(): string {
  const dns = new Set<string>(["localhost"]);
  const ips = new Set<string>(["127.0.0.1", "::1"]);
  const host = os.hostname();
  if (host !== "") dns.add(host);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (!ni.internal) ips.add(ni.address);
    }
  }
  // IP 字面量只进 IP SAN，主机名进 DNS SAN
  const ipSet = new Set([...ips]);
  const dnsOnly = [...dns].filter((d) => !ipSet.has(d));
  return [
    ...dnsOnly.map((d) => `DNS:${d}`),
    ...[...ips].map((i) => `IP:${i}`),
  ].join(",");
}

function generateSelfSigned(certPath: string, keyPath: string): void {
  fs.mkdirSync(path.dirname(certPath), { recursive: true });
  const san = buildSubjectAltName();
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "ec",
      "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-keyout", keyPath,
      "-out", certPath,
      "-days", "1825",
      "-nodes",
      "-subj", "/O=unity-test-platform/CN=Unity Test Platform (self-signed)",
      "-addext", `subjectAltName=${san}`,
    ], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    const e = err as { stderr?: Buffer };
    throw new Error(`自签名证书生成失败（需要 openssl）: ${(e.stderr ?? Buffer.from("")).toString().trim() || (err as Error).message}`);
  }
  fs.chmodSync(keyPath, 0o600);
}

/**
 * 确保证书可用。返回 (certFile, keyFile, sha256指纹, 是否自签名)。
 * 优先级：用户证书（均非空）> 数据目录已生成证书（可解析即复用）> 新生成。
 */
export function ensureTLSCertificate(dataDir: string, userCert: string, userKey: string): TLSCertPaths {
  if (userCert !== "" && userKey !== "") {
    return { certFile: userCert, keyFile: userKey, fingerprint: fingerprintFromCertFile(userCert), selfSigned: false };
  }
  const { certPath, keyPath } = tlsCertPaths(dataDir);
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const fp = fingerprintFromCertFile(certPath);
      // 简单有效性校验：证书在有效期内（过期后重新生成）
      const cert = new X509Certificate(fs.readFileSync(certPath));
      if (new Date(cert.validTo).getTime() > Date.now()) {
        return { certFile: certPath, keyFile: keyPath, fingerprint: fp, selfSigned: true };
      }
    } catch {
      /* 损坏/过期 → 重新生成 */
    }
  }
  generateSelfSigned(certPath, keyPath);
  return { certFile: certPath, keyFile: keyPath, fingerprint: fingerprintFromCertFile(certPath), selfSigned: true };
}

