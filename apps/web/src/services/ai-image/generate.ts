"use client";

/**
 * AI 文生图服务
 *
 * Atlas Cloud (主) → WaveSpeedAI (备) → fal.ai (兜底)
 * 优先级自动 fallback
 *
 * Atlas Cloud flux-2-pro (主) → WaveSpeedAI flux-1.1-pro (备) → fal.ai flux-2-pro (兜底)
 */

export interface ImageGenOptions {
  prompt: string;
  negativePrompt?: string;
  width?: number;        // 默认 1024
  height?: number;       // 默认 1024
  numImages?: number;    // 默认 1
  seed?: number;         // 可选，用于复现结果
  onProgress?: (status: string) => void;
}

export interface ImageGenResult {
  success: boolean;
  images?: Array<{ url: string; width: number; height: number }>;
  error?: string;
  provider: "atlas" | "wavespeed" | "fal";
}

// ===== Atlas Cloud API (主，同步) =====

const ATLAS_BASE = "https://api.atlascloud.ai/api/v1";

interface AtlasResponse {
  output?: { image_url?: string };
  outputs?: string[];
  error?: string;
}

async function callAtlasCloud(options: ImageGenOptions): Promise<ImageGenResult> {
  const apiKey = process.env.NEXT_PUBLIC_ATLAS_API_KEY || "";
  if (!apiKey) {
    throw new Error("Atlas Cloud API Key 未配置");
  }

  const {
    prompt,
    width = 1024,
    height = 1024,
    seed,
    onProgress,
  } = options;

  onProgress?.("Atlas Cloud: 生成中...");

  const res = await fetch(`${ATLAS_BASE}/model/generateImage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "black-forest-labs/flux-2-pro/text-to-image",
      prompt,
      width,
      height,
      seed,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Atlas Cloud 请求失败 (${res.status}): ${errText}`);
  }

  const json: AtlasResponse = await res.json();

  if (json.output?.image_url) {
    return {
      success: true,
      images: [{ url: json.output.image_url, width, height }],
      provider: "atlas",
    };
  }

  if (json.outputs && json.outputs.length > 0) {
    const images = json.outputs.map((url: string) => ({ url, width, height }));
    return { success: true, images, provider: "atlas" };
  }

  throw new Error(`Atlas Cloud 返回异常: ${JSON.stringify(json)}`);
}

// ===== WaveSpeedAI API (备，异步) =====

const WAVESPEED_BASE = "https://api.wavespeed.ai/api/v3";

interface WavespeedResponse {
  code?: number;
  data?: {
    id?: string;
    status?: string;
    outputs?: string[];
    urls?: { get?: string };
    error?: string;
  };
}

async function callWaveSpeedAI(options: ImageGenOptions): Promise<ImageGenResult> {
  const apiKey = process.env.NEXT_PUBLIC_WAVESPEED_API_KEY || "";
  if (!apiKey) {
    throw new Error("WaveSpeedAI API Key 未配置");
  }

  const {
    prompt,
    negativePrompt = "",
    width = 1024,
    height = 1024,
    numImages = 1,
    seed,
    onProgress,
  } = options;

  onProgress?.("WaveSpeedAI: 提交任务...");

  const body: Record<string, unknown> = {
    prompt,
    size: `${width}*${height}`,
    num_images: numImages,
    seed: seed ?? -1,
  };
  if (negativePrompt) body.negative_prompt = negativePrompt;

  const res = await fetch(`${WAVESPEED_BASE}/wavespeed-ai/flux-2-pro/text-to-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WaveSpeedAI 请求失败 (${res.status}): ${errText}`);
  }

  const json: WavespeedResponse = await res.json();
  const data = json.data;
  if (!data?.id) {
    throw new Error(`WaveSpeedAI 返回异常: ${JSON.stringify(json)}`);
  }

  // 异步模式：轮询结果
  onProgress?.("WaveSpeedAI: 生成中...");
  return await wavespeedPoll(data.id, apiKey, width, height, onProgress);
}

async function wavespeedPoll(
  taskId: string,
  apiKey: string,
  width: number,
  height: number,
  onProgress?: (status: string) => void,
): Promise<ImageGenResult> {
  const maxAttempts = 90; // 90 * 2s = 3min
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const res = await fetch(
      `${WAVESPEED_BASE}/predictions/${taskId}/result`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    if (!res.ok) continue;

    const json: WavespeedResponse = await res.json();
    const data = json.data;
    if (!data) continue;

    if (data.status === "completed") {
      const outputs = data.outputs;
      if (!outputs || outputs.length === 0) {
        return { success: false, error: "WaveSpeedAI 返回了空结果", provider: "wavespeed" };
      }
      const images = outputs.map((url: string) => ({ url, width, height }));
      return { success: true, images, provider: "wavespeed" };
    }

    if (data.status === "failed") {
      const errMsg = data.error || "未知错误";
      throw new Error(`WaveSpeedAI: ${errMsg}`);
    }

    if (i % 5 === 0) {
      onProgress?.(`WaveSpeedAI: 生成中... (${Math.round((i / maxAttempts) * 100)}%)`);
    }
  }

  throw new Error("WaveSpeedAI 生成超时（超过 3 分钟）");
}

// ===== fal.ai API (兜底，同步) =====

const FAL_BASE = "https://fal.run";

interface FalResponse {
  images?: Array<{ url: string; width: number; height: number }>;
}

async function callFalAI(options: ImageGenOptions): Promise<ImageGenResult> {
  const apiKey = process.env.NEXT_PUBLIC_FAL_API_KEY || "";
  if (!apiKey) {
    throw new Error("fal.ai API Key 未配置");
  }

  const {
    prompt,
    negativePrompt = "",
    numImages = 1,
    seed,
    onProgress,
  } = options;

  onProgress?.("fal.ai: 生成中...");

  const body: Record<string, unknown> = {
    prompt,
    num_images: numImages,
    seed,
  };
  if (negativePrompt) body.negative_prompt = negativePrompt;

  const res = await fetch(`${FAL_BASE}/fal-ai/flux-2-pro`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fal.ai 请求失败 (${res.status}): ${errText}`);
  }

  const json: FalResponse = await res.json();

  if (json.images && json.images.length > 0) {
    return { success: true, images: json.images, provider: "fal" };
  }

  throw new Error(`fal.ai 返回异常: ${JSON.stringify(json)}`);
}

// ===== 主入口：Atlas Cloud → WaveSpeedAI → fal.ai =====

export async function generateImage(options: ImageGenOptions): Promise<ImageGenResult> {
  const atlasKey = process.env.NEXT_PUBLIC_ATLAS_API_KEY;
  const wavespeedKey = process.env.NEXT_PUBLIC_WAVESPEED_API_KEY;
  const falKey = process.env.NEXT_PUBLIC_FAL_API_KEY;

  if (!atlasKey && !wavespeedKey && !falKey) {
    return {
      success: false,
      error: "未配置任何 API Key。请在 .env.local 中配置",
      provider: "fal",
    };
  }

  // 第一选择: Atlas Cloud flux-1.1-pro
  if (atlasKey) {
    try {
      return await callAtlasCloud(options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      console.warn("Atlas Cloud 失败，fallback WaveSpeedAI:", msg);
      options.onProgress?.("Atlas Cloud 失败，切换 WaveSpeedAI...");
    }
  }

  // 备用: WaveSpeedAI flux-1.1-pro
  if (wavespeedKey) {
    try {
      return await callWaveSpeedAI(options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      console.warn("WaveSpeedAI 失败，fallback fal.ai:", msg);
      options.onProgress?.("WaveSpeedAI 失败，切换 fal.ai...");
    }
  }

  // 兜底: fal.ai flux-2-pro
  if (falKey) {
    try {
      return await callFalAI(options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      return { success: false, error: `所有提供商均失败。fal.ai: ${msg}`, provider: "fal" };
    }
  }

  return { success: false, error: "所有提供商均不可用", provider: "fal" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
