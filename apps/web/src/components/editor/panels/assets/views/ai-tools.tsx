"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { PanelView } from "./base-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { zh } from "@/locale/zh";
import { removeBackground, inpaintErase } from "@/services/ai-tools";

type ToolMode = "remove-bg" | "inpaint";

const BRUSH_SIZES = [8, 16, 24, 40] as const;
const MASK_COLOR = "rgba(255, 0, 0, 0.5)";

export function AIToolsView() {
  const editor = useEditor();
  const activeProject = useEditor((e) => e.project.getActive());
  const mediaAssets = useEditor((e) => e.media.getAssets());

  const imageAssets = useMemo(
    () => mediaAssets.filter((a) => a.type === "image" && !a.ephemeral),
    [mediaAssets],
  );

  const [mode, setMode] = useState<ToolMode>("remove-bg");
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [erasePrompt, setErasePrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");

  // Canvas 涂鸦状态
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null); // 离屏遮罩画布
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState<number>(16);
  const [hasMask, setHasMask] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const selectedAsset = useMemo(
    () => imageAssets.find((a) => a.id === selectedAssetId) || null,
    [imageAssets, selectedAssetId],
  );

  // 加载图片到 Canvas
  useEffect(() => {
    if (mode !== "inpaint" || !selectedAsset?.url) return;
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !maskCanvas) return;

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;

      // 计算显示尺寸（限制宽度）
      const maxW = 320;
      const scale = Math.min(1, maxW / img.naturalWidth);
      const displayW = Math.round(img.naturalWidth * scale);
      const displayH = Math.round(img.naturalHeight * scale);

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.style.width = `${displayW}px`;
      canvas.style.height = `${displayH}px`;

      maskCanvas.width = img.naturalWidth;
      maskCanvas.height = img.naturalHeight;

      setCanvasZoom(scale);
      setHasMask(false);
      redrawCanvas();
    };
    img.src = selectedAsset.url;
  }, [selectedAsset?.url, mode]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (imageRef.current) {
      ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
    }

    // 叠加遮罩图层
    const maskCtx = maskCanvasRef.current?.getContext("2d");
    if (maskCtx) {
      const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
      const overlayCtx = ctx;
      for (let i = 3; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 0) {
          // 有遮罩的区域覆盖红色半透明
          overlayCtx.fillStyle = MASK_COLOR;
          const px = (i / 4) % canvas.width;
          const py = Math.floor((i / 4) / canvas.width);
          overlayCtx.fillRect(px, py, 1, 1);
        }
      }
    }

    // 重新绘制遮罩（因为被覆盖了）
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // No need to re-draw image - let's restart
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (imageRef.current) {
      ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
    }
    if (maskCtx) {
      const md = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < md.data.length; i += 4) {
        if (md.data[i] > 0) {
          const px = (i / 4) % canvas.width;
          const py = Math.floor((i / 4) / canvas.width);
          ctx.fillStyle = MASK_COLOR;
          ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }, []);

  // Canvas 绘图事件
  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const x = Math.round((e.clientX - rect.left) / canvasZoom);
      const y = Math.round((e.clientY - rect.top) / canvasZoom);
      return { x, y };
    },
    [canvasZoom],
  );

  const drawBrush = useCallback(
    (x: number, y: number) => {
      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) return;
      const ctx = maskCanvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      setHasMask(true);

      // 同步更新显示 Canvas
      const canvas = canvasRef.current;
      if (!canvas) return;
      const displayCtx = canvas.getContext("2d");
      if (!displayCtx) return;
      displayCtx.fillStyle = MASK_COLOR;
      displayCtx.beginPath();
      displayCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      displayCtx.fill();
    },
    [brushSize],
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasCoords(e);
      setIsDrawing(true);
      drawBrush(x, y);
    },
    [getCanvasCoords, drawBrush],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return;
      const { x, y } = getCanvasCoords(e);
      drawBrush(x, y);
    },
    [isDrawing, getCanvasCoords, drawBrush],
  );

  const handleCanvasMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const handleClearMask = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    setHasMask(false);
    redrawCanvas();
  }, [redrawCanvas]);

  // 生成遮罩 data URL
  const getMaskDataUrl = useCallback((): string | null => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || !hasMask) return null;
    return maskCanvas.toDataURL("image/png");
  }, [hasMask]);

  const handleProcess = async () => {
    if (!activeProject) {
      toast.error(zh["toast.no_active_project"]);
      return;
    }
    if (!selectedAsset) {
      toast.error(zh["ai_tools.no_image"]);
      return;
    }
    if (mode === "inpaint" && !hasMask) {
      toast.error("请先在图片上涂鸦标记要擦除的区域");
      return;
    }

    setIsProcessing(true);
    setProgress("");

    try {
      const file = selectedAsset.file;

      if (mode === "remove-bg") {
        const result = await removeBackground({
          imageFile: file,
          onProgress: (msg) => setProgress(msg),
        });

        if (!result.success) {
          toast.error(zh["ai_tools.failed"], { description: result.error });
          return;
        }

        await editor.media.addMediaAsset({
          projectId: activeProject.metadata.id,
          asset: {
            name: result.file!.name,
            file: result.file!,
            type: "image",
          },
        });

        toast.success(zh["ai_tools.success"]);
      } else {
        // 擦除模式：需要遮罩图
        const maskDataUrl = getMaskDataUrl();
        if (!maskDataUrl) {
          toast.error("无法生成遮罩图");
          return;
        }

        const result = await inpaintErase({
          imageFile: file,
          maskDataUrl,
          prompt: erasePrompt.trim() || undefined,
          onProgress: (msg) => setProgress(msg),
        });

        if (!result.success) {
          toast.error(zh["ai_tools.failed"], { description: result.error });
          return;
        }

        await editor.media.addMediaAsset({
          projectId: activeProject.metadata.id,
          asset: {
            name: result.file!.name,
            file: result.file!,
            type: "image",
          },
        });

        toast.success(zh["ai_tools.success"]);
        handleClearMask();
        setErasePrompt("");
      }
    } catch (error) {
      console.error("AI 工具处理失败:", error);
      toast.error(zh["ai_tools.failed"], {
        description:
          error instanceof Error ? error.message : zh["toast.please_try_again"],
      });
    } finally {
      setIsProcessing(false);
      setProgress("");
    }
  };

  const selectClasses =
    "h-9 w-full rounded-md border bg-background px-3 text-sm";

  return (
    <PanelView title={zh["ai_tools.title"]}>
      <div className="flex flex-col gap-4 p-3">
        {/* 功能模式切换 */}
        <div className="flex gap-1 rounded-md bg-muted p-1">
          <button
            type="button"
            className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "remove-bg"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("remove-bg")}
            disabled={isProcessing}
          >
            {zh["ai_tools.remove_bg"]}
          </button>
          <button
            type="button"
            className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "inpaint"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("inpaint")}
            disabled={isProcessing}
          >
            {zh["ai_tools.inpaint"]}
          </button>
        </div>

        {/* 功能说明 */}
        <p className="text-muted-foreground text-xs">
          {mode === "remove-bg"
            ? zh["ai_tools.remove_bg_desc"]
            : zh["ai_tools.inpaint_desc"]}
        </p>

        {/* 图片选择 */}
        <div className="flex flex-col gap-1.5">
          <Label>{zh["ai_tools.select_image"]}</Label>
          {imageAssets.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {zh["ai_tools.no_image"]}
            </p>
          ) : (
            <select
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              className={selectClasses}
              disabled={isProcessing}
            >
              <option value="">-- {zh["ai_tools.select_image"]} --</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name || `图片-${asset.id.slice(0, 8)}`}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Canvas 涂鸦区域（仅擦除模式） */}
        {mode === "inpaint" && selectedAsset?.url && (
          <div className="flex flex-col gap-2">
            {/* 画笔工具栏 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">画笔大小：</span>
              {BRUSH_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`flex size-7 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                    brushSize === size
                      ? "bg-foreground text-background"
                      : "border bg-background text-muted-foreground hover:border-foreground"
                  }`}
                  onClick={() => setBrushSize(size)}
                >
                  {size}
                </button>
              ))}
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearMask}
                disabled={!hasMask || isProcessing}
                className="h-7 text-xs"
              >
                清除
              </Button>
            </div>

            {/* Canvas */}
            <div className="flex justify-center rounded-md border bg-[#ccc] bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNlZWUiLz48cmVjdCB4PSIxMCIgeT0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2VlZSIvPjxyZWN0IHg9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmZmYiLz48cmVjdCB5PSIxMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZmZmIi8+PC9zdmc+')] p-2">
              <canvas
                ref={canvasRef}
                className="cursor-crosshair rounded"
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
              />
              <canvas ref={maskCanvasRef} className="hidden" />
            </div>
            <p className="text-muted-foreground text-xs text-center">
              用红色画笔在图片上涂抹，标记要擦除的区域
            </p>
          </div>
        )}

        {/* 抠像模式：预览图 */}
        {mode === "remove-bg" && selectedAsset?.url && (
          <div className="flex justify-center rounded-md border bg-muted/30 p-2">
            <img
              src={selectedAsset.url}
              alt={selectedAsset.name || "预览"}
              className="max-h-40 max-w-full rounded object-contain"
            />
          </div>
        )}

        {/* 擦除模式：可选文字提示 */}
        {mode === "inpaint" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-tools-erase-prompt">
              {zh["ai_tools.erase_prompt"]}（选填）
            </Label>
            <textarea
              id="ai-tools-erase-prompt"
              className="min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm resize-y"
              placeholder={zh["ai_tools.erase_placeholder"]}
              value={erasePrompt}
              onChange={(e) => setErasePrompt(e.target.value)}
              rows={2}
              disabled={isProcessing}
            />
          </div>
        )}

        {/* 处理按钮 */}
        <Button
          onClick={handleProcess}
          disabled={
            isProcessing ||
            !selectedAsset ||
            (mode === "inpaint" && !hasMask)
          }
          className="w-full"
        >
          {isProcessing
            ? progress || zh["ai_tools.processing"]
            : mode === "remove-bg"
              ? zh["ai_tools.start_remove_bg"]
              : zh["ai_tools.start_erase"]}
        </Button>

        {/* 提示信息 */}
        <p className="text-muted-foreground text-xs leading-relaxed">
          通过 fal.ai 调用 AI 模型。抠像约 3-5 秒；擦除需先在图片上涂鸦标记区域，约 10-20 秒。结果自动加入素材库。
        </p>
      </div>
    </PanelView>
  );
}
