/**
 * 模型配置 — 预定义提供者 + 自定义接入
 *   - DeepSeek: 默认免费提供者
 *   - 预留: NewAPI / OneAPI / OpenAI 兼容网关（用户可自行添加）
 *   - 用户可在设置中切换模型
 */

export type { ModelProvider } from "./types";
import type { ModelProvider } from "./types";

/** 预定义的模型提供者列表 */
export const PRESET_PROVIDERS: ModelProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    modelName: "deepseek-chat",
    isOpenAICompatible: true,
  },
  // 预留: 用户可通过设置面板添加自定义网关
  // {
  //   id: "newapi",
  //   name: "自定义网关 (NewAPI)",
  //   baseUrl: "https://your-gateway.example.com",
  //   apiKey: "",
  //   modelName: "gpt-4o",
  //   isOpenAICompatible: true,
  // },
];

/** 从 localStorage 读取当前选中的模型配置 */
export function loadModelConfig(): ModelProvider {
  try {
    const raw = localStorage.getItem("opencut-agent-model");
    if (raw) return JSON.parse(raw) as ModelProvider;
  } catch { /* ignore */ }
  // 默认 DeepSeek
  return { ...PRESET_PROVIDERS[0] };
}

/** 保存模型配置到 localStorage */
export function saveModelConfig(config: ModelProvider) {
  localStorage.setItem("opencut-agent-model", JSON.stringify(config));
}

/** 获取所有可用模型（预置 + 用户添加的） */
export function getAvailableModels(): ModelProvider[] {
  const stored = loadModelConfig();
  // 如果用户配了自定义网关，将其加入列表
  const custom = PRESET_PROVIDERS.some((p) => p.id === stored.id)
    ? PRESET_PROVIDERS.map((p) =>
        p.id === stored.id ? { ...p, apiKey: stored.apiKey, baseUrl: stored.baseUrl, modelName: stored.modelName } : p
      )
    : [...PRESET_PROVIDERS, stored];
  return custom;
}
