/**
 * AI 客户端 — 支持 OpenAI 兼容 API（DeepSeek / 自定义网关）
 *
 * SSE 格式：
 *   data: {"choices":[{"delta":{"content":"文字"}}  ]}
 *   data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"xxx"}}]}}]}
 *   ...
 *   data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}
 *   data: [DONE]
 *
 * 关键：finish_reason 在 choices[0] 层级，不在 delta 里。
 *      tool_calls 可能分片到多个 chunk（name 在一个、arguments 在另一个）。
 */

import type { ChatMessage, ToolDefinition, ModelProvider, AgentStreamEvent } from "./types";

export async function* streamChat(
  provider: ModelProvider,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): AsyncGenerator<AgentStreamEvent> {
  const body: Record<string, unknown> = {
    model: provider.modelName,
    messages,
    stream: true,
  };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(`${provider.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`API 请求失败 (${res.status}): ${errText.slice(0, 500)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("响应体为空");

  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue; // SSE 结束标记，忽略（用 finish_reason 判断）

      try {
        const chunk = JSON.parse(data);
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        const fr = choice?.finish_reason;
        if (fr) {
          finishReason = fr;
          console.log("[sse] finish_reason:", fr);
        }

        if (delta?.content) {
          yield { textDelta: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            yield {
              toolCall: {
                id: tc.id || "",
                index: tc.index,
                type: "function",
                function: {
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                },
              },
            };
            // 每个 tool_call stream 事件也更新 finishReason 防止丢失
          }
        }
      } catch { /* skip bad JSON */ }
    }
  }

  // 流结束后才发 done
  yield { done: true };
}
