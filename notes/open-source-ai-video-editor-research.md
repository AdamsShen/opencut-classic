# 开源 AI 视频编辑器全景调研

> 调研时间：2026-07-30
> 调研背景：寻找跨平台 + 视频编辑能力 + AI 能力三者均衡的开源视频编辑器

---

## 一、核心结论

**目前不存在在跨平台、视频编辑能力、AI 能力三方面都很突出的开源产品。** 每个项目都有明显的取舍和短板。

---

## 二、产品全景对比

### 2.1 综合评分矩阵

| 项目 | 跨平台 | 视频编辑成熟度 | AI 能力 | Stars | 许可证 | 现状 |
|------|:------:|:------------:|:------:|-------:|--------|------|
| **OpenCut Rewrite** | ✅ Web/桌面/移动 | ❓ 待定 | ❓ MCP 规划中 | 79.8k | MIT | 🔴 重写中，不可用 |
| **Palmier Pro** | ❌ macOS only | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 12.8k | GPLv3 | 🟢 可用 |
| **OpenCut Classic**（本地） | ⚠️ Web+桌面未完成 | ⭐⭐ | ⭐⭐⭐⭐ | Legacy | MIT | 🔴 已归档 |
| **video-use** | ✅ Python/跨平台 | ⭐（无GUI） | ⭐⭐⭐⭐⭐ | 18.1k | MIT | 🟢 可用 |
| **FableCut** | ⚠️ 仅浏览器 | ⭐⭐⭐ | ⭐⭐⭐ | 559 | MIT | 🟢 可用 |
| **OpenChatCut** | ✅ Electron 跨平台 | ⭐⭐⭐ | ⭐⭐⭐ | 609 | AGPLv3 | 🟡 早期 |
| **Pireel Studio** | ⚠️ 仅浏览器 | ⭐⭐ | ⭐⭐ | 822 | AGPLv3 | 🟢 可用 |
| **SynthCut** | ✅ Electron 跨平台 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 4 | GPLv3 | 🔴 刚出生(21 commits) |
| **OpenInCut** | ✅ Tauri 跨平台 | ⭐⭐⭐ | ⭐⭐⭐ | 4 | Apache-2.0 | 🔴 v0.2.1 极早期 |

---

### 2.2 技术栈与平台

| 项目 | 技术栈 | 平台 | GitHub |
|------|--------|------|--------|
| **OpenCut Rewrite** | Rust + Moon | Web / Desktop / Mobile | [opencut-app/opencut](https://github.com/opencut-app/opencut) |
| **Palmier Pro** | Swift + Metal | macOS only (Tahoe/Apple Silicon) | [palmier-io/palmier-pro](https://github.com/palmier-io/palmier-pro) |
| **OpenCut Classic** | Next.js + Rust/WASM + Bun | Web (+ GPUI 桌面未完成) | [opencut-app/opencut-classic](https://github.com/opencut-app/opencut-classic) |
| **video-use** | Python + FFmpeg | 跨平台 CLI/Agent | [browser-use/video-use](https://github.com/browser-use/video-use) |
| **FableCut** | JavaScript (零依赖) + Node | 浏览器 | [ronak-create/FableCut](https://github.com/ronak-create/FableCut) |
| **OpenChatCut** | React 19 + Electron + Remotion | 跨平台桌面 | [0xsline/OpenChatCut](https://github.com/0xsline/OpenChatCut) |
| **Pireel Studio** | TypeScript + Vite + WebCodecs | 浏览器 | [pireel/pireel](https://github.com/pireel/pireel) |
| **SynthCut** | Node/TS + Electron + FFmpeg | 跨平台桌面 | [Relo-video/SynthCut](https://github.com/Relo-video/SynthCut) |
| **OpenInCut** | Rust + Tauri + FFmpeg | 跨平台桌面 | [PeDitXOS/OpenInCut](https://github.com/PeDitXOS/OpenInCut) |

---

## 三、视频编辑能力深度对比

| 能力 | OpenCut Classic | Palmier Pro | FableCut | OpenChatCut | SynthCut |
|------|:---:|:---:|:---:|:---:|:---:|
| 多轨编辑 | ✅ | ✅ | ✅ 3V+4A | ✅ | ✅ |
| 裁剪/分割/变速 | ✅ | ✅ | ✅ trim/split/snap | ✅ | ✅ |
| 关键帧动画 | ✅ 三通道 | ✅ | ✅ ~25属性+缓动 | ✅ | ✅ |
| **内置特效** | ⚠️ 仅1个(模糊) | ✅ Metal shader | ✅ 14种滤镜 | ✅ WebGL 多特效 | ✅ 堆叠式特效链 |
| **转场** | ❌ | ✅ | ✅ 17种(含毛刺/擦除) | ✅ | ✅ 淡入淡出/交叉 |
| **色彩校正** | ❌ | ✅ | ✅ 调色+色度键 | ✅ LUT | ✅ 色轮/曲线/LUT |
| 运动图形 | ❌ | ❌ | ✅ SVG 动画 | ✅ WebGL | ✅ Remotion 驱动 |
| 字幕 | ✅ Whisper | ✅ | ✅ 动态字幕 | ✅ 逐词转录 | ✅ Whisper 本地 |
| **OTIO 交换** | ❌ | ❌ | ❌ | ❌ | ✅ DaVinci 互通 |
| **导出格式** | MP4+WebM | MP4(H.264/H.265/ProRes)+XML | MP4(CRF-18) | MP4+Audio+SRT+FCPXML | 平台预设+LUFS归一化 |
| GPU 渲染 | ✅ Rust/wgpu | ✅ Metal原生 | ❌ | ✅ WebGL | ✅ GPU编码预览 |

---

## 四、AI 能力深度对比

| 能力 | OpenCut Classic | Palmier Pro | FableCut | SynthCut | video-use |
|------|:---:|:---:|:---:|:---:|:---:|
| **文生视频** | ✅ 三路fallback | ✅ Kling/Veo/Seedance | ❌ | ❌ | ❌ |
| **文生图** | ✅ 三路fallback | ✅ 内置 | ❌ | ❌ | ❌ |
| AI 音乐/音效 | ✅ musicgen | ✅ 内置 | ❌ | ❌ | ❌ |
| AI 抠像 | ✅ birefnet | ❓ | ✅ MediaPipe本地 | ❌ | ❌ |
| AI 擦除 | ✅ flux inpainting | ❓ | ❌ | ❌ | ❌ |
| 智能字幕 | ✅ Whisper本地 | ✅ | ❌ | ✅ Whisper本地 | ✅ 逐词时间戳 |
| AI 自动调色 | ❌ | ❌ | ❌ | ❌ | ✅ 多风格 |
| 自动去语气词 | ❌ | ❌ | ❌ | ❌ | ✅ |
| **MCP Agent操控** | ❌ | ✅ HTTP MCP | ✅ MCP+REST | ✅ 94个MCP工具 | ✅ |
| 对话式编辑 | ❌ | ❌ | ❌ | ❌ | ✅ |
| **AI运行位置** | 全部云端API | 云端API | 浏览器端MediaPipe | 100%本地离线 | 100%本地离线 |

---

## 五、MCP（Model Context Protocol）支持对比

MCP 是让 AI Agent（如 Claude Code、Cursor、Codex）直接操控视频编辑器的协议标准。

| 项目 | MCP 支持 | 工具数量 | 实现方式 |
|------|:---:|:---:|------|
| **SynthCut** | ✅ | **94个** | HTTP MCP Server |
| **Palmier Pro** | ✅ | 多个 | `http://127.0.0.1:19789/mcp` |
| **OpenInCut** | ✅ | 53个 | Tauri 内嵌 |
| **FableCut** | ✅ | 多个 | MCP + REST + JSON |
| **Kinocut** | ✅ | 多个 | Python MCP Server |
| **OpenChatCut** | ✅ | 多个 | MCP + Agent Skills |
| **Pireel** | ✅ | 多个 | 浏览器 MCP |
| **OpenCut Rewrite** | 🔜 规划中 | - | - |
| **OpenCut Classic** | ❌ | - | - |
| **video-use** | ✅ | 多个 | Code Agent 直接调用 |

---

## 六、许可证与商用友好度

| 许可证 | 项目 | 商用友好度 |
|--------|------|:---:|
| **MIT** | OpenCut Rewrite / OpenCut Classic / FableCut / video-use | 🟢 最宽松 |
| **Apache-2.0** | OpenInCut / Kinocut | 🟢 宽松 |
| **GPLv3** | Palmier Pro / SynthCut | 🟡 衍生作品须开源 |
| **AGPLv3** | OpenChatCut / Pireel | 🔴 网络使用也须开源 |

---

## 七、各项目致命短板

| 短板类型 | 项目 |
|----------|------|
| **不跨平台** | Palmier Pro（macOS only）、FableCut/Pireel（纯浏览器） |
| **视频编辑弱** | video-use（无GUI时间线）、OpenCut Classic（1特效/0转场/0调色） |
| **AI能力弱/无** | OpenCut Rewrite（AI全在规划中） |
| **太早期/不可靠** | SynthCut(4 stars/21 commits)、OpenInCut(4 stars/v0.2.1) |
| **许可证限制多** | Palmier Pro/SynthCut(GPLv3)、OpenChatCut/Pireel(AGPLv3) |
| **已停止维护** | OpenCut Classic（上游归档） |

---

## 八、未来展望

### 最值得关注的项目

1. **[OpenCut Rewrite](https://github.com/opencut-app/opencut)**（79.8k ⭐）
   - MIT 协议 + Rust 核心统一三端 + MCP 规划中
   - 一旦完成，将是最有可能达成三者均衡的产品
   - **风险**：重写时间未知，当前不可用，架构还在设计中

2. **[SynthCut](https://github.com/Relo-video/SynthCut)**（4 ⭐）
   - 视频编辑能力在开源领域最全（调色轮/曲线/LUT/关键帧/防抖/OTIO/94个MCP工具）
   - 跨平台 Electron，100% 本地离线
   - **风险**：21 commits，社区几乎为零，需赌它能否成长

3. **[video-use](https://github.com/browser-use/video-use)**（18.1k ⭐）
   - MIT 协议，AI 视频编辑的思路最清晰（不看视频直接读转录+时间戳）
   - 自动去语气词/调色/字幕烧录/自我评估循环
   - **风险**：无 GUI 编辑器，纯代码/Agent 驱动，不适合需要手动剪辑的用户

### 选型建议

| 场景 | 推荐 |
|------|------|
| 想要完整桌面编辑器 + AI | **Palmier Pro**（仅 macOS，接受 GPLv3） |
| 想要纯浏览器、零安装 | **FableCut**（MIT，功能最全面） |
| 只想给 AI Agent 加视频编辑能力 | **video-use**（18k star，MIT，最成熟） |
| 愿意押注未来 | **OpenCut Rewrite**（等重写完成）或 **SynthCut**（赌它成长） |
| 需要二次开发/商用 | **FableCut** 或 **video-use**（MIT，无许可证顾虑） |

---

## 九、本地项目情况

当前电脑上的 `/Users/xmly/opencut-classic` 是 OpenCut 经典版：

- **仓库地址**：`git@github.com:AdamsShen/opencut-classic.git`
- **状态**：上游已归档，不再维护
- **已实现的 AI 能力**：文生视频（三路 fallback）、文生图（三路 fallback）、AI 音乐/音效、AI 抠像、AI 擦除
- **视频编辑短板**：仅 1 个内置特效（模糊）、无转场、无色彩校正、无运动图形、无 MCP 支持
- **优势**：MIT 协议，Rust/WASM GPU 渲染，AI 生成覆盖面全
