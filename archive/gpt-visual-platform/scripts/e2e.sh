#!/usr/bin/env bash
# 端到端冒烟测试：Go 编排服务（HTTPS 自签名）+ Rust Agent 全流程（CI 可跑，/tmp 隔离）
# 覆盖：注册 → 领取 → 执行 → 上报 → 落盘；内置 web_check 真实断言（HTTPS 自签名目标）；取消/删除链路
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
SERVER_PID=""
AGENT_PID=""
cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "${AGENT_PID:-}" ] && kill "$AGENT_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

command -v go >/dev/null || { echo "E2E 失败: 需要 go"; exit 1; }
command -v cargo >/dev/null || { echo "E2E 失败: 需要 cargo"; exit 1; }

echo "[E2E] 构建双端…"
(cd "$ROOT/server" && go build -o "$WORK/unity-orchestrator" .)
(cd "$ROOT/agent" && cargo build --release --quiet)
cp "$ROOT/agent/target/release/unity-agent" "$WORK/"

echo "[E2E] 启动服务（HTTPS 自签名）与 Agent（PLATFORM_INSECURE_TLS=1）…"
PORT=19111
DATA_DIR="$WORK/data" PORT=$PORT "$WORK/unity-orchestrator" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
sleep 1.5

PLATFORM_URL="https://localhost:$PORT" AGENT_ID=e2e-agent PLATFORM=mac \
  AGENT_SKILLS=PlayMode AGENT_WORKDIR="$WORK/agent_runs" PLATFORM_INSECURE_TLS=1 \
  "$WORK/unity-agent" >"$WORK/agent.log" 2>&1 &
AGENT_PID=$!
sleep 2

C="curl -sfk"
$C "https://localhost:$PORT/api/agents" | grep -q e2e-agent || {
  echo "E2E 失败: Agent 未注册"; cat "$WORK/agent.log"; exit 1;
}

# Agent 领取并执行占位任务
JOB=$($C -X POST "https://localhost:$PORT/api/jobs" -H 'Content-Type: application/json' \
  -d '{"platform":"mac","required_skills":["PlayMode"],"extra":{"job_type":"self_check"}}')
JOB_ID=$(echo "$JOB" | sed -E 's/.*"job_id":([0-9]+).*/\1/')
echo "[E2E] Agent 任务 $JOB_ID 已创建，等待执行（最长 45s）…"
STATUS=""
for _ in $(seq 1 45); do
  STATUS=$($C "https://localhost:$PORT/api/jobs/$JOB_ID" | sed -E 's/.*"status":"([a-z]+)".*/\1/' || true)
  [ "${STATUS:-}" = "passed" ] && break
  sleep 1
done
[ "${STATUS:-}" = "passed" ] || {
  echo "E2E 失败: Agent 任务未通过（状态: ${STATUS:-未知}）"
  echo "--- agent.log ---"; cat "$WORK/agent.log" || true
  echo "--- server.log ---"; tail -20 "$WORK/server.log" || true
  exit 1
}
echo "[E2E] Agent 任务通过 ✓"

# 内置 web_check 真实断言：检查服务自身健康接口（HTTPS 自签名目标，insecure_tls）
TARGET_URL="https://localhost:$PORT/api/health"
WJ_BODY="{\"platform\":\"web\",\"extra\":{\"job_type\":\"web_check\",\"url\":\"$TARGET_URL\",\"keyword\":\"ok\",\"insecure_tls\":true}}"
WJ=$($C -X POST "https://localhost:$PORT/api/jobs" -H 'Content-Type: application/json' -d "$WJ_BODY")
WJ_ID=$(echo "$WJ" | sed -E 's/.*"job_id":([0-9]+).*/\1/')
echo "[E2E] 内置 web_check 任务 #"$WJ_ID"，等待结果…"
WSTATUS=""
for _ in $(seq 1 20); do
  WSTATUS=$($C "https://localhost:$PORT/api/jobs/$WJ_ID" | sed -E 's/.*"status":"([a-z]+)".*/\1/' || true)
  [ "${WSTATUS:-}" = "passed" ] && break
  sleep 1
done
[ "${WSTATUS:-}" = "passed" ] || {
  echo "E2E 失败: web_check 未通过（状态: ${WSTATUS:-未知}）"
  tail -20 "$WORK/server.log" || true
  exit 1
}
echo "[E2E] 内置 web_check 通过 ✓"

# 内置环境自检（web 平台，服务端真实断言）
SJ=$($C -X POST "https://localhost:$PORT/api/jobs" -H 'Content-Type: application/json' \
  -d '{"platform":"web","extra":{"job_type":"self_check"}}')
SJ_ID=$(echo "$SJ" | sed -E 's/.*"job_id":([0-9]+).*/\1/')
echo "[E2E] 内置环境自检任务 ${SJ_ID}，等待结果…"
SSTATUS=""
for _ in $(seq 1 20); do
  SSTATUS=$($C "https://localhost:$PORT/api/jobs/$SJ_ID" | sed -E 's/.*"status":"([a-z]+)".*/\1/' || true)
  [ "${SSTATUS:-}" = "passed" ] && break
  sleep 1
done
[ "${SSTATUS:-}" = "passed" ] || { echo "E2E 失败: 环境自检未通过（${SSTATUS:-未知}）"; exit 1; }
echo "[E2E] 内置环境自检通过 ✓"

# 内置诊断三件套：端口检查（服务自身端口）/ 证书检查（自签名）/ DNS 检查（localhost）
DJ=$($C -X POST "https://localhost:$PORT/api/jobs" -H 'Content-Type: application/json' \
  -d '{"platform":"web","extra":{"job_type":"port_check","host":"localhost","port":'"$PORT"',"expect_open":true}}')
DJ_ID=$(echo "$DJ" | sed -E 's/.*"job_id":([0-9]+).*/\1/')
CC=$($C -X POST "https://localhost:$PORT/api/jobs" -H 'Content-Type: application/json' \
  -d '{"platform":"web","extra":{"job_type":"cert_check","host":"localhost","port":'"$PORT"',"min_days_valid":1}}')
CC_ID=$(echo "$CC" | sed -E 's/.*"job_id":([0-9]+).*/\1/')
DJ2=$($C -X POST "https://localhost:$PORT/api/jobs" -H 'Content-Type: application/json' \
  -d '{"platform":"web","extra":{"job_type":"dns_check","hostname":"localhost"}}')
DJ2_ID=$(echo "$DJ2" | sed -E 's/.*"job_id":([0-9]+).*/\1/')
echo "[E2E] 诊断任务 ${DJ_ID}/${CC_ID}/${DJ2_ID}（端口/证书/DNS），等待结果…"
DOK=0
for _ in $(seq 1 20); do
  DOK=0
  for ID in $DJ_ID $CC_ID $DJ2_ID; do
    S=$($C "https://localhost:$PORT/api/jobs/$ID" | sed -E 's/.*"status":"([a-z]+)".*/\1/' || true)
    [ "${S:-}" = "passed" ] && DOK=$((DOK+1))
  done
  [ "$DOK" = "3" ] && break
  sleep 1
done
[ "$DOK" = "3" ] || { echo "E2E 失败: 诊断任务未全部通过（$DOK/3）"; exit 1; }
echo "[E2E] 诊断三件套通过 ✓"

# 取消 / 删除链路（ios 平台无 Agent，任务保持 pending）
CJ=$($C -X POST "https://localhost:$PORT/api/jobs" -H 'Content-Type: application/json' -d '{"platform":"ios"}')
CJ_ID=$(echo "$CJ" | sed -E 's/.*"job_id":([0-9]+).*/\1/')
$C -X POST "https://localhost:$PORT/api/jobs/$CJ_ID/cancel" -H 'Content-Type: application/json' -d '{}' > /dev/null
$C "https://localhost:$PORT/api/jobs/$CJ_ID" | grep -q '"status":"cancelled"' || { echo "E2E 失败: 取消未生效"; exit 1; }
$C -X DELETE "https://localhost:$PORT/api/jobs/$CJ_ID" > /dev/null
[ "$($C -o /dev/null -w '%{http_code}' "https://localhost:$PORT/api/jobs/$CJ_ID")" = "404" ] || { echo "E2E 失败: 删除未生效"; exit 1; }
echo "[E2E] 取消/删除链路 OK ✓"

grep -q '"job_id"' "$WORK/data/jobs.json" || { echo "E2E 失败: jobs.json 未落盘"; exit 1; }
echo "E2E 通过: 注册 → 领取 → 执行 → 上报 → web_check(HTTPS) → 取消/删除 → 落盘 全链路 OK"
