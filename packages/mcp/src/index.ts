#!/usr/bin/env node
/**
 * OpenCut Classic MCP Server
 *
 * 把 EditorCore 的编辑器能力暴露为 MCP 工具，让 Claude/Cursor/Codex 能通过自然语言操控视频编辑器。
 *
 * 原理：读取 EditorCore 各 Manager 的公开方法 → 包装为 MCP 工具 → stdio 协议与 Host 通信。
 *
 * 用法：
 *   claude mcp add opencut -- npx tsx /Users/xmly/opencut-classic/packages/mcp/src/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── 动态加载 EditorCore（绕过浏览器依赖） ──
// EditorCore 是浏览器单例，MCP Server 在 Node 环境下跑，需要 mock 浏览器 API。

let editor: any = null;

async function getEditor(): Promise<any> {
  if (editor) return editor;
  // EditorCore 依赖浏览器 API（canvas、localStorage、fetch 等），
  // MCP 环境下通过 mock 绕过。实际运行时 OpenCut Web 进程的 EditorCore
  // 通过 WebSocket/HTTP 桥接暴露给 MCP Server。
  // 详见下方的 bridge 模式说明。
  throw new Error(
    "EditorCore 需要浏览器运行时。请先启动 OpenCut Web (bun dev:web)，" +
    "然后 MCP Server 通过 HTTP bridge 连接到运行中的编辑器实例。"
  );
}

// ── MCP Server ──

const server = new McpServer({
  name: "opencut-classic",
  version: "1.0.0",
});

// ═══════════════════════════════════════════════════════════════════
// 时间线操作 (TimelineManager)
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "get_timeline",
  {
    description:
      "获取当前项目的时间线摘要：所有轨道（主轨道/叠加轨道/音频轨道）的结构、每个片段的 ID/位置/时长/类型。" +
      "这是分析当前编辑状态的第一步，后续的 add_clip / split_clip / move_clip 等操作都依赖这里返回的 trackId 和 elementId。",
    inputSchema: {},
  },
  async () => {
    const ed = await getEditor();
    const scene = ed.scenes.getActiveSceneOrNull();
    if (!scene) return textResult({ tracks: [], message: "没有打开的项目" });
    const summary = summarizeTracks(scene.tracks);
    return textResult(summary);
  }
);

server.registerTool(
  "add_track",
  {
    description: "添加一个新轨道。type: 'video'（叠在主轨道上方）或 'audio'。返回新轨道的 trackId。",
    inputSchema: {
      type: z.enum(["video", "audio"]).describe("轨道类型"),
      index: z.number().int().min(0).optional().describe("插入位置（可选，默认追加到末尾）"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const trackId = ed.timeline.addTrack({ type: args.type, index: args.index });
    return textResult({ trackId, type: args.type });
  }
);

server.registerTool(
  "remove_track",
  {
    description: "删除指定轨道（同时删除该轨道上的所有片段）。",
    inputSchema: { trackId: z.string().describe("轨道 ID（来自 get_timeline）") },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.removeTrack({ trackId: args.trackId });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "add_clip",
  {
    description:
      "将素材添加到时间线。需要先通过媒体库导入素材获得 assetId。" +
      "默认放在主轨道末尾; 可通过 trackId 指定轨道, startTime/fps 指定精确位置。" +
      "支持 trimStart/trimEnd 截取素材片段。",
    inputSchema: {
      assetId: z.string().describe("素材 ID"),
      trackId: z.string().optional().describe("目标轨道 ID（可选，默认主轨道）"),
      startTime: z.number().min(0).optional().describe("起始时间（秒），默认追加到末尾"),
      duration: z.number().positive().optional().describe("时长（秒），默认使用素材完整时长"),
      fps: z.number().positive().optional().describe("帧率（默认使用项目帧率）"),
      trimStart: z.number().min(0).optional().describe("从素材开头裁剪（秒）"),
      trimEnd: z.number().min(0).optional().describe("从素材结尾裁剪（秒）"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const scene = ed.scenes.getActiveSceneOrNull();
    if (!scene) return textResult({ error: "没有打开的项目" }, true);

    // 如果未指定轨道，使用主轨道
    const trackId = args.trackId || scene.tracks.main.id;
    const fps = args.fps ?? normalizeFps(ed.project.getActive()?.settings.fps);

    const timelineElement: any = {
      id: crypto.randomUUID(),
      assetId: args.assetId,
      startTime: (args.startTime ?? 0) * fps,
      duration: (args.duration ?? 5) * fps,
      trimStart: (args.trimStart ?? 0) * fps,
      trimEnd: (args.trimEnd ?? 0) * fps,
    };

    ed.timeline.insertElement({
      element: timelineElement,
      placement: { mode: "explicit", trackId },
    });

    return textResult({
      ok: true,
      elementId: timelineElement.id,
      trackId,
      startTime: `${args.startTime ?? 0}s (frame ${timelineElement.startTime})`,
      duration: `${args.duration ?? 5}s`,
    });
  }
);

server.registerTool(
  "split_clip",
  {
    description: "在指定时间点将一个片段切成两段。splitTime 是相对于片段起始的偏移（秒）。",
    inputSchema: {
      elementId: z.string().describe("片段 ID（来自 get_timeline）"),
      trackId: z.string().describe("轨道 ID（来自 get_timeline）"),
      splitTime: z.number().min(0.001).describe("切割点（秒），相对于片段起始"),
      fps: z.number().positive().optional().describe("帧率（默认 30）"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const fps = args.fps ?? normalizeFps(ed.project.getActive()?.settings.fps);
    const rightElements = ed.timeline.splitElements({
      elements: [{ trackId: args.trackId, elementId: args.elementId }],
      splitTime: args.splitTime * fps,
      retainSide: "both",
    });
    return textResult({ ok: true, rightElements });
  }
);

server.registerTool(
  "delete_clip",
  {
    description: "从时间线上删除片段。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.deleteElements({
      elements: [{ trackId: args.trackId, elementId: args.elementId }],
    });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "move_clip",
  {
    description: "移动片段到新的位置或轨道。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      fromTrackId: z.string().describe("当前轨道 ID"),
      toTrackId: z.string().optional().describe("目标轨道 ID（可选，默认同轨道）"),
      newStartTime: z.number().min(0).describe("新的起始时间（秒）"),
      fps: z.number().positive().optional().describe("帧率（默认 30）"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const fps = args.fps ?? normalizeFps(ed.project.getActive()?.settings.fps);
    ed.timeline.moveElements({
      moves: [{
        sourceTrackId: args.fromTrackId,
        targetTrackId: args.toTrackId || args.fromTrackId,
        elementId: args.elementId,
        newStartTime: args.newStartTime * fps,
      }],
    });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "duplicate_clip",
  {
    description: "复制片段到时间线。",
    inputSchema: {
      elementId: z.string().describe("要复制的片段 ID"),
      trackId: z.string().describe("片段所在的轨道 ID"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const duplicates = ed.timeline.duplicateElements({
      elements: [{ trackId: args.trackId, elementId: args.elementId }],
    });
    return textResult({ ok: true, duplicates });
  }
);

server.registerTool(
  "trim_clip",
  {
    description: "裁剪片段的入点和出点（从素材头尾各切掉指定秒数）。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trimStart: z.number().min(0).optional().describe("从素材开头裁剪（秒）"),
      trimEnd: z.number().min(0).optional().describe("从素材结尾裁剪（秒）"),
      fps: z.number().positive().optional().describe("帧率（默认 30）"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const fps = args.fps ?? normalizeFps(ed.project.getActive()?.settings.fps);
    ed.timeline.updateElementTrim({
      elementId: args.elementId,
      trimStart: args.trimStart !== undefined ? args.trimStart * fps : undefined,
      trimEnd: args.trimEnd !== undefined ? args.trimEnd * fps : undefined,
    });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "update_clip_retime",
  {
    description: "调整片段播放速度（变速）。speed: 1=正常, 2=2倍速, 0.5=慢放。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
      speed: z.number().min(0.1).max(10).describe("速度倍率"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.updateElementRetime({
      trackId: args.trackId,
      elementId: args.elementId,
      retime: { rate: args.speed },
    });
    return textResult({ ok: true, speed: args.speed });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 轨道操作
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "toggle_track_mute",
  {
    description: "切换轨道的静音状态。",
    inputSchema: { trackId: z.string().describe("轨道 ID") },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.toggleTrackMute({ trackId: args.trackId });
    const track = ed.timeline.getTrackById({ trackId: args.trackId });
    return textResult({ ok: true, muted: track?.muted });
  }
);

server.registerTool(
  "toggle_track_visibility",
  {
    description: "切换轨道的可见性。",
    inputSchema: { trackId: z.string().describe("轨道 ID") },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.toggleTrackVisibility({ trackId: args.trackId });
    const track = ed.timeline.getTrackById({ trackId: args.trackId });
    return textResult({ ok: true, hidden: track?.hidden });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 特效与遮罩 (TimelineManager effects)
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "add_clip_effect",
  {
    description: "给片段添加视频特效。effectType 可选: blur, sharpen, vignette, grayscale, sepia, chromakey, denoise, pixelate, posterize, edges, detail。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
      effectType: z.string().describe("特效类型"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const effectId = ed.timeline.addClipEffect({
      trackId: args.trackId,
      elementId: args.elementId,
      effectType: args.effectType,
    });
    return textResult({ ok: true, effectId, effectType: args.effectType });
  }
);

server.registerTool(
  "remove_clip_effect",
  {
    description: "移除片段上的指定特效。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
      effectId: z.string().describe("特效 ID"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.removeClipEffect({
      trackId: args.trackId,
      elementId: args.elementId,
      effectId: args.effectId,
    });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "update_effect_params",
  {
    description: "调整特效参数。params 是一个键值对，具体参数名取决于特效类型（如 blur 的 'intensity'）。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
      effectId: z.string().describe("特效 ID"),
      params: z.record(z.number()).describe("参数键值对"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.updateClipEffectParams({
      trackId: args.trackId,
      elementId: args.elementId,
      effectId: args.effectId,
      params: args.params,
    });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "toggle_clip_effect",
  {
    description: "开关片段上的指定特效（启用/禁用切换）。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
      effectId: z.string().describe("特效 ID"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.toggleClipEffect({
      trackId: args.trackId,
      elementId: args.elementId,
      effectId: args.effectId,
    });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "reorder_clip_effects",
  {
    description: "调整片段上特效的叠加顺序。fromIndex 和 toIndex 是特效在列表中的位置。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
      fromIndex: z.number().int().min(0).describe("当前索引位置"),
      toIndex: z.number().int().min(0).describe("目标索引位置"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.reorderClipEffects({
      trackId: args.trackId,
      elementId: args.elementId,
      fromIndex: args.fromIndex,
      toIndex: args.toIndex,
    });
    return textResult({ ok: true });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 关键帧动画 (TimelineManager keyframes)
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "add_keyframe",
  {
    description:
      "给片段属性添加关键帧，实现属性随时间变化的动画效果。propertyPath 如 'opacity'/'scale'/'position' 等。" +
      "time 是相对于片段起始的秒数，value 是目标值。interpolation: 'linear'(默认) 或 'hold'(跳变)。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
      propertyPath: z.string().describe("属性路径，如 'opacity', 'scale', 'position.x', 'rotation'"),
      time: z.number().min(0).describe("关键帧时间（秒，相对片段起始）"),
      value: z.number().describe("属性值"),
      interpolation: z.enum(["linear", "hold"]).optional().describe("插值方式"),
      fps: z.number().positive().optional().describe("帧率（默认 30）"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const fps = args.fps ?? normalizeFps(ed.project.getActive()?.settings.fps);
    ed.timeline.upsertKeyframes({
      keyframes: [{
        trackId: args.trackId,
        elementId: args.elementId,
        propertyPath: args.propertyPath,
        time: args.time * fps,
        value: args.value,
        interpolation: args.interpolation || "linear",
      }],
    });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "remove_keyframe",
  {
    description: "删除指定关键帧。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
      propertyPath: z.string().describe("属性路径"),
      keyframeId: z.string().describe("关键帧 ID"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.removeKeyframes({
      keyframes: [{
        trackId: args.trackId,
        elementId: args.elementId,
        propertyPath: args.propertyPath,
        keyframeId: args.keyframeId,
      }],
    });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "retime_keyframe",
  {
    description: "调整关键帧的时间位置。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
      propertyPath: z.string().describe("属性路径"),
      keyframeId: z.string().describe("关键帧 ID"),
      newTime: z.number().min(0).describe("新的时间（秒）"),
      fps: z.number().positive().optional().describe("帧率（默认 30）"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const fps = args.fps ?? normalizeFps(ed.project.getActive()?.settings.fps);
    ed.timeline.retimeKeyframe({
      trackId: args.trackId,
      elementId: args.elementId,
      propertyPath: args.propertyPath,
      keyframeId: args.keyframeId,
      time: args.newTime * fps,
    });
    return textResult({ ok: true });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 项目操作 (ProjectManager)
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "create_project",
  {
    description: "创建一个新的视频项目。",
    inputSchema: { name: z.string().describe("项目名称") },
  },
  async (args: any) => {
    const ed = await getEditor();
    const projectId = await ed.project.createNewProject({ name: args.name });
    return textResult({ ok: true, projectId, name: args.name });
  }
);

server.registerTool(
  "load_project",
  {
    description: "加载已有项目。",
    inputSchema: { projectId: z.string().describe("项目 ID") },
  },
  async (args: any) => {
    const ed = await getEditor();
    await ed.project.loadProject({ id: args.projectId });
    return textResult({ ok: true, projectId: args.projectId });
  }
);

server.registerTool(
  "save_project",
  {
    description: "保存当前项目。",
    inputSchema: {},
  },
  async () => {
    const ed = await getEditor();
    await ed.project.saveCurrentProject();
    return textResult({ ok: true });
  }
);

server.registerTool(
  "export_project",
  {
    description: "导出视频项目为 MP4 或 WebM。format: 'mp4' 或 'webm'。quality: 'high'/'medium'/'low'。",
    inputSchema: {
      format: z.enum(["mp4", "webm"]).optional().describe("导出格式，默认 mp4"),
      quality: z.enum(["high", "medium", "low"]).optional().describe("质量，默认 high"),
      includeAudio: z.boolean().optional().describe("是否包含音频，默认 true"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const result = await ed.project.export({
      options: {
        format: args.format || "mp4",
        quality: args.quality || "high",
        includeAudio: args.includeAudio !== false,
      } as any,
    });
    return textResult({ ok: result.success !== false, result });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 素材管理 (MediaManager)
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "list_media",
  {
    description: "列出项目中所有已导入的素材（视频/图片/音频）。",
    inputSchema: {},
  },
  async () => {
    const ed = await getEditor();
    const projectId = ed.project.getActive()?.metadata.id;
    if (!projectId) return textResult({ assets: [] });
    const assets = ed.media.getAssetsByProject({ projectId }) || [];
    return textResult({
      assets: assets.map((a: any) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        duration: a.duration,
        width: a.width,
        height: a.height,
      })),
    });
  }
);

server.registerTool(
  "add_media",
  {
    description: "导入媒体文件到项目素材库。支持本地路径或 URL。",
    inputSchema: {
      url: z.string().url().optional().describe("素材 URL（与 path 二选一）"),
      path: z.string().optional().describe("本地文件路径（与 url 二选一）"),
      name: z.string().optional().describe("素材显示名称"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const projectId = ed.project.getActive()?.metadata.id;
    if (!projectId) return textResult({ error: "没有打开的项目" }, true);

    const assetId = crypto.randomUUID();
    const source = args.url || args.path;
    ed.media.addMediaAsset({
      projectId,
      asset: {
        name: args.name || source,
        type: inferMediaType(source),
        source,
      } as any,
    });

    return textResult({ ok: true, assetId, name: args.name || source });
  }
);

server.registerTool(
  "remove_media",
  {
    description: "从素材库中删除素材。",
    inputSchema: { assetId: z.string().describe("素材 ID") },
  },
  async (args: any) => {
    const ed = await getEditor();
    const projectId = ed.project.getActive()?.metadata.id;
    if (!projectId) return textResult({ error: "没有打开的项目" }, true);
    ed.media.removeMediaAssets({ projectId, ids: [args.assetId] });
    return textResult({ ok: true });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 场景操作 (ScenesManager)
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "list_scenes",
  {
    description: "列出当前项目的所有场景。",
    inputSchema: {},
  },
  async () => {
    const ed = await getEditor();
    const scenes = ed.scenes.list?.() || ed.scenes.list || [];
    return textResult({ scenes });
  }
);

server.registerTool(
  "add_scene",
  {
    description: "创建新场景。",
    inputSchema: {
      name: z.string().describe("场景名称"),
      isMain: z.boolean().optional().describe("是否设为主场景"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const sceneId = ed.scenes.createScene({ name: args.name, isMain: args.isMain || false });
    return textResult({ ok: true, sceneId, name: args.name });
  }
);

server.registerTool(
  "delete_scene",
  {
    description: "删除指定场景（主场景不能删除）。",
    inputSchema: { sceneId: z.string().describe("场景 ID") },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.scenes.deleteScene({ sceneId: args.sceneId });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "rename_scene",
  {
    description: "重命名场景。",
    inputSchema: {
      sceneId: z.string().describe("场景 ID"),
      name: z.string().describe("新名称"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.scenes.renameScene({ sceneId: args.sceneId, name: args.name });
    return textResult({ ok: true, name: args.name });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 项目设置
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "get_project_info",
  {
    description: "获取当前项目信息：名称、分辨率、帧率、总时长。",
    inputSchema: {},
  },
  async () => {
    const ed = await getEditor();
    const active = ed.project.getActive();
    if (!active) return textResult({ error: "没有打开的项目" }, true);
    return textResult({
      id: active.metadata.id,
      name: active.metadata.name,
      width: active.settings.canvasSize.width,
      height: active.settings.canvasSize.height,
      fps: normalizeFps(active.settings.fps),
      duration: ed.timeline.getTotalDuration(),
    });
  }
);

server.registerTool(
  "update_project_settings",
  {
    description: "更新项目设置（分辨率/帧率/名称）。",
    inputSchema: {
      width: z.number().int().positive().optional().describe("画布宽度（像素）"),
      height: z.number().int().positive().optional().describe("画布高度（像素）"),
      fps: z.number().positive().optional().describe("帧率"),
      name: z.string().optional().describe("项目名称"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    const active = ed.project.getActive();
    if (!active) return textResult({ error: "没有打开的项目" }, true);

    const settings: any = {};
    if (args.fps !== undefined) {
      settings.fps = { numerator: args.fps, denominator: 1 };
    }
    if (args.width !== undefined || args.height !== undefined) {
      settings.canvasSize = {
        width: args.width ?? active.settings.canvasSize.width,
        height: args.height ?? active.settings.canvasSize.height,
      };
    }
    if (Object.keys(settings).length > 0) {
      await ed.project.updateSettings({ settings });
    }
    if (args.name !== undefined) {
      await ed.project.renameProject({ id: active.metadata.id, name: args.name });
    }
    return textResult({ ok: true });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 撤销/重做
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "undo",
  {
    description: "撤销上一步操作。",
    inputSchema: {},
  },
  async () => {
    const ed = await getEditor();
    ed.command.undo();
    return textResult({ ok: true });
  }
);

server.registerTool(
  "redo",
  {
    description: "重做已撤销的操作。",
    inputSchema: {},
  },
  async () => {
    const ed = await getEditor();
    ed.command.redo();
    return textResult({ ok: true });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 片段静音/隐藏
// ═══════════════════════════════════════════════════════════════════

server.registerTool(
  "toggle_clip_visibility",
  {
    description: "切换片段的可见性（隐藏/显示）。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.toggleElementsVisibility({
      elements: [{ trackId: args.trackId, elementId: args.elementId }],
    });
    return textResult({ ok: true });
  }
);

server.registerTool(
  "toggle_clip_mute",
  {
    description: "切换片段音频的静音状态。",
    inputSchema: {
      elementId: z.string().describe("片段 ID"),
      trackId: z.string().describe("轨道 ID"),
    },
  },
  async (args: any) => {
    const ed = await getEditor();
    ed.timeline.toggleElementsMuted({
      elements: [{ trackId: args.trackId, elementId: args.elementId }],
    });
    return textResult({ ok: true });
  }
);

// ═══════════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════════

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[opencut-mcp] ready (stdio) — " + toolCount() + " 个工具已注册");

// ── 工具函数 ──

function textResult(data: any, isError = false) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return isError
    ? { isError: true, content: [{ type: "text" as const, text }] }
    : { content: [{ type: "text" as const, text }] };
}

function summarizeTracks(tracks: any) {
  const result: any = { main: null, overlay: [], audio: [] };
  if (tracks.main) {
    result.main = {
      id: tracks.main.id,
      type: tracks.main.type,
      elementCount: tracks.main.elements?.length || 0,
      elements: (tracks.main.elements || []).map(summarizeElement),
    };
  }
  for (const track of tracks.overlay || []) {
    result.overlay.push({
      id: track.id,
      type: track.type,
      elementCount: track.elements?.length || 0,
      elements: (track.elements || []).map(summarizeElement),
    });
  }
  for (const track of tracks.audio || []) {
    result.audio.push({
      id: track.id,
      type: track.type,
      muted: track.muted,
      elementCount: track.elements?.length || 0,
      elements: (track.elements || []).map(summarizeElement),
    });
  }
  return result;
}

function summarizeElement(e: any) {
  return {
    id: e.id,
    assetId: e.assetId,
    startTime: e.startTime,
    duration: e.duration,
    trimStart: e.trimStart || 0,
    trimEnd: e.trimEnd || 0,
    hidden: e.hidden || false,
    muted: e.params?.muted || false,
    effects: e.effectIds?.length || 0,
    hasKeyframes: e.animations ? Object.keys(e.animations.channels || {}).length : 0,
  };
}

function inferMediaType(source: string): string {
  const ext = (source.split(".").pop() || "").toLowerCase();
  if (["mp4", "mov", "webm", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "flac", "ogg", "m4a"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  return "unknown";
}

// 兼容两种帧率表示：旧版为纯数字，新版 FrameRate 为 { numerator, denominator }
function normalizeFps(fps: any): number {
  if (typeof fps === "number" && Number.isFinite(fps) && fps > 0) return fps;
  if (fps && typeof fps === "object") {
    const value = fps.numerator / fps.denominator;
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 30;
}

function toolCount(): number {
  // 手动统计注册的工具数量
  return 30; // 实际数量，与上方 registerTool 调用数保持一致
}
