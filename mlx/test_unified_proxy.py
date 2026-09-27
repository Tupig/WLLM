#!/usr/bin/env python3
"""
unified_proxy.py 单元测试

测试协议转换函数：
- anthropic_to_openai
- openai_to_anthropic
- responses_to_chat
- chat_to_responses
"""

import json
import unittest
import sys
import os

# 添加父目录到路径，以便导入 unified_proxy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unified_proxy


class TestAnthropicToOpenAI(unittest.TestCase):
    """测试 Anthropic Messages → OpenAI Chat Completions 转换"""

    def test_simple_text_message(self):
        """测试简单文本消息"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [
                {"role": "user", "content": "Hello, world!"}
            ]
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(result["model"], unified_proxy.BACKEND_MODEL)
        self.assertEqual(result["max_tokens"], 1024)
        self.assertEqual(len(result["messages"]), 1)
        self.assertEqual(result["messages"][0]["role"], "user")
        self.assertEqual(result["messages"][0]["content"], "Hello, world!")

    def test_system_message(self):
        """测试系统消息"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "system": "You are a helpful assistant.",
            "messages": [
                {"role": "user", "content": "Hello!"}
            ]
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(len(result["messages"]), 2)
        self.assertEqual(result["messages"][0]["role"], "system")
        self.assertEqual(result["messages"][0]["content"], "You are a helpful assistant.")
        self.assertEqual(result["messages"][1]["role"], "user")

    def test_multi_turn_conversation(self):
        """测试多轮对话"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [
                {"role": "user", "content": "What is 2+2?"},
                {"role": "assistant", "content": "4"},
                {"role": "user", "content": "And 3+3?"}
            ]
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(len(result["messages"]), 3)
        self.assertEqual(result["messages"][0]["content"], "What is 2+2?")
        self.assertEqual(result["messages"][1]["content"], "4")
        self.assertEqual(result["messages"][2]["content"], "And 3+3?")

    def test_tool_calls(self):
        """测试工具调用"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "call_123",
                            "name": "get_weather",
                            "input": {"location": "Tokyo"}
                        }
                    ]
                }
            ]
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(len(result["messages"]), 1)
        msg = result["messages"][0]
        self.assertIn("tool_calls", msg)
        self.assertEqual(len(msg["tool_calls"]), 1)
        self.assertEqual(msg["tool_calls"][0]["id"], "call_123")
        self.assertEqual(msg["tool_calls"][0]["function"]["name"], "get_weather")

    def test_tool_results(self):
        """测试工具结果"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "call_123",
                            "content": "Sunny, 25°C"
                        }
                    ]
                }
            ]
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(len(result["messages"]), 1)
        msg = result["messages"][0]
        self.assertEqual(msg["role"], "tool")
        self.assertEqual(msg["tool_call_id"], "call_123")
        self.assertEqual(msg["content"], "Sunny, 25°C")

    def test_tools_definition(self):
        """测试工具定义转换"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "Hello"}],
            "tools": [
                {
                    "name": "get_weather",
                    "description": "Get weather info",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "location": {"type": "string"}
                        }
                    }
                }
            ]
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertIn("tools", result)
        self.assertEqual(len(result["tools"]), 1)
        tool = result["tools"][0]
        self.assertEqual(tool["type"], "function")
        self.assertEqual(tool["function"]["name"], "get_weather")
        self.assertEqual(tool["function"]["description"], "Get weather info")

    def test_tool_choice_auto(self):
        """测试 tool_choice: auto"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "Hello"}],
            "tool_choice": {"type": "auto"}
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(result["tool_choice"], "auto")

    def test_tool_choice_any(self):
        """测试 tool_choice: any → required"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "Hello"}],
            "tool_choice": {"type": "any"}
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(result["tool_choice"], "required")

    def test_tool_choice_none(self):
        """测试 tool_choice: none"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "Hello"}],
            "tool_choice": {"type": "none"}
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(result["tool_choice"], "none")

    def test_tool_choice_specific(self):
        """测试 tool_choice: tool (指定工具)"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "Hello"}],
            "tool_choice": {"type": "tool", "name": "get_weather"}
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(result["tool_choice"]["type"], "function")
        self.assertEqual(result["tool_choice"]["function"]["name"], "get_weather")

    def test_temperature_and_top_p(self):
        """测试温度和 top_p 参数"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "Hello"}],
            "temperature": 0.7,
            "top_p": 0.9
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(result["temperature"], 0.7)
        self.assertEqual(result["top_p"], 0.9)

    def test_stop_sequences(self):
        """测试 stop_sequences 转换"""
        body = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "Hello"}],
            "stop_sequences": ["STOP", "END"]
        }
        result = unified_proxy.anthropic_to_openai(body)
        
        self.assertEqual(result["stop"], ["STOP", "END"])


class TestOpenAIToAnthropic(unittest.TestCase):
    """测试 OpenAI Chat Completions → Anthropic Messages 转换"""

    def test_simple_response(self):
        """测试简单文本响应"""
        data = {
            "id": "chatcmpl-123",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Hello! How can I help?"
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20
            }
        }
        body = {"model": "claude-3-5-sonnet-20241022"}
        result = unified_proxy.openai_to_anthropic(data, body)
        
        self.assertEqual(result["type"], "message")
        self.assertEqual(result["role"], "assistant")
        self.assertEqual(result["model"], "claude-3-5-sonnet-20241022")
        self.assertEqual(len(result["content"]), 1)
        self.assertEqual(result["content"][0]["type"], "text")
        self.assertEqual(result["content"][0]["text"], "Hello! How can I help?")
        self.assertEqual(result["stop_reason"], "end_turn")

    def test_tool_calls_response(self):
        """测试工具调用响应"""
        data = {
            "id": "chatcmpl-123",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "call_456",
                                "type": "function",
                                "function": {
                                    "name": "get_weather",
                                    "arguments": '{"location": "Tokyo"}'
                                }
                            }
                        ]
                    },
                    "finish_reason": "tool_calls"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20
            }
        }
        body = {"model": "claude-3-5-sonnet-20241022"}
        result = unified_proxy.openai_to_anthropic(data, body)
        
        self.assertEqual(result["stop_reason"], "tool_use")
        self.assertEqual(len(result["content"]), 1)
        self.assertEqual(result["content"][0]["type"], "tool_use")
        self.assertEqual(result["content"][0]["id"], "call_456")
        self.assertEqual(result["content"][0]["name"], "get_weather")
        self.assertEqual(result["content"][0]["input"], {"location": "Tokyo"})

    def test_length_finish_reason(self):
        """测试 length finish_reason → max_tokens"""
        data = {
            "id": "chatcmpl-123",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "This is a long response..."
                    },
                    "finish_reason": "length"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 100
            }
        }
        body = {"model": "claude-3-5-sonnet-20241022"}
        result = unified_proxy.openai_to_anthropic(data, body)
        
        self.assertEqual(result["stop_reason"], "max_tokens")

    def test_usage_conversion(self):
        """测试 usage 字段转换"""
        data = {
            "id": "chatcmpl-123",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Hello"
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 15,
                "completion_tokens": 25
            }
        }
        body = {"model": "claude-3-5-sonnet-20241022"}
        result = unified_proxy.openai_to_anthropic(data, body)
        
        self.assertEqual(result["usage"]["input_tokens"], 15)
        self.assertEqual(result["usage"]["output_tokens"], 25)


class TestResponsesToChat(unittest.TestCase):
    """测试 OpenAI Responses → OpenAI Chat Completions 转换"""

    def test_simple_text_input(self):
        """测试简单文本输入"""
        body = {
            "model": "gpt-4o",
            "input": "Hello, world!"
        }
        result = unified_proxy.responses_to_chat(body)
        
        self.assertEqual(result["model"], unified_proxy.BACKEND_MODEL)
        self.assertEqual(len(result["messages"]), 1)
        self.assertEqual(result["messages"][0]["role"], "user")
        self.assertEqual(result["messages"][0]["content"], "Hello, world!")

    def test_instructions_as_system(self):
        """测试 instructions 转换为 system 消息"""
        body = {
            "model": "gpt-4o",
            "input": "Hello!",
            "instructions": "You are a helpful assistant."
        }
        result = unified_proxy.responses_to_chat(body)
        
        self.assertEqual(len(result["messages"]), 2)
        self.assertEqual(result["messages"][0]["role"], "system")
        self.assertEqual(result["messages"][0]["content"], "You are a helpful assistant.")
        self.assertEqual(result["messages"][1]["role"], "user")

    def test_list_input(self):
        """测试列表格式输入"""
        body = {
            "model": "gpt-4o",
            "input": [
                {"type": "message", "content": [{"type": "input_text", "text": "Hello"}]},
                {"type": "message", "content": [{"type": "input_text", "text": "World"}]}
            ]
        }
        result = unified_proxy.responses_to_chat(body)
        
        self.assertEqual(len(result["messages"]), 1)
        self.assertEqual(result["messages"][0]["content"], "Hello\nWorld")

    def test_max_output_tokens(self):
        """测试 max_output_tokens 转换"""
        body = {
            "model": "gpt-4o",
            "input": "Hello",
            "max_output_tokens": 2048
        }
        result = unified_proxy.responses_to_chat(body)
        
        self.assertEqual(result["max_tokens"], 2048)

    def test_tools_conversion(self):
        """测试 tools 转换"""
        body = {
            "model": "gpt-4o",
            "input": "Hello",
            "tools": [
                {
                    "type": "function",
                    "name": "get_weather",
                    "description": "Get weather info",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {"type": "string"}
                        }
                    }
                }
            ]
        }
        result = unified_proxy.responses_to_chat(body)
        
        self.assertIn("tools", result)
        self.assertEqual(len(result["tools"]), 1)
        self.assertEqual(result["tools"][0]["function"]["name"], "get_weather")

    def test_tool_choice_string(self):
        """测试 tool_choice 字符串格式"""
        body = {
            "model": "gpt-4o",
            "input": "Hello",
            "tool_choice": "auto"
        }
        result = unified_proxy.responses_to_chat(body)
        
        self.assertEqual(result["tool_choice"], "auto")

    def test_tool_choice_dict(self):
        """测试 tool_choice 字典格式"""
        body = {
            "model": "gpt-4o",
            "input": "Hello",
            "tool_choice": {"type": "required"}
        }
        result = unified_proxy.responses_to_chat(body)
        
        self.assertEqual(result["tool_choice"], "required")


class TestChatToResponses(unittest.TestCase):
    """测试 OpenAI Chat Completions → OpenAI Responses 转换"""

    def test_simple_response(self):
        """测试简单文本响应"""
        data = {
            "id": "chatcmpl-123",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Hello! How can I help?"
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20
            }
        }
        body = {"model": "gpt-4o"}
        result = unified_proxy.chat_to_responses(data, body)
        
        self.assertEqual(result["object"], "response")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(result["output"]), 1)
        self.assertEqual(result["output"][0]["type"], "message")
        self.assertEqual(result["output"][0]["role"], "assistant")
        self.assertEqual(result["output"][0]["content"][0]["text"], "Hello! How can I help?")

    def test_tool_calls_response(self):
        """测试工具调用响应"""
        data = {
            "id": "chatcmpl-123",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "call_456",
                                "type": "function",
                                "function": {
                                    "name": "get_weather",
                                    "arguments": '{"location": "Tokyo"}'
                                }
                            }
                        ]
                    },
                    "finish_reason": "tool_calls"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20
            }
        }
        body = {"model": "gpt-4o"}
        result = unified_proxy.chat_to_responses(data, body)
        
        self.assertEqual(result["status"], "completed")
        # 应该有 message 和 function_call 输出
        self.assertGreaterEqual(len(result["output"]), 1)

    def test_usage_conversion(self):
        """测试 usage 字段转换"""
        data = {
            "id": "chatcmpl-123",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Hello"
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 15,
                "completion_tokens": 25
            }
        }
        body = {"model": "gpt-4o"}
        result = unified_proxy.chat_to_responses(data, body)
        
        self.assertEqual(result["usage"]["input_tokens"], 15)
        self.assertEqual(result["usage"]["output_tokens"], 25)


class TestTextOf(unittest.TestCase):
    """测试 _text_of 辅助函数"""

    def test_none_input(self):
        """测试 None 输入"""
        self.assertEqual(unified_proxy._text_of(None), "")

    def test_string_input(self):
        """测试字符串输入"""
        self.assertEqual(unified_proxy._text_of("Hello"), "Hello")

    def test_list_of_strings(self):
        """测试字符串列表"""
        self.assertEqual(unified_proxy._text_of(["Hello", "World"]), "Hello\nWorld")

    def test_list_of_text_blocks(self):
        """测试 text block 列表"""
        content = [
            {"type": "text", "text": "Hello"},
            {"type": "text", "text": "World"}
        ]
        self.assertEqual(unified_proxy._text_of(content), "Hello\nWorld")

    def test_mixed_content(self):
        """测试混合内容"""
        content = [
            {"type": "text", "text": "Hello"},
            {"type": "tool_result", "content": "Result"},
            "Plain text"
        ]
        result = unified_proxy._text_of(content)
        self.assertIn("Hello", result)
        self.assertIn("Result", result)
        self.assertIn("Plain text", result)


if __name__ == "__main__":
    unittest.main()
