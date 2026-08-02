/**
 * AgentService — 核心 tool-use 循环
 */

import type { ChatMessage, ToolCall, AgentSession } from "./types";
import { streamChat } from "./client";
import { TOOL_DEFINITIONS, executeTool } from "./tool-definitions";
import { loadModelConfig, saveModelConfig, type ModelProvider } from "./model-config";
import { SYSTEM_PROMPT } from "./system-prompt";

type StreamCallback = (event: {
  type: "text" | "tool" | "tool_result" | "done" | "error";
  content?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
}) => void;

export class AgentService {
  private messages: ChatMessage[] = [];
  private provider: ModelProvider;
  private readonly MAX_TOOL_ROUNDS = 10;

  constructor(provider?: ModelProvider) {
    this.provider = provider || loadModelConfig();
  }

  setProvider(provider: ModelProvider) {
    this.provider = provider;
    saveModelConfig(provider);
  }

  getProvider(): ModelProvider { return this.provider; }
  newChat() { this.messages = []; }
  loadSession(session: AgentSession) { this.messages = [...session.messages]; }
  exportSession(): AgentSession {
    return { id: crypto.randomUUID(), title: "", messages: [...this.messages], createdAt: Date.now(), updatedAt: Date.now() };
  }
  getMessages(): ChatMessage[] { return this.messages; }

  async *run(userInput: string, onProgress?: StreamCallback): AsyncGenerator<string> {
    if (this.messages.length === 0) {
      this.messages.push({ role: "system", content: SYSTEM_PROMPT });
    }
    this.messages.push({ role: "user", content: userInput });

    const maxRounds = this.MAX_TOOL_ROUNDS;
    for (let round = 0; round < maxRounds; round++) {
      let textContent = "";
      // 按 index 合并 DeepSeek 分片的 tool_calls（name 和 arguments 可能在不同 chunk）
      const tcByIndex = new Map<number, ToolCall>();

      console.log(`[agent] round ${round + 1}/${maxRounds}, messages: ${this.messages.length}`);

      try {
        for await (const event of streamChat(this.provider, this.messages, TOOL_DEFINITIONS)) {
          if (event.textDelta) {
            textContent += event.textDelta;
            onProgress?.({ type: "text", content: event.textDelta });
            yield event.textDelta;
          }

          if (event.toolCall) {
            const tc = event.toolCall;
            const idx = tc.index ?? 0;
            const existing = tcByIndex.get(idx);
            tcByIndex.set(idx, {
              index: idx,
              id: existing?.id || tc.id,
              type: "function",
              function: {
                name: existing?.function.name || tc.function.name,
                arguments: (existing?.function.arguments || "") + (tc.function.arguments || ""),
              },
            });
          }

          if (event.done) break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        console.error("[agent] stream error:", msg);
        onProgress?.({ type: "error", content: msg });
        yield `\n\n❌ ${msg}`;
        break;
      }

      // 收集有效 tool_calls
      const resolved = Array.from(tcByIndex.values()).filter((tc) => tc.function.name && tc.function.arguments);
      console.log("[agent] text:", textContent.slice(0, 80), "tools:", resolved.map((t) => t.function.name).join(","));

      if (resolved.length > 0) {
        // 记录 assistant 消息
        this.messages.push({
          role: "assistant",
          content: textContent || null,
          tool_calls: resolved,
        });

        const names = resolved.map((t) => t.function.name).join(", ");
        onProgress?.({ type: "tool", toolName: names });
        yield `\n\n🔧 **执行**: ${names}\n`;

        for (const tc of resolved) {
          let result: unknown;
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            console.log("[agent] exec:", tc.function.name, JSON.stringify(args));
            result = executeTool(tc.function.name, args);
            console.log("[agent] result:", typeof result === "object" ? JSON.stringify(result).slice(0, 300) : result);
            onProgress?.({ type: "tool_result", toolName: tc.function.name, args, result });
          } catch (e) {
            result = { error: `参数解析失败: ${e}` };
            onProgress?.({ type: "tool_result", toolName: tc.function.name, args: tc.function.arguments, result });
          }
          this.messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        continue; // ← 把结果发给 AI，进入下一轮
      }

      // 纯文字 → 结束
      if (textContent) {
        this.messages.push({ role: "assistant", content: textContent });
      } else {
        // AI 没有返回任何内容 —— 结束本轮
        this.messages.push({ role: "assistant", content: "操作完成" });
        yield "操作完成";
      }
      onProgress?.({ type: "done" });
      break;
    }
  }
}

let _instance: AgentService | null = null;
export function getAgentService(): AgentService { return _instance || (_instance = new AgentService()); }
export function createAgentService(p: ModelProvider): AgentService { return _instance = new AgentService(p); }
