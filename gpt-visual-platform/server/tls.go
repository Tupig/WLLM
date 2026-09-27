// TLS 证书管理：优先使用用户提供的证书（TLS_CERT/TLS_KEY），
// 否则自动生成自签名证书（ECDSA P-256，SAN 覆盖 localhost/127.0.0.1/::1/主机名/所有网卡 IP），
// 存放于 data/tls/ 跨重启复用。启动时打印 SHA-256 指纹供 Agent 侧核对。
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

// tlsCertPaths 自签名证书的存放位置（数据目录下，跨重启复用）。
func tlsCertPaths(dataDir string) (string, string) {
	dir := filepath.Join(dataDir, "tls")
	return filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
}

// certFingerprint 计算证书 SHA-256 指纹（hex，冒号分隔）。
func certFingerprint(certFile string) (string, error) {
	pair, err := tls.LoadX509KeyPair(certFile, certFile) // 只为取叶子证书
	if err != nil {
		// LoadX509KeyPair 需要匹配的 key；改为只读证书 PEM
		pemBytes, rerr := os.ReadFile(certFile)
		if rerr != nil {
			return "", rerr
		}
		return fingerprintFromPEM(pemBytes)
	}
	return fingerprintFromDER(pair.Certificate[0]), nil
}

// ensureTLSCertificate 确保证书可用。
// 优先级：用户证书（certFile/keyFile 均非空）> 数据目录中已生成的自签名证书 > 新生成。
// 返回 (certFile, keyFile, sha256指纹hex, error)。
func ensureTLSCertificate(dataDir, userCert, userKey string) (string, string, string, error) {
	if userCert != "" && userKey != "" {
		fp, err := certFingerprint(userCert)
		if err != nil {
			return "", "", "", fmt.Errorf("加载用户证书失败: %w", err)
		}
		return userCert, userKey, fp, nil
	}

	certPath, keyPath := tlsCertPaths(dataDir)
	if _, err := tls.LoadX509KeyPair(certPath, keyPath); err == nil {
		fp, err := certFingerprint(certPath)
		if err != nil {
			return "", "", "", err
		}
		return certPath, keyPath, fp, nil
	}

	certPEM, keyPEM, err := generateSelfSigned()
	if err != nil {
		return "", "", "", err
	}
	if err := os.MkdirAll(filepath.Dir(certPath), 0o755); err != nil {
		return "", "", "", err
	}
	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil {
		return "", "", "", err
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		return "", "", "", err
	}
	fp, err := fingerprintFromPEM(certPEM)
	if err != nil {
		return "", "", "", err
	}
	return certPath, keyPath, fp, nil
}

// generateSelfSigned 生成自签名证书（ECDSA P-256，有效期 5 年）。
func generateSelfSigned() ([]byte, []byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}

	host, _ := os.Hostname()
	dnsNames := []string{"localhost"}
	var ips []net.IP = []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() {
				if ipn.IP.To4() != nil || ipn.IP.To16() != nil {
					ips = append(ips, ipn.IP)
					dnsNames = append(dnsNames, ipn.IP.String())
				}
			}
		}
	}
	dnsNames = appendUnique(dnsNames, host) // 主机名（可能不含点）

	serial, err := rand.Int(rand.Reader, serialLimit)
	if err != nil {
		return nil, nil, err
	}
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "Unity Test Platform (self-signed)", Organization: []string{"unity-test-platform"}},
		NotBefore:             time.Now().Add(-24 * time.Hour),
		NotAfter:              time.Now().AddDate(5, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true, // 自签名需 CA 位，便于导入系统信任链
		DNSNames:              dedup(dnsNames),
		IPAddresses:           dedupIPs(ips),
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return certPEM, keyPEM, nil
}

// serialLimit 证书序列号上限（20 字节，符合 RFC 5280 对 serial 的建议范围）。
var serialLimit = new(big.Int).Lsh(big.NewInt(1), 128)

func fingerprintFromPEM(pemBytes []byte) (string, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return "", fmt.Errorf("证书 PEM 解析失败")
	}
	return fingerprintFromDER(block.Bytes), nil
}

func fingerprintFromDER(der []byte) string {
	sum := sha256.Sum256(der)
	out := ""
	for i, b := range sum {
		if i > 0 {
			out += ":"
		}
		out += fmt.Sprintf("%02X", b)
	}
	return out
}

func appendUnique(list []string, v string) []string {
	if v == "" {
		return list
	}
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

func dedup(list []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range list {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func dedupIPs(list []net.IP) []net.IP {
	seen := map[string]bool{}
	out := []net.IP{}
	for _, v := range list {
		k := v.String()
		if !seen[k] {
			seen[k] = true
			out = append(out, v)
		}
	}
	return out
}
