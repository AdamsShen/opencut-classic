/**
 * 工具定义 — 从 EditorCore 的 Manager 方法映射而来
 *
 * 33 个工具，覆盖 OpenCut Classic 的完整编辑能力。
 * 关键：所有工具的入参 fieldName 与 get_timeline 返回值完全一致，
 * AI 直接复制返回的字段值到工具调用即可，无需猜测映射。
 *
 * get_timeline 返回格式：
 * {
 *   main: { id, type, elements: [{ id, assetId, startTime, duration, ... }] },
 *   overlay: [{ id, type, elements: [...] }],
 *   audio: [{ id, type, elements: [...], muted }]
 * }
 */

import { EditorCore } from "@/core";
import type { ToolDefinition } from "./types";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ═══ 时间线查询 ═══
  {
    type: "function",
    function: {
      name: "get_timeline",
      description: "获取当前项目完整时间线。返回 main/overlay/audio 三维数组。每个片段字段: id(操作必用), assetId, startTime(帧), duration(帧), trimStart, trimEnd, hidden, muted, effectCount, keyframeCount。所有后续操作都需要这里的 id。",
      parameters: { type: "object", properties: {} },
    },
  },

  // ═══ 轨道操作 ═══
  makeFn("add_track", "添加新轨道。type: 'video'(叠加)或'audio'(音频)。返回新 trackId。",
    { type: { type: "string", desc: "video 或 audio" }, index: { type: "number", desc: "插入位置(可选)" } },
    ["type"]),
  makeFn("remove_track", "删除轨道及上面的所有片段。",
    { id: { type: "string", desc: "轨道ID,来自get_timeline返回的track.id" } }, ["id"]),
  makeFn("toggle_track_mute", "切换轨道静音状态。",
    { id: { type: "string", desc: "轨道ID" } }, ["id"]),
  makeFn("toggle_track_visibility", "切换轨道可见性。",
    { id: { type: "string", desc: "轨道ID" } }, ["id"]),

  // ═══ 片段操作 ═══
  makeFn("delete_clip", "从时间线删除片段。id 直接使用 get_timeline 返回的 element.id。",
    { id: { type: "string", desc: "片段ID (就是 get_timeline 返回的 element.id)" } }, ["id"]),
  makeFn("duplicate_clip", "复制片段。",
    { id: { type: "string", desc: "片段ID" } }, ["id"]),
  makeFn("toggle_clip_visibility", "切换片段可见性(隐藏/显示)。",
    { id: { type: "string", desc: "片段ID" } }, ["id"]),
  makeFn("toggle_clip_mute", "切换片段音频静音。",
    { id: { type: "string", desc: "片段ID" } }, ["id"]),

  makeFn("split_clip", "在指定时间点将片段切成两段。splitTime 是相对于片段起始的秒数。",
    {
      id: { type: "string", desc: "片段ID" },
      splitTime: { type: "number", desc: "切割点(秒),相对片段起始" },
    }, ["id", "splitTime"]),

  makeFn("trim_clip", "裁剪片段入点和出点(从素材头尾切掉指定秒数)。",
    {
      id: { type: "string", desc: "片段ID" },
      trimStart: { type: "number", desc: "从开头裁剪(秒)" },
      trimEnd: { type: "number", desc: "从结尾裁剪(秒)" },
    }, ["id"]),

  makeFn("move_clip", "移动片段到新的时间位置。newStartTime 为秒数。",
    {
      id: { type: "string", desc: "片段ID" },
      newStartTime: { type: "number", desc: "新起始时间(秒)" },
    }, ["id", "newStartTime"]),

  makeFn("update_clip_retime", "调整片段播放速度。1=正常, 2=2倍速, 0.5=慢放。",
    { id: { type: "string", desc: "片段ID" }, speed: { type: "number", desc: "速度(0.1~10)" } }, ["id", "speed"]),

  makeFn("add_clip", "将素材添加到时间线。需要先用 add_media 导入素材。startTime/duration/trimStart/trimEnd 都为秒。",
    {
      assetId: { type: "string", desc: "素材ID" },
      startTime: { type: "number", desc: "起始时间(秒,可选,默认追加)" },
      duration: { type: "number", desc: "时长(秒,可选)" },
      trimStart: { type: "number", desc: "从素材开头裁剪(秒,可选)" },
      trimEnd: { type: "number", desc: "从素材结尾裁剪(秒,可选)" },
    }, ["assetId"]),

  // ═══ 特效 ═══
  makeFn("add_clip_effect", "给片段添加视频特效。effectType: blur/sharpen/vignette/grayscale/sepia/chromakey/denoise/pixelate/posterize/edges/detail。返回 effectId。",
    { id: { type: "string", desc: "片段ID" }, effectType: { type: "string", desc: "特效类型" } }, ["id", "effectType"]),
  makeFn("remove_clip_effect", "移除片段上的指定特效。",
    { id: { type: "string", desc: "片段ID" }, effectId: { type: "string", desc: "特效ID" } }, ["id", "effectId"]),
  makeFn("update_effect_params", "调整特效参数。",
    { id: { type: "string", desc: "片段ID" }, effectId: { type: "string", desc: "特效ID" }, params: { type: "object", desc: "键值对" } }, ["id", "effectId", "params"]),
  makeFn("toggle_clip_effect", "开关片段上的特效。",
    { id: { type: "string", desc: "片段ID" }, effectId: { type: "string", desc: "特效ID" } }, ["id", "effectId"]),
  makeFn("reorder_clip_effects", "调整特效叠加顺序。",
    { id: { type: "string", desc: "片段ID" }, fromIndex: { type: "number", desc: "" }, toIndex: { type: "number", desc: "" } }, ["id", "fromIndex", "toIndex"]),

  // ═══ 关键帧 ═══
  makeFn("add_keyframe", "给片段属性添加关键帧。propertyPath: opacity/scale/rotation/position.x/position.y。time 为秒数。interpolation: linear/hold。",
    {
      id: { type: "string", desc: "片段ID" },
      propertyPath: { type: "string", desc: "属性路径" },
      time: { type: "number", desc: "时间(秒)" },
      value: { type: "number", desc: "属性值" },
      interpolation: { type: "string", desc: "linear 或 hold" },
    }, ["id", "propertyPath", "time", "value"]),
  makeFn("remove_keyframe", "删除指定关键帧。",
    { id: { type: "string", desc: "片段ID" }, propertyPath: { type: "string", desc: "" }, keyframeId: { type: "string", desc: "" } }, ["id", "propertyPath", "keyframeId"]),
  makeFn("retime_keyframe", "调整关键帧时间。",
    { id: { type: "string", desc: "片段ID" }, propertyPath: { type: "string", desc: "" }, keyframeId: { type: "string", desc: "" }, newTime: { type: "number", desc: "新时间(秒)" } }, ["id", "propertyPath", "keyframeId", "newTime"]),

  // ═══ 项目 ═══
  makeFn("create_project", "创建新视频项目。", { name: { type: "string", desc: "项目名" } }, ["name"]),
  makeFn("load_project", "加载已有项目。", { projectId: { type: "string", desc: "项目ID" } }, ["projectId"]),
  makeFn("save_project", "保存当前项目。", {}),
  makeFn("export_project", "导出视频。format: mp4/webm, quality: high/medium/low。",
    { format: { type: "string", desc: "mp4 或 webm" }, quality: { type: "string", desc: "high/medium/low" }, includeAudio: { type: "boolean", desc: "含音频?" } }),
  makeFn("get_project_info", "获取当前项目信息: 名称/分辨率/帧率/总时长。", {}),
  makeFn("update_project_settings", "更新项目设置。",
    { width: { type: "number", desc: "" }, height: { type: "number", desc: "" }, fps: { type: "number", desc: "" }, name: { type: "string", desc: "" } }),

  // ═══ 素材 ═══
  makeFn("list_media", "列出项目中所有已导入的素材(视频/图片/音频)。返回每个素材的 id/name/type。", {}),
  makeFn("add_media", "导入媒体文件到素材库。url 和 path 二选一。返回 assetId。",
    { url: { type: "string", desc: "素材URL" }, path: { type: "string", desc: "本地文件路径" }, name: { type: "string", desc: "名称" } }),
  makeFn("remove_media", "从素材库删除素材。", { assetId: { type: "string", desc: "素材ID" } }, ["assetId"]),

  // ═══ 编辑控制 ═══
  makeFn("undo", "撤销上一步操作。", {}),
  makeFn("redo", "重做已撤销的操作。", {}),
];

// ── 辅助函数 ──

function makeFn(
  name: string,
  description: string,
  props: Record<string, { type: string; desc: string }>,
  required: string[] = [],
): ToolDefinition {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const [k, v] of Object.entries(props)) {
    properties[k] = { type: v.type, description: v.desc };
  }
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, ...(required.length > 0 ? { required } : {}) },
    },
  };
}

// ════════════════════════════════════════════════════════════
// 工具执行器
// ════════════════════════════════════════════════════════════

const fps = 30; // OpenCut 默认帧率

export function executeTool(name: string, args: Record<string, unknown>): unknown {
  const editor = EditorCore.getInstance();
  const id = args.id as string; // 统一用 id，替代之前的 elementId

  switch (name) {
    // ── 时间线 ──
    case "get_timeline": {
      const scene = editor.scenes.getActiveSceneOrNull();
      if (!scene) return { tracks: [] };
      const t = scene.tracks;
      return {
        main: { id: t.main.id, type: t.main.type, elements: t.main.elements.map(se) },
        overlay: t.overlay.map((tr: any) => ({ id: tr.id, type: tr.type, elements: tr.elements.map(se) })),
        audio: t.audio.map((tr: any) => ({ id: tr.id, type: tr.type, muted: tr.muted, elements: tr.elements.map(se) })),
      };
    }

    // ── 片段操作 ──
    case "add_track":
      return { trackId: editor.timeline.addTrack({ type: args.type as any, index: args.index as number }) };

    case "remove_track":
      editor.timeline.removeTrack({ trackId: id });
      return { ok: true };

    case "toggle_track_mute":
      editor.timeline.toggleTrackMute({ trackId: id });
      return { ok: true };

    case "toggle_track_visibility":
      editor.timeline.toggleTrackVisibility({ trackId: id });
      return { ok: true };

    case "delete_clip": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id} 所在的轨道` };
      editor.timeline.deleteElements({ elements: [{ trackId: tid, elementId: id }] });
      return { ok: true, deleted: id };
    }

    case "duplicate_clip": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      return { ok: true, duplicates: editor.timeline.duplicateElements({ elements: [{ trackId: tid, elementId: id }] }) };
    }

    case "toggle_clip_visibility": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.toggleElementsVisibility({ elements: [{ trackId: tid, elementId: id }] });
      return { ok: true };
    }

    case "toggle_clip_mute": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.toggleElementsMuted({ elements: [{ trackId: tid, elementId: id }] });
      return { ok: true };
    }

    case "split_clip": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      const right = editor.timeline.splitElements({
        elements: [{ trackId: tid, elementId: id }],
        splitTime: (args.splitTime as number) * fps,
      });
      return { ok: true, rightElements: right };
    }

    case "trim_clip": {
      editor.timeline.updateElementTrim({
        elementId: id,
        trimStart: args.trimStart !== undefined ? (args.trimStart as number) * fps : undefined,
        trimEnd: args.trimEnd !== undefined ? (args.trimEnd as number) * fps : undefined,
      });
      return { ok: true };
    }

    case "move_clip": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.moveElements({
        moves: [{ trackId: tid, elementId: id, newStartTime: (args.newStartTime as number) * fps }],
      });
      return { ok: true };
    }

    case "update_clip_retime": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.updateElementRetime({ trackId: tid, elementId: id, retime: { speed: args.speed as number } });
      return { ok: true };
    }

    case "add_clip": {
      const scene = editor.scenes.getActiveSceneOrNull();
      if (!scene) return { error: "没有打开的项目" };
      const element: any = {
        id: crypto.randomUUID(),
        assetId: args.assetId,
        startTime: ((args.startTime as number) ?? 0) * fps,
        duration: ((args.duration as number) ?? 5) * fps,
        trimStart: ((args.trimStart as number) ?? 0) * fps,
        trimEnd: ((args.trimEnd as number) ?? 0) * fps,
      };
      editor.timeline.insertElement({ element, placement: { trackId: scene.tracks.main.id, time: element.startTime } });
      return { ok: true, id: element.id };
    }

    // ── 特效 ──
    case "add_clip_effect": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      return { ok: true, effectId: editor.timeline.addClipEffect({ trackId: tid, elementId: id, effectType: args.effectType as string }) };
    }

    case "remove_clip_effect": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.removeClipEffect({ trackId: tid, elementId: id, effectId: args.effectId as string });
      return { ok: true };
    }

    case "update_effect_params": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.updateClipEffectParams({ trackId: tid, elementId: id, effectId: args.effectId as string, params: (args.params as any) || {} });
      return { ok: true };
    }

    case "toggle_clip_effect": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.toggleClipEffect({ trackId: tid, elementId: id, effectId: args.effectId as string });
      return { ok: true };
    }

    case "reorder_clip_effects": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.reorderClipEffects({ trackId: tid, elementId: id, fromIndex: args.fromIndex as number, toIndex: args.toIndex as number });
      return { ok: true };
    }

    // ── 关键帧 ──
    case "add_keyframe": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.upsertKeyframes({
        keyframes: [{ trackId: tid, elementId: id, propertyPath: args.propertyPath as string, time: (args.time as number) * fps, value: args.value as number, interpolation: (args.interpolation as any) || "linear" }],
      });
      return { ok: true };
    }

    case "remove_keyframe": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.removeKeyframes({
        keyframes: [{ trackId: tid, elementId: id, propertyPath: args.propertyPath as string, keyframeId: args.keyframeId as string }],
      });
      return { ok: true };
    }

    case "retime_keyframe": {
      const tid = findTrack(editor, id);
      if (!tid) return { error: `未找到片段 ${id}` };
      editor.timeline.retimeKeyframe({ trackId: tid, elementId: id, propertyPath: args.propertyPath as string, keyframeId: args.keyframeId as string, time: (args.newTime as number) * fps });
      return { ok: true };
    }

    // ── 项目 ──
    case "create_project": return editor.project.createNewProject({ name: args.name as string });
    case "load_project": editor.project.loadProject({ id: args.projectId as string }); return { ok: true };
    case "save_project": editor.project.saveCurrentProject(); return { ok: true };
    case "export_project": return editor.project.export({ options: args as any });

    case "get_project_info": {
      const a = editor.project.getActive();
      if (!a) return { error: "没有打开的项目" };
      return { id: a.id, name: a.metadata?.name, width: a.settings?.width, height: a.settings?.height, fps: a.settings?.fps };
    }

    case "update_project_settings":
      editor.project.updateProjectSettings({ settings: args });
      return { ok: true };

    // ── 素材 ──
    case "list_media": {
      const a = editor.project.getActive();
      if (!a) return { assets: [] };
      const assets = (editor.media as any).getAssetsByProject?.({ projectId: a.id }) || [];
      return { assets: assets.map((x: any) => ({ id: x.id, name: x.name, type: x.type })) };
    }

    case "add_media": {
      const a = editor.project.getActive();
      if (!a) return { error: "没有打开的项目" };
      const src = (args.url || args.path) as string;
      const id = crypto.randomUUID();
      const ext = (src.split(".").pop() || "").toLowerCase();
      const type = ["mp4","mov","webm"].includes(ext) ? "video" : ["mp3","wav","aac","flac","m4a"].includes(ext) ? "audio" : "image";
      (editor.media as any).addMediaAsset?.({ projectId: a.id, asset: { name: (args.name as string) || src, type, source: src } as any });
      return { ok: true, assetId: id, type };
    }

    case "remove_media": {
      const a = editor.project.getActive();
      if (!a) return { error: "没有打开的项目" };
      (editor.media as any).removeMediaAssets?.({ projectId: a.id, ids: [args.assetId] });
      return { ok: true };
    }

    case "undo": editor.command.undo(); return { ok: true };
    case "redo": editor.command.redo(); return { ok: true };
    default: return { error: `未知工具: ${name}` };
  }
}

// ── 辅助 ──

function se(e: any) {
  return {
    id: e.id, assetId: e.assetId, startTime: e.startTime, duration: e.duration,
    trimStart: e.trimStart || 0, trimEnd: e.trimEnd || 0,
    hidden: e.hidden || false, muted: e.params?.muted || false,
    effectCount: e.effectIds?.length || 0,
    keyframeCount: e.animations ? Object.keys(e.animations.channels || {}).length : 0,
  };
}

function findTrack(editor: EditorCore, elementId: string): string | null {
  const scene = editor.scenes.getActiveSceneOrNull();
  if (!scene) return null;
  const { tracks } = scene as any;
  // 搜 main
  if (tracks.main?.elements?.some((e: any) => e.id === elementId)) return tracks.main.id;
  // 搜 overlay
  for (const t of tracks.overlay || []) {
    if (t.elements?.some((e: any) => e.id === elementId)) return t.id;
  }
  // 搜 audio
  for (const t of tracks.audio || []) {
    if (t.elements?.some((e: any) => e.id === elementId)) return t.id;
  }
  return null;
}
