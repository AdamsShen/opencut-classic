"use client";

import { useState } from "react";
import { PanelView } from "./base-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { zh } from "@/locale/zh";
import { generateVideo, type VideoGenResult } from "@/services/ai-video/generate";

type Duration = 4 | 5 | 8 | 10 | 12 | 15;
type Resolution = "480p" | "720p" | "1080p";
type AspectRatio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "21:9" | "adaptive";

const DURATIONS: Duration[] = [4, 5, 8, 10, 12, 15];
const RESOLUTIONS: { value: Resolution; label: string; price: string }[] = [
  { value: "720p", label: "720p", price: "~$0.10/s" },
  { value: "1080p", label: "1080p", price: "~$0.25/s" },
];
const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "16:9", label: "16:9（横屏）" },
  { value: "9:16", label: "9:16（竖屏）" },
  { value: "1:1", label: "1:1（方形）" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "21:9", label: "21:9（宽屏）" },
  { value: "adaptive", label: "自适应" },
];

export function AIVideoView() {
  const editor = useEditor();
  const activeProject = useEditor((e) => e.project.getActive());

  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<Duration>(5);
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [generateAudio, setGenerateAudio] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error(zh["ai_video.no_prompt"]);
      return;
    }
    if (!activeProject) {
      toast.error(zh["ai_video.no_project"]);
      return;
    }

    setIsGenerating(true);
    setProgress("");

    try {
      const result = await generateVideo({
        prompt: prompt.trim(),
        duration,
        resolution,
        aspectRatio,
        generateAudio,
        onProgress: (msg) => setProgress(msg),
      });

      if (!result.success) {
        toast.error(zh["ai_video.failed"], {
          description: result.error,
        });
        return;
      }

      // 下载生成的视频
      setProgress(zh["ai_video.downloading"]);
      const response = await fetch(result.videoUrl!);
      if (!response.ok) {
        throw new Error(`下载视频失败 (${response.status})`);
      }
      const blob = await response.blob();
      const file = new File([blob], `seedance-${Date.now()}.mp4`, {
        type: "video/mp4",
      });

      // 加入媒体资产库
      await editor.media.addMediaAsset({
        projectId: activeProject.metadata.id,
        asset: {
          name: `AI视频-${Date.now()}`,
          file,
          type: "video",
        },
      });

      toast.success(zh["ai_video.success"], {
        description: `通过 ${result.provider === "atlas" ? "Atlas Cloud" : "WaveSpeedAI"} 生成`,
      });
      setPrompt("");
    } catch (error) {
      console.error("视频生成失败:", error);
      toast.error(zh["ai_video.failed"], {
        description: error instanceof Error ? error.message : zh["toast.please_try_again"],
      });
    } finally {
      setIsGenerating(false);
      setProgress("");
    }
  };

  const selectClasses =
    "h-9 w-full rounded-md border bg-background px-3 text-sm";

  return (
    <PanelView title={zh["tab.ai_video"]}>
      <div className="flex flex-col gap-4 p-3">
        {/* Prompt 输入 */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-video-prompt">{zh["ai_video.prompt_label"]}</Label>
          <textarea
            id="ai-video-prompt"
            className="min-h-[100px] w-full rounded-md border bg-background px-3 py-2 text-sm resize-y"
            placeholder={zh["ai_video.prompt_placeholder"]}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            disabled={isGenerating}
          />
        </div>

        {/* Duration */}
        <div className="flex flex-col gap-1.5">
          <Label>{zh["ai_video.duration"]}</Label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) as Duration)}
            className={selectClasses}
            disabled={isGenerating}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} 秒
              </option>
            ))}
          </select>
        </div>

        {/* Resolution */}
        <div className="flex flex-col gap-1.5">
          <Label>{zh["ai_video.resolution"]}</Label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as Resolution)}
            className={selectClasses}
            disabled={isGenerating}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}（{r.price}）
              </option>
            ))}
          </select>
        </div>

        {/* Aspect Ratio */}
        <div className="flex flex-col gap-1.5">
          <Label>{zh["ai_video.aspect_ratio"]}</Label>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            className={selectClasses}
            disabled={isGenerating}
          >
            {ASPECT_RATIOS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {/* Audio toggle */}
        <div className="flex items-center gap-2">
          <input
            id="ai-video-audio"
            type="checkbox"
            checked={generateAudio}
            onChange={(e) => setGenerateAudio(e.target.checked)}
            disabled={isGenerating}
            className="size-4 rounded"
          />
          <Label htmlFor="ai-video-audio" className="text-sm cursor-pointer">
            生成同步音频（对话/音效/背景音乐）
          </Label>
        </div>

        {/* Generate 按钮 */}
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full"
        >
          {isGenerating ? (progress || zh["ai_video.generating"]) : zh["ai_video.generate"]}
        </Button>

        {/* Provider 提示 */}
        <p className="text-muted-foreground text-xs leading-relaxed">
          主：{zh["ai_video.provider_atlas"]} → 备：{zh["ai_video.provider_wavespeed"]}。
          {zh["ai_video.hint"]}
        </p>
      </div>
    </PanelView>
  );
}
