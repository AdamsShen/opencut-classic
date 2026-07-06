"use client";

/**
 * AI 视频生成服务
 *
 * 主：Atlas Cloud API 调用 Seedance 2.0
 * 备：WaveSpeedAI API 作为 fallback
 *
 * 两个 API 都是异步模式：提交任务 → 轮询状态 → 获取视频 URL
 */

export interface VideoGenOptions {
  prompt: string;
  duration?: number; // 4-15 秒
  resolution?: "480p" | "720p" | "1080p";
  aspectRatio?: "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "21:9" | "adaptive";
  generateAudio?: boolean;
  onProgress?: (status: string) => void;
}

export interface VideoGenResult {
  success: boolean;
  videoUrl?: string;
  error?: string;
  provider: "atlas" | "wavespeed";
}

// ===== Atlas Cloud API =====

const ATLAS_BASE = "https://api.atlascloud.ai/api/v1";

interface AtlasPrediction {
  id: string;
  status: string;
  outputs?: string[];
  error?: string;
}

async function atlasGenerate(prompt: string, data: Record<string, unknown>): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_ATLAS_API_KEY || "";
  const res = await fetch(`${ATLAS_BASE}/model/generateVideo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Atlas Cloud 请求失败 (${res.status}): ${errText}`);
  }

  const json = await res.json();
  if (!json.data?.id) {
    throw new Error(`Atlas Cloud 返回异常: ${JSON.stringify(json)}`);
  }
  return json.data.id;
}

async function atlasPoll(predictionId: string): Promise<AtlasPrediction> {
  const apiKey = process.env.NEXT_PUBLIC_ATLAS_API_KEY || "";
  const res = await fetch(
    `${ATLAS_BASE}/model/prediction/${predictionId}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );

  if (!res.ok) {
    throw new Error(`Atlas Cloud 轮询失败 (${res.status})`);
  }

  const json = await res.json();
  return json.data as AtlasPrediction;
}

async function callAtlasCloud(options: VideoGenOptions): Promise<VideoGenResult> {
  options.onProgress?.("Atlas Cloud: 提交任务...");

  const predictionId = await atlasGenerate(options.prompt, {
    model: "bytedance/seedance-2.0/text-to-video",
    prompt: options.prompt,
    duration: options.duration ?? 5,
    resolution: options.resolution ?? "720p",
    ratio: options.aspectRatio ?? "adaptive",
    generate_audio: options.generateAudio ?? false,
    watermark: false,
  });

  options.onProgress?.("Atlas Cloud: 生成中...");

  // 轮询直到完成，最长等待 5 分钟
  const maxAttempts = 150; // 150 * 2s = 5min
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const pred = await atlasPoll(predictionId);

    if (pred.status === "completed" || pred.status === "succeeded") {
      const videoUrl = pred.outputs?.[0];
      if (!videoUrl) {
        return { success: false, error: "Atlas Cloud 返回了空视频地址", provider: "atlas" };
      }
      return { success: true, videoUrl, provider: "atlas" };
    }

    if (pred.status === "failed") {
      const errMsg = pred.error || "未知错误";
      throw new Error(`Atlas Cloud: ${errMsg}`);
    }

    if (i % 5 === 0) {
      options.onProgress?.(`Atlas Cloud: 生成中... (${Math.round((i / maxAttempts) * 100)}%)`);
    }
  }

  throw new Error("Atlas Cloud 生成超时（超过 5 分钟）");
}

// ===== WaveSpeedAI API (fallback) =====

const WAVESPEED_BASE = "https://api.wavespeed.ai/api/v3";

async function wavespeedGenerate(prompt: string, data: Record<string, unknown>): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_WAVESPEED_API_KEY || "";
  const model = "bytedance/seedance-2.0/text-to-video-turbo";
  const res = await fetch(`${WAVESPEED_BASE}/${model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WaveSpeedAI 请求失败 (${res.status}): ${errText}`);
  }

  const json = await res.json();
  if (!json.id && !json.request_id) {
    throw new Error(`WaveSpeedAI 返回异常: ${JSON.stringify(json)}`);
  }
  return json.id || json.request_id;
}

async function wavespeedPoll(requestId: string): Promise<{ status: string; outputs?: string[] }> {
  const apiKey = process.env.NEXT_PUBLIC_WAVESPEED_API_KEY || "";
  const res = await fetch(
    `${WAVESPEED_BASE}/predictions/${requestId}/result`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );

  if (!res.ok) {
    throw new Error(`WaveSpeedAI 轮询失败 (${res.status})`);
  }

  // WaveSpeedAI 返回 { code, data: { status, outputs, ... } }
  const json = await res.json();
  return json.data || json;
}

async function callWaveSpeedAI(options: VideoGenOptions): Promise<VideoGenResult> {
  options.onProgress?.("WaveSpeedAI: 提交任务...");

  const requestId = await wavespeedGenerate(options.prompt, {
    prompt: options.prompt,
    duration: options.duration ?? 5,
    resolution: options.resolution === "480p" ? "720p" : (options.resolution ?? "720p"),
    aspect_ratio: options.aspectRatio ?? "16:9",
    generate_audio: options.generateAudio ?? false,
  });

  options.onProgress?.("WaveSpeedAI: 生成中...");

  const maxAttempts = 150;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const result = await wavespeedPoll(requestId);

    if (result.status === "completed") {
      const videoUrl = result.outputs?.[0];
      if (!videoUrl) {
        return { success: false, error: "WaveSpeedAI 返回了空视频地址", provider: "wavespeed" };
      }
      return { success: true, videoUrl, provider: "wavespeed" };
    }

    if (result.status === "failed") {
      throw new Error("WaveSpeedAI 生成失败");
    }

    if (i % 5 === 0) {
      options.onProgress?.(`WaveSpeedAI: 生成中... (${Math.round((i / maxAttempts) * 100)}%)`);
    }
  }

  throw new Error("WaveSpeedAI 生成超时（超过 5 分钟）");
}

// ===== 主入口：Atlas Cloud 优先，失败后 fallback 到 WaveSpeedAI =====

export async function generateVideo(options: VideoGenOptions): Promise<VideoGenResult> {
  // 检查 API Key
  const atlasKey = process.env.NEXT_PUBLIC_ATLAS_API_KEY;
  const wavespeedKey = process.env.NEXT_PUBLIC_WAVESPEED_API_KEY;

  if (!atlasKey && !wavespeedKey) {
    return {
      success: false,
      error: "未配置 API Key。请在 .env.local 中设置 NEXT_PUBLIC_ATLAS_API_KEY 或 NEXT_PUBLIC_WAVESPEED_API_KEY",
      provider: "atlas",
    };
  }

  // 优先使用 Atlas Cloud
  if (atlasKey) {
    try {
      return await callAtlasCloud(options);
    } catch (atlasError) {
      const errMsg = atlasError instanceof Error ? atlasError.message : "未知错误";
      console.warn("Atlas Cloud 调用失败，尝试 fallback 到 WaveSpeedAI:", errMsg);
      options.onProgress?.(`Atlas Cloud 失败 (${errMsg})，切换到 WaveSpeedAI...`);

      if (!wavespeedKey) {
        return { success: false, error: `Atlas Cloud 失败: ${errMsg}`, provider: "atlas" };
      }
      // 继续到 fallback
    }
  }

  // Fallback: WaveSpeedAI
  if (wavespeedKey) {
    try {
      return await callWaveSpeedAI(options);
    } catch (wavespeedError) {
      const errMsg = wavespeedError instanceof Error ? wavespeedError.message : "未知错误";
      return { success: false, error: `所有提供商均失败。WaveSpeedAI: ${errMsg}`, provider: "wavespeed" };
    }
  }

  return { success: false, error: "所有提供商均不可用", provider: "atlas" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
