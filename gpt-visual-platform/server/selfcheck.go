// 内置环境自检：基础任务的真实执行器（替代占位）。
// 对运行环境做一组真实断言：存储可写、TLS 证书、技能表、磁盘空间、版本信息。
package main

import (
	"os"
)

// executeSelfCheck 环境自检（platform=web 内置执行）。
func executeSelfCheck(job map[string]any, store *Store) (bool, map[string]any) {
	checks := map[string]any{}
	failed := []string{}

	// 1) 存储可写（数据目录真实写探针）
	if err := store.HealthCheck(); err != nil {
		failed = append(failed, "存储不可写: "+err.Error())
		checks["storage"] = "不可写"
	} else {
		checks["storage"] = "可写"
	}

	// 2) TLS 证书（HTTPS 模式应存在；HTTP 模式视为信息项不判失败）
	certPath, _ := tlsCertPaths(store.DataDir())
	if _, err := os.Stat(certPath); err == nil {
		checks["tls_cert"] = "已配置"
	} else {
		checks["tls_cert"] = "未生成（HTTP 模式）"
	}

	// 3) 技能表已加载
	checks["skills"] = len(skills)
	if len(skills) == 0 {
		failed = append(failed, "技能表为空")
	}

	// 4) 磁盘可用空间 ≥ 100MB
	freeMB, err := diskFreeMB(store.DataDir())
	if err != nil {
		checks["disk_free_mb"] = "未知"
	} else {
		checks["disk_free_mb"] = freeMB
		if freeMB >= 0 && freeMB < 100 {
			failed = append(failed, "磁盘可用空间不足 100MB")
		}
	}

	// 5) 任务存储可读
	if jobsJSON, err := store.ListJobsJSON(); err != nil {
		failed = append(failed, "任务存储读取失败: "+err.Error())
	} else if len(jobsJSON) > 2 {
		checks["jobs_store"] = "可读"
	}

	checks["version"] = version
	success := len(failed) == 0
	msg := "环境自检通过"
	if !success {
		msg = "环境自检失败: " + joinStrings(failed, "；")
	}
	return success, map[string]any{"message": msg, "checks": checks}
}

func joinStrings(list []string, sep string) string {
	out := ""
	for i, s := range list {
		if i > 0 {
			out += sep
		}
		out += s
	}
	return out
}
