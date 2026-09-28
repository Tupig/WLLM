// GPT 生成 Unity 测试用例：integrations/gpt_testgen.py 的 Go 移植。
// 需配置 OPENAI_API_KEY；可选 OPENAI_MODEL（默认 gpt-4o-mini）。
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const openaiSystemPrompt = `你是一个 Unity 测试工程师。根据用户的测试需求，生成符合 Unity Test Framework（NUnit）的 C# 测试代码。
要求：
1. 仅输出可编译的 C# 代码，不要 markdown 代码块或解释。
2. 使用 UnityEngine.TestTools、NUnit.Framework；Play Mode 用 [UnityTest] 返回 IEnumerator，Edit Mode 用 [Test]。
3. 类名以 Generated_ 开头，命名空间可省略或使用项目默认。
4. 如需加载场景，使用 UnityEngine.SceneManagement.SceneManager.LoadSceneAsync。
5. 断言使用 Assert.IsTrue/AreEqual 等。`

// generateTestCase 返回 (code, error)。code 非空表示生成成功。
func generateTestCase(prompt, assembly string) (string, string) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return "", "OPENAI_API_KEY 未配置"
	}
	model := os.Getenv("OPENAI_MODEL")
	if model == "" {
		model = "gpt-4o-mini"
	}
	// 支持 OpenAI 兼容网关/私有部署；测试中也可注入假上游
	base := strings.TrimRight(os.Getenv("OPENAI_BASE_URL"), "/")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	userContent := prompt
	if assembly != "" {
		userContent = fmt.Sprintf("程序集/命名空间参考: %s\n\n%s", assembly, prompt)
	}
	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": openaiSystemPrompt},
			{"role": "user", "content": userContent},
		},
		"temperature": 0.3,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", base+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err.Error()
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err.Error()
	}
	defer resp.Body.Close()

	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err.Error()
	}
	if out.Error != nil {
		return "", out.Error.Message
	}
	if len(out.Choices) == 0 {
		return "", "模型返回为空"
	}
	text := strings.TrimSpace(out.Choices[0].Message.Content)
	if text == "" {
		return "", "模型返回为空"
	}
	// 去 markdown 围栏（与 gpt_testgen.py 保持一致）
	if strings.HasPrefix(text, "```") {
		for _, start := range []string{"```csharp", "```cs", "```C#", "```"} {
			if strings.HasPrefix(text, start) {
				text = strings.TrimLeft(text[len(start):], " \t\n\r")
				break
			}
		}
		if strings.HasSuffix(text, "```") {
			text = strings.TrimRight(strings.TrimSuffix(text, "```"), " \t\n\r")
		}
	}
	return text, ""
}
