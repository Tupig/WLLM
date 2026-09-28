"""
可选模块：使用 OpenAI GPT 根据自然语言生成 Unity Test Framework（UTF）C# 测试代码。
依赖：pip install openai；环境变量 OPENAI_API_KEY；可选 OPENAI_MODEL（默认 gpt-4o-mini）。
未配置时 generate() 返回 error，编排服务可降级为仅保存 prompt。
"""
import os
from typing import Optional

_SYSTEM_PROMPT = """你是一个 Unity 测试工程师。根据用户的测试需求，生成符合 Unity Test Framework（NUnit）的 C# 测试代码。
要求：
1. 仅输出可编译的 C# 代码，不要 markdown 代码块或解释。
2. 使用 UnityEngine.TestTools、NUnit.Framework；Play Mode 用 [UnityTest] 返回 IEnumerator，Edit Mode 用 [Test]。
3. 类名以 Generated_ 开头，命名空间可省略或使用项目默认。
4. 如需加载场景，使用 UnityEngine.SceneManagement.SceneManager.LoadSceneAsync。
5. 断言使用 Assert.IsTrue/AreEqual 等。"""


def generate(prompt: str, assembly: Optional[str] = None) -> dict:
    """
    根据自然语言 prompt 生成 UTF 风格 C# 测试代码。
    返回 {"code": "..."} 或 {"code": None, "error": "..."}。
    """
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return {"code": None, "error": "OPENAI_API_KEY 未配置"}
    try:
        import openai
    except ImportError:
        return {"code": None, "error": "未安装 openai，请执行: pip install openai"}
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    client = openai.OpenAI(api_key=api_key)
    user_content = prompt
    if assembly:
        user_content = f"程序集/命名空间参考: {assembly}\n\n{prompt}"
    try:
        r = client.chat.completions.create(model=model, messages=[{"role": "system", "content": _SYSTEM_PROMPT}, {"role": "user", "content": user_content}], temperature=0.3)
        text = (r.choices[0].message.content or "").strip()
        if not text:
            return {"code": None, "error": "模型返回为空"}
        if text.startswith("```"):
            for start in ("```csharp", "```cs", "```C#", "```"):
                if text.startswith(start):
                    text = text[len(start):].lstrip()
                    break
            if text.endswith("```"):
                text = text[:-3].rstrip()
        return {"code": text, "error": None}
    except Exception as e:
        return {"code": None, "error": str(e)}
