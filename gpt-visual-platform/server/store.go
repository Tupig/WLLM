// 数据存储：与 Python 版 modules/services/data_service.py 的文件格式完全兼容，
// 可直接读写现有 data/ 目录（agents.json、jobs.json、job_id.txt、runs/job_<id>.json）。
//
// 并发模型：所有共享状态的读写在 s.mu 内完成；对外只输出锁内序列化好的 JSON 字节，
// 不逃逸任何 map/slice 引用（避免数据竞争，go test -race 可验证）。
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// Store 编排服务的内存 + 文件存储。实体用 map[string]any 以保持与 Python 版
// 完全一致的 JSON 结构（缺省字段为 null 而不是省略）。
type Store struct {
	mu      sync.Mutex
	dataDir string
	runsDir string

	agents map[string]map[string]any
	jobs   []map[string]any
	jobID  int
}

func NewStore(dataDir string) (*Store, error) {
	runsDir := filepath.Join(dataDir, "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{dataDir: dataDir, runsDir: runsDir, agents: map[string]map[string]any{}}
	s.load()
	return s, nil
}

func (s *Store) agentsPath() string { return filepath.Join(s.dataDir, "agents.json") }
func (s *Store) jobsPath() string   { return filepath.Join(s.dataDir, "jobs.json") }
func (s *Store) jobIDPath() string  { return filepath.Join(s.dataDir, "job_id.txt") }

func (s *Store) load() {
	s.agents = map[string]map[string]any{}
	if b, err := os.ReadFile(s.agentsPath()); err == nil {
		if err := json.Unmarshal(b, &s.agents); err != nil {
			log.Printf("[存储] 警告: agents.json 解析失败（按空数据处理）: %v", err)
		}
	}
	s.jobs = nil
	if b, err := os.ReadFile(s.jobsPath()); err == nil {
		if err := json.Unmarshal(b, &s.jobs); err != nil {
			log.Printf("[存储] 警告: jobs.json 解析失败（按空数据处理）: %v", err)
		}
	}
	s.jobID = 0
	if b, err := os.ReadFile(s.jobIDPath()); err == nil {
		if n, err := strconv.Atoi(string(bytes.TrimSpace(b))); err == nil {
			s.jobID = n
			return
		}
	}
	// 解析失败时从任务列表计算最大 ID（与 Python 版一致）
	for _, j := range s.jobs {
		if id := jobIDOf(j); id > s.jobID {
			s.jobID = id
		}
	}
	if err := s.writeJobIDLocked(); err != nil {
		log.Printf("[存储] 写入 job_id.txt 失败: %v", err)
	}
}

// writeJSONFile 原子写入：先写临时文件再 rename，避免进程中断留下半截 JSON。
// 格式与 Python 版一致：2 空格缩进、不转义 HTML 字符。
func writeJSONFile(path string, v any) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Store) writeJobIDLocked() error {
	return os.WriteFile(s.jobIDPath(), []byte(strconv.Itoa(s.jobID)), 0o644)
}

func (s *Store) saveDataLocked() error {
	if err := writeJSONFile(s.agentsPath(), s.agents); err != nil {
		return err
	}
	return writeJSONFile(s.jobsPath(), s.jobs)
}

// saveAgentsLocked 只持久化 Agent 表：心跳/注册高频发生，
// 若每次连带全量重写 jobs.json 会造成无谓的写放大（任务越多越慢）。
func (s *Store) saveAgentsLocked() error {
	return writeJSONFile(s.agentsPath(), s.agents)
}

func (s *Store) saveJobLocked(job map[string]any) error {
	id := jobIDOf(job)
	return writeJSONFile(filepath.Join(s.runsDir, "job_"+strconv.Itoa(id)+".json"), job)
}

// jobIDOf 从任务 map 中取 job_id（JSON 反序列化后为 float64）。
func jobIDOf(job map[string]any) int {
	switch v := job["job_id"].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	}
	return 0
}

func nowFloat() float64 { return float64(time.Now().UnixNano()) / 1e9 }

// NextJobID 自增任务 ID 并立即落盘（与 Python 版语义一致）。
func (s *Store) NextJobID() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobID++
	if err := s.writeJobIDLocked(); err != nil {
		log.Printf("[存储] 写入 job_id.txt 失败: %v", err)
	}
	return s.jobID
}

// SetAgent 注册/覆盖 Agent。
func (s *Store) SetAgent(id string, agent map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agents[id] = agent
	if err := s.saveAgentsLocked(); err != nil {
		log.Printf("[存储] 保存 agents 失败: %v", err)
	}
}

// Heartbeat 更新心跳字段；Agent 未注册返回 false。
func (s *Store) Heartbeat(id, status string, currentJobID *int, lastSeen float64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	agent, ok := s.agents[id]
	if !ok {
		return false
	}
	agent["last_seen"] = lastSeen
	agent["status"] = status
	agent["current_job_id"] = currentJobID
	if err := s.saveAgentsLocked(); err != nil {
		log.Printf("[存储] 保存 agents 失败: %v", err)
	}
	return true
}

// CancelJob 取消任务：pending/running 置为 cancelled（终态）。
// 返回 (任务是否存在, 是否已取消)；已通过/失败的任务不可取消。
func (s *Store) CancelJob(id int) (bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if jobIDOf(j) != id {
			continue
		}
		st, _ := j["status"].(string)
		if st == "cancelled" {
			return true, true // 幂等
		}
		if st != "pending" && st != "running" {
			return true, false
		}
		j["status"] = "cancelled"
		if err := s.saveJobLocked(j); err != nil {
			log.Printf("[存储] 保存任务快照失败: %v", err)
		}
		if err := s.saveDataLocked(); err != nil {
			log.Printf("[存储] 保存 jobs 失败: %v", err)
		}
		return true, true
	}
	return false, false
}

// DeleteJob 删除任务：从列表移除并删除快照文件；不存在返回 false。
func (s *Store) DeleteJob(id int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, j := range s.jobs {
		if jobIDOf(j) == id {
			s.jobs = append(s.jobs[:i], s.jobs[i+1:]...)
			_ = os.Remove(filepath.Join(s.runsDir, "job_"+strconv.Itoa(id)+".json"))
			if err := s.saveDataLocked(); err != nil {
				log.Printf("[存储] 保存 jobs 失败: %v", err)
			}
			return true
		}
	}
	return false
}

// HasJob 判断任务是否存在。
func (s *Store) HasJob(id int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if jobIDOf(j) == id {
			return true
		}
	}
	return false
}

// ---------- 任务产物（执行记录） ----------

// artifactNameRe 产物文件名白名单（防路径穿越）。
var artifactNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

func (s *Store) artifactsDir(jobID int) string {
	return filepath.Join(s.runsDir, "job_"+strconv.Itoa(jobID), "artifacts")
}

// SaveArtifact 保存 Agent 上传的执行记录（steps.json、日志尾部等）。
func (s *Store) SaveArtifact(jobID int, name string, content []byte) error {
	if !artifactNameRe.MatchString(name) {
		return fmt.Errorf("产物名非法: %q", name)
	}
	dir := s.artifactsDir(jobID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, name), content, 0o644)
}

// ArtifactInfo 产物元信息。
type ArtifactInfo struct {
	Name string `json:"name"`
	Size int    `json:"size"`
}

// ListArtifacts 列出任务产物；无产物返回空列表。
func (s *Store) ListArtifacts(jobID int) []ArtifactInfo {
	out := []ArtifactInfo{}
	entries, err := os.ReadDir(s.artifactsDir(jobID))
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if info, err := e.Info(); err == nil {
			out = append(out, ArtifactInfo{Name: e.Name(), Size: int(info.Size())})
		}
	}
	return out
}

// ReadArtifact 读取产物内容；名称经白名单校验防路径穿越。
func (s *Store) ReadArtifact(jobID int, name string) ([]byte, error) {
	if !artifactNameRe.MatchString(name) {
		return nil, fmt.Errorf("产物名非法: %q", name)
	}
	return os.ReadFile(filepath.Join(s.artifactsDir(jobID), name))
}

// HasAgent 判断 Agent 是否已注册（结果上报的前置校验）。
func (s *Store) HasAgent(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.agents[id]
	return ok
}

// ListAgentsJSON 锁内序列化 Agent 列表，返回 {"items": [...], "total": N} 的 JSON 字节。
func (s *Store) ListAgentsJSON() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]map[string]any, 0, len(s.agents))
	for _, a := range s.agents {
		items = append(items, a)
	}
	return json.Marshal(map[string]any{"items": items, "total": len(items)})
}

// AppendJob 新任务入队并落盘。
func (s *Store) AppendJob(job map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs = append(s.jobs, job)
	if err := s.saveJobLocked(job); err != nil {
		log.Printf("[存储] 保存任务快照失败: %v", err)
	}
	if err := s.saveDataLocked(); err != nil {
		log.Printf("[存储] 保存 jobs 失败: %v", err)
	}
}

// ListJobsJSON 锁内序列化任务列表，返回 {"items": [...], "total": N} 的 JSON 字节。
func (s *Store) ListJobsJSON() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return json.Marshal(map[string]any{"items": s.jobs, "total": len(s.jobs)})
}

// FindJobJSON 锁内查找任务并序列化；未找到返回 nil, nil。
func (s *Store) FindJobJSON(id int) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if jobIDOf(j) == id {
			return json.Marshal(j)
		}
	}
	var job map[string]any
	if b, err := os.ReadFile(filepath.Join(s.runsDir, "job_"+strconv.Itoa(id)+".json")); err == nil {
		if err := json.Unmarshal(b, &job); err == nil && job != nil {
			return json.Marshal(job)
		}
	}
	return nil, nil
}

// SetJobResult 上报结果：锁内完成查找、状态变更与落盘；任务不存在返回 false。
// 已取消（cancelled）为终态：Agent 迟到的上报被静默接受但不覆盖状态。
func (s *Store) SetJobResult(id int, agentID string, success bool, logPath *string, summary map[string]any) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	var job map[string]any
	for _, j := range s.jobs {
		if jobIDOf(j) == id {
			job = j
			break
		}
	}
	if job == nil {
		return false
	}
	if st, _ := job["status"].(string); st == "cancelled" {
		return true
	}
	status := "failed"
	if success {
		status = "passed"
	}
	job["status"] = status
	if summary == nil {
		summary = map[string]any{}
	}
	job["result"] = map[string]any{
		"agent_id": agentID,
		"success":  success,
		"log_path": logPath,
		"summary":  summary,
	}
	if err := s.saveJobLocked(job); err != nil {
		log.Printf("[存储] 保存任务结果失败: %v", err)
	}
	if err := s.saveDataLocked(); err != nil {
		log.Printf("[存储] 保存 jobs 失败: %v", err)
	}
	return true
}

// PollJobJSON 拉取该平台下一条 pending 任务；required_skills 仅为 agent 技能子集时才匹配
// （agent 未声明技能时可拉取任意任务，保持与 Python 版一致）。命中后置为 running，
// 锁内序列化返回；无匹配任务返回 nil, nil。
func (s *Store) PollJobJSON(platform string, agentSkills map[string]bool) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j["platform"] != platform {
			continue
		}
		if st, _ := j["status"].(string); st != "pending" {
			continue
		}
		required := toStringSet(j["required_skills"])
		if len(required) > 0 && len(agentSkills) > 0 && !subset(required, agentSkills) {
			continue
		}
		j["status"] = "running"
		j["started_at"] = nowFloat() // 失联超时计时起点
		if err := s.saveJobLocked(j); err != nil {
			log.Printf("[存储] 保存任务快照失败: %v", err)
		}
		if err := s.saveDataLocked(); err != nil {
			log.Printf("[存储] 保存 jobs 失败: %v", err)
		}
		return json.Marshal(j)
	}
	return nil, nil
}

// HealthCheck 返回存储健康状态（数据目录可写性）。
func (s *Store) HealthCheck() error {
	probe := filepath.Join(s.dataDir, ".health_probe")
	if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
		return err
	}
	_ = os.Remove(probe)
	return nil
}

// ReapStale 失联超时兜底：running 超过 stale 的任务标记为 failed（Agent 挂死/失联保护）。
// 超时基准：started_at（缺失时回退 created_at）。返回被清理的任务 ID 列表。
func (s *Store) ReapStale(stale time.Duration) []int {
	s.mu.Lock()
	defer s.mu.Unlock()
	reaped := []int{}
	now := nowFloat()
	for _, j := range s.jobs {
		if st, _ := j["status"].(string); st != "running" {
			continue
		}
		base, _ := j["started_at"].(float64)
		if base == 0 {
			base, _ = j["created_at"].(float64)
		}
		if base == 0 || now-base < stale.Seconds() {
			continue
		}
		id := jobIDOf(j)
		j["status"] = "failed"
		j["result"] = map[string]any{
			"agent_id": "system",
			"success":  false,
			"log_path": nil,
			"summary": map[string]any{
				"message": fmt.Sprintf("执行超时（%.0f 分钟无结果，Agent 可能已失联）", (now-base)/60),
			},
		}
		if err := s.saveJobLocked(j); err != nil {
			log.Printf("[存储] 保存任务快照失败: %v", err)
		}
		reaped = append(reaped, id)
	}
	if len(reaped) > 0 {
		if err := s.saveDataLocked(); err != nil {
			log.Printf("[存储] 保存 jobs 失败: %v", err)
		}
	}
	return reaped
}

// DataDir 数据目录路径（自检等模块使用）。
func (s *Store) DataDir() string { return s.dataDir }

// ClaimBuiltin 内置执行器专用：领取一条 pending 的内置任务（web_check/api_check/api_load/api_flow）并置为 running。
func (s *Store) ClaimBuiltin() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j["platform"] != "web" {
			continue
		}
		if st, _ := j["status"].(string); st != "pending" {
			continue
		}
		extra, _ := j["extra"].(map[string]any)
		if jt, _ := extra["job_type"].(string); !builtinTypes[jt] {
			continue
		}
		j["status"] = "running"
		j["started_at"] = nowFloat() // 失联超时计时起点
		if err := s.saveJobLocked(j); err != nil {
			log.Printf("[存储] 保存任务快照失败: %v", err)
		}
		if err := s.saveDataLocked(); err != nil {
			log.Printf("[存储] 保存 jobs 失败: %v", err)
		}
		return j
	}
	return nil
}

// CleanupJobs 数据管理：删除终态任务（passed/failed/cancelled）。返回删除条数。
func (s *Store) CleanupJobs() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.jobs[:0]
	removed := 0
	for _, j := range s.jobs {
		st, _ := j["status"].(string)
		if st == "passed" || st == "failed" || st == "cancelled" {
			_ = os.Remove(filepath.Join(s.runsDir, "job_"+strconv.Itoa(jobIDOf(j))+".json"))
			removed++
			continue
		}
		kept = append(kept, j)
	}
	if removed == 0 {
		return 0
	}
	s.jobs = kept
	if err := s.saveDataLocked(); err != nil {
		log.Printf("[存储] 保存 jobs 失败: %v", err)
	}
	return removed
}

// toStringSet 把 required_skills 转为集合：内存中为 []string，从 JSON 文件读回为 []any。
func toStringSet(v any) map[string]bool {
	set := map[string]bool{}
	switch arr := v.(type) {
	case []string:
		for _, s := range arr {
			set[s] = true
		}
	case []any:
		for _, item := range arr {
			if str, ok := item.(string); ok {
				set[str] = true
			}
		}
	}
	return set
}

func subset(required, agentSkills map[string]bool) bool {
	for k := range required {
		if !agentSkills[k] {
			return false
		}
	}
	return true
}
