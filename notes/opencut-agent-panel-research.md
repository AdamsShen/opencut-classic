# OpenCut Classic 内置 AI 聊天面板技术方案调研

> 调研时间：2026-07-30
> 需求：在 OpenCut Classic 编辑器内部实现类似 Palmier Pro 的 AI 助手面板，用户通过自然语言控制视频编辑

---

## 一、四个方案对比总览

| | A 方案 | B 方案 | C 方案 | D 方案（推荐） |
|---|:--:|:--:|:--:|:--:|
| **名称** | MCP + Claude Code | 直连 DeepSeek API | 桥接 Claude Code | **直连 DeepSeek（对标 Palmier Pro）** |
| **AI 后端** | Claude（通过 Claude Code） | DeepSeek API | Claude（通过 Claude Code） | DeepSeek API（可替换为任何支持 function calling 的模型） |
| **通信方式** | MCP stdio 协议 | HTTP POST `/v1/chat/completions` | WebSocket → MCP stdio | HTTP POST `/v1/chat/completions`（OpenAI 兼容格式） |
| **工具实现** | 已有 packages/mcp/ 的 31 个工具 | TypeScript 对象映射 | 复用 packages/mcp/ | TypeScript 对象映射，直接调 EditorCore |
| **工具执行** | EditorCore（需跨进程桥接） | EditorCore（同浏览器进程，直接调用） | EditorCore（通过 MCP → 桥接进程） | EditorCore（同浏览器进程，直接调用） |
| **需要额外 Key** | 无（走现有 Claude Code 配置） | DeepSeek API Key | 无 | DeepSeek API Key |
| **Skills / Memory / Rules** | ✅ 全部保留 | ❌ 全部丢失 | ✅ 全部保留 | ❌ 需自己写 system prompt |
| **工具调用质量** | 高 | 中（DeepSeek function calling） | 高 | 中（可替换模型提升） |
| **响应速度** | 快 | 快 | 慢（多一层桥接） | 快 |
| **实现复杂度** | 高（跨进程通信） | **低（~400 行）** | 很高（WebSocket + MCP + 桥接） | **低（~600 行）** |
| **依赖** | 必须同时启动 Claude Code | 只需要 DeepSeek 服务 | 必须启动 Claude Code + 桥接进程 | 只需要 DeepSeek 服务 |

---

## 二、D 方案（推荐）整体架构

对标 Palmier Pro 的实现方式，聊天面板直接通过 HTTP API 调 AI 模型，工具执行直接调浏览器内的 EditorCore 实例。

```
┌────────────────────────────────────────────────────────────────────┐
│                  OpenCut Classic (浏览器进程)                         │
│                                                                    │
│  ┌──────────────────┐                                              │
│  │  AgentPanel.tsx    │  ← React 聊天面板（对标 Palmier AgentPanelView）│
│  │  AgentMessageList  │                                              │
│  │  AgentInputBox     │                                              │
│  └────────┬───────────┘                                              │
│           │ 用户输入 "把第一个片段切成两半"                               │
│           ▼                                                         │
│  ┌──────────────────────────────────────────────┐                   │
│  │  AgentService.ts                              │                   │
│  │                                               │                   │
│  │  async *run(userInput: string):               │                   │
│  │    messages.push({role: "user", content})     │                   │
│  │    while (true) {                              │────── HTTP POST ──↝  ☁️ DeepSeek API
│  │      ① response = await callDeepSeek(         │     /v1/chat/completions
│  │           model: "deepseek-chat",             │
│  │           messages,  ← 对话历史                 │
│  │           tools,     ← 31 个工具定义             │
│  │           stream: true                        │
│  │         )                                     │←───── SSE 流 ──────
│  │                                               │
│  │      ② 解析 SSE 事件                            │
│  │         if text → 实时显示在聊天面板              │
│  │         if tool_calls → 解析工具调用             │
│  │                                               │
│  │      ③ 如果有 tool_calls:                       │
│  │         for (const tc of toolCalls) {          │
│  │           result = executeTool(tc.name, args)  │→ editor.timeline.splitElements()
│  │                                    ↑ 同进程直接调用，无需任何协议 │
│  │           messages.push(toolResult)            │
│  │         }                                     │
│  │         continue  ← 回到 ①，把结果发给 AI        │
│  │                                               │
│  │      ④ 如果只有文本 → break，结束循环             │
│  │    }                                          │
│  └──────────────────────────────────────────────┘                   │
│                                                                    │
│  ┌──────────────────────────┐                                      │
│  │  tool-definitions.ts      │  ← 31 个工具定义                      │
│  │                          │     name + description + parameters  │
│  │  从 EditorCore Manager    │     → DeepSeek 需要的 OpenAI 格式      │
│  │  的公开方法映射而来        │                                      │
│  └──────────────────────────┘                                      │
│                                                                    │
│  ┌──────────────────────────┐                                      │
│  │  EditorCore (已有)        │  ← 12 个 Manager, ~4000 行             │
│  │  .timeline.splitElements │                                      │
│  │  .project.export         │                                      │
│  │  .media.addMediaAsset    │                                      │
│  │  ...                     │                                      │
│  └──────────────────────────┘                                      │
└────────────────────────────────────────────────────────────────────┘
```

---

## 三、API 格式适配

Palmier Pro 用的是 Anthropic 原生格式，OpenCut Classic 需要适配 DeepSeek 的 OpenAI 兼容格式。

### 请求格式差异

```
Palmier Pro (Anthropic)                     OpenCut Classic + DeepSeek (OpenAI)
────────────────────────                    ─────────────────────────────────
POST /v1/messages                          POST /v1/chat/completions
x-api-key: sk-ant-xxx                      Authorization: Bearer sk-xxx
anthropic-version: 2023-06-01              Content-Type: application/json

{                                          {
  "model": "claude-sonnet-5",                "model": "deepseek-chat",
  "max_tokens": 8192,                        "messages": [...],
  "stream": true,                             "tools": [...],
  "system": "你是视频编辑助手...",              "stream": true
  "messages": [{                            }
    "role": "user",
    "content": "把片段切成两半"
  }],
  "tools": [{                               "tools": [{
    "name": "split_clip",                     "type": "function",
    "description": "切割片段",                  "function": {
    "input_schema": {                           "name": "split_clip",
      "type": "object",                         "description": "切割片段",
      "properties": {                           "parameters": {
        "elementId": { "type": "string" },        "type": "object",
        "splitTime": { "type": "number" }          "properties": {
      }                                               "elementId": {"type":"string"},
    }                                                 "splitTime": {"type":"number"}
  }]                                                }
}                                                  }
                                                }]
                                              }]
                                            }
```

### 响应格式差异

```
Anthropic SSE 事件                           OpenAI (DeepSeek) SSE 事件
────────────────────                         ──────────────────────────
event: content_block_start                   data: {"choices":[{"delta":
data: {"type":"content_block_start",          {"tool_calls":[{"index":0,
  "content_block":{"type":"tool_use",          "function":{"name":"split"}}]}
  "id":"toolu_xxx","name":"split_clip"}}     ]}]}

event: content_block_delta
data: {"type":"content_block_delta",         data: {"choices":[{"delta":
  "delta":{"type":"input_json_delta",          {"tool_calls":[{"index":0,
  "partial_json":"{\"splitTime\":2.5}"}}       "function":{"arguments":
                                              "{\"splitTime\":2.5}"}}]}
                                            ]}]}

event: content_block_stop
data: {"type":"content_block_stop"}

event: message_delta                        data: {"choices":[{
data: {"type":"message_delta",                "finish_reason":"tool_calls"
  "delta":{"stop_reason":"tool_use"}}        }]}
```

---

## 四、Palmier Pro 源码对照

| Palmier Pro 文件 | 行数 | 功能 | OpenCut Classic 对应 |
|---|---|---|---|
| `AgentService.swift` | 708 | 核心：消息管理 + tool-use 循环 + AI 客户端选择 | `AgentService.ts`（~300 行） |
| `AgentPanelView.swift` | ~500 | 聊天面板 UI（消息列表 + 输入框 + 快捷提示） | `AgentPanel.tsx`（~150 行） |
| `AgentInputBox.swift` | ~300 | 输入框（含 @ 提及素材/片段功能） | `AgentInputBox.tsx`（~80 行） |
| `AgentMessageView.swift` | ~240 | 消息气泡渲染（文字/工具调用/工具结果） | `AgentMessageList.tsx`（~100 行） |
| `ToolExecutor.swift` | 330 | 工具执行器（工具名 → EditorViewModel 方法路由） | 直接调用 `EditorCore.timeline.xxx()` |
| `AnthropicClient.swift` | 88 | Anthropic API HTTP 客户端（直连时用） | DeepSeek HTTP 请求（fetch + SSE 解析） |
| `PalmierClient.swift` | 112 | Palmier 云端代理 HTTP 客户端（付费时用） | 不需要（只用 DeepSeek 直连） |
| `AgentClientTypes.swift` | 225 | 共享类型定义 + SSE 解析器 | 不需要（DeepSeek 格式不同） |
| `AnthropicRequest/SSE` | 150 | Anthropic SSE 事件解析 | `parseSSE()`（OpenAI 格式，~50 行） |
| `ToolDefinitions.swift` | ~1000 | 52 个工具定义 | `tool-definitions.ts`（31 个工具，~200 行） |
| `ToolExecutor+*.swift` | 30 个文件 | 每个工具文件的具体实现 | **不需要**，直接调 EditorCore Manager 方法 |
| `AgentInstructions.swift` | - | System prompt | `systemPrompt` 字符串常量 |

---

## 五、工具清单（31 个，从 EditorCore 映射）

| 类别 | 工具名 | 调用的 EditorCore 方法 | 数量 |
|------|--------|------------------------|:--:|
| **时间线** | `get_timeline` | `scenes.getActiveSceneOrNull()` | 8 |
| | `add_clip` | `timeline.insertElement()` | |
| | `split_clip` | `timeline.splitElements()` | |
| | `delete_clip` | `timeline.deleteElements()` | |
| | `move_clip` | `timeline.moveElements()` | |
| | `duplicate_clip` | `timeline.duplicateElements()` | |
| | `trim_clip` | `timeline.updateElementTrim()` | |
| | `update_clip_retime` | `timeline.updateElementRetime()` | |
| **轨道** | `add_track` | `timeline.addTrack()` | 4 |
| | `remove_track` | `timeline.removeTrack()` | |
| | `toggle_track_mute` | `timeline.toggleTrackMute()` | |
| | `toggle_track_visibility` | `timeline.toggleTrackVisibility()` | |
| **特效** | `add_clip_effect` | `timeline.addClipEffect()` | 5 |
| | `remove_clip_effect` | `timeline.removeClipEffect()` | |
| | `update_effect_params` | `timeline.updateClipEffectParams()` | |
| | `toggle_clip_effect` | `timeline.toggleClipEffect()` | |
| | `reorder_clip_effects` | `timeline.reorderClipEffects()` | |
| **关键帧** | `add_keyframe` | `timeline.upsertKeyframes()` | 3 |
| | `remove_keyframe` | `timeline.removeKeyframes()` | |
| | `retime_keyframe` | `timeline.retimeKeyframe()` | |
| **项目** | `create_project` | `project.createNewProject()` | 6 |
| | `load_project` | `project.loadProject()` | |
| | `save_project` | `project.saveCurrentProject()` | |
| | `export_project` | `project.export()` | |
| | `get_project_info` | `project.getActive()` | |
| | `update_project_settings` | `project.updateProjectSettings()` | |
| **素材** | `list_media` | `media.getAssetsByProject()` | 3 |
| | `add_media` | `media.addMediaAsset()` | |
| | `remove_media` | `media.removeMediaAssets()` | |
| **编辑控制** | `undo` | `command.undo()` | 2 |
| | `redo` | `command.redo()` | |

---

## 六、具体实现计划

### 改动清单

```
apps/web/src/
├── components/editor/panels/agent/
│   ├── AgentPanel.tsx              # 聊天面板主容器（~150 行）
│   ├── AgentMessageList.tsx        # 消息列表渲染（~100 行）
│   └── AgentInputBox.tsx           # 输入框 + 发送/停止按钮（~80 行）
│
├── services/agent/
│   ├── AgentService.ts             # 核心：DeepSeek API 调用 + tool-use 循环（~300 行）
│   ├── tool-definitions.ts         # 31 个工具定义（OpenAI 格式，~200 行）
│   └── deepseek-client.ts          # DeepSeek HTTP 请求 + SSE 解析（~100 行）
│
├── components/editor/editor-header.tsx          # 改动：加 "AI 助手" 按钮
└── app/editor/[project_id]/page.tsx             # 改动：布局加 AgentPanel（右侧面板）
```

### 第一步：DeepSeek HTTP 客户端 + SSE 解析器

```typescript
// services/agent/deepseek-client.ts

const DEEPSEEK_BASE = "https://api.deepseek.com";

interface DeepSeekStreamChunk {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: "stop" | "tool_calls" | "length";
  }>;
}

async function *streamChat(
  apiKey: string,
  messages: Message[],
  tools: ToolDefinition[],
): AsyncGenerator<DeepSeekStreamChunk> {
  const res = await fetch(`${DEEPSEEK_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
    }),
  });

  // SSE 解析循环
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try { yield JSON.parse(data); } catch {}
      }
    }
  }
}
```

### 第二步：AgentService tool-use 循环

```typescript
// services/agent/AgentService.ts

class AgentService {
  private messages: Message[] = [];
  private tools: ToolDefinition[] = toolDefinitions;

  constructor(private apiKey: string) {}

  async *chat(userInput: string): AsyncGenerator<string> {
    this.messages.push({ role: "user", content: userInput });

    while (true) {
      let textContent = "";
      const toolCalls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of streamChat(this.apiKey, this.messages, this.tools)) {
        const delta = chunk.choices?.[0]?.delta;

        if (delta?.content) {
          textContent += delta.content;
          yield delta.content; // 实时流式显示
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls.has(idx)) toolCalls.set(idx, { id: "", name: "", args: "" });
            const entry = toolCalls.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
          }
        }
      }

      // 如果有工具调用 → 执行 → 结果发回 → 继续循环
      if (toolCalls.size > 0) {
        // 记录 assistant 消息（含 tool_calls）
        this.messages.push({
          role: "assistant",
          content: textContent || null,
          tool_calls: Array.from(toolCalls.values()).map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.args },
          })),
        });

        yield `\n🔧 执行: ${Array.from(toolCalls.values()).map(t => t.name).join(", ")}\n`;

        // 逐个执行工具，结果发回
        for (const tc of toolCalls.values()) {
          const result = executeEditorTool(tc.name, JSON.parse(tc.args));
          this.messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
        }
        continue; // ← 回到 while 开头，AI 看结果后决定下一步
      }

      // 只有文字 → 结束循环
      this.messages.push({ role: "assistant", content: textContent });
      break;
    }
  }
}
```

### 第三步：工具执行函数

```typescript
// services/agent/tool-definitions.ts

function executeEditorTool(name: string, args: Record<string, any>): any {
  const editor = EditorCore.getInstance();

  switch (name) {
    case "get_timeline":
      const scene = editor.scenes.getActiveSceneOrNull();
      return summarizeTracks(scene?.tracks);

    case "split_clip":
      return editor.timeline.splitElements({
        elements: [{ trackId: args.trackId, elementId: args.elementId }],
        splitTime: args.splitTime * 30, // 秒转帧
      });

    case "add_clip":
      return editor.timeline.insertElement({...args});

    case "export_project":
      return editor.project.export({ options: args });

    // ... 其余 27 个工具映射
  }
}
```

---

## 七、API Key 存储

| Palmier Pro | OpenCut Classic |
|---|---|
| macOS Keychain（AnthropicKeychain.load/save） | 浏览器 `localStorage` |
| 支持环境变量 `ANTHROPIC_API_KEY`（DEBUG 模式） | 可在设置面板输入 |
| 支持登录 Palmier 账号用云端代理 | 支持配 DeepSeek Key（或其他 OpenAI 兼容 API 的 Key） |

---

## 八、关键结论

1. **不需要 MCP 协议**：内置聊天面板的工具执行直接调浏览器内的 `EditorCore` 实例，不需要任何跨进程通信
2. **Palmier Pro 也是这么做的**：聊天面板用 `AnthropicClient` 直连 API + `ToolExecutor` 直调 EditorViewModel
3. **DeepSeek API 适配**：格式差异只在 HTTP 请求体 和 SSE 事件解析，核心 tool-use 循环逻辑完全不变
4. **总代码量约 600-800 行**：不需要 MCP SDK、不需要 Agent 框架、不需要 LangChain，就是 HTTP 请求 + for 循环
5. **模型可替换**：如果把 DeepSeek 换成 Anthropic API，只需换 HTTP 客户端和 SSE 解析器，AgentService 的循环逻辑不用改
