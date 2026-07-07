"use client";

import { useState } from "react";
import { PanelView } from "./base-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { zh } from "@/locale/zh";
import { generateImage } from "@/services/ai-image/generate";

interface SizeOption {
  value: string;
  label: string;
  width: number;
  height: number;
}

const SIZE_OPTIONS: SizeOption[] = [
  { value: "1024x1024", label: zh["ai_image.square"], width: 1024, height: 1024 },
  { value: "1344x768", label: zh["ai_image.landscape_16_9"], width: 1344, height: 768 },
  { value: "768x1344", label: zh["ai_image.portrait_9_16"], width: 768, height: 1344 },
  { value: "1216x832", label: zh["ai_image.landscape_3_2"], width: 1216, height: 832 },
];

const PROVIDER_LABELS: Record<string, string> = {
  atlas: "Atlas Cloud",
  wavespeed: "WaveSpeedAI",
  fal: "fal.ai",
};

export function AIImageView() {
  const editor = useEditor();
  const activeProject = useEditor((e) => e.project.getActive());

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [numImages, setNumImages] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const selectedSize = SIZE_OPTIONS.find((s) => s.value === size) || SIZE_OPTIONS[0];

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error(zh["ai_image.no_prompt"]);
      return;
    }
    if (!activeProject) {
      toast.error(zh["ai_image.no_project"]);
      return;
    }

    setIsGenerating(true);
    setProgress("");
    setPreviewUrls([]);

    try {
      const result = await generateImage({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        width: selectedSize.width,
        height: selectedSize.height,
        numImages,
        onProgress: (msg) => setProgress(msg),
      });

      if (!result.success) {
        toast.error(zh["ai_image.failed"], {
          description: result.error,
        });
        return;
      }

      // 逐个下载并加入素材库
      const urls: string[] = [];
      for (const image of result.images!) {
        setProgress(`下载图片 ${urls.length + 1}/${result.images!.length}...`);

        const response = await fetch(image.url);
        if (!response.ok) {
          console.warn(`下载图片失败: ${image.url} (${response.status})`);
          continue;
        }
        const blob = await response.blob();
        const ext = blob.type === "image/png" ? "png" : "jpg";
        const file = new File(
          [blob],
          `ai-image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`,
          { type: blob.type },
        );

        await editor.media.addMediaAsset({
          projectId: activeProject.metadata.id,
          asset: {
            name: `AI图片-${Date.now()}-${urls.length + 1}`,
            file,
            type: "image",
          },
        });

        urls.push(image.url);
      }

      setPreviewUrls(urls);

      toast.success(
        zh["ai_image.success"].replace("{count}", String(urls.length)),
        {
          description: `通过 ${PROVIDER_LABELS[result.provider] || result.provider} 生成`,
        },
      );

      // 不清空 prompt，方便用户迭代
    } catch (error) {
      console.error("图片生成失败:", error);
      toast.error(zh["ai_image.failed"], {
        description:
          error instanceof Error ? error.message : zh["toast.please_try_again"],
      });
    } finally {
      setIsGenerating(false);
      setProgress("");
    }
  };

  const selectClasses =
    "h-9 w-full rounded-md border bg-background px-3 text-sm";

  return (
    <PanelView title={zh["ai_image.title"]}>
      <div className="flex flex-col gap-4 p-3">
        {/* Prompt 输入 */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-image-prompt">{zh["ai_image.prompt_label"]}</Label>
          <textarea
            id="ai-image-prompt"
            className="min-h-[100px] w-full rounded-md border bg-background px-3 py-2 text-sm resize-y"
            placeholder={zh["ai_image.prompt_placeholder"]}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            disabled={isGenerating}
          />
        </div>

        {/* 负向 Prompt */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-image-neg-prompt">
            {zh["ai_image.negative_prompt_label"]}{" "}
            <span className="text-muted-foreground font-normal">
              {zh["ai_image.negative_prompt_optional"]}
            </span>
          </Label>
          <textarea
            id="ai-image-neg-prompt"
            className="min-h-[56px] w-full rounded-md border bg-background px-3 py-2 text-sm resize-y"
            placeholder={zh["ai_image.negative_prompt_placeholder"]}
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            rows={2}
            disabled={isGenerating}
          />
        </div>

        {/* 画面比例 */}
        <div className="flex flex-col gap-1.5">
          <Label>{zh["ai_image.aspect_ratio"]}</Label>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className={selectClasses}
            disabled={isGenerating}
          >
            {SIZE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* 生成数量 */}
        <div className="flex flex-col gap-1.5">
          <Label>{zh["ai_image.num_images"]}</Label>
          <select
            value={numImages}
            onChange={(e) => setNumImages(Number(e.target.value))}
            className={selectClasses}
            disabled={isGenerating}
          >
            <option value={1}>1 张</option>
            <option value={2}>2 张</option>
            <option value={4}>4 张</option>
          </select>
        </div>

        {/* 生成按钮 */}
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full"
        >
          {isGenerating ? (progress || zh["ai_image.generating"]) : zh["ai_image.generate"]}
        </Button>

        {/* 生成预览 */}
        {previewUrls.length > 0 && (
          <div
            className={`grid gap-2 mt-2 ${
              previewUrls.length <= 2 ? "grid-cols-2" : "grid-cols-2"
            }`}
          >
            {previewUrls.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`生成图片 ${idx + 1}`}
                className="rounded-md border object-cover aspect-square"
              />
            ))}
          </div>
        )}

        {/* 提示信息 */}
        <p className="text-muted-foreground text-xs leading-relaxed">
          {zh["ai_image.hint"]}
        </p>
      </div>
    </PanelView>
  );
}
