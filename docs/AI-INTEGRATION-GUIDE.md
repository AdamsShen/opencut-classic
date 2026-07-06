# OpenCut 经典版 AI 能力集成实施指南

> 仓库：`git@github.com:AdamsShen/opencut-classic.git`
> 本地路径：`/Users/xmly/opencut-classic`
> 创建时间：2026-07-06

---

## 目录

- [1. 项目现状分析](#1-项目现状分析)
- [2. 代码架构速览](#2-代码架构速览)
- [3. 分步实施计划](#3-分步实施计划)
  - [第一步：前端界面中文化](#第一步前端界面中文化)
  - [第二步：Seedance 2.0 文生视频集成](#第二步seedance-20-文生视频集成)
  - [第三步：AI 智能擦除 + 抠像集成](#第三步ai-智能擦除--抠像集成)
  - [第四步：完善智能字幕功能](#第四步完善智能字幕功能)
  - [第五步：AI 音乐/音效生成](#第五步ai-音乐音效生成)
- [4. 各步骤依赖关系](#4-各步骤依赖关系)
- [5. 完成后的功能对比](#5-完成后的功能对比)

---

## 1. 项目现状分析

### 当前 AI 能力：0

| 剪映 AI 能力 | OpenCut 现有状态 |
|------|------|
| 智能字幕 | ⚠️ 有 `TranscriptionService`（基于 `@huggingface/transformers`），可用程度待验证 |
| 文生视频 | ❌ 不存在 |
| 文生图 | ❌ 不存在 |
| 智能擦除/去水印 | ❌ 不存在 |
| 智能抠像 | ❌ 不存在 |
| 超清修复 | ❌ 不存在（浏览器端也做不了） |
| AI 音乐/音效 | ❌ 不存在 |

### 已有 AI 基础设施

| 能力 | 实现方式 | 文件 |
|------|---------|------|
| 语音转文字 | `@huggingface/transformers` + Web Worker 模式 | `src/services/transcription/service.ts`, `worker.ts` |
| HuggingFace SDK | 已安装 `@huggingface/transformers` v3.8+ | `package.json` |
| 服务注册模式 | `services/` 目录下的 service-manager 框架 | `src/services/` |

---

## 2. 代码架构速览

### 2.1 编辑器面板架构

```
编辑器主界面
├── 顶部 Header (editor-header.tsx)         — 项目名、Logo菜单、导出按钮
├── 左侧 AssetsPanel (assets/index.tsx)      — 素材/音频/文字/贴纸/特效等 Tab
│   ├── TabBar (tabbar.tsx)                  — 垂直图标按钮栏
│   ├── tabs 注册表 (assets-panel-store.tsx) — TAB_KEYS + tabs 对象
│   └── viewMap (assets/index.tsx)           — Tab → 组件映射
├── 中间 Preview + Timeline                  — 预览画布 + 多轨道时间轴
└── 右侧 Properties                          — 属性面板
```

### 2.2 AI 能力核心接入点

#### 新增 AI 标签页

```
assets-panel-store.tsx
  ├── TAB_KEYS 数组         ← 新增 "ai-video" / "ai-tools" / "ai-audio"
  ├── tabs 对象             ← 新增标签图标和名称
  └── useAssetsPanelStore    ← 保持不变

assets/index.tsx
  ├── viewMap               ← 新增 Tab → 组件映射
  └── 导入新组件

新增 AI 组件文件
  └── src/components/editor/panels/assets/views/ai-video.tsx   (文生视频)
  └── src/components/editor/panels/assets/views/ai-tools.tsx   (擦除+抠像)
  └── src/components/editor/panels/assets/views/ai-audio.tsx   (音乐/音效)
```

#### 结果回写 Media 资产库

```
新组件调用 API → 获取结果 → MediaManager.addMediaAsset()
                                    ↓
                              媒体资产库临时存储
                                    ↓
                         用户拖入时间轴剪辑
```

### 2.3 关键文件路径

```
apps/web/src/
├── components/editor/panels/assets/
│   ├── assets-panel-store.tsx          ← 标签注册（TAB_KEYS + tabs）
│   ├── index.tsx                       ← 标签渲染（viewMap）
│   ├── tabbar.tsx                      ← 标签栏 UI
│   └── views/
│       ├── assets.tsx                  ← Media 视图
│       ├── base-panel.tsx              ← 面板容器
│       └── settings/                   ← 设置视图
├── core/managers/
│   ├── media-manager.ts                ← addMediaAsset() 方法
│   └── commands.ts                     ← AddMediaAssetCommand
├── commands/media/
│   └── add-media-asset.ts             ← 媒体添加命令
├── media/
│   ├── types.ts                        ← MediaType = "image" | "video" | "audio"
│   └── processing.ts                   ← 媒体文件处理
├── services/
│   ├── transcription/                  ← 已有语音转文字
│   │   ├── service.ts                  ← TranscriptionService
│   │   └── worker.ts                   ← Web Worker（HuggingFace 推理）
│   └── renderer/                       ← 渲染管线
└── locale/                             ← 【新增】中文本地化
    └── zh.ts                           ← 中文文案文件
```

### 2.4 MediaManager API

```ts
// 核心方法 — 将 AI 生成的视频/图片/音频加入编辑器
class MediaManager {
  async addMediaAsset({
    projectId: string,
    asset: { file: File, type: "image" | "video" | "audio", ... }
  }): Promise<MediaAsset | null>

  // 会触发：持久化存储 + 通知 UI 刷新 + FPS 自适应
}

// MediaAsset 接口
interface MediaAsset {
  id: string
  file: File        // 必填 — 生成的文件需转为 File 对象
  type: "image" | "video" | "audio"
  url?: string      // 可选 — 对象 URL
  thumbnailUrl?: string
}
```

---

## 3. 分步实施计划

### 第一步：前端界面中文化

**目标**：所有 UI 文案从英文改为中文。

**范围**：约 35 个文件、约 130 条文案。

**方案**：极简 key-value 字典，不引入 i18n 框架。

**改动量**：1 天

#### 实施步骤

**Step 1.1** — 新建中文文案文件

```bash
mkdir -p apps/web/src/locale
```

创建 `apps/web/src/locale/zh.ts`：

```ts
export const zh = {
  // ===== 侧边栏标签 =====
  "tab.media": "素材",
  "tab.sounds": "音频",
  "tab.text": "文字",
  "tab.stickers": "贴纸",
  "tab.effects": "特效",
  "tab.transitions": "转场",
  "tab.captions": "字幕",
  "tab.adjustment": "调节",
  "tab.settings": "设置",

  // ===== 导航 =====
  "nav.roadmap": "路线图",
  "nav.contributors": "贡献者",
  "nav.sponsors": "赞助商",
  "nav.blog": "博客",
  "nav.projects": "项目",
  "nav.brand_assets": "品牌资源",

  // ===== Header 菜单 =====
  "menu.exit_project": "退出项目",
  "menu.shortcuts": "快捷键",
  "menu.discord": "Discord",
  "menu.copy_svg": "复制 SVG",
  "menu.download_svg": "下载 SVG",

  // ===== 导出面板 =====
  "export.export": "导出",
  "export.exporting_project": "正在导出项目",
  "export.export_project": "导出项目",
  "export.format": "格式",
  "export.quality": "画质",
  "export.quality.low": "低 - 最小文件",
  "export.quality.medium": "中 - 平衡",
  "export.quality.high": "高 - 推荐",
  "export.quality.very_high": "最高 - 大文件",
  "export.format.mp4": "MP4 (H.264) - 兼容性更好",
  "export.format.webm": "WebM (VP9) - 文件更小",
  "export.audio.include": "导出包含音频",
  "export.cancel": "取消",
  "export.retry": "重试",
  "export.copy": "复制",
  "export.failed": "导出失败",
  "export.unknown_error": "未知错误",

  // ===== 素材面板 =====
  "media.video": "视频",
  "media.audio": "音频",
  "media.name": "名称",
  "media.type": "类型",
  "media.duration": "时长",
  "media.delete": "删除",
  "media.delete_items": "删除 {count} 项",
  "media.upload": "上传",
  "media.search": "搜索...",
  "media.categories": "分类",

  // ===== 属性面板 =====
  "property.audio": "音频",
  "property.speed": "速度",
  "property.effects": "特效",
  "property.text": "文字",

  // ===== 场景 =====
  "scene.select": "选择",
  "scene.cancel": "取消",

  // ===== Toast 提示 =====
  "toast.failed_rename_project": "重命名项目失败",
  "toast.failed_delete_project": "删除项目失败",
  "toast.failed_save_project": "保存项目失败",
  "toast.failed_duplicate_projects": "复制项目失败",
  "toast.failed_create_project": "创建项目失败",
  "toast.failed_delete_scene": "删除场景失败",
  "toast.failed_add_sticker": "添加贴纸失败",
  "toast.failed_save_sound": "保存音频失败",
  "toast.failed_remove_sound": "移除音频失败",
  "toast.failed_clear_sounds": "清除音频失败",
  "toast.failed_copy_snapshot": "复制快照失败",
  "toast.failed_save_snapshot": "保存快照失败",
  "toast.no_active_project": "没有打开的项目",
  "toast.not_enough_storage": "浏览器存储空间不足",
  "toast.unsupported_file_type": "不支持的文件类型",
  "toast.failed_process_file": "文件处理失败",
  "toast.feedback_sent": "反馈已发送",
  "toast.please_try_again": "请重试",
  "toast.project_not_found": "项目未找到",
  "toast.sound_file_not_available": "音频文件不可用",

  // ===== 通用 =====
  "common.loading": "加载中...",
  "common.coming_soon": "即将推出...",
  "common.save": "保存",
  "common.delete": "删除",
  "common.rename": "重命名",
  "common.duplicate": "复制",
  "common.cancel": "取消",
} as const
```

**Step 1.2** — 逐个文件替换硬编码字符串

| 优先级 | 文件 | 改动方式 |
|------|------|---------|
| 1 | `assets-panel-store.tsx` | `label: "Media"` → `label: zh["tab.media"]` |
| 2 | `header.tsx` | 导航 links 数组中的 label |
| 3 | `footer.tsx` | 同上 |
| 4 | `editor-header.tsx` | 菜单项 + toast 文案 |
| 5 | `export-button.tsx` | 导出面板全部文案 |
| 6 | `assets.tsx` (MediaView) | 表头 + toast |
| 7 | `index.tsx` (AssetsPanel) | "coming soon" |
| 8 | `registry.tsx` (属性面板) | 属性分组标签 |
| 9 | `scenes-view.tsx` | Select/Cancel |
| 10 | Toast 文案集中替换 | `project-manager.ts`, `media-manager.ts`, `sounds-store.ts`, `processing.ts`, `feedback-popover.tsx` 等 |
| 11 | 页面标题 | `roadmap/page.tsx`, `contributors/page.tsx`, `blog/page.tsx` 等 |
| 12 | `metadata.ts` | 网站 SEO 描述 |

**Step 1.3** — 验证

```bash
cd /Users/xmly/opencut-classic
bun dev:web
# 打开 http://localhost:3000 确认所有界面显示中文
```

---

### 第二步：Seedance 2.0 文生视频集成

**目标**：编辑器内直接输入 prompt，调用 Seedance 2.0 生成视频，自动加入素材库。

**方案**：新增 AI Video 标签页 → `@fal-ai/client` SDK → 结果写入 MediaManager。

**依赖**：fal.ai API Key（免费注册即可获取）

**改动量**：1-2 天

#### 实施步骤

**Step 2.1** — 安装依赖

```bash
cd /Users/xmly/opencut-classic
bun add @fal-ai/client
```

**Step 2.2** — 配置环境变量

在 `apps/web/.env.local` 添加：

```env
FAL_KEY=your_fal_ai_api_key_here
```

在 `apps/web/src/env/web.ts` 中添加该环境变量的类型定义。

**Step 2.3** — 注册 AI Video 标签

修改 `apps/web/src/components/editor/panels/assets/assets-panel-store.tsx`：

```ts
// 1. 在 TAB_KEYS 数组中新增
export const TAB_KEYS = [
  "media",
  "sounds",
  "text",
  "stickers",
  "effects",
  "transitions",
  "captions",
  "adjustment",
  "ai-video",   // 新增
  "settings",
] as const

// 2. 添加图标
import { Video02Icon } from "@hugeicons/core-free-icons"  // 新增

// 3. 在 tabs 对象中新增
export const tabs = {
  // ... 原有内容不变 ...
  "ai-video": {
    icon: createHugeiconsIcon({ icon: Video02Icon }),
    label: zh["tab.ai_video"],   // "AI 视频"
  },
  // ...
}
```

中文文案同步在 `zh.ts` 中加入：

```ts
"tab.ai_video": "AI 视频",
```

**Step 2.4** — 在 viewMap 中注册组件

修改 `apps/web/src/components/editor/panels/assets/index.tsx`：

```tsx
import { AIVideoView } from "./views/ai-video"

export function AssetsPanel() {
  const viewMap: Record<Tab, React.ReactNode> = {
    // ... 原有内容不变 ...
    "ai-video": <AIVideoView />,
    // ...
  }
}
```

**Step 2.5** — 创建 AI Video 组件

新建 `apps/web/src/components/editor/panels/assets/views/ai-video.tsx`：

```tsx
"use client"

import { useState } from "react"
import { PanelView } from "./base-panel"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { useEditor } from "@/editor/use-editor"
import { fal } from "@fal-ai/client"
import { zh } from "@/locale/zh"

// 配置 fal.ai client
fal.config({
  credentials: process.env.NEXT_PUBLIC_FAL_KEY
})

export function AIVideoView() {
  const editor = useEditor()
  const activeProject = useEditor((e) => e.project.getActive())
  
  const [prompt, setPrompt] = useState("")
  const [duration, setDuration] = useState<"4" | "8" | "12" | "15">("8")
  const [resolution, setResolution] = useState<"480p" | "720p">("720p")
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState("")

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("请输入视频描述")
      return
    }
    if (!activeProject) {
      toast.error(zh["toast.no_active_project"])
      return
    }

    setIsGenerating(true)
    setProgress("提交任务...")

    try {
      const result = await fal.subscribe(
        "bytedance/seedance-2.0/text-to-video",
        {
          input: {
            prompt: prompt.trim(),
            duration,
            resolution,
          },
          logs: true,
          onQueueUpdate: (update) => {
            if (update.status === "IN_PROGRESS") {
              setProgress("生成中...")
            }
          },
        }
      )

      // 下载生成的视频
      setProgress("下载视频...")
      const videoUrl = result.data.video.url
      const response = await fetch(videoUrl)
      const blob = await response.blob()
      const file = new File([blob], `seedance-${Date.now()}.mp4`, {
        type: "video/mp4",
      })

      // 加入媒体资产库
      await editor.media.addMediaAsset({
        projectId: activeProject.metadata.id,
        asset: {
          file,
          type: "video",
        },
      })

      toast.success("视频生成成功，已加入素材库")
      setPrompt("")
    } catch (error) {
      console.error("Seedance generation failed:", error)
      toast.error("视频生成失败", {
        description:
          error instanceof Error ? error.message : zh["toast.please_try_again"],
      })
    } finally {
      setIsGenerating(false)
      setProgress("")
    }
  }

  return (
    <PanelView title={zh["tab.ai_video"]}>
      <div className="flex flex-col gap-4 p-3">
        {/* Prompt 输入 */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-video-prompt">视频描述</Label>
          <textarea
            id="ai-video-prompt"
            className="..."  // 复用现有样式
            placeholder="描述你想要生成的视频..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            disabled={isGenerating}
          />
        </div>

        {/* Duration 选择 */}
        <div className="flex flex-col gap-1.5">
          <Label>时长（秒）</Label>
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value as any)}
            className="..."
          >
            <option value="4">4 秒</option>
            <option value="8">8 秒</option>
            <option value="12">12 秒</option>
            <option value="15">15 秒</option>
          </select>
        </div>

        {/* Resolution 选择 */}
        <div className="flex flex-col gap-1.5">
          <Label>分辨率</Label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as any)}
            className="..."
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
          </select>
        </div>

        {/* 生成按钮 */}
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full"
        >
          {isGenerating ? progress : "生成视频"}
        </Button>

        {/* 提示信息 */}
        <p className="text-muted-foreground text-xs">
          基于字节跳动 Seedance 2.0 模型，通过 fal.ai 调用。
          720p 约 $0.30/秒，8 秒约 $2.42。
        </p>
      </div>
    </PanelView>
  )
}
```

**Step 2.6** — 验证

```bash
cd /Users/xmly/opencut-classic
# 确保 .env.local 中 FAL_KEY 已设置
bun dev:web
```

1. 打开编辑器 → 左侧面板出现 "AI 视频" 标签
2. 输入 prompt → 选择参数 → 点击生成
3. 等待 ~2 分钟 → 视频自动加入素材库
4. 拖入时间轴测试剪辑

#### 备用方案：EvoLink API（更便宜）

如果要用 EvoLink 替代 fal.ai（便宜约 35%），改动仅在 API 调用层：

```ts
// 替换为 EvoLink 的 REST API 调用
const EVOLINK_API_KEY = process.env.NEXT_PUBLIC_EVOLINK_API_KEY

const response = await fetch("https://api.evolink.ai/v1/videos/generations", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${EVOLINK_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "seedance-2.0-text-to-video",
    prompt: prompt,
    duration: parseInt(duration),
    quality: resolution
  })
})
const result = await response.json()
// 后续处理同上
```

---

### 第三步：AI 智能擦除 + 抠像集成

**目标**：选中图片后，涂鸦标记要擦除的区域或一键抠像。

**方案**：新增 AI Tools 标签页 → fal.ai Inpainting / RemoveBG API → 结果回写素材库。

**依赖**：第二步的 `@fal-ai/client` 已安装。

**改动量**：3-5 天

#### 实施步骤

**Step 3.1** — 注册 AI Tools 标签

在 `assets-panel-store.tsx` 中新增：

```ts
"ai-tools"  // 加入 TAB_KEYS

// tabs 中新增
"ai-tools": {
  icon: createHugeiconsIcon({ icon: AiSparklesIcon }),
  label: zh["tab.ai_tools"],
}
```

**Step 3.2** — 创建 AI Tools 组件

功能分区：
- **AI 擦除**：选图 → 涂鸦遮罩 Canvas → fal.ai Inpainting API → 返回结果
- **AI 抠像**：选图 → fal.ai RemoveBG API → 透明背景结果
- **AI 扩图**：选图 → fal.ai Outpainting API → 扩展画面

**Step 3.3** — 涂鸦遮罩 Canvas

这个功能需要实现一个简单的 Canvas 涂鸦工具，复杂度最大。如果不想做，可以降级为：
- 用 `IOPaint` 本地服务（`pip install iopaint` → `localhost:8080`）代替
- 或者在 OpenCut 中只提供"选中图片 → API 智能擦除"（不做涂鸦，整图调用）

---

### 第四步：完善智能字幕功能

**目标**：确认并完善已有的语音转文字/自动字幕能力。

**方案**：检查 `TranscriptionService` 实际可用程度，优化 UI 交互。

**改动量**：1-2 天

#### 实施步骤

**Step 4.1** — 功能审计

```bash
# 检查 TranscriptionService 实现完整度
cat apps/web/src/services/transcription/service.ts
cat apps/web/src/services/transcription/worker.ts
cat apps/web/src/transcription/types.ts
cat apps/web/src/transcription/models.ts
cat apps/web/src/subtitles/components/assets-view.tsx
```

需要确认：
- [ ] 是否支持自动语言检测
- [ ] 是否有说话人分离（diarization）
- [ ] 词级时间戳对齐精度
- [ ] 字幕样式自定义（字体/颜色/大小/位置）
- [ ] 字幕导出（SRT/VTT）

**Step 4.2** — 补齐缺失能力

根据审计结果决定是否：
- 升级 Whisper 模型版本
- 接入 pyannote 做说话人分离
- 优化字幕编辑 UI

---

### 第五步：AI 音乐/音效生成

**目标**：编辑器内根据 prompt 生成背景音乐或音效。

**方案**：新增 AI Audio 标签页 → fal.ai / EvoLink / Replicate API → 结果写入音频素材库。

**改动量**：2-3 天

#### 实施步骤

**Step 5.1** — 选择模型

| 渠道 | 模型 | 说明 |
|------|------|------|
| fal.ai | `facebook/musicgen` 或 `stabilityai/stable-audio` | 文本转音乐/音效 |
| Replicate | `meta/musicgen` | Meta 官方模型 |
| 本地 | AudioCraft (Meta) | 需要 GPU |

推荐使用 fal.ai（统一 API Key）。

**Step 5.2** — 类似 AIVideoView 的实现模式

- Prompt 输入框
- 类型选择（背景音乐 / 音效）
- 时长选择
- 生成按钮
- 结果写入 `MediaManager`（type: "audio"）

---

## 4. 各步骤依赖关系

```
第一步（中文化）
    │
    ├── 第二步（文生视频），不依赖第一步，可并行
    │      │
    │      └── 依赖：FAL_KEY 环境变量
    │
    ├── 第三步（擦除+抠像），不依赖前面，可并行
    │      │
    │      └── 依赖：@fal-ai/client（第二步会安装）
    │
    ├── 第四步（字幕完善），独立，任何时候做
    │
    └── 第五步（AI 音乐），不依赖前面，可并行

推荐执行顺序：第一步 → 第二步 → 第五步 → 第三步 → 第四步
                  (先给UI中文 再快赢文生视频 再音频 再抠像 最后字幕)
```

---

## 5. 完成后的功能对比

| AI 能力 | 剪映 | 实施前 | 实施后 |
|------|:--:|:--:|:--:|
| 文生视频 | ✅ | ❌ | ✅ Seedance 2.0 |
| 图生视频 | ✅ | ❌ | ✅ Seedance 2.0 I2V |
| 文生图 | ✅ | ❌ | ⚠️ 可扩展 |
| 智能字幕 | ✅ | ⚠️ 待验证 | ✅ Whisper |
| AI 配音 (TTS) | ✅ | ❌ | ⚠️ 待扩展 |
| 智能抠像 | ✅ VIP | ❌ | ✅ RemoveBG API |
| AI 消除 | ✅ VIP | ❌ | ✅ Inpainting API |
| AI 扩图 | ✅ VIP | ❌ | ⚠️ Outpainting API |
| 超清修复 | ✅ VIP | ❌ | ❌（浏览器不可行） |
| AI 音乐 | ✅ | ❌ | ✅ MusicGen API |
| 中文界面 | ✅ | ❌ | ✅ 第一步完成后 |

**覆盖度**：0% → 约 70%（10 项中覆盖 7 项，超清修复因技术限制无法集成）
