"use client";

import { useState } from "react";
import { PanelView } from "./base-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { zh } from "@/locale/zh";
import { generateAudio } from "@/services/ai-audio";
import type { AudioGenMode } from "@/services/ai-audio";

const DURATIONS = [5, 10, 15, 20, 30] as const;

export function AIAudioView() {
  const editor = useEditor();
  const activeProject = useEditor((e) => e.project.getActive());

  const [mode, setMode] = useState<AudioGenMode>("music");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(10);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error(zh["ai_audio.no_prompt"]);
      return;
    }
    if (!activeProject) {
      toast.error(zh["ai_audio.no_project"]);
      return;
    }

    setIsProcessing(true);
    setProgress("");

    try {
      const result = await generateAudio({
        prompt: prompt.trim(),
        mode,
        duration,
        onProgress: (msg) => setProgress(msg),
      });

      if (!result.success) {
        toast.error(zh["ai_audio.failed"], {
          description: result.error,
        });
        return;
      }

      const file = result.file!;
      const url = URL.createObjectURL(file);

      await editor.media.addMediaAsset({
        projectId: activeProject.metadata.id,
        asset: {
          name: file.name,
          file,
          type: "audio",
          url,
        },
      });

      toast.success(zh["ai_audio.success"]);
      setPrompt("");
    } catch (error) {
      console.error("音频生成失败:", error);
      toast.error(zh["ai_audio.failed"], {
        description: error instanceof Error ? error.message : zh["toast.please_try_again"],
      });
    } finally {
      setIsProcessing(false);
      setProgress("");
    }
  };

  const selectClasses =
    "h-9 w-full rounded-md border bg-background px-3 text-sm";

  return (
    <PanelView title={zh["ai_audio.title"]}>
      <div className="flex flex-col gap-4 p-3">
        {/* 模式切换 */}
        <div className="flex gap-1 rounded-md bg-muted p-1">
          <button
            type="button"
            className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "music"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("music")}
            disabled={isProcessing}
          >
            {zh["ai_audio.music"]}
          </button>
          <button
            type="button"
            className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "soundfx"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("soundfx")}
            disabled={isProcessing}
          >
            {zh["ai_audio.soundfx"]}
          </button>
        </div>

        <p className="text-muted-foreground text-xs">
          {mode === "music" ? zh["ai_audio.music_desc"] : zh["ai_audio.soundfx_desc"]}
        </p>

        {/* Prompt */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-audio-prompt">{zh["ai_audio.prompt_label"]}</Label>
          <textarea
            id="ai-audio-prompt"
            className="min-h-[100px] w-full rounded-md border bg-background px-3 py-2 text-sm resize-y"
            placeholder={zh["ai_audio.prompt_placeholder"]}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            disabled={isProcessing}
          />
        </div>

        {/* 时长 */}
        <div className="flex flex-col gap-1.5">
          <Label>{zh["ai_audio.duration"]}</Label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={selectClasses}
            disabled={isProcessing}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} 秒
              </option>
            ))}
          </select>
        </div>

        {/* 生成按钮 */}
        <Button
          onClick={handleGenerate}
          disabled={isProcessing || !prompt.trim()}
          className="w-full"
        >
          {isProcessing
            ? progress || zh["ai_audio.processing"]
            : zh["ai_audio.generate"]}
        </Button>

        <p className="text-muted-foreground text-xs leading-relaxed">
          {zh["ai_audio.hint"]}
        </p>
      </div>
    </PanelView>
  );
}
