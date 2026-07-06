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
  provider: "atlas" | "wavespeed" | "replicate" | "fal";
}

// ===== Replicate API =====

const REPLICATE_BASE = "https://api.replicate.com/v1";

async function replicateGenerate(data: Record<string, unknown>): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_REPLICATE_API_KEY || "";
  const res = await fetch(
    `${REPLICATE_BASE}/models/bytedance/seedance-2.0/predictions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(data),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Replicate 请求失败 (${res.status}): ${errText}`);
  }

  const json = await res.json();
  if (!json.id && !json.urls?.get) {
    throw new Error(`Replicate 返回异常: ${JSON.stringify(json)}`);
  }

  // Replicate returns { id, urls: { get } } or { id, urls: { stream } }
  return json.urls?.get || `${REPLICATE_BASE}/predictions/${json.id}`;
}

async function replicatePoll(
  pollUrlOrId: string,
): Promise<{ status: string; output?: string; error?: string }> {
  const apiKey = process.env.NEXT_PUBLIC_REPLICATE_API_KEY || "";
  const url = pollUrlOrId.startsWith("http")
    ? pollUrlOrId
    : `${REPLICATE_BASE}/predictions/${pollUrlOrId}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Replicate 轮询失败 (${res.status})`);
  }

  const json = await res.json();
  return {
    status: json.status,
    output: typeof json.output === "string" ? json.output : json.output?.url || json.output?.[0],
    error: json.error,
  };
}

async function callReplicate(options: VideoGenOptions): Promise<VideoGenResult> {
  options.onProgress?.("Replicate: 提交任务...");

  const pollUrl = await replicateGenerate({
    input: {
      prompt: options.prompt,
      duration: options.duration ?? 5,
      resolution: options.resolution ?? "720p",
    },
  });

  options.onProgress?.("Replicate: 生成中...");

  const maxAttempts = 150;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const result = await replicatePoll(pollUrl);

    if (result.status === "succeeded" || result.status === "completed") {
      const videoUrl = result.output;
      if (!videoUrl) {
        return { success: false, error: "Replicate 返回了空视频地址", provider: "replicate" };
      }
      return { success: true, videoUrl, provider: "replicate" };
    }

    if (result.status === "failed" || result.status === "canceled") {
      throw new Error(`Replicate: ${result.error || "生成失败"}`);
    }

    if (i % 5 === 0) {
      options.onProgress?.(`Replicate: 生成中... (${Math.round((i / maxAttempts) * 100)}%)`);
    }
  }

  throw new Error("Replicate 生成超时（超过 5 分钟）");
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

// ===== fal.ai API (优先，已验证可用) =====

const FAL_BASE = "https://queue.fal.run";

async function falGenerate(data: Record<string, unknown>): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_FAL_API_KEY || "";
  const res = await fetch(`${FAL_BASE}/bytedance/seedance-2.0/text-to-video`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fal.ai 请求失败 (${res.status}): ${errText}`);
  }

  const json = await res.json();
  if (!json.request_id && !json.status_url) {
    throw new Error(`fal.ai 返回异常: ${JSON.stringify(json)}`);
  }
  return json.status_url || `${FAL_BASE}/bytedance/seedance-2.0/requests/${json.request_id}/status`;
}

async function falPoll(statusUrl: string): Promise<{ status: string; video?: { url?: string } }> {
  const apiKey = process.env.NEXT_PUBLIC_FAL_API_KEY || "";
  const url = statusUrl.startsWith("http") ? statusUrl : `${FAL_BASE}${statusUrl}`;

  const res = await fetch(url, {
    headers: { Authorization: `Key ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`fal.ai 轮询失败 (${res.status})`);
  }

  return res.json();
}

async function callFalAI(options: VideoGenOptions): Promise<VideoGenResult> {
  options.onProgress?.("fal.ai: 提交任务...");

  const statusUrl = await falGenerate({
    prompt: options.prompt,
    duration: options.duration ?? 5,
    resolution: options.resolution ?? "720p",
  });

  options.onProgress?.("fal.ai: 生成中...");

  const maxAttempts = 150;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const result = await falPoll(statusUrl);

    if (result.status === "COMPLETED") {
      // fal.ai 完成后的 response_url 里才有 video，再查一次
      const apiKey = process.env.NEXT_PUBLIC_FAL_API_KEY || "";
      const reqId = result.request_id;
      if (reqId) {
        const finalRes = await fetch(
          `${FAL_BASE}/bytedance/seedance-2.0/requests/${reqId}`,
          { headers: { Authorization: `Key ${apiKey}` } },
        );
        const final = await finalRes.json();
        const videoUrl = final.video?.url;
        if (videoUrl) {
          return { success: true, videoUrl, provider: "fal" };
        }
      }
      return { success: false, error: "fal.ai 返回了空视频地址", provider: "fal" };
    }

    if (result.status === "FAILED") {
      throw new Error("fal.ai 生成失败");
    }

    if (i % 5 === 0) {
      options.onProgress?.(`fal.ai: 生成中... (${Math.round((i / maxAttempts) * 100)}%)`);
    }
  }

  throw new Error("fal.ai 生成超时（超过 5 分钟）");
}

// ===== 主入口：Replicate → WaveSpeedAI → Atlas Cloud → fal.ai =====

export async function generateVideo(options: VideoGenOptions): Promise<VideoGenResult> {
  const replicateKey = process.env.NEXT_PUBLIC_REPLICATE_API_KEY;
  const wavespeedKey = process.env.NEXT_PUBLIC_WAVESPEED_API_KEY;
  const atlasKey = process.env.NEXT_PUBLIC_ATLAS_API_KEY;
  const falKey = process.env.NEXT_PUBLIC_FAL_API_KEY;

  if (!replicateKey && !wavespeedKey && !atlasKey && !falKey) {
    return {
      success: false,
      error: "未配置 API Key。请在 .env.local 中设置 NEXT_PUBLIC_REPLICATE_API_KEY / WAVESPEED / ATLAS / FAL_API_KEY",
      provider: "replicate",
    };
  }

  // 第一选择: fal.ai (已验证可用 ✅)
  if (falKey) {
    try {
      return await callFalAI(options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      console.warn("fal.ai 失败，fallback:", msg);
      options.onProgress?.("fal.ai 失败，切换 Replicate...");
    }
  }

  // 第二选择: Replicate ($0.08/s 最便宜)
  if (replicateKey) {
    try {
      return await callReplicate(options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      console.warn("Replicate 失败，fallback:", msg);
      options.onProgress?.("Replicate 失败，切换 WaveSpeedAI...");
    }
  }

  // 第三选择: WaveSpeedAI
  if (wavespeedKey) {
    try {
      return await callWaveSpeedAI(options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      console.warn("WaveSpeedAI 失败，fallback:", msg);
      options.onProgress?.("WaveSpeedAI 失败，切换 Atlas Cloud...");
    }
  }

  // 最后兜底: Atlas Cloud
  if (atlasKey) {
    try {
      return await callAtlasCloud(options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      return { success: false, error: `所有提供商均失败。Atlas: ${msg}`, provider: "atlas" };
    }
  }

  return { success: false, error: "所有提供商均不可用", provider: "replicate" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
