/**
 * Agent 类型定义
 * 预留学多模型切换的接口设计
 */

export interface ModelProvider {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** API 端点 URL */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 模型名，发送给 API */
  modelName: string;
  /** 是否为 OpenAI 兼容格式 */
  isOpenAICompatible: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  index?: number;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

export interface AgentStreamEvent {
  /** 文字增量 */
  textDelta?: string;
  /** 工具调用完成 */
  toolCall?: ToolCall;
  /** 流结束 */
  done?: boolean;
}

export interface AgentSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
