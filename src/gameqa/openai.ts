/**
 * gameqa/openai.ts — GPT 生成 Unity 测试用例（openai.go 移植）
 * 需 OPENAI_API_KEY；可选 OPENAI_MODEL（默认 gpt-4o-mini）/ OPENAI_BASE_URL（OpenAI 兼容网关）。
 */
const SYSTEM_PROMPT = `你是一个 Unity 测试工程师。根据用户的测试需求，生成符合 Unity Test Framework（NUnit）的 C# 测试代码。
要求：
1. 仅输出可编译的 C# 代码，不要 markdown 代码块或解释。
2. 使用 UnityEngine.TestTools、NUnit.Framework；Play Mode 用 [UnityTest] 返回 IEnumerator，Edit Mode 用 [Test]。
3. 类名以 Generated_ 开头，命名空间可省略或使用项目默认。
4. 如需加载场景，使用 UnityEngine.SceneManagement.SceneManager.LoadSceneAsync。
5. 断言使用 Assert.IsTrue/AreEqual 等。`;

/** 返回 [code, error]；code 非空表示生成成功 */
export async function generateTestCase(prompt: string, assembly: string): Promise<[string, string]> {
  const apiKey = (process.env["OPENAI_API_KEY"] ?? "").trim();
  if (apiKey === "") return ["", "OPENAI_API_KEY 未配置"];
  const model = process.env["OPENAI_MODEL"] || "gpt-4o-mini";
  let base = (process.env["OPENAI_BASE_URL"] ?? "").replace(/\/+$/, "");
  if (base === "") base = "https://api.openai.com/v1";

  const userContent = assembly ? `程序集/命名空间参考: ${assembly}\n\n${prompt}` : prompt;
  try {
    const resp = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const out = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (out.error) return ["", out.error.message ?? "上游返回错误"];
    const text = (out.choices?.[0]?.message?.content ?? "").trim();
    if (text === "") return ["", "模型返回为空"];
    return [stripFences(text), ""];
  } catch (err) {
    return ["", (err as Error).message];
  }
}

/** 去 markdown 围栏（与 gpt_testgen.py 一致） */
function stripFences(text: string): string {
  if (!text.startsWith("```")) return text;
  for (const start of ["```csharp", "```cs", "```C#", "```"]) {
    if (text.startsWith(start)) {
      text = text.slice(start.length).replace(/^[ \t\n\r]+/, "");
      break;
    }
  }
  if (text.endsWith("```")) {
    text = text.slice(0, -3).replace(/[ \t\n\r]+$/, "");
  }
  return text;
}

/** JSON 序列化辅助（generate_and_run 写 extra 用） */
