// 运维诊断执行器：TCP 端口连通性 / TLS 证书有效期 / DNS 解析断言。
// 面向游戏服务器运维监控（登录服/网关端口、证书到期、域名解析），全部零依赖。
package main

import (
	"crypto/tls"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

// executePortCheck TCP 端口连通性检查（游戏登录服/网关端口监控）。
// extra: {"host": "1.2.3.4", "port": 7777, "expect_open": true, "timeout_ms": 3000, "latency_ms": 200}
func executePortCheck(job map[string]any) (bool, map[string]any) {
	extra, _ := job["extra"].(map[string]any)
	host, _ := extra["host"].(string)
	host = strings.TrimSpace(host)
	port := int(numFromAny(extra, "port", 0))
	if host == "" || port <= 0 || port > 65535 {
		return false, map[string]any{"message": "需要 host 与有效 port（1-65535）"}
	}
	expectOpen := true
	if v, ok := extra["expect_open"].(bool); ok {
		expectOpen = v
	}
	timeoutMS := numFromAny(extra, "timeout_ms", 3000)
	addr := net.JoinHostPort(host, strconv.Itoa(port))

	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, time.Duration(timeoutMS)*time.Millisecond)
	latency := time.Since(start).Milliseconds()
	if conn != nil {
		_ = conn.Close()
	}

	open := err == nil
	checks := map[string]any{"addr": addr, "open": open, "latency_ms": latency}
	success := open == expectOpen
	msg := ""
	switch {
	case err != nil:
		msg = fmt.Sprintf("端口不可达 %s: %v", addr, err)
	case !success:
		msg = fmt.Sprintf("端口 %s 状态不符（open=%v，期望 %v）", addr, open, expectOpen)
	default:
		msg = fmt.Sprintf("端口可达 %s（%dms）", addr, latency)
	}
	if maxLatency := int64(numFromAny(extra, "latency_ms", 0)); maxLatency > 0 && latency > maxLatency && success {
		success = false
		msg = fmt.Sprintf("连接延迟 %dms > 上限 %dms", latency, maxLatency)
	}
	return success, map[string]any{"message": msg, "checks": checks}
}

// executeCertCheck TLS 证书到期检查（游戏官网/账号服/API 域名运维）。
// extra: {"host": "api.example.com", "port": 443, "min_days_valid": 14}
// 说明：读取对端证书（不校验信任链，自签名也可检查到期时间）。
func executeCertCheck(job map[string]any) (bool, map[string]any) {
	extra, _ := job["extra"].(map[string]any)
	host, _ := extra["host"].(string)
	host = strings.TrimSpace(host)
	port := int(numFromAny(extra, "port", 443))
	if host == "" {
		return false, map[string]any{"message": "缺少 host"}
	}
	minDays := int(numFromAny(extra, "min_days_valid", 14))

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{
		InsecureSkipVerify: true, //nolint:gosec // 只读取证书元数据（到期/签发者），不校验信任链
		ServerName:         host,
	})
	if err != nil {
		return false, map[string]any{"message": fmt.Sprintf("TLS 握手失败 %s: %v", addr, err)}
	}
	defer conn.Close()

	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return false, map[string]any{"message": "对端未返回证书"}
	}
	leaf := certs[0]
	days := int(time.Until(leaf.NotAfter).Hours() / 24)
	success := days >= minDays
	msg := fmt.Sprintf("证书剩余 %d 天（%s 签发，%s 到期）", days, leaf.Issuer.CommonName, leaf.NotAfter.Format("2006-01-02"))
	if !success {
		msg = fmt.Sprintf("证书仅剩 %d 天（低于阈值 %d 天），%s 到期", days, minDays, leaf.NotAfter.Format("2006-01-02"))
	}
	return success, map[string]any{
		"message":   msg,
		"host":      addr,
		"subject":   leaf.Subject.CommonName,
		"issuer":    leaf.Issuer.CommonName,
		"not_after": leaf.NotAfter.Format("2006-01-02 15:04:05"),
		"days_left": days,
		"min_days":  minDays,
	}
}

// executeDNSCheck DNS 解析检查（域名解析成功 / 期望 IP 命中）。
// extra: {"hostname": "gate.example.com", "expected_ips": "1.2.3.4,5.6.7.8"}
func executeDNSCheck(job map[string]any) (bool, map[string]any) {
	extra, _ := job["extra"].(map[string]any)
	hostname, _ := extra["hostname"].(string)
	hostname = strings.TrimSpace(hostname)
	if hostname == "" {
		return false, map[string]any{"message": "缺少 hostname"}
	}
	var expected []string
	switch v := extra["expected_ips"].(type) {
	case string:
		for _, s := range strings.Split(v, ",") {
			if s = strings.TrimSpace(s); s != "" {
				expected = append(expected, s)
			}
		}
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				expected = append(expected, s)
			}
		}
	}

	ips, err := net.LookupHost(hostname)
	if err != nil {
		return false, map[string]any{"message": fmt.Sprintf("解析失败 %s: %v", hostname, err)}
	}
	checks := map[string]any{"hostname": hostname, "resolved": ips}
	success := len(ips) > 0
	if len(expected) > 0 {
		hit := false
		for _, e := range expected {
			for _, ip := range ips {
				if ip == e {
					hit = true
				}
			}
		}
		checks["expected"] = expected
		checks["expected_hit"] = hit
		if !hit {
			success = false
		}
	}
	msg := fmt.Sprintf("DNS 解析 %s → %s", hostname, strings.Join(ips, ", "))
	if len(expected) > 0 {
		msg += fmt.Sprintf("（期望命中 %v）", expected)
	}
	if !success {
		msg = "DNS 解析失败: " + msg
	}
	return success, map[string]any{"message": msg, "checks": checks}
}
