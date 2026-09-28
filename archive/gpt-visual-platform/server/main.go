// Unity3D MMORPG 自动化测试平台 - 编排服务（Go 版）
// 与 Python 版 main.py 的 API 完全对齐；前端看板（static/）无需改动。
// 运行：go run . （默认端口 9111；PORT/DATA_DIR/STATIC_DIR 环境变量或同名 flag 可覆盖）
// 版本注入：go build -ldflags "-X main.version=v1.0.0"
package main

import (
	"context"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// version 构建时通过 -ldflags "-X main.version=..." 注入。
var version = "dev"

// maxBodyBytes 请求体上限：防止恶意超大 JSON 消耗内存。
const maxBodyBytes = 1 << 20 // 1 MiB

// toolNameRe MCP 工具名白名单。
var toolNameRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// Server 编排服务：持有存储与静态目录。
type Server struct {
	store     *Store
	staticDir string
}

// NewServer 供 main 与测试共同使用。
func NewServer(store *Store, staticDir string) http.Handler {
	s := &Server{store: store, staticDir: staticDir}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/version", s.handleVersion)
	mux.HandleFunc("GET /api/skills", s.handleSkills)
	mux.HandleFunc("POST /api/agents/register", s.handleRegister)
	mux.HandleFunc("POST /api/agents/heartbeat", s.handleHeartbeat)
	mux.HandleFunc("GET /api/agents", s.handleListAgents)
	mux.HandleFunc("POST /api/generate-test", s.handleGenerateTest)
	mux.HandleFunc("POST /api/jobs", s.handleCreateJob)
	mux.HandleFunc("GET /api/jobs", s.handleListJobs)
	mux.HandleFunc("POST /api/jobs/result", s.handleJobResult)
	mux.HandleFunc("POST /api/jobs/cleanup", s.handleCleanupJobs)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", s.handleCancelJob)
	mux.HandleFunc("DELETE /api/jobs/{id}", s.handleDeleteJob)
	mux.HandleFunc("POST /api/jobs/artifacts", s.handleUploadArtifacts)
	mux.HandleFunc("GET /api/jobs/artifacts", s.handleListArtifacts)
	mux.HandleFunc("GET /api/jobs/artifacts/{name}", s.handleGetArtifact)
	mux.HandleFunc("GET /api/jobs/poll/{platform}", s.handlePollJob)
	mux.HandleFunc("GET /api/jobs/{id}", s.handleGetJob)

	mux.HandleFunc("GET /api/mcp/status", s.handleMCPStatus)
	mux.HandleFunc("POST /api/mcp/execute-tool", s.handleMCPExecuteTool)
	mux.HandleFunc("POST /api/mcp/batch-execute", s.handleMCPBatchExecute)
	mux.HandleFunc("POST /api/mcp/set-active-instance", s.handleMCPSetActiveInstance)
	mux.HandleFunc("POST /api/mcp/manage-scene", s.handleMCPManageScene)
	mux.HandleFunc("POST /api/mcp/manage-asset", s.handleMCPManageAsset)
	mux.HandleFunc("POST /api/mcp/manage-material", s.handleMCPManageMaterial)
	mux.HandleFunc("POST /api/mcp/execute-menu-item", s.handleMCPExecuteMenuItem)
	mux.HandleFunc("GET /api/mcp/project-info", s.handleMCPProjectInfo)
	mux.HandleFunc("GET /api/mcp/scene-info", s.handleMCPSceneInfo)

	staticHandler := http.StripPrefix("/static/", http.FileServer(noDirFS{http.Dir(s.staticDir)}))
	mux.Handle("GET /static/", noCache(staticHandler))
	mux.HandleFunc("GET /", s.handleIndex)
	return requestLogger(recoverer(tokenAuth(mux)))
}

func main() {
	port := flag.String("port", envOr("PORT", "9111"), "监听端口")
	dataDir := flag.String("data", envOr("DATA_DIR", "data"), "数据目录")
	staticDir := flag.String("static", envOr("STATIC_DIR", "static"), "静态资源目录")
	tlsMode := flag.String("tls", envOr("TLS_MODE", "auto"), "TLS 模式: auto（自签名/用户证书，默认）| off（明文 HTTP，仅限可信内网）")
	showVersion := flag.Bool("version", false, "打印版本号后退出")
	flag.Parse()

	if *showVersion {
		println("unity-orchestrator " + version)
		return
	}

	store, err := NewStore(*dataDir)
	if err != nil {
		log.Fatalf("[启动] 数据目录初始化失败: %v", err)
	}
	handler := NewServer(store, *staticDir)

	// 内置执行器（无需 Agent 的真实测试能力），随服务停机一起停止
	// stale：running 任务超过该时长（默认 30 分钟）判定 Agent 失联，标记失败
	stale := 30 * time.Minute
	if v := os.Getenv("STALE_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			stale = time.Duration(n) * time.Minute
		}
	}
	stopWorker := StartBuiltinWorker(store, 500*time.Millisecond, stale)
	defer stopWorker()

	srv := &http.Server{
		Addr:              ":" + *port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      180 * time.Second, // 须大于 openai.go 的 120s 上游超时
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	// 优雅停机：SIGINT/SIGTERM 后排水 10s
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		log.Printf("[停机] 收到信号，排水 10s 内完成在途请求…")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("[停机] 排水超时，强制退出: %v", err)
		}
	}()

	ln, err := net.Listen("tcp", ":"+*port)
	if err != nil {
		log.Fatalf("[启动] 端口监听失败: %v", err)
	}
	scheme := "https"
	switch *tlsMode {
	case "off":
		scheme = "http"
		log.Printf("[启动][警告] TLS 已关闭，流量明文传输——仅限可信内网使用")
	default: // auto
		userCert, userKey := os.Getenv("TLS_CERT"), os.Getenv("TLS_KEY")
		certFile, keyFile, fp, err := ensureTLSCertificate(*dataDir, userCert, userKey)
		if err != nil {
			log.Fatalf("[启动] TLS 证书准备失败: %v", err)
		}
		pair, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			log.Fatalf("[启动] TLS 证书加载失败: %v", err)
		}
		srv.TLSConfig = &tls.Config{
			Certificates: []tls.Certificate{pair},
			MinVersion:   tls.VersionTLS12,
		}
		ln = tls.NewListener(ln, srv.TLSConfig)
		log.Printf("[启动] TLS 证书: %s（自签名，浏览器/Agent 侧信任方式见 SECURITY.md）", certFile)
		log.Printf("[启动] TLS 指纹(SHA-256): %s", fp)
	}

	log.Printf("[启动] Go 版编排服务 %s 监听 %s://localhost:%s（数据目录 %s，静态资源 %s）", version, scheme, *port, *dataDir, *staticDir)
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("[启动] 服务失败: %v", err)
	}
	log.Printf("[停机] 已退出")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ---------- 中间件 ----------

// statusRecorder 记录响应状态码，供请求日志使用。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// requestLogger 每个请求输出一行：方法 路径 状态 耗时。
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("[HTTP] %s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
	})
}

// recoverer 捕获 handler panic：记录堆栈并返回 500（而非裸断连）。
func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[PANIC] %s %s: %v", r.Method, r.URL.Path, rec)
				writeDetail(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// noCache 禁用静态资源启发式缓存：看板 JS/CSS 更新后浏览器必须拉新版本。
func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

// tokenAuth 共享令牌认证：设置 PLATFORM_TOKEN 后，除健康/版本端点外的 /api/* 一律要求
// 请求头 X-Platform-Token 匹配（常量时间比较）。未设置时保持旧行为（仅限可信内网，见 SECURITY.md）。
func tokenAuth(next http.Handler) http.Handler {
	token := os.Getenv("PLATFORM_TOKEN")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token != "" && strings.HasPrefix(r.URL.Path, "/api/") {
			if r.URL.Path != "/api/health" && r.URL.Path != "/api/version" {
				if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Platform-Token")), []byte(token)) != 1 {
					writeDetail(w, http.StatusUnauthorized, "unauthorized: missing or invalid X-Platform-Token")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// noDirFS 关闭目录列表：目录请求一律 404，避免泄露静态资源清单。
type noDirFS struct{ inner http.FileSystem }

func (n noDirFS) Open(name string) (http.File, error) {
	f, err := n.inner.Open(name)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	if st.IsDir() {
		_ = f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}

// ---------- 通用工具 ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store") // API 响应永不缓存，防启发式缓存吃到过期数据
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeRawJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// writeDetail 以 FastAPI 兼容格式返回错误：{"detail": "..."}
func writeDetail(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, map[string]string{"detail": detail})
}

func decodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	// 防 CSRF Simple Request：POST 体必须是 application/json（跨站 text/plain 表单无法伪造）
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(strings.TrimSpace(ct), "application/json") {
		writeDetail(w, http.StatusUnsupportedMediaType, "Content-Type 必须为 application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeDetail(w, http.StatusRequestEntityTooLarge, "请求体超过 1MB 限制")
			return false
		}
		writeDetail(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return false
	}
	return true
}

// ---------- 健康 / 版本 ----------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	resp := map[string]any{"ok": true, "version": version}
	if err := s.store.HealthCheck(); err != nil {
		resp["ok"] = false
		resp["error"] = err.Error()
		writeJSON(w, http.StatusServiceUnavailable, resp)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"version": version})
}

// ---------- Skills ----------

func (s *Server) handleSkills(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": skills, "total": len(skills)})
}

// ---------- Agent ----------

type AgentRegister struct {
	AgentID  string         `json:"agent_id"`
	Platform string         `json:"platform"`
	Skills   []string       `json:"skills"`
	Extra    map[string]any `json:"extra"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var body AgentRegister
	if !decodeBody(w, r, &body) {
		return
	}
	skills := body.Skills
	if skills == nil {
		skills = []string{}
	}
	extra := body.Extra
	if extra == nil {
		extra = map[string]any{}
	}
	s.store.SetAgent(body.AgentID, map[string]any{
		"agent_id":       body.AgentID,
		"platform":       body.Platform,
		"skills":         skills,
		"extra":          extra,
		"last_seen":      nowFloat(),
		"status":         "idle",
		"current_job_id": nil,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "agent_id": body.AgentID})
}

type AgentHeartbeat struct {
	AgentID      string `json:"agent_id"`
	Status       string `json:"status"`
	CurrentJobID *int   `json:"current_job_id"`
}

func (s *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	var body AgentHeartbeat
	if !decodeBody(w, r, &body) {
		return
	}
	if !s.store.Heartbeat(body.AgentID, body.Status, body.CurrentJobID, nowFloat()) {
		writeDetail(w, http.StatusNotFound, "agent not registered")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListAgents(w http.ResponseWriter, r *http.Request) {
	body, err := s.store.ListAgentsJSON()
	if err != nil {
		writeDetail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeRawJSON(w, http.StatusOK, body)
}

// ---------- 任务 ----------

type JobCreate struct {
	Platform         string         `json:"platform"`
	RequiredSkills   []string       `json:"required_skills"`
	UnityProjectPath *string        `json:"unity_project_path"`
	TestFilter       *string        `json:"test_filter"`
	Extra            map[string]any `json:"extra"`
}

func (s *Server) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var body JobCreate
	if !decodeBody(w, r, &body) {
		return
	}
	extra := body.Extra
	if extra == nil {
		extra = map[string]any{}
	}
	// GPT 生成并执行：先调 OpenAI 生成 C# 测试代码写入 extra（与 Python 版一致）
	if jt, _ := extra["job_type"].(string); jt == "generate_and_run" {
		if prompt, _ := extra["prompt"].(string); prompt != "" {
			assembly, _ := extra["unity_assembly"].(string)
			code, errStr := generateTestCase(prompt, assembly)
			if code != "" {
				extra["generated_test_csharp"] = code
			}
			if errStr != "" {
				extra["generate_error"] = errStr
			}
		}
	}
	required := body.RequiredSkills
	if required == nil {
		required = []string{}
	}
	jid := s.store.NextJobID()
	job := map[string]any{
		"job_id":             jid,
		"platform":           body.Platform,
		"required_skills":    required,
		"unity_project_path": body.UnityProjectPath,
		"test_filter":        body.TestFilter,
		"extra":              extra,
		"status":             "pending",
		"created_at":         nowFloat(),
		"result":             nil,
	}
	s.store.AppendJob(job)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "job_id": jid})
}

func (s *Server) handleListJobs(w http.ResponseWriter, r *http.Request) {
	body, err := s.store.ListJobsJSON()
	if err != nil {
		writeDetail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeRawJSON(w, http.StatusOK, body)
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeDetail(w, http.StatusNotFound, "job not found")
		return
	}
	body, err := s.store.FindJobJSON(id)
	if err != nil {
		writeDetail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if body == nil {
		writeDetail(w, http.StatusNotFound, "job not found")
		return
	}
	writeRawJSON(w, http.StatusOK, body)
}

type JobResult struct {
	JobID   int            `json:"job_id"`
	AgentID string         `json:"agent_id"`
	Success bool           `json:"success"`
	LogPath *string        `json:"log_path"`
	Summary map[string]any `json:"summary"`
}

func (s *Server) handleJobResult(w http.ResponseWriter, r *http.Request) {
	var body JobResult
	if !decodeBody(w, r, &body) {
		return
	}
	// 安全增强：结果只能由已注册 Agent 上报（防匿名伪造结果）
	if !s.store.HasAgent(body.AgentID) {
		writeDetail(w, http.StatusForbidden, "agent not registered")
		return
	}
	if !s.store.SetJobResult(body.JobID, body.AgentID, body.Success, body.LogPath, body.Summary) {
		writeDetail(w, http.StatusNotFound, "job not found")
		return
	}
	if !body.Success {
		NotifyJobFailure(map[string]any{"job_id": float64(body.JobID), "platform": "unknown"}, body.AgentID, body.Summary)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleCleanupJobs 数据管理：批量删除终态任务（passed/failed/cancelled）。
func (s *Server) handleCleanupJobs(w http.ResponseWriter, r *http.Request) {
	removed := s.store.CleanupJobs()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed})
}

// handleCancelJob 取消任务（pending/running → cancelled 终态，Agent 迟到结果不再覆盖）。
func (s *Server) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeDetail(w, http.StatusNotFound, "job not found")
		return
	}
	found, cancelled := s.store.CancelJob(id)
	if !found {
		writeDetail(w, http.StatusNotFound, "job not found")
		return
	}
	if !cancelled {
		writeDetail(w, http.StatusConflict, "任务已通过/失败，不可取消")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": "cancelled"})
}

// handleDeleteJob 删除任务（列表移除 + 快照文件删除）。
func (s *Server) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeDetail(w, http.StatusNotFound, "job not found")
		return
	}
	if !s.store.DeleteJob(id) {
		writeDetail(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleUploadArtifacts Agent 上传执行记录（steps.json、日志尾部等，文本内容）。
// 扁平路径：POST /api/jobs/artifacts，job_id 在请求体中。
func (s *Server) handleUploadArtifacts(w http.ResponseWriter, r *http.Request) {
	var body struct {
		JobID   int    `json:"job_id"`
		AgentID string `json:"agent_id"`
		Files   []struct {
			Name    string `json:"name"`
			Content string `json:"content"`
		} `json:"files"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if !s.store.HasAgent(body.AgentID) {
		writeDetail(w, http.StatusForbidden, "agent not registered")
		return
	}
	if !s.store.HasJob(body.JobID) {
		writeDetail(w, http.StatusNotFound, "job not found")
		return
	}
	if len(body.Files) > 10 {
		writeDetail(w, http.StatusBadRequest, "单次最多上传 10 个文件")
		return
	}
	stored := 0
	for _, f := range body.Files {
		if err := s.store.SaveArtifact(body.JobID, f.Name, []byte(f.Content)); err != nil {
			writeDetail(w, http.StatusBadRequest, err.Error())
			return
		}
		stored++
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stored": stored})
}

// handleListArtifacts 列出任务产物：GET /api/jobs/artifacts?job_id=N
func (s *Server) handleListArtifacts(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.URL.Query().Get("job_id"))
	if err != nil {
		writeDetail(w, http.StatusBadRequest, "job_id 必须为整数")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job_id": id, "files": s.store.ListArtifacts(id)})
}

// handleGetArtifact 读取产物内容：GET /api/jobs/artifacts/{name}?job_id=N
func (s *Server) handleGetArtifact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.URL.Query().Get("job_id"))
	if err != nil {
		writeDetail(w, http.StatusBadRequest, "job_id 必须为整数")
		return
	}
	name := r.PathValue("name")
	data, err := s.store.ReadArtifact(id, name)
	if err != nil {
		writeDetail(w, http.StatusNotFound, "artifact not found")
		return
	}
	if strings.HasSuffix(name, ".json") {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	} else {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}
	_, _ = w.Write(data)
}

func (s *Server) handlePollJob(w http.ResponseWriter, r *http.Request) {
	platform := r.PathValue("platform")
	agentSkills := map[string]bool{}
	for _, sk := range strings.Split(r.URL.Query().Get("skills"), ",") {
		if t := strings.TrimSpace(sk); t != "" {
			agentSkills[t] = true
		}
	}
	body, err := s.store.PollJobJSON(platform, agentSkills)
	if err != nil {
		writeDetail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if body == nil {
		writeRawJSON(w, http.StatusOK, []byte(`{"job": null}`+"\n"))
		return
	}
	// 包装为 {"job": <job>}，与 Python 版响应结构一致
	jobJSON := strings.TrimSpace(string(body))
	writeRawJSON(w, http.StatusOK, []byte(`{"job": `+jobJSON+"}\n"))
}

// ---------- GPT 生成测试 ----------

type GenerateTestRequest struct {
	Prompt   string `json:"prompt"`
	Assembly string `json:"assembly"`
}

func (s *Server) handleGenerateTest(w http.ResponseWriter, r *http.Request) {
	var body GenerateTestRequest
	if !decodeBody(w, r, &body) {
		return
	}
	code, errStr := generateTestCase(body.Prompt, body.Assembly)
	// 与 Python 版一致：code/error 为空时返回 null
	var codeField, errField any
	if code != "" {
		codeField = code
	}
	if errStr != "" {
		errField = errStr
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": codeField, "error": errField})
}

// ---------- Unity MCP 代理 ----------

func (s *Server) handleMCPStatus(w http.ResponseWriter, r *http.Request) {
	available := mcpAvailable()
	// 与 Python 版一致：恒返回 instances 键（不可用时为空对象）
	instances := map[string]any{}
	if available {
		instances = mcpGet("/resources/unity_instances", nil, 30*time.Second)
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": available, "instances": instances})
}

func (s *Server) handleMCPExecuteTool(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ToolName   string         `json:"tool_name"`
		ToolParams map[string]any `json:"tool_params"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ToolName == "" {
		writeDetail(w, http.StatusBadRequest, "tool_name 是必需的")
		return
	}
	// 白名单：防路径穿越/查询注入到 MCP 上游（如 "../../resources/x"、"t?cmd=..."）
	if !toolNameRe.MatchString(body.ToolName) {
		writeDetail(w, http.StatusBadRequest, "tool_name 仅允许字母、数字、下划线与连字符")
		return
	}
	if body.ToolParams == nil {
		body.ToolParams = map[string]any{}
	}
	writeJSON(w, http.StatusOK, mcpPost("/tools/"+body.ToolName, body.ToolParams, 30*time.Second))
}

func (s *Server) handleMCPBatchExecute(w http.ResponseWriter, r *http.Request) {
	// 与 Python 版一致：缺 tools 键按空列表执行；存在但非列表才报错
	var body map[string]json.RawMessage
	if !decodeBody(w, r, &body) {
		return
	}
	raw, ok := body["tools"]
	if !ok {
		writeJSON(w, http.StatusOK, mcpPost("/tools/batch_execute", map[string]any{"tools": []any{}}, 30*time.Second))
		return
	}
	var tools []any
	if err := json.Unmarshal(raw, &tools); err != nil {
		writeDetail(w, http.StatusBadRequest, "tools 必须是列表")
		return
	}
	if tools == nil {
		tools = []any{}
	}
	writeJSON(w, http.StatusOK, mcpPost("/tools/batch_execute", map[string]any{"tools": tools}, 30*time.Second))
}

func (s *Server) handleMCPSetActiveInstance(w http.ResponseWriter, r *http.Request) {
	var body struct {
		InstanceID string `json:"instance_id"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.InstanceID == "" {
		writeDetail(w, http.StatusBadRequest, "instance_id 是必需的")
		return
	}
	writeJSON(w, http.StatusOK, mcpPost("/tools/set_active_instance", map[string]any{"instance_id": body.InstanceID}, 30*time.Second))
}

func (s *Server) handleMCPManageScene(w http.ResponseWriter, r *http.Request) {
	s.handleMCPManageGeneric(w, r, "action", "scene_path", "action 和 scene_path 是必需的", "/tools/manage_scene")
}

func (s *Server) handleMCPManageAsset(w http.ResponseWriter, r *http.Request) {
	s.handleMCPManageGeneric(w, r, "action", "asset_path", "action 和 asset_path 是必需的", "/tools/manage_asset")
}

func (s *Server) handleMCPManageMaterial(w http.ResponseWriter, r *http.Request) {
	s.handleMCPManageGeneric(w, r, "action", "material_path", "action 和 material_path 是必需的", "/tools/manage_material")
}

// handleMCPManageGeneric 统一处理 manage-* 三兄弟：action + 路径字段 + 可选 properties。
func (s *Server) handleMCPManageGeneric(w http.ResponseWriter, r *http.Request, actionKey, pathKey, errMsg, endpoint string) {
	var body map[string]any
	if !decodeBody(w, r, &body) {
		return
	}
	action, _ := body[actionKey].(string)
	pathVal, _ := body[pathKey].(string)
	if action == "" || pathVal == "" {
		writeDetail(w, http.StatusBadRequest, errMsg)
		return
	}
	props, _ := body["properties"].(map[string]any)
	params := mcpMergeProps(map[string]any{actionKey: action, pathKey: pathVal}, props)
	writeJSON(w, http.StatusOK, mcpPost(endpoint, params, 30*time.Second))
}

func (s *Server) handleMCPExecuteMenuItem(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MenuPath string `json:"menu_path"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.MenuPath == "" {
		writeDetail(w, http.StatusBadRequest, "menu_path 是必需的")
		return
	}
	writeJSON(w, http.StatusOK, mcpPost("/tools/execute_menu_item", map[string]any{"menu_path": body.MenuPath}, 30*time.Second))
}

func (s *Server) handleMCPProjectInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, mcpGet("/resources/project_info", url.Values{}, 30*time.Second))
}

func (s *Server) handleMCPSceneInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, mcpGet("/resources/scene_info", url.Values{}, 30*time.Second))
}

// ---------- 看板 ----------

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(filepath.Join(s.staticDir, "index.html"))
	if err != nil {
		writeDetail(w, http.StatusNotFound, "index.html not found")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}
