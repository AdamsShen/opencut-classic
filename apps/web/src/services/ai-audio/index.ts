"use client";

/**
 * AI 音乐/音效生成服务
 *
 * 通过 fal.ai API 调用 musicgen 模型
 * flickr-musicgen-1.5b: https://fal.ai/models/fal-ai/musicgen
 *
 * 模式: POST 提交 → 轮询 → 下载音频 → File
 */

const FAL_BASE = "https://queue.fal.run";

function falKey(): string {
  return process.env.NEXT_PUBLIC_FAL_API_KEY || "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAudioUrl(payload: Record<string, unknown>): string | null {
  // fal.ai musicgen 返回 { audio_url: { url: "..." } }
  const audioUrl =
    (payload.audio_url as { url?: string })?.url ||
    payload.audio_url;
  if (typeof audioUrl === "string" && audioUrl.startsWith("http")) return audioUrl;

  // audio 对象
  const audio = (payload.audio as { url?: string }) || {};
  if (audio.url && audio.url.startsWith("http")) return audio.url;

  // 通用降级
  const output = payload.output;
  if (typeof output === "string" && output.startsWith("http")) return output;

  const result = payload.result;
  if (typeof result === "string" && result.startsWith("http")) return result;

  return null;
}

export type AudioGenMode = "music" | "soundfx";

export interface AudioGenOptions {
  prompt: string;
  mode: AudioGenMode;
  duration?: number; // 秒，最大 30
  onProgress?: (msg: string) => void;
}

export interface AudioGenResult {
  success: boolean;
  file?: File;
  error?: string;
}

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

  // 1. 提交
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

  // 2. 轮询
  const maxAttempts = 90; // 90 * 2s = 3min
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
      const url = extractAudioUrl(status as Record<string, unknown>);
      if (url) return url;

      // 降级：response_url
      const responseUrl = status.response_url as string | undefined;
      if (responseUrl) {
        try {
          const r = await fetch(responseUrl, {
            headers: { Authorization: `Key ${key}` },
          });
          if (r.ok) {
            const data = await r.json();
            const url2 = extractAudioUrl(data as Record<string, unknown>);
            if (url2) return url2;
          }
        } catch { /* ignore */ }
        if (responseUrl.startsWith("http") && !responseUrl.includes("fal.run")) {
          return responseUrl;
        }
      }

      console.warn("fal.ai audio COMPLETED raw:", JSON.stringify(status).slice(0, 800));
      throw new Error("fal.ai 任务完成但未找到音频文件");
    }

    if (status.status === "FAILED") throw new Error("fal.ai 任务失败");

    if (i % 3 === 0) {
      onProgress?.(`处理中... (${Math.round((i / maxAttempts) * 100)}%)`);
    }
  }

  throw new Error("fal.ai 处理超时（超过 3 分钟）");
}

/**
 * 根据 prompt 生成音乐或音效
 * 使用 fal-ai/musicgen 模型
 */
export async function generateAudio(
  options: AudioGenOptions,
): Promise<AudioGenResult> {
  const { prompt, mode, duration = 10, onProgress } = options;

  try {
    const isMusic = mode === "music";
    const fullPrompt = isMusic
      ? `${prompt}. High quality music track.`
      : `A ${Math.max(duration, 3)}-second sound effect of ${prompt}. High quality, detailed.`;

    const audioUrl = await submitAndPoll({
      endpoint: "fal-ai/musicgen",
      input: {
        prompt: fullPrompt,
        duration: Math.min(duration, 30),
      },
      onProgress,
    });

    onProgress?.("下载音频...");
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`下载音频失败 (${response.status})`);
    }
    const blob = await response.blob();
    const prefix = isMusic ? "音乐" : "音效";
    const safeName = prompt.slice(0, 20).replace(/[^\w一-鿿]/g, "_");
    const name = `${prefix}-${safeName}-${Date.now()}`;

    const file = new File([blob], `${name}.mp3`, {
      type: blob.type || "audio/mpeg",
    });

    return { success: true, file };
  } catch (error) {
    console.error("音频生成失败:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}
