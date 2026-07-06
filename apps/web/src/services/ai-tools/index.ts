"use client";

/**
 * AI 工具服务（抠像 + 擦除）
 *
 * 通过 fal.ai API 调用：
 * - removeBackground: fal-ai/birefnet 模型，~2-5 秒
 * - inpaintErase: fal-ai/flux-lora/inpainting 模型，通过提示词描述要擦除的内容
 *
 * fal.ai queue 模式：POST 提交 → 轮询 status_url → COMPLETED 时结果在轮询响应中
 * 见文档: https://fal.ai/docs/rest-api/queue
 */

const FAL_BASE = "https://queue.fal.run";

function falKey(): string {
  return process.env.NEXT_PUBLIC_FAL_API_KEY || "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从 fal.ai 响应对象中提取图片 URL
 * 支持多种常见的响应格式：
 * - { images: [{ url: "..." }] }
 * - { image: { url: "..." } }
 * - { output: "https://..." }
 * - { result: "https://..." }
 */
function extractImageUrl(payload: Record<string, unknown>): string | null {
  // images 数组
  const images = payload.images as { url?: string }[] | undefined;
  if (images?.[0]?.url) return images[0].url;

  // image 对象
  const image = payload.image as { url?: string } | undefined;
  if (image?.url) return image.url;

  // output 字符串
  const output = payload.output;
  if (typeof output === "string" && output.startsWith("http")) return output;

  // result 字符串
  const result = payload.result;
  if (typeof result === "string" && result.startsWith("http")) return result;

  return null;
}

// ===== 公共：fal.ai 提交 + 轮询 + 下载 =====

async function submitAndPoll({
  endpoint,
  input,
  onProgress,
}: {
  endpoint: string;
  input: Record<string, unknown>;
  onProgress?: (msg: string) => void;
}): Promise<string> {
  const key = falKey();
  if (!key) throw new Error("未配置 NEXT_PUBLIC_FAL_API_KEY");

  // 1. 提交任务
  onProgress?.("提交任务...");
  const submitRes = await fetch(`${FAL_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${key}`,
    },
    body: JSON.stringify(input),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`fal.ai 请求失败 (${submitRes.status}): ${errText}`);
  }

  const submission = await submitRes.json();
  const statusUrl =
    submission.status_url ||
    `${FAL_BASE}/${endpoint}/requests/${submission.request_id}/status`;

  if (!statusUrl) {
    throw new Error(
      `fal.ai 提交响应缺少 status_url: ${JSON.stringify(submission).slice(0, 300)}`,
    );
  }

  // 2. 轮询状态（fal.ai 完成时结果直接嵌入轮询响应）
  const maxAttempts = 120; // 120 * 2s = 4min
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Key ${key}` },
    });
    if (!statusRes.ok) {
      throw new Error(`fal.ai 轮询失败 (${statusRes.status})`);
    }
    const status = await statusRes.json();

    if (status.status === "COMPLETED") {
      // 结果通常在轮询响应中直接返回
      const imageUrl = extractImageUrl(status as Record<string, unknown>);
      if (imageUrl) return imageUrl;

      // 降级：尝试 response_url（可能是预签名文件地址或 API 地址）
      const responseUrl = status.response_url as string | undefined;
      if (responseUrl) {
        try {
          const resultRes = await fetch(responseUrl, {
            headers: { Authorization: `Key ${key}` },
          });
          if (resultRes.ok) {
            const result = await resultRes.json();
            const url2 = extractImageUrl(result as Record<string, unknown>);
            if (url2) return url2;
          }
        } catch {
          console.warn("response_url fetch failed, trying direct URL approach");
        }
        // response_url 可能就是直接的文件 URL
        if (
          responseUrl.startsWith("http") &&
          !responseUrl.includes("fal.run")
        ) {
          return responseUrl;
        }
      }

      // 把整个响应打出来方便调试
      console.warn("fal.ai COMPLETED raw response:", JSON.stringify(status).slice(0, 1000));
      throw new Error(
        `fal.ai 任务完成但未找到结果图片。请联系开发者查看控制台日志`,
      );
    }

    if (status.status === "FAILED") {
      throw new Error(
        "fal.ai 任务失败",
      );
    }

    // 每 15 秒上报一次进度
    if (i % 3 === 0) {
      onProgress?.(`处理中... (${Math.round((i / maxAttempts) * 100)}%)`);
    }
  }

  throw new Error("fal.ai 处理超时（超过 4 分钟）");
}

// ===== AI 抠像 =====

export interface RemoveBGOptions {
  imageFile: File;
  onProgress?: (msg: string) => void;
}

export interface RemoveBGResult {
  success: boolean;
  file?: File;
  error?: string;
}

/**
 * 去除图片背景，生成透明 PNG
 * 使用 fal-ai/birefnet 模型
 */
export async function removeBackground(
  options: RemoveBGOptions,
): Promise<RemoveBGResult> {
  const { imageFile, onProgress } = options;

  try {
    onProgress?.("上传图片...");
    const dataUrl = await fileToDataUrl(imageFile);

    const imageUrl = await submitAndPoll({
      endpoint: "fal-ai/birefnet",
      input: {
        image_url: dataUrl,
        model: "General Use (Light)",
        operating_resolution: "1024x1024",
        output_format: "png",
        refine_foreground: true,
      },
      onProgress,
    });

    // 下载结果
    onProgress?.("下载结果...");
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`下载抠像结果失败 (${response.status})`);
    }
    const blob = await response.blob();
    const file = new File(
      [blob],
      `抠图-${imageFile.name.replace(/\.[^.]+$/, "")}.png`,
      { type: "image/png" },
    );

    return { success: true, file };
  } catch (error) {
    console.error("抠像失败:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

// ===== AI 擦除 =====

export interface InpaintEraseOptions {
  imageFile: File;
  maskDataUrl: string; // Canvas 涂鸦生成的遮罩图（白色=擦除区域，黑色=保留区域）
  prompt?: string; // 可选：文字描述要擦除的内容
  onProgress?: (msg: string) => void;
}

export interface InpaintEraseResult {
  success: boolean;
  file?: File;
  error?: string;
}

/**
 * AI 智能擦除：涂鸦遮罩 + 可选文字提示
 * 使用 fal-ai/flux-lora/inpainting 模型
 * fal.ai 要求: image_url + mask_url + 可选 prompt
 */
export async function inpaintErase(
  options: InpaintEraseOptions,
): Promise<InpaintEraseResult> {
  const { imageFile, maskDataUrl, prompt, onProgress } = options;

  try {
    onProgress?.("上传图片和遮罩...");
    const imageDataUrl = await fileToDataUrl(imageFile);

    const input: Record<string, unknown> = {
      image_url: imageDataUrl,
      mask_url: maskDataUrl,
      num_inference_steps: 28,
      guidance_scale: 7.5,
    };

    if (prompt) {
      input.prompt = `Remove ${prompt}. Keep everything else exactly the same. Fill the removed area naturally with the surrounding background.`;
      input.negative_prompt =
        "blurry, distorted, low quality, different style, text, watermark";
    }

    const resultUrl = await submitAndPoll({
      endpoint: "fal-ai/flux-lora/inpainting",
      input,
      onProgress,
    });

    // 下载擦除结果
    onProgress?.("下载结果...");
    const response = await fetch(resultUrl);
    if (!response.ok) {
      throw new Error(`下载擦除结果失败 (${response.status})`);
    }
    const blob = await response.blob();
    const ext = imageFile.name.match(/\.([^.]+)$/)?.[1] || "png";
    const file = new File(
      [blob],
      `擦除-${imageFile.name.replace(/\.[^.]+$/, "")}.${ext}`,
      { type: blob.type || "image/png" },
    );

    return { success: true, file };
  } catch (error) {
    console.error("擦除失败:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

// ===== 工具函数 =====

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}
