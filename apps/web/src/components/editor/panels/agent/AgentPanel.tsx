"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ThinkingDots } from "./ThinkingDots";
import type { ModelProvider } from "@/services/agent/types";
import { loadModelConfig, saveModelConfig, PRESET_PROVIDERS } from "@/services/agent/model-config";
import { getAgentService, createAgentService } from "@/services/agent/AgentService";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiBrain01Icon,
  Cancel01Icon,
  PlusSignIcon,
  ArrowUp01Icon,
  Copy01Icon,
  CheckmarkCircle01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";

interface AgentPanelProps {
  onClose?: () => void;
}

interface DisplayMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  isThinking?: boolean;
  toolCalls?: ToolCallRecord[];
}

interface ToolCallRecord {
  name: string;
  args: string;
  result: string;
  collapsed: boolean;
}

/** 可复制的消息气泡 + 工具调用折叠卡片 */
function MessageBubble({ msg, onCopy }: { msg: DisplayMessage; onCopy: () => void }) {
  const [showCopy, setShowCopy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toolStates, setToolStates] = useState<Record<number, boolean>>({});

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopy();
  };

  const toggleTool = (idx: number) => {
    setToolStates((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
      {/* 文字气泡 */}
      <div
        className={`group relative max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          msg.role === "user" ? "bg-primary text-primary-foreground" : msg.role === "system" ? "bg-destructive/10 text-destructive" : "bg-muted"
        }`}
        onMouseEnter={() => setShowCopy(true)}
        onMouseLeave={() => { setShowCopy(false); setCopied(false); }}
      >
        {msg.isThinking ? (
          <ThinkingDots />
        ) : (
          <div className="text-xs leading-relaxed">{msg.content}</div>
        )}
        {/* 复制按钮 — hover 时显示 */}
        {showCopy && !msg.isThinking && msg.content && (
          <button
            onClick={handleCopy}
            className={`absolute -bottom-2 right-0 rounded-full p-1 shadow-sm border transition-opacity ${
              copied ? "bg-green-100 border-green-300" : "bg-background border-border hover:bg-muted"
            }`}
            title={copied ? "已复制" : "复制"}
          >
            <HugeiconsIcon icon={copied ? CheckmarkCircle01Icon : Copy01Icon} className="size-3" />
          </button>
        )}
      </div>

      {/* 工具调用卡片 */}
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="w-full mt-1 space-y-1">
          {msg.toolCalls.map((tc, idx) => {
            const open = toolStates[idx] ?? true;
            return (
              <div key={idx} className="rounded border border-border bg-muted/30 overflow-hidden">
                <button
                  className="flex items-center gap-1 w-full px-2 py-1 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/50"
                  onClick={() => toggleTool(idx)}
                >
                  <HugeiconsIcon icon={open ? ArrowDown01Icon : ArrowRight01Icon} className="size-3" />
                  <span className="font-mono text-primary">{tc.name}</span>
                </button>
                {open && (
                  <div className="px-2 pb-2 space-y-1.5">
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">参数</div>
                      <pre className="text-[10px] font-mono bg-background rounded p-1.5 overflow-x-auto whitespace-pre-wrap">{tc.args}</pre>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">结果</div>
                      <pre className="text-[10px] font-mono bg-background rounded p-1.5 overflow-x-auto whitespace-pre-wrap">{tc.result}</pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AgentPanel({ onClose }: AgentPanelProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProvider] = useState<ModelProvider>(loadModelConfig);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const agentRef = useRef(getAgentService());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", isThinking: true }]);

    setIsStreaming(true);
    let assistantText = "";
    let toolText = "";
    let toolCalls: ToolCallRecord[] = [];

    try {
      const agent = agentRef.current;
      for await (const chunk of agent.run(text, (ev) => {
        if (ev.type === "tool") {
          toolText = `\n\n🔧 执行工具: ${ev.toolName}\n\n`;
        }
        if (ev.type === "tool_result" && ev.toolName) {
          toolCalls.push({
            name: ev.toolName,
            args: JSON.stringify(ev.args, null, 2),
            result: JSON.stringify(ev.result, null, 2),
            collapsed: true,
          });
        }
      })) {
        assistantText += chunk;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.isThinking) {
            next[next.length - 1] = {
              role: "assistant",
              content: toolText + assistantText,
              isThinking: false,
              toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
            };
          } else {
            next[next.length - 1] = {
              role: "assistant",
              content: last.content + chunk,
              toolCalls: toolCalls.length > 0 ? [...toolCalls] : last.toolCalls,
            };
          }
          return next;
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "未知错误";
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "system", content: `❌ ${errMsg}` };
        return next;
      });
    } finally {
      // 兜底：如果 thinking 状态还没被清除，强制清除
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.isThinking) {
          const next = [...prev];
          next[prev.length - 1] = { role: "assistant", content: "无响应", toolCalls: toolCalls };
          return next;
        }
        return prev;
      });
      setIsStreaming(false);
    }
  }, [input, isStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    agentRef.current.newChat();
    setMessages([]);
  };

  const handleModelChange = (modelId: string) => {
    const preset = PRESET_PROVIDERS.find((p) => p.id === modelId);
    if (!preset) return;
    const newProvider = { ...preset, apiKey: provider.apiKey };
    saveModelConfig(newProvider);
    setProvider(newProvider);
    createAgentService(newProvider);
    agentRef.current = getAgentService();
  };

  const handleApiKeyChange = (key: string) => {
    const newProvider = { ...provider, apiKey: key };
    saveModelConfig(newProvider);
    setProvider(newProvider);
    createAgentService(newProvider);
    agentRef.current = getAgentService();
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={AiBrain01Icon} className="size-4" />
          <span className="text-sm font-medium">AI 助手</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleNewChat} className="rounded p-1 hover:bg-muted" title="新对话">
            <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className="rounded px-2 py-0.5 text-xs hover:bg-muted">
            {provider.name}
          </button>
          {onClose && (
            <button onClick={onClose} className="rounded p-1 hover:bg-muted" title="关闭">
              <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="border-b px-3 py-2 space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">模型</label>
            <select
              className="w-full mt-1 rounded border px-2 py-1 text-xs bg-background"
              value={provider.id}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              {PRESET_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">API Key</label>
            <input
              type="password"
              className="w-full mt-1 rounded border px-2 py-1 text-xs bg-background font-mono"
              placeholder="sk-xxx"
              value={provider.apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-8">
            <p className="mb-2">👋 我是你的 AI 视频编辑助手</p>
            <p className="text-xs">试试说：</p>
            <div className="mt-2 space-y-1">
              {[
                "删除时间线上的所有图片",
                "给第一个片段添加模糊特效",
                "把第一个片段切成两半",
                "导出为 mp4 高画质",
              ].map((s) => (
                <button
                  key={s}
                  className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-muted truncate"
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} onCopy={() => {}} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary min-h-[36px] max-h-[120px]"
            rows={1}
            placeholder="输入编辑指令... (Enter 发送)"
            value={input}
            onChange={(e) => { setInput(e.target.value); }}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <Button size="icon" className="shrink-0" onClick={handleSend} disabled={!input.trim() || isStreaming}>
            <HugeiconsIcon icon={isStreaming ? Cancel01Icon : ArrowUp01Icon} className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
