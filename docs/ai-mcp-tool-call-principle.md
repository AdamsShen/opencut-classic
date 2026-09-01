# OpenCut AI 助手 — MCP 工具调用原理

## 概述

OpenCut 的 AI 对话功能采用标准的 **Agentic Tool-Use Loop（代理工具调用循环）** 架构。核心原则只有一句话：

> **大模型（DeepSeek）负责「决策」**—— 判断该调哪个工具、传什么参数；**你的代码负责「执行」**—— 实际操作 EditorCore 完成编辑。

这不是传统意义上的 MCP（Model Context Protocol），而是 **OpenAI 兼容的 Function Calling 机制**。工具定义通过 API 请求发送给大模型，大模型通过流式响应返回 `tool_calls` 指令，代码本地执行后把结果传回。

---

## 核心架构

```
                        ┌─────────────────────────────────────────────┐
                        │            OpenAI-Compatible API             │
                        │         (DeepSeek / 自定义网关)               │
                        │                                              │
                        │   POST /v1/chat/completions                  │
                        │   { model, messages, stream: true, tools }   │
                        │                    ▲                         │
                        │   SSE stream       │  HTTP POST              │
                        │   textDelta +      │  (messages +            │
                        │   tool_calls        │   33 tool defs)         │
                        │                    │                         │
                        └────────────────────┼─────────────────────────┘
                                             │
                    ┌────────────────────────┴────────────────────────┐
                    │              浏览器 (OpenCut Web)                 │
                    │                                                   │
                    │  ┌──────────┐    ┌─────────────┐                 │
                    │  │AgentPanel│───▶│AgentService │                 │
                    │  │ (UI 层)  │    │ (编排循环)   │                 │
                    │  └──────────┘    └──────┬──────┘                 │
                    │                        │                         │
                    │                        ▼                         │
                    │              ┌─────────────────┐                 │
                    │              │ executeTool()    │                 │
                    │              │ (33 个工具执行器) │                 │
                    │              └────────┬────────┘                 │
                    │                       │                          │
                    │                       ▼                          │
                    │              ┌─────────────────┐                 │
                    │              │   EditorCore    │                 │
                    │              │ (视频编辑引擎)   │                 │
                    │              └─────────────────┘                 │
                    └──────────────────────────────────────────────────┘
```

### 各层职责

| 层 | 文件 | 职责 |
|---|------|------|
| **UI 层** | `AgentPanel.tsx` | 聊天界面，发送消息，流式展示结果 |
| **编排层** | `AgentService.ts` | 工具调用循环：发请求 → 解析 tool_calls → 执行工具 → 回传结果，最多 10 轮 |
| **客户端** | `client.ts` | 封装 OpenAI 兼容 API 的 SSE 流式请求 |
| **工具层** | `tool-definitions.ts` | 33 个编辑工具的 JSON Schema 定义 + 实际执行逻辑 |
| **提示词** | `system-prompt.ts` | 告诉大模型何时使用工具、如何回复 |

### 两种 MCP 形态对比

OpenCut 项目中存在**两套工具暴露机制**，它们共享同一套编辑器能力但服务于完全不同的场景：

```
┌──────────────────────────────────────────────────────────────────┐
│                    OpenCut 双通道架构                              │
│                                                                   │
│  通道一：Web AI 聊天                    通道二：外部 MCP Server      │
│  ┌─────────────────────┐              ┌─────────────────────┐     │
│  │ 用户在编辑器内输入    │              │ Claude/Cursor IDE    │     │
│  │ "删除所有图片"        │              │ 外部 AI 工具         │     │
│  └──────────┬──────────┘              └──────────┬──────────┘     │
│             │                                    │                │
│             ▼                                    ▼                │
│  ┌─────────────────────┐              ┌─────────────────────┐     │
│  │ AgentService.run()   │              │ packages/mcp (stdio) │     │
│  │ HTTP → DeepSeek API  │              │ 标准 MCP 协议        │     │
│  │ tool_calls 在浏览器   │              │ JSON-RPC over stdio  │     │
│  │ 本地执行              │              │ 通过 bridge 连接      │     │
│  └──────────┬──────────┘              └──────────┬──────────┘     │
│             │                                    │                │
│             └──────────────┬─────────────────────┘                │
│                            ▼                                      │
│                   ┌─────────────────┐                             │
│                   │   EditorCore    │                             │
│                   │   (同一套 API)   │                             │
│                   └─────────────────┘                             │
└──────────────────────────────────────────────────────────────────┘
```

| 维度 | Web AI 聊天（通道一） | MCP Server（通道二） |
|------|----------------------|---------------------|
| **触发方式** | 用户在编辑器侧边栏输入 | 外部 AI（Claude/Cursor）调用 |
| **通信协议** | HTTP SSE（OpenAI 兼容） | stdio（标准 MCP 协议） |
| **工具定义** | `tool-definitions.ts` 中的 JSON Schema | `packages/mcp/src/index.ts` 中 Zod Schema |
| **执行环境** | 浏览器 JavaScript | Node.js（通过 bridge 连浏览器） |
| **决策方** | DeepSeek 大模型 | Claude/外部 AI |
| **代码文件** | `apps/web/src/services/agent/` | `packages/mcp/` |

> **重点**：本文档聚焦**通道一（Web AI 聊天）**的原理。通道二（独立 MCP Server）仅在外观层面不同——本质仍是"AI 决策 → 本地执行"模式。

---

## 完整调用流程（时序图）

```
用户               AgentPanel         AgentService        client.ts          DeepSeek API        EditorCore
 │                     │                   │                   │                    │                │
 │  输入"删除所有图片"   │                   │                   │                    │                │
 │─────────────────────▶│                   │                   │                    │                │
 │                     │  run(userInput)   │                   │                    │                │
 │                     │──────────────────▶│                   │                    │                │
 │                     │                   │ ① 添加 user msg   │                    │                │
 │                     │                   │ 到 messages[]     │                    │                │
 │                     │                   │                   │                    │                │
 │                     │                   │  streamChat()     │                    │                │
 │                     │                   │──────────────────▶│                    │                │
 │                     │                   │                   │ ② POST /v1/chat/  │                │
 │                     │                   │                   │ completions        │                │
 │                     │                   │                   │ {model, messages,  │                │
 │                     │                   │                   │  stream:true,      │                │
 │                     │                   │                   │  tools:[33个工具]}  │                │
 │                     │                   │                   │───────────────────▶│                │
 │                     │                   │                   │                    │                │
 │                     │                   │                   │  ③ SSE stream:     │                │
 │                     │                   │                   │  data:{"choices":  │                │
 │                     │                   │                   │   [{"delta":{      │                │
 │                     │                   │                   │   "tool_calls":[   │                │
 │                     │                   │                   │   {index:0,        │                │
 │                     │                   │                   │    function:{      │                │
 │                     │                   │                   │    name:"get_      │                │
 │                     │                   │                   │    timeline"}}]}}]}│                │
 │                     │                   │                   │◀───────────────────│                │
 │                     │                   │                   │                    │                │
 │                     │                   │                   │  data:{"choices":  │                │
 │                     │                   │                   │   [{"finish_reason":│                │
 │                     │                   │                   │   "tool_calls"}]}  │                │
 │                     │                   │                   │◀───────────────────│                │
 │                     │                   │                   │                    │                │
 │                     │                   │  yield {toolCall} │                    │                │
 │                     │                   │◀──────────────────│                    │                │
 │                     │                   │                   │                    │                │
 │                     │                   │ ④ 解析 tool_calls │                    │                │
 │                     │                   │ tcByIndex Map 合并│                    │                │
 │                     │                   │                   │                    │                │
 │                     │                   │ ⑤ executeTool(    │                    │                │
 │                     │                   │   "get_timeline", │                    │                │
 │                     │                   │   {})              │                    │                │
 │                     │                   │───────────────────────────────────────────────────────▶│
 │                     │                   │                   │                    │                │
 │                     │                   │  ◀── 返回 timeline │                    │                │
 │                     │                   │  {main:{elements:  │                    │                │
 │                     │                   │   [...]},overlay:  │                    │                │
 │                     │                   │   [...],audio:[..] │                    │                │
 │                     │                   │   }                │                    │                │
 │                     │                   │◀──────────────────────────────────────────────────────│
 │                     │                   │                   │                    │                │
 │                     │                   │ ⑥ push result 到  │                    │                │
 │                     │                   │ messages[]:        │                    │                │
 │                     │                   │ {role:"tool",      │                    │                │
 │                     │                   │  content: result}  │                    │                │
 │                     │                   │                   │                    │                │
 │                     │                   │ ⑦ continue →       │                    │                │
 │                     │                   │ 第二轮 streamChat()│                    │                │
 │                     │                   │──────────────────▶│                    │                │
 │                     │                   │                   │───────────────────▶│                │
 │                     │                   │                   │                    │                │
 │                     │                   │                   │ ⑧ DeepSeek 分析    │                │
 │                     │                   │                   │ timeline，发现所有   │                │
 │                     │                   │                   │ 图片 → 决定调       │                │
 │                     │                   │                   │ delete_clip × N    │                │
 │                     │                   │                   │                    │                │
 │                     │                   │                   │  data: tool_calls  │                │
 │                     │                   │                   │  [delete_clip(id=  │                │
 │                     │                   │                   │   "xxx"), ...]     │                │
 │                     │                   │                   │◀───────────────────│                │
 │                     │                   │                   │                    │                │
 │                     │                   │  yield toolCalls  │                    │                │
 │                     │                   │◀──────────────────│                    │                │
 │                     │                   │                   │                    │                │
 │                     │                   │ for each toolCall │                    │                │
 │                     │                   │ executeTool(      │                    │                │
 │                     │                   │  "delete_clip",   │                    │                │
 │                     │                   │  {id: "xxx"})     │                    │                │
 │                     │                   │───────────────────────────────────────────────────────▶│
 │                     │                   │  ◀── {ok:true}     │                    │                │
 │                     │                   │                   │                    │                │
 │                     │                   │ ⑨ push tool       │                    │                │
 │                     │                   │ results → 继续循环  │                    │                │
 │                     │                   │                   │                    │                │
 │                     │                   │ 第三轮 streamChat()│                    │                │
 │                     │                   │──────────────────▶│                    │                │
 │                     │                   │                   │───────────────────▶│                │
 │                     │                   │                   │ ⑩ textDelta:      │                │
 │                     │                   │                   │ "已删除所有图片..." │                │
 │                     │                   │                   │ finish_reason:"stop"│                │
 │                     │                   │                   │◀───────────────────│                │
 │                     │                   │                   │                    │                │
 │                     │  yield text delta │                   │                    │                │
 │                     │◀──────────────────│                   │                    │                │
 │                     │                   │                   │                    │                │
 │  "已删除3张图片"    │                   │                   │                    │                │
 │◀────────────────────│                   │                   │                    │                │
```

---

## 决策流程图

下面展示 `AgentService.run()` 内部的完整判断逻辑：

```
                         ┌──────────────────┐
                         │  AgentService     │
                         │  .run(userInput)  │
                         └────────┬─────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │ round = 0               │
                    │ messages.push({         │
                    │   role:"user",          │
                    │   content: userInput    │
                    │ })                      │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ streamChat(provider,    │◀──────────────────────┐
                    │   messages, 33 tools)   │                       │
                    │ → POST DeepSeek API     │                       │
                    └────────────┬────────────┘                       │
                                 │                                    │
                                 ▼                                    │
                    ┌─────────────────────────┐                       │
                    │ 读取 SSE 流             │                       │
                    │ textDelta → 追加文字     │                       │
                    │ toolCall → 合并到        │                       │
                    │   tcByIndex Map         │                       │
                    └────────────┬────────────┘                       │
                                 │                                    │
                                 ▼                                    │
                    ┌─────────────────────────┐                       │
                    │ finish_reason 是什么？   │                       │
                    └──────┬──────────┬───────┘                       │
                           │          │                               │
                   tool_calls          stop                           │
                           │          │                               │
                           ▼          ▼                               │
              ┌────────────────┐  ┌──────────────┐                   │
              │ 收集 tool_calls │  │ textDelta 有 │                   │
              │ 并过滤有效项    │  │ 内容？        │                   │
              │ (有 name+args) │  └──┬───────┬───┘                   │
              └───────┬────────┘     │       │                       │
                      │            Yes      No                       │
                      ▼              │       │                       │
              ┌────────────────┐     │       ▼                       │
              │ 有有效的        │     │  ┌──────────┐                │
              │ tool_calls?     │     │  │ push      │               │
              └───┬──────┬─────┘     │  │ "操作完成" │               │
                  │      │           │  └──────────┘                │
                 Yes     No          │       │                       │
                  │      │           │       ▼                       │
                  ▼      ▼           │  ┌──────────┐                │
     ┌──────────────────┐ │          │  │ onProgress│               │
     │ push assistant    │ │          │  │("done")  │               │
     │ (含 tool_calls)   │ │          │  └──────────┘                │
     └────────┬─────────┘ │          │       │                       │
              │           │          │       ▼                       │
              ▼           │          │  ┌──────────┐                │
     ┌──────────────────┐ │          │  │  break   │                │
     │ for each tc:     │ │          │  │  ← 结束! │                │
     │  executeTool()   │ │          │  └──────────┘                │
     │  push role:"tool"│ │          │                               │
     └────────┬─────────┘ │          │                               │
              │           │          │                               │
              ▼           │          │                               │
     ┌──────────────────┐ │          │                               │
     │ round++           │ │          │                               │
     │ round < 10 ?      │ │          │                               │
     └──┬───────────┬───┘ │          │                               │
        │           │     │          │                               │
       Yes          No    │          │                               │
        │           │     │          │                               │
        │           ▼     │          │                               │
        │   ┌──────────┐  │          │                               │
        │   │  break   │  │          │                               │
        │   └──────────┘  │          │                               │
        │                 │          │                               │
        └─────────────────┘          │                               │
        (回到循环顶部)                │                               │
                                     │                               │
                              ┌──────┘                               │
                              │ (纯文字)                              │
                              ▼                                      │
                     ┌──────────────────┐                            │
                     │ push assistant   │                            │
                     │ (仅 textContent) │                            │
                     └────────┬─────────┘                            │
                              │                                      │
                              ▼                                      │
                     ┌──────────────────┐                            │
                     │ onProgress("done")│                            │
                     │ break ← 结束!     │                            │
                     └──────────────────┘                            │
```

---

## 关键技术细节

### 1. SSE 流式解析与 tool_calls 分片合并

DeepSeek 的 SSE 响应中，**`name` 和 `arguments` 可能分在不同的 chunk 中**。代码通过 `tcByIndex` Map 按 `index` 合并：

```
SSE Chunk 1:  delta.tool_calls[0] = { index: 0, id: "call_xxx", function: { name: "get_timeline" } }
SSE Chunk 2:  delta.tool_calls[0] = { index: 0, function: { arguments: "{}" } }
                                       ↑ 只有 arguments，没有 name
合并结果:     { index: 0, id: "call_xxx", function: { name: "get_timeline", arguments: "{}" } }
```

```typescript
// AgentService.ts 中的合并逻辑
if (event.toolCall) {
  const tc = event.toolCall;
  const idx = tc.index ?? 0;
  const existing = tcByIndex.get(idx);
  tcByIndex.set(idx, {
    index: idx,
    id: existing?.id || tc.id,
    type: "function",
    function: {
      name: existing?.function.name || tc.function.name,              // 保留已有的 name
      arguments: (existing?.function.arguments || "") + (tc.function.arguments || ""),  // 拼接 arguments
    },
  });
}
```

### 2. finish_reason 信号

DeepSeek 在每轮响应末尾设置 `finish_reason`：

| finish_reason | 含义 | 代码行为 |
|---------------|------|---------|
| `tool_calls` | "我需要更多信息/要执行操作，暂停文字生成" | 执行 tool_calls → 把结果 push 到 messages → continue 进入下一轮 |
| `stop` | "对话结束，不再需要调工具" | 退出循环，返回文字结果给用户 |

### 3. messages 数组的角色演变

以下展示一次"删除所有图片"操作中，messages 数组的完整变化过程：

```
初始状态（第一轮开始前）:
┌──────────────────────────────────────────────────────────┐
│ [0] { role: "system", content: "你是 OpenCut..." }       │  ← 只在 messages.length===0 时添加
│ [1] { role: "user",   content: "删除时间线上的所有图片" }  │  ← 用户输入
└──────────────────────────────────────────────────────────┘

第一轮（LLM 决定调 get_timeline）:
┌──────────────────────────────────────────────────────────┐
│ [0] { role: "system", content: "你是 OpenCut..." }       │
│ [1] { role: "user",   content: "删除时间线上的所有图片" }  │
│ [2] { role: "assistant", content: null,                  │  ← LLM 返回 tool_calls
│       tool_calls: [{ function: { name: "get_timeline",   │
│                                  arguments: "{}" } }] }  │
│ [3] { role: "tool",                                     │  ← 本地执行结果
│       tool_call_id: "call_xxx",                          │
│       content: '{"main":{...},"overlay":[...],...}' }   │
└──────────────────────────────────────────────────────────┘

第二轮（LLM 分析 timeline 后调用 delete_clip）:
┌──────────────────────────────────────────────────────────┐
│ ... 上述 4 条 ...                                        │
│ [4] { role: "assistant", content: null,                  │
│       tool_calls: [                                      │
│         { function: { name: "delete_clip",               │
│                       arguments: '{"id":"img1"}' } },    │
│         { function: { name: "delete_clip",               │
│                       arguments: '{"id":"img2"}' } },    │
│         { function: { name: "delete_clip",               │
│                       arguments: '{"id":"img3"}' } }     │
│       ] }                                                │
│ [5] { role: "tool", tool_call_id: "call_a",             │
│       content: '{"ok":true,"deleted":"img1"}' }          │
│ [6] { role: "tool", tool_call_id: "call_b",             │
│       content: '{"ok":true,"deleted":"img2"}' }          │
│ [7] { role: "tool", tool_call_id: "call_c",             │
│       content: '{"ok":true,"deleted":"img3"}' }          │
└──────────────────────────────────────────────────────────┘

第三轮（LLM 产出最终文字回复）:
┌──────────────────────────────────────────────────────────┐
│ ... 上述 8 条 ...                                        │
│ [8] { role: "assistant", content: "已删除时间线上的      │
│       3 张图片：img1、img2、img3。" }                     │  ← finish_reason: "stop"
└──────────────────────────────────────────────────────────┘
```

### 4. 安全防护机制

为防止大模型对无关输入也调用工具（如用户输入 `"111"`），系统提示词中设置了多层防护：

```
防护层级:
┌─────────────────────────────────────────────┐
│ 层1: System Prompt（关键！）                 │
│   "仅当用户的输入明确是视频编辑操作指令时，    │
│    才调用工具"                               │
│   "如果用户输入不是视频编辑指令（例如闲聊、    │
│    数字、无意义文本），直接文字回复"           │
├─────────────────────────────────────────────┤
│ 层2: MAX_TOOL_ROUNDS = 10                   │
│   防止无限循环                               │
├─────────────────────────────────────────────┤
│ 层3: tool_calls 有效性检查                   │
│   只执行 name + arguments 都非空的 tool_call │
├─────────────────────────────────────────────┤
│ 层4: try-catch 包裹单个工具执行              │
│   单个工具失败不影响其他工具                  │
└─────────────────────────────────────────────┘
```

### 5. 工具与 EditorCore 的映射

所有 33 个工具按功能分为 6 组，每组映射到 EditorCore 的不同 API 模块：

```
┌──────────────────────────────────────────────────────────────┐
│                    Tool → EditorCore 映射                      │
│                                                               │
│  时间线查询 (1):                                               │
│    get_timeline      → scenes.getActiveSceneOrNull()          │
│                         + summarizeTracks()                   │
│                                                               │
│  轨道操作 (4):                                                 │
│    add_track          → timeline.addTrack()                   │
│    remove_track       → timeline.removeTrack()                │
│    toggle_track_mute  → timeline.toggleTrackMute()            │
│    toggle_track_vis   → timeline.toggleTrackVisibility()      │
│                                                               │
│  片段操作 (9):                                                 │
│    delete_clip        → timeline.deleteElements()             │
│    duplicate_clip     → timeline.duplicateElements()          │
│    split_clip         → timeline.splitElements()              │
│    trim_clip          → timeline.updateElementTrim()          │
│    move_clip          → timeline.moveElements()               │
│    add_clip           → timeline.insertElement()              │
│    update_clip_retime → timeline.updateElementRetime()        │
│    toggle_clip_vis    → timeline.toggleElementsVisibility()   │
│    toggle_clip_mute   → timeline.toggleElementsMuted()        │
│                                                               │
│  特效 (5):                                                     │
│    add_clip_effect     → timeline.addClipEffect()             │
│    remove_clip_effect  → timeline.removeClipEffect()          │
│    update_effect_params→ timeline.updateClipEffectParams()    │
│    toggle_clip_effect  → timeline.toggleClipEffect()          │
│    reorder_clip_effects→ timeline.reorderClipEffects()        │
│                                                               │
│  关键帧 (3):                                                   │
│    add_keyframe       → timeline.upsertKeyframes()            │
│    remove_keyframe    → timeline.removeKeyframes()            │
│    retime_keyframe    → timeline.retimeKeyframe()             │
│                                                               │
│  项目/素材/编辑 (11):                                          │
│    create_project     → project.createNewProject()            │
│    load_project       → project.loadProject()                 │
│    save_project       → project.saveCurrentProject()          │
│    export_project     → project.export()                      │
│    get_project_info   → project.getActive()                   │
│    update_settings    → project.updateProjectSettings()       │
│    list_media         → media.getAssetsByProject()            │
│    add_media          → media.addMediaAsset()                 │
│    remove_media       → media.removeMediaAssets()             │
│    undo               → command.undo()                        │
│    redo               → command.redo()                        │
└──────────────────────────────────────────────────────────────┘
```

---

## 完整 API 请求/响应示例

### 场景：用户输入 "删除时间线上的图片"

> 对话上下文：用户之前输入了无效内容 `"111"`，助手已回复拒绝。现在用户发出真实编辑指令。
>
> 注意：`tools` 参数只保留了前 3 个工具示例来说明结构，实际发送了全部 33 个。

---

### Round 1：大模型决定调 `get_timeline` 获取时间线

#### 请求

```json
POST https://api.deepseek.com/v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-xxx

{
  "model": "deepseek-chat",
  "messages": [
    {
      "role": "system",
      "content": "你是 OpenCut 视频编辑器内置助手。核心原则：只处理视频编辑相关请求，简短回复。\n\n重要——何时使用工具:\n- 仅当用户的输入明确是视频编辑操作指令时，才调用工具（如 get_timeline / add_clip / split_clip 等）\n- 如果用户输入不是视频编辑指令（例如闲聊、数字、无意义文本），直接文字回复，绝不要调用任何工具\n- 不确定时先文字询问用户意图，不要猜测性地调用工具\n\n规则:\n1. 先判断用户输入是否与视频编辑相关，不相关则不调工具\n2. 需要知道时间线状态时，调 get_timeline\n3. 需要知道素材类型时，调 list_media\n4. 所有操作工具只传 id 参数（来自 get_timeline 返回的 element.id）\n5. {ok:true} = 成功，不用重复调\n6. 操作完给出 1-2 句话的结果总结，不要长篇分析\n7. 获取信息类工具和操作工具可以在同一轮一起调"
    },
    {
      "role": "user",
      "content": "111"
    },
    {
      "role": "assistant",
      "content": "你好，请问有什么视频编辑方面的需求我可以帮你处理吗？"
    },
    {
      "role": "user",
      "content": "删除时间线上的图片"
    }
  ],
  "stream": true,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_timeline",
        "description": "获取当前项目完整时间线。返回 main/overlay/audio 三维数组...",
        "parameters": { "type": "object", "properties": {} }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "delete_clip",
        "description": "从时间线删除片段。id 直接使用 get_timeline 返回的 element.id。",
        "parameters": {
          "type": "object",
          "properties": {
            "id": { "type": "string", "description": "片段ID" }
          },
          "required": ["id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "add_clip",
        "description": "将素材添加到时间线。需要先用 add_media 导入素材...",
        "parameters": {
          "type": "object",
          "properties": {
            "assetId": { "type": "string", "description": "素材ID" },
            "startTime": { "type": "number", "description": "起始时间(秒,可选)" },
            "duration": { "type": "number", "description": "时长(秒,可选)" },
            "trimStart": { "type": "number", "description": "从素材开头裁剪(秒,可选)" },
            "trimEnd": { "type": "number", "description": "从素材结尾裁剪(秒,可选)" }
          },
          "required": ["assetId"]
        }
      }
    }
    // ... 其余 30 个工具定义省略（格式同上）
  ]
}
```

#### SSE 响应流

```
第 1 个 SSE 帧（tool_calls 出现）:
data: {"id":"4fa505b09de44fc599019bcb6f5a2106","object":"chat.completion.chunk","created":1764561716,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_00_BxMbQx5mPvI8XQhTDGMVlz0M","type":"function","function":{"name":"get_timeline","arguments":""}}]},"finish_reason":null}]}

第 2 个 SSE 帧（arguments 到达）:
data: {"id":"4fa505b09de44fc599019bcb6f5a2106","object":"chat.completion.chunk","created":1764561716,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"finish_reason":null}]}

第 3 个 SSE 帧（finish_reason = "tool_calls"）:
data: {"id":"4fa505b09de44fc599019bcb6f5a2106","object":"chat.completion.chunk","created":1764561716,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1723,"completion_tokens":53,"total_tokens":1776}}

data: [DONE]
```

#### 代码收到后的处理

```
AgentService.run() 解析 SSE:
  ┌─ 从第 1 帧拿到 tool_calls[0].function.name = "get_timeline"
  ├─ 从第 2 帧拿到 tool_calls[0].function.arguments = "{}"  (触发 tcByIndex 合并)
  └─ 从第 3 帧拿到 finish_reason = "tool_calls"  → 进入工具执行分支

执行 executeTool("get_timeline", {}):
  → EditorCore.getInstance().scenes.getActiveSceneOrNull()
  → 返回:
  {
    "main": {
      "id": "main-track",
      "type": "video",
      "elements": [
        { "id": "DpdnCcbV4lBAVu2z", "assetId": "1bYfM8OnzSnQH4q5", "startTime": 0, "duration": 600, "trimStart": 0, "trimEnd": 0, "hidden": false, "muted": false, "effectCount": 0, "keyframeCount": 0 },
        { "id": "-iAl1r_2txmBpPlq", "assetId": "hKFaZY5nB58e8XuZ", "startTime": 600, "duration": 600, "trimStart": 0, "trimEnd": 0, "hidden": false, "muted": false, "effectCount": 0, "keyframeCount": 0 },
        { "id": "2naSJ_CuW5_LFW6I", "assetId": "QQzzDRa6YKJwQywn", "startTime": 1200, "duration": 600, "trimStart": 0, "trimEnd": 0, "hidden": false, "muted": false, "effectCount": 0, "keyframeCount": 0 },
        { "id": "iNBr_GNMcprW6eqc", "assetId": "1bYfM8OnzSnQH4q5", "startTime": 1800, "duration": 600, "trimStart": 0, "trimEnd": 0, "hidden": false, "muted": false, "effectCount": 0, "keyframeCount": 0 }
      ]
    },
    "overlay": [],
    "audio": []
  }

将 tool result push 到 messages:
  { "role": "tool", "tool_call_id": "call_00_BxMbQx5mPvI8XQhTDGMVlz0M", "content": "{\"main\":{\"id\":\"main-track\",...}}"

→ continue，进入下一轮
```

---

### Round 2：大模型分析时间线后调用 `delete_clip`

> 此时 messages 已包含 6 条消息（system + user + assistant("111"场景) + user(真实指令) + assistant(含 get_timeline tool_calls) + tool(get_timeline 结果)）

#### 请求

```json
POST https://api.deepseek.com/v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-xxx

{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "你是 OpenCut 视频编辑器内置助手..." },
    { "role": "user", "content": "111" },
    { "role": "assistant", "content": "你好，请问有什么视频编辑方面的需求我可以帮你处理吗？" },
    { "role": "user", "content": "删除时间线上的图片" },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_00_BxMbQx5mPvI8XQhTDGMVlz0M",
          "type": "function",
          "function": {
            "name": "get_timeline",
            "arguments": "{}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_00_BxMbQx5mPvI8XQhTDGMVlz0M",
      "content": "{\"main\":{\"id\":\"main-track\",\"type\":\"video\",\"elements\":[{\"id\":\"DpdnCcbV4lBAVu2z\",\"assetId\":\"1bYfM8OnzSnQH4q5\",\"startTime\":0,\"duration\":600,\"trimStart\":0,\"trimEnd\":0,\"hidden\":false,\"muted\":false,\"effectCount\":0,\"keyframeCount\":0},{\"id\":\"-iAl1r_2txmBpPlq\",\"assetId\":\"hKFaZY5nB58e8XuZ\",\"startTime\":600,\"duration\":600,\"trimStart\":0,\"trimEnd\":0,\"hidden\":false,\"muted\":false,\"effectCount\":0,\"keyframeCount\":0},{\"id\":\"2naSJ_CuW5_LFW6I\",\"assetId\":\"QQzzDRa6YKJwQywn\",\"startTime\":1200,\"duration\":600,\"trimStart\":0,\"trimEnd\":0,\"hidden\":false,\"muted\":false,\"effectCount\":0,\"keyframeCount\":0},{\"id\":\"iNBr_GNMcprW6eqc\",\"assetId\":\"1bYfM8OnzSnQH4q5\",\"startTime\":1800,\"duration\":600,\"trimStart\":0,\"trimEnd\":0,\"hidden\":false,\"muted\":false,\"effectCount\":0,\"keyframeCount\":0}]},\"overlay\":[],\"audio\":[]}"
    }
  ],
  "stream": true,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_timeline",
        "description": "获取当前项目完整时间线...",
        "parameters": { "type": "object", "properties": {} }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "delete_clip",
        "description": "从时间线删除片段。id 直接使用 get_timeline 返回的 element.id。",
        "parameters": {
          "type": "object",
          "properties": {
            "id": { "type": "string", "description": "片段ID（就是 get_timeline 返回的 element.id）" }
          },
          "required": ["id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "list_media",
        "description": "列出项目中所有已导入的素材(视频/图片/音频)。返回每个素材的 id/name/type。",
        "parameters": { "type": "object", "properties": {} }
      }
    }
    // ... 其余 30 个工具定义省略
  ]
}
```

#### SSE 响应流

```
第 1 帧（textDelta 先到达 — DeepSeek 在调工具前可能先输出文字）:
data: {"id":"f26cad8c5d4a448db2f4f94eb1999b5b","object":"chat.completion.chunk","created":1764561805,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"content":"好的"},"finish_reason":null}]}

第 2 帧（textDelta）:
data: {"id":"f26cad8c5d4a448db2f4f94eb1999b5b","object":"chat.completion.chunk","created":1764561805,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"content":"，我先"},"finish_reason":null}]}

第 3 帧（textDelta）:
data: {"id":"f26cad8c5d4a448db2f4f94eb1999b5b","object":"chat.completion.chunk","created":1764561805,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"content":"查看当前时间线"},"finish_reason":null}]}

第 4 帧（tool_calls 出现 — DeepSeek 边说话边决定调工具）:
data: {"id":"f26cad8c5d4a448db2f4f94eb1999b5b","object":"chat.completion.chunk","created":1764561805,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_00_IUnA4NpJv9E3MszI4ijgNDjr","type":"function","function":{"name":"delete_clip","arguments":""}}]},"finish_reason":null}]}

第 5 帧（arguments）:
data: {"id":"f26cad8c5d4a448db2f4f94eb1999b5b","object":"chat.completion.chunk","created":1764561805,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"id\": \"DpdnCcbV4lBAVu2z\"}"}}]},"finish_reason":null}]}

第 6 帧（finish_reason = "tool_calls"）:
data: {"id":"f26cad8c5d4a448db2f4f94eb1999b5b","object":"chat.completion.chunk","created":1764561806,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4110,"completion_tokens":50,"total_tokens":4160}}

data: [DONE]
```

#### 代码处理

```
AgentService.run() 解析:
  ┌─ textDelta: "好的，我先查看当前时间线"  → 暂存到 textContent，前端实时展示
  ├─ tool_calls[0].name  = "delete_clip"
  └─ tool_calls[0].arguments = '{"id": "DpdnCcbV4lBAVu2z"}'

执行 executeTool("delete_clip", { id: "DpdnCcbV4lBAVu2z" }):
  → findTrack(editor, "DpdnCcbV4lBAVu2z") → "main-track"
  → editor.timeline.deleteElements({ elements: [{ trackId: "main-track", elementId: "DpdnCcbV4lBAVu2z" }] })
  → 返回: { "ok": true, "deleted": "DpdnCcbV4lBAVu2z" }

消息追加:
  assistant: { role: "assistant", content: "好的，我先查看当前时间线", tool_calls: [...] }
  tool:      { role: "tool", tool_call_id: "call_00_IUnA4NpJv9E3MszI4ijgNDjr", content: '{"ok":true,"deleted":"DpdnCcbV4lBAVu2z"}' }

→ continue，进入下一轮
```

---

### Round 3：大模型产出最终回复（无工具调用）

> DeepSeek 根据 delete_clip 的执行结果，生成最终的文字总结

#### 请求

```json
POST https://api.deepseek.com/v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-xxx

{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "你是 OpenCut 视频编辑器内置助手..." },
    { "role": "user", "content": "111" },
    { "role": "assistant", "content": "你好，请问有什么视频编辑方面的需求我可以帮你处理吗？" },
    { "role": "user", "content": "删除时间线上的图片" },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_00_BxMbQx5mPvI8XQhTDGMVlz0M",
          "type": "function",
          "function": { "name": "get_timeline", "arguments": "{}" }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_00_BxMbQx5mPvI8XQhTDGMVlz0M",
      "content": "{\"main\":{\"id\":\"main-track\",\"type\":\"video\",\"elements\":[...]},\"overlay\":[],\"audio\":[]}"
    },
    {
      "role": "assistant",
      "content": "好的，我先查看当前时间线",
      "tool_calls": [
        {
          "id": "call_00_IUnA4NpJv9E3MszI4ijgNDjr",
          "type": "function",
          "function": { "name": "delete_clip", "arguments": "{\"id\": \"DpdnCcbV4lBAVu2z\"}" }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_00_IUnA4NpJv9E3MszI4ijgNDjr",
      "content": "{\"ok\":true,\"deleted\":\"DpdnCcbV4lBAVu2z\"}"
    }
  ],
  "stream": true,
  "tools": [
    { "type": "function", "function": { "name": "get_timeline", ... } },
    { "type": "function", "function": { "name": "delete_clip", ... } }
    // ... 其余 31 个
  ]
}
```

#### SSE 响应流

```
第 1 帧（textDelta）:
data: {"id":"82e68d79c0284e80b7411c16cf42d4cf","object":"chat.completion.chunk","created":1764561824,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"content":"已"},"finish_reason":null}]}

第 2 帧（textDelta）:
data: {"id":"82e68d79c0284e80b7411c16cf42d4cf","object":"chat.completion.chunk","created":1764561824,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"content":"删除片段"},"finish_reason":null}]}

第 3 帧（textDelta）:
data: {"id":"82e68d79c0284e80b7411c16cf42d4cf","object":"chat.completion.chunk","created":1764561824,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{"content":" DpdnCcbV4lBAVu2z。"},"finish_reason":null}]}

第 4 帧（finish_reason = "stop" — 结束）:
data: {"id":"82e68d79c0284e80b7411c16cf42d4cf","object":"chat.completion.chunk","created":1764561824,"model":"deepseek-chat","system_fingerprint":"fp_9e2b1e6b03_prod0820","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4072,"completion_tokens":8,"total_tokens":4080}}

data: [DONE]
```

#### 代码处理

```
AgentService.run() 解析:
  ┌─ textDelta: "已删除片段 DpdnCcbV4lBAVu2z。"
  ├─ finish_reason = "stop"
  └─ resolved (tool_calls) = []  → 无工具调用

→ push assistant 消息，break 退出循环
→ onProgress("done")
→ 最终返回："已删除片段 DpdnCcbV4lBAVu2z。"
```

---

## 数据流全景图

```
                           用户输入 "删除时间线上的图片"
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         AgentService.run()                           │
│                                                                       │
│  messages = [                                                        │
│    { role:"system", content: SYSTEM_PROMPT },                        │
│    ... 历史消息 ...,                                                  │
│    { role:"user", content: "删除时间线上的图片" }                      │
│  ]                                                                    │
│                                                                       │
│  tools = TOOL_DEFINITIONS  // 33 个工具的 JSON Schema               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         client.streamChat()                           │
│                                                                       │
│  POST https://api.deepseek.com/v1/chat/completions                   │
│  { model, messages, stream: true, tools }                            │
│                                                                       │
│  读出 ReadableStream → 解析 SSE "data:" 行                           │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                    SSE 流事件分类                             │     │
│  │                                                              │     │
│  │  delta.content  → yield { textDelta: "文字" }                │     │
│  │  delta.tool_calls → yield { toolCall: { name, arguments } }  │     │
│  │  finish_reason   → 记录到 finishReason 变量                   │     │
│  │  流关闭          → yield { done: true }                       │     │
│  └─────────────────────────────────────────────────────────────┘     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│              AgentService.run() — 循环判断                            │
│                                                                       │
│  ┌──────────────────────────────┐                                    │
│  │ 有 tool_calls 且有效？       │                                    │
│  └──┬───────────────┬───────────┘                                    │
│     │ YES           │ NO                                              │
│     ▼               ▼                                                │
│  ┌──────────────┐ ┌──────────────┐                                   │
│  │ 执行工具      │ │ 纯文字回复    │                                   │
│  │              │ │              │                                   │
│  │ push:        │ │ push:        │                                   │
│  │ assistant    │ │ assistant    │                                   │
│  │ (tool_calls) │ │ (text)       │                                   │
│  │              │ │              │                                   │
│  │ for each tc: │ │ break        │                                   │
│  │  executeTool │ │ ← 结束       │                                   │
│  │  push: tool  │ │              │                                   │
│  │  (result)    │ │              │                                   │
│  │              │ │              │                                   │
│  │ continue     │ │              │                                   │
│  │ ← 下一轮     │ │              │                                   │
│  └──────────────┘ └──────────────┘                                   │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      AgentPanel.tsx (UI)                              │
│                                                                       │
│  for await (const chunk of agent.run(input, onProgress)) {            │
│    // chunk 是 yield 的文字增量                                       │
│    setMessages(prev => 更新最后一条 assistant 消息的内容)              │
│  }                                                                    │
│                                                                       │
│  onProgress 回调:                                                     │
│    type:"tool"  → 显示工具执行中提示                                  │
│    type:"tool_result" → 缓存 toolCall 记录用于折叠卡片               │
│    type:"done"  → 结束 streaming 状态                                │
│    type:"error" → 显示错误                                            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 核心原理总结

### Q: 到底是谁在「调用」MCP 工具？

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                       │
│   答案是：大模型（DeepSeek）做决策，你的代码做执行。                   │
│                                                                       │
│   你的代码从来没有主动"替"大模型决定调哪个工具。                       │
│   你的代码只是：                                                      │
│     1. 把工具清单（33 个 JSON Schema）发给大模型                      │
│     2. 接收大模型返回的 tool_calls 指令                               │
│     3. 在本地（浏览器）执行对应的 EditorCore 方法                     │
│     4. 把执行结果传回给大模型                                         │
│     5. 重复以上循环直到大模型说"stop"                                 │
│                                                                       │
│   类比：你的代码是一双手，大模型是大脑。                               │
│   大脑说"拿起杯子"，手就拿起杯子。手不会自行决定拿什么。              │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Q: 和标准 MCP 协议的区别？

```
┌─────────────────────────────────────────────────────────────────────┐
│  标准 MCP (Model Context Protocol):                                  │
│    客户端 ←→ stdio/HTTP ←→ MCP Server → 执行工具                    │
│    工具定义由 Server 提供，客户端发现后调用                           │
│                                                                      │
│  OpenCut Web AI 聊天 (本文档):                                       │
│    AgentService → HTTP SSE → DeepSeek API                            │
│    工具定义在请求中发送，tool_calls 在响应中返回                      │
│                                                                      │
│  OpenCut 外部 MCP Server (packages/mcp):                             │
│    Claude ←→ stdio ←→ MCP Server → bridge → EditorCore              │
│    这才是标准 MCP 协议，但走的是另一条通道                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键文件索引

| 文件 | 路径 | 行数 |
|------|------|------|
| AgentService | `apps/web/src/services/agent/AgentService.ts` | 138 行 |
| streamChat | `apps/web/src/services/agent/client.ts` | 101 行 |
| 工具定义+执行 | `apps/web/src/services/agent/tool-definitions.ts` | 404 行 |
| 系统提示词 | `apps/web/src/services/agent/system-prompt.ts` | 17 行 |
| 类型定义 | `apps/web/src/services/agent/types.ts` | 66 行 |
| 模型配置 | `apps/web/src/services/agent/model-config.ts` | 57 行 |
| UI 组件 | `apps/web/src/components/editor/panels/agent/AgentPanel.tsx` | 343 行 |
| 外部 MCP Server | `packages/mcp/src/index.ts` | ~350 行 |
| 导出入口 | `apps/web/src/services/agent/index.ts` | 7 行 |

---

## 附录：SSE 协议说明

OpenAI 兼容的 Server-Sent Events (SSE) 格式：

```
数据帧格式:  "data: " + JSON + "\n\n"

帧类型:
  1. delta.content 帧   → 流式文字
  2. delta.tool_calls 帧 → 工具调用（可能分片）
  3. finish_reason 帧   → 结束信号 + token 用量
  4. [DONE] 帧          → SSE 流终止（备用）

finish_reason 取值:
  "tool_calls" → 大模型要求执行工具，对话继续
  "stop"       → 对话正常结束
  "length"     → 达到最大 token 数
  "content_filter" → 被安全过滤器拦截
```

> 文档版本: v2.0 | 更新日期: 2026-08-08 | 代码基线: `apps/web/src/services/agent/`
