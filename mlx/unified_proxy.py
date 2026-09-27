#!/usr/bin/env python3
"""
统一协议代理服务器

同时支持三种协议，只监听一个端口：
  - /v1/chat/completions  OpenAI Chat Completions
  - /v1/responses         OpenAI Responses
  - /v1/messages          Anthropic Messages

后端：mlx_lm.server (http://127.0.0.1:8080/v1/chat/completions)

设计要点：
  - 零第三方依赖，只用标准库
  - 支持流式与非流式
  - 支持 tool_use / tool_result / tools 双向转换
  - 单进程单端口，简化架构
  - 优化性能：连接池、超时、内存管理
"""

import json
import os
import sys
import uuid
import urllib.request
import urllib.error
import threading
import queue
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BACKEND = os.environ.get("MLX_BACKEND", "http://127.0.0.1:8080/v1/chat/completions")
BACKEND_MODEL = os.environ.get("MLX_MODEL", "default_model")
PORT = int(os.environ.get("MLX_UNIFIED_PORT", "4100"))

# 性能优化配置
REQUEST_TIMEOUT = int(os.environ.get("MLX_REQUEST_TIMEOUT", "1800"))

# 认证配置（可选）
AUTH_TOKEN = os.environ.get("MLX_AUTH_TOKEN", "")

# Anthropic stop_reason 映射
STOP_MAP = {"tool_calls": "tool_use", "length": "max_tokens", "stop": "end_turn"}


# ==============================================================================
# Anthropic ↔ OpenAI 转换（从 anthropic_proxy.py 移植）
# ==============================================================================

def _text_of(content):
    """把 Anthropic 的 content（str 或 block 列表）压成纯文本。"""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if isinstance(b, str):
                parts.append(b)
            elif isinstance(b, dict):
                if b.get("type") == "text":
                    parts.append(b.get("text", ""))
                elif b.get("type") == "tool_result":
                    parts.append(_text_of(b.get("content")))
        return "\n".join(p for p in parts if p)
    return str(content)


def anthropic_to_openai(body):
    """Anthropic Messages 请求 → OpenAI Chat Completions 请求。"""
    msgs = []
    sys_parts = []

    sysp = body.get("system")
    if sysp:
        sys_parts.append(_text_of(sysp))

    for m in body.get("messages", []):
        role = m.get("role", "user")
        content = m.get("content")

        if role == "system":
            sys_parts.append(_text_of(content))
            continue

        if isinstance(content, str):
            msgs.append({"role": role, "content": content})
            continue

        texts, tool_calls, tool_results = [], [], []
        for b in content or []:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "text":
                texts.append(b.get("text", ""))
            elif bt == "tool_use":
                tool_calls.append({
                    "id": b.get("id") or f"call_{uuid.uuid4().hex[:16]}",
                    "type": "function",
                    "function": {
                        "name": b.get("name") or "",
                        "arguments": json.dumps(b.get("input") or {}, ensure_ascii=False),
                    },
                })
            elif bt == "tool_result":
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": b.get("tool_use_id") or "",
                    "content": _text_of(b.get("content")),
                })

        if tool_results:
            msgs.extend(tool_results)
            if texts:
                msgs.append({"role": "user", "content": "\n".join(texts)})
            continue

        msg = {"role": role}
        if tool_calls:
            msg["content"] = "\n".join(texts) if texts else ""
            msg["tool_calls"] = tool_calls
        else:
            msg["content"] = "\n".join(texts)
        msgs.append(msg)

    if sys_parts:
        merged = "\n\n".join(p for p in sys_parts if p)
        if merged:
            msgs.insert(0, {"role": "system", "content": merged})

    req = {
        "model": BACKEND_MODEL,
        "messages": msgs,
        "max_tokens": body.get("max_tokens") or 4096,
    }
    if body.get("temperature") is not None:
        req["temperature"] = body["temperature"]
    if body.get("top_p") is not None:
        req["top_p"] = body["top_p"]
    if body.get("stop_sequences"):
        req["stop"] = body["stop_sequences"]

    if body.get("tools"):
        req["tools"] = [{
            "type": "function",
            "function": {
                "name": t.get("name") or "",
                "description": t.get("description") or "",
                "parameters": t.get("input_schema") or {"type": "object", "properties": {}},
            },
        } for t in body["tools"]]

    tc = body.get("tool_choice")
    if isinstance(tc, dict):
        tct = tc.get("type")
        if tct == "auto":
            req["tool_choice"] = "auto"
        elif tct == "any":
            req["tool_choice"] = "required"
        elif tct == "none":
            req["tool_choice"] = "none"
        elif tct == "tool" and tc.get("name"):
            req["tool_choice"] = {"type": "function", "function": {"name": tc["name"]}}

    return req


def openai_to_anthropic(data, body):
    """OpenAI Chat Completions 响应 → Anthropic Messages 响应（非流式）。"""
    ch = (data.get("choices") or [{}])[0]
    m = ch.get("message") or {}
    content = []

    if m.get("content"):
        content.append({"type": "text", "text": m["content"]})

    for tcall in (m.get("tool_calls") or []):
        fn = tcall.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except Exception:
            args = {}
        content.append({
            "type": "tool_use",
            "id": tcall.get("id") or f"toolu_{uuid.uuid4().hex[:16]}",
            "name": fn.get("name") or "",
            "input": args,
        })

    u = data.get("usage") or {}
    return {
        "id": data.get("id") or f"msg_{uuid.uuid4().hex[:24]}",
        "type": "message",
        "role": "assistant",
        "model": body.get("model") or BACKEND_MODEL,
        "content": content,
        "stop_reason": STOP_MAP.get(str(ch.get("finish_reason") or ""), "end_turn"),
        "stop_sequence": None,
        "usage": {
            "input_tokens": u.get("prompt_tokens", 0),
            "output_tokens": u.get("completion_tokens", 0),
        },
    }


# ==============================================================================
# OpenAI Responses ↔ OpenAI Chat Completions 转换
# ==============================================================================

def responses_to_chat(body):
    """OpenAI Responses 请求 → OpenAI Chat Completions 请求。"""
    # 提取 input 中的文本
    input_text = ""
    input_data = body.get("input")

    if isinstance(input_data, str):
        input_text = input_data
    elif isinstance(input_data, list):
        parts = []
        for item in input_data:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if item.get("type") == "message":
                    content = item.get("content", [])
                    if isinstance(content, str):
                        parts.append(content)
                    elif isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict) and c.get("type") == "input_text":
                                parts.append(c.get("text", ""))
        input_text = "\n".join(parts)

    msgs = [{"role": "user", "content": input_text}]

    # 如果有 instructions，作为 system 消息
    instructions = body.get("instructions")
    if instructions:
        msgs.insert(0, {"role": "system", "content": instructions})

    req = {
        "model": BACKEND_MODEL,
        "messages": msgs,
        "max_tokens": body.get("max_output_tokens") or 4096,
    }

    if body.get("temperature") is not None:
        req["temperature"] = body["temperature"]
    if body.get("top_p") is not None:
        req["top_p"] = body["top_p"]
    if body.get("stop"):
        req["stop"] = body["stop"]

    # 转换 tools
    if body.get("tools"):
        req["tools"] = []
        for t in body["tools"]:
            if t.get("type") == "function":
                req["tools"].append({
                    "type": "function",
                    "function": {
                        "name": t.get("name") or "",
                        "description": t.get("description") or "",
                        "parameters": t.get("parameters") or {"type": "object", "properties": {}},
                    },
                })

    # tool_choice
    tc = body.get("tool_choice")
    if isinstance(tc, str):
        req["tool_choice"] = tc
    elif isinstance(tc, dict):
        tct = tc.get("type")
        if tct == "auto":
            req["tool_choice"] = "auto"
        elif tct == "required":
            req["tool_choice"] = "required"
        elif tct == "none":
            req["tool_choice"] = "none"
        elif tct == "function" and tc.get("name"):
            req["tool_choice"] = {"type": "function", "function": {"name": tc["name"]}}

    return req


def chat_to_responses(data, body):
    """OpenAI Chat Completions 响应 → OpenAI Responses 响应（非流式）。"""
    ch = (data.get("choices") or [{}])[0]
    m = ch.get("message") or {}
    u = data.get("usage") or {}

    output = []
    output_text = m.get("content", "")
    if output_text:
        output.append({
            "type": "message",
            "id": f"msg_{uuid.uuid4().hex[:24]}",
            "role": "assistant",
            "content": [{"type": "output_text", "text": output_text}],
            "status": "completed",
        })

    # 处理 tool_calls
    for tcall in (m.get("tool_calls") or []):
        fn = tcall.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except Exception:
            args = {}
        output.append({
            "type": "function_call",
            "id": f"fc_{uuid.uuid4().hex[:16]}",
            "call_id": tcall.get("id") or f"call_{uuid.uuid4().hex[:16]}",
            "name": fn.get("name") or "",
            "arguments": json.dumps(args, ensure_ascii=False),
            "status": "completed",
        })

    # 确定 status
    finish_reason = ch.get("finish_reason")
    if finish_reason == "length":
        status = "incomplete"
    else:
        status = "completed"

    resp = {
        "id": data.get("id") or f"resp_{uuid.uuid4().hex[:24]}",
        "object": "response",
        "created_at": data.get("created") or 0,
        "status": status,
        "output": output,
        "usage": {
            "input_tokens": u.get("prompt_tokens", 0),
            "output_tokens": u.get("completion_tokens", 0),
            "total_tokens": u.get("total_tokens", 0),
        },
    }

    if body.get("model"):
        resp["model"] = body["model"]

    return resp


# ==============================================================================
# 流式转换
# ==============================================================================


# ==============================================================================
# HTTP 服务
# ==============================================================================

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "mlx-unified-proxy/1.0"

    def __init__(self, *args, **kwargs):
        # 初始化实例变量（避免类变量共享问题）
        self._headers_sent = False
        self._chunks_ended = False
        super().__init__(*args, **kwargs)

    # type: ignore[override]
    def log_message(self, format, *args):
        sys.stderr.write("[unified-proxy] %s - %s\n" % (self.address_string(), format % args))
        sys.stderr.flush()

    def _check_auth(self):
        """检查认证（如果配置了AUTH_TOKEN）"""
        if not AUTH_TOKEN:
            return True
        auth = self.headers.get("Authorization", "")
        return auth == f"Bearer {AUTH_TOKEN}" or auth == f"Token {AUTH_TOKEN}"

    def end_headers(self):
        self._headers_sent = True
        super().end_headers()

    # 最大请求体大小 (10MB)
    MAX_BODY_SIZE = 10 * 1024 * 1024

    def _send_stream_headers(self):
        """发送流式SSE响应头"""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

    def _read_body(self):
        """读取请求体：同时支持 Content-Length 与 Transfer-Encoding: chunked。"""
        import io
        te = (self.headers.get("Transfer-Encoding") or "").lower()
        try:
            if "chunked" in te:
                buf = io.BytesIO()
                total_size = 0
                while True:
                    size_line = self.rfile.readline()
                    if not size_line:
                        break
                    size_line = size_line.strip()
                    if not size_line:
                        continue
                    try:
                        size = int(size_line.split(b";")[0], 16)
                    except ValueError:
                        break
                    if size == 0:
                        self.rfile.readline()
                        break
                    total_size += size
                    if total_size > self.MAX_BODY_SIZE:
                        self._json(413, {"error": {"message": "Request body too large", "type": "invalid_request_error"}})
                        return None
                    buf.write(self.rfile.read(size))
                    self.rfile.readline()
                raw = buf.getvalue()
            else:
                n = int(self.headers.get("Content-Length") or 0)
                if n > self.MAX_BODY_SIZE:
                    self._json(413, {"error": {"message": "Request body too large", "type": "invalid_request_error"}})
                    return None
                raw = self.rfile.read(n) if n > 0 else b""
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": {"message": "Invalid JSON", "type": "invalid_request_error"}})
            return None
        except Exception as e:
            self.log_message("body read error: %r", e)
            self._json(500, {"error": {"message": "Failed to read request body", "type": "api_error"}})
            return None

    def _json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _err(self, code, msg, etype="api_error"):
        self._json(code, {"type": "error", "error": {"type": etype, "message": msg}})

    def _chunk(self, text):
        payload = text.encode()
        self.wfile.write(b"%x\r\n" % len(payload) + payload + b"\r\n")
        self.wfile.flush()

    def _sse(self, event, data):
        self._chunk("event: %s\ndata: %s\n\n" % (event, json.dumps(data, ensure_ascii=False)))

    def _end_chunks(self):
        if not self._chunks_ended:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
            self._chunks_ended = True

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/")
        if path in ("/health", "/v1/health"):
            self._json(200, {"status": "ok", "backend": BACKEND})
        elif path in ("/", ""):
            self._json(200, {
                "service": "mlx-unified-proxy",
                "protocols": ["/v1/chat/completions", "/v1/responses", "/v1/messages"],
                "backend": BACKEND,
            })
        else:
            self._err(404, "not found", "not_found_error")

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/")

        # 检查认证
        if not self._check_auth():
            self._json(401, {"error": {"message": "Unauthorized", "type": "authentication_error"}})
            return

        # 检测协议类型
        is_anthropic = "anthropic-version" in self.headers
        is_responses = path.endswith("/responses")

        body = self._read_body()
        if body is None:
            # _read_body 已发送错误响应
            return

        if path.endswith("/messages/count_tokens"):
            self._json(200, {"input_tokens": 1})
            return

        # 路由到对应处理器
        if is_responses or (path == "/v1/responses" and not is_anthropic):
            self._handle_responses(body)
        elif is_anthropic or path.endswith("/messages"):
            self._handle_anthropic(body)
        elif path.endswith("/chat/completions"):
            self._handle_chat(body)
        else:
            self._err(404, "not found", "not_found_error")

    def _handle_chat(self, body):
        """处理 OpenAI Chat Completions 请求"""
        payload = body.copy()
        payload["model"] = BACKEND_MODEL
        want_stream = bool(body.get("stream"))

        self._relay_to_backend(payload, body, "chat", want_stream)

    def _handle_anthropic(self, body):
        """处理 Anthropic Messages 请求"""
        payload = anthropic_to_openai(body)
        want_stream = bool(body.get("stream"))

        n_msgs = len(body.get("messages") or [])
        n_tools = len(body.get("tools") or [])
        approx = sum(len(_text_of(m.get("content"))) for m in (body.get("messages") or []))
        self.log_message("anthropic: messages=%d tools=%d stream=%s approx_chars=%d",
                         n_msgs, n_tools, want_stream, approx)

        self._relay_to_backend(payload, body, "anthropic", want_stream)

    def _handle_responses(self, body):
        """处理 OpenAI Responses 请求"""
        payload = responses_to_chat(body)
        want_stream = bool(body.get("stream"))

        self.log_message("responses: stream=%s", want_stream)

        self._relay_to_backend(payload, body, "responses", want_stream)

    def _relay_to_backend(self, payload, original_body, protocol, want_stream=False):
        """统一转发到后端"""
        try:
            # 紧凑JSON序列化，减少体积
            body_bytes = json.dumps(payload, separators=(',', ':')).encode()

            if want_stream:
                payload["stream"] = True
                body_bytes = json.dumps(payload, separators=(',', ':')).encode()
                req = urllib.request.Request(
                    BACKEND,
                    data=body_bytes,
                    method="POST",
                    headers={"Content-Type": "application/json", "Authorization": "Bearer local"}
                )
                resp = urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT)

                if protocol == "anthropic":
                    self._relay_stream_anthropic(resp, original_body)
                elif protocol == "responses":
                    self._relay_stream_responses(resp, original_body)
                else:
                    # Chat 流式
                    self._send_stream_headers()
                    try:
                        for raw in resp:
                            self._chunk(raw.decode("ascii", "ignore"))
                    finally:
                        self._end_chunks()
            else:
                req = urllib.request.Request(
                    BACKEND,
                    data=body_bytes,
                    method="POST",
                    headers={"Content-Type": "application/json", "Authorization": "Bearer local"}
                )
                with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                    data = json.loads(resp.read().decode())

                if protocol == "anthropic":
                    self._json(200, openai_to_anthropic(data, original_body))
                elif protocol == "responses":
                    self._json(200, chat_to_responses(data, original_body))
                else:
                    self._json(200, data)

        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:500]
            self.log_message("backend HTTP %s: %s", e.code, detail)
            self._safe_err(502, f"backend error {e.code}: {detail}")
        except (BrokenPipeError, ConnectionResetError):
            self.log_message("client disconnected")
        except Exception as e:
            self.log_message("proxy error: %r", e)
            self._safe_err(500, repr(e))

    def _safe_err(self, code, msg):
        try:
            if self._headers_sent:
                self._end_chunks()
            else:
                self._err(code, msg)
        except Exception:
            pass

    def _relay_stream_anthropic(self, resp, body):
        """流式转换：OpenAI → Anthropic"""
        self._send_stream_headers()

        try:
            msg_id = f"msg_{uuid.uuid4().hex[:24]}"
            self._sse("message_start", {
                "type": "message_start",
                "message": {
                    "id": msg_id, "type": "message", "role": "assistant",
                    "model": body.get("model") or BACKEND_MODEL,
                    "content": [], "stop_reason": None, "stop_sequence": None,
                    "usage": {"input_tokens": 0, "output_tokens": 0},
                },
            })
            self._sse("ping", {"type": "ping"})

            in_tokens = out_tokens = 0
            block_index = -1
            block_open = False
            block_kind = None
            tool_slot = {}
            stop_reason = "end_turn"

            def close_block():
                nonlocal block_open
                if block_open:
                    self._sse("content_block_stop", {"type": "content_block_stop", "index": block_index})
                    block_open = False

            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                chunk_s = line[5:].strip()
                if not chunk_s or chunk_s == "[DONE]":
                    continue
                try:
                    chunk = json.loads(chunk_s)
                except Exception:
                    continue

                usage = chunk.get("usage") or {}
                if usage.get("prompt_tokens"):
                    in_tokens = usage["prompt_tokens"]
                if usage.get("completion_tokens"):
                    out_tokens = usage["completion_tokens"]

                choice = (chunk.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                fr = choice.get("finish_reason")
                if fr:
                    stop_reason = STOP_MAP.get(fr, "end_turn")

                piece = delta.get("content")
                if piece:
                    if not (block_open and block_kind == "text"):
                        close_block()
                        block_index += 1
                        self._sse("content_block_start", {
                            "type": "content_block_start", "index": block_index,
                            "content_block": {"type": "text", "text": ""}})
                        block_open, block_kind = True, "text"
                    self._sse("content_block_delta", {
                        "type": "content_block_delta", "index": block_index,
                        "delta": {"type": "text_delta", "text": piece}})

                for tcall in (delta.get("tool_calls") or []):
                    oi = tcall.get("index", 0)
                    fn = tcall.get("function") or {}
                    if oi not in tool_slot:
                        close_block()
                        block_index += 1
                        tool_slot[oi] = block_index
                        self._sse("content_block_start", {
                            "type": "content_block_start", "index": block_index,
                            "content_block": {
                                "type": "tool_use",
                                "id": tcall.get("id") or f"toolu_{uuid.uuid4().hex[:16]}",
                                "name": fn.get("name") or "",
                                "input": {},
                            }})
                        block_open, block_kind = True, "tool"
                    if fn.get("arguments"):
                        self._sse("content_block_delta", {
                            "type": "content_block_delta", "index": tool_slot[oi],
                            "delta": {"type": "input_json_delta", "partial_json": fn["arguments"]}})

            close_block()
            self._sse("message_delta", {
                "type": "message_delta",
                "delta": {"stop_reason": stop_reason, "stop_sequence": None},
                "usage": {"input_tokens": in_tokens, "output_tokens": out_tokens},
            })
            self._sse("message_stop", {"type": "message_stop"})
        finally:
            try:
                self._end_chunks()
            except Exception:
                pass

    def _relay_stream_responses(self, resp, body):
        """流式转换：OpenAI → Responses"""
        self._send_stream_headers()

        try:
            response_id = f"resp_{uuid.uuid4().hex[:24]}"
            self._sse("response.created", {
                "type": "response.created",
                "response": {
                    "id": response_id,
                    "object": "response",
                    "status": "in_progress",
                    "output": [],
                },
            })

            content_text = ""
            stop_reason = "stop"

            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                chunk_s = line[5:].strip()
                if not chunk_s or chunk_s == "[DONE]":
                    continue
                try:
                    chunk = json.loads(chunk_s)
                except Exception:
                    continue

                choice = (chunk.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                fr = choice.get("finish_reason")
                if fr:
                    stop_reason = "stop" if fr == "stop" else fr

                piece = delta.get("content")
                if piece:
                    content_text += piece
                    self._sse("response.output_item.delta", {
                        "type": "response.output_item.delta",
                        "delta": {"type": "content_block_delta", "text": piece},
                    })

            # 发送完成事件
            self._sse("response.output_item.done", {
                "type": "response.output_item.done",
                "item": {
                    "type": "message",
                    "id": f"msg_{uuid.uuid4().hex[:24]}",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": content_text}],
                    "status": "completed",
                },
            })

            self._sse("response.completed", {
                "type": "response.completed",
                "response": {
                    "id": response_id,
                    "object": "response",
                    "status": "completed",
                    "output": [],
                },
            })
        finally:
            try:
                self._end_chunks()
            except Exception:
                pass


def main():
    import signal

    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    sys.stderr.write(f"[unified-proxy] listening on 127.0.0.1:{PORT} → {BACKEND}\n")
    sys.stderr.write(f"[unified-proxy] protocols: chat/completions, responses, messages\n")
    sys.stderr.flush()

    def shutdown_handler(signum, frame):
        sys.stderr.write(f"\n[unified-proxy] received signal {signum}, shutting down...\n")
        srv.shutdown()

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    try:
        srv.serve_forever()
    finally:
        srv.shutdown()
        srv.server_close()
        sys.stderr.write("[unified-proxy] stopped\n")


if __name__ == "__main__":
    main()
