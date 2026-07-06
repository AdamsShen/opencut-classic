import type { CaptionChunk } from "@/transcription/types";

/**
 * 格式化秒数为 SRT 时间戳格式
 * HH:MM:SS,mmm
 */
function formatSrtTimestamp({ seconds }: { seconds: number }): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * 将字幕块数组导出为 SRT 格式字符串
 */
export function exportSrt({ captions }: { captions: CaptionChunk[] }): string {
  if (captions.length === 0) return "";

  const lines: string[] = [];

  for (let i = 0; i < captions.length; i++) {
    const caption = captions[i];
    const startTime = formatSrtTimestamp({ seconds: caption.startTime });
    const endTime = formatSrtTimestamp({
      seconds: caption.startTime + caption.duration,
    });

    lines.push(
      `${i + 1}`,
      `${startTime} --> ${endTime}`,
      caption.text.trim(),
      "",
    );
  }

  return lines.join("\n");
}

/**
 * 格式化秒数为 VTT 时间戳格式
 * HH:MM:SS.mmm
 */
function formatVttTimestamp({ seconds }: { seconds: number }): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/**
 * 将字幕块数组导出为 WebVTT 格式字符串
 */
export function exportVtt({ captions }: { captions: CaptionChunk[] }): string {
  if (captions.length === 0) return "";

  const lines = ["WEBVTT", ""];

  for (let i = 0; i < captions.length; i++) {
    const caption = captions[i];
    const startTime = formatVttTimestamp({ seconds: caption.startTime });
    const endTime = formatVttTimestamp({
      seconds: caption.startTime + caption.duration,
    });

    lines.push(
      `${i + 1}`,
      `${startTime} --> ${endTime}`,
      caption.text.trim(),
      "",
    );
  }

  return lines.join("\n");
}
