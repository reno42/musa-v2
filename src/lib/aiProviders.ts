/**
 * AI provider registry — single source of truth for all provider/model
 * configuration across the app (ChatFAB, ChatTab, Dashboard, EditorV2).
 *
 * Every provider gets a curated model list so the UI can render a proper
 * dropdown instead of a free-text field. The first entry in `models` is the
 * default — picked for the best cost/quality trade-off on the free tier.
 */

export interface AIProvider {
  id: string;
  label: string;
  /** API key prefix shown as placeholder hint. */
  keyPrefix: string;
  /** localStorage slot for the key. */
  keySlot: string;
  /** localStorage slot for the selected model. */
  modelSlot: string;
  /** Available models — first is the default. */
  models: string[];
  /** Whether this provider supports vision (image input). */
  vision?: boolean;
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: "google",
    label: "Google Gemini",
    keyPrefix: "AIza",
    keySlot: "futuraria-gemini-key",
    modelSlot: "futuraria-gemini-model",
    vision: true,
    models: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
  },
  {
    id: "quiver",
    label: "Quiver AI",
    keyPrefix: "qv_",
    keySlot: "futuraria-quiver-key",
    modelSlot: "futuraria-quiver-model",
    models: [
      "arrow-1.1",
      "arrow-1.1-max",
    ],
  },
  {
    // Not a chat provider — powers the editor's 🧅 layer separation
    // (Seedream 5.0 Pro via WaveSpeedAI). Registered here so the BYOK key
    // and model selection flow through the same server-side store as
    // google/quiver (see userKeys.ts / keys.mjs).
    id: "wavespeed",
    label: "WaveSpeedAI",
    keyPrefix: "",
    keySlot: "futuraria-wavespeed-key",
    modelSlot: "futuraria-wavespeed-model",
    models: [
      "seedream-v5.0-pro/layer-decomposition",
    ],
  },
  {
    // Not a chat provider — powers the editor's 🎬 image-to-video
    // (RunwayML Gen-4). Registered here so the BYOK key and model
    // selection flow through the same server-side store as
    // google/quiver/wavespeed (see userKeys.ts / keys.mjs).
    id: "runway",
    label: "RunwayML",
    keyPrefix: "key_",
    keySlot: "futuraria-runway-key",
    modelSlot: "futuraria-runway-model",
    models: [
      "gen4_turbo",
      "gen4.5",
    ],
  },
  {
    // Photo search for the editor's icon panel. The key lives in the same
    // server-side store; the panel decrypts it to memory per session and
    // calls Unsplash straight from the browser (see IconPicker.tsx) — same
    // direct-call pattern the chat uses for its LLM providers.
    id: "unsplash",
    label: "Unsplash",
    keyPrefix: "",
    keySlot: "futuraria-unsplash-key",
    modelSlot: "futuraria-unsplash-model",
    models: [],
  },
  {
    id: "openai",
    label: "OpenAI",
    keyPrefix: "sk-",
    keySlot: "futuraria-chat-key-openai",
    modelSlot: "futuraria-chat-model-openai",
    models: [
      // Familia GPT-6 (sept 2026): sol = equilibrio, luna = volumen barato,
      // astra = máxima capacidad. IDs verificados en developers.openai.com.
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-6-astra",
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keyPrefix: "sk-ant-",
    keySlot: "futuraria-chat-key-anthropic",
    modelSlot: "futuraria-chat-model-anthropic",
    models: [
      // Lineup vigente (claude platform docs): sonnet-5 velocidad/inteligencia,
      // opus-5-5 agéntico largo, haiku-4-5 el más rápido, fable-5-1 razonamiento.
      // Sonnet/Opus 4 retirados de la API en 2026.
      "claude-sonnet-5",
      "claude-opus-5-5",
      "claude-haiku-4-5",
      "claude-fable-5-1",
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    keyPrefix: "sk-",
    keySlot: "futuraria-chat-key-deepseek",
    modelSlot: "futuraria-chat-model-deepseek",
    models: [
      // Los aliases deepseek-chat/reasoner apuntan siempre al último modelo;
      // v4.1-flash verificado en el catálogo vivo de OpenRouter.
      "deepseek-chat",
      "deepseek-reasoner",
      "deepseek-v4.1-flash",
    ],
  },
  {
    // Kimi — international platform (platform.kimi.ai, api.moonshot.ai).
    // K3/K2.6/K2.7 accept text, image and video input.
    id: "kimi",
    label: "Kimi",
    keyPrefix: "sk-",
    keySlot: "futuraria-chat-key-kimi",
    modelSlot: "futuraria-chat-model-kimi",
    vision: true,
    models: [
      // Catálogo Kimi (platform.kimi.ai): k3 flagship 1M ctx, k2.7 code
      // (+highspeed), k2.6/k2.5 generacionales previas.
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "kimi-k2.6",
      "kimi-k2.5",
    ],
  },
  {
    // Moonshot — China platform (platform.moonshot.cn). Same Kimi model
    // family as "kimi", separate account/keys/endpoint — users pick the
    // one their key belongs to.
    id: "moonshot",
    label: "Moonshot",
    keyPrefix: "sk-",
    keySlot: "futuraria-chat-key-moonshot",
    modelSlot: "futuraria-chat-model-moonshot",
    vision: true,
    models: [
      // Catálogo China (platform.moonshot.cn) — mismas familias que Kimi.
      "kimi-k3",
      "kimi-k2.6",
      "kimi-k2.7-code",
      "kimi-k2.5",
    ],
  },
  {
    // Qwen — Alibaba Cloud Model Studio, international (Singapore)
    // OpenAI-compatible endpoint. China-hosted keys need the CN base URL
    // and are served by the same ids.
    id: "qwen",
    label: "Qwen",
    keyPrefix: "sk-",
    keySlot: "futuraria-chat-key-qwen",
    modelSlot: "futuraria-chat-model-qwen",
    models: [
      // Model Studio (DashScope intl): qwen3.5-plus hosted flagship,
      // qwen3.5-flash volumen, qwen-plus/qwen-flash aliases estables.
      "qwen3.5-plus",
      "qwen3.5-flash",
      "qwen-plus",
      "qwen-flash",
    ],
  },
  {
    // Zhipu — Z.ai GLM flagship series. Key format "id.secret" (no fixed
    // prefix), OpenAI-compatible v4 API. Lista = GET /models real (sept 2026);
    // glm-5.3-flash default por costo/velocidad.
    id: "zhipu",
    label: "Zhipu (Z.ai)",
    keyPrefix: "",
    keySlot: "futuraria-chat-key-zhipu",
    modelSlot: "futuraria-chat-model-zhipu",
    models: [
      "glm-5.3-flash",
      "glm-5.3-flashx",
      "glm-5.3",
      "glm-5.2",
      "glm-5.1",
      "glm-5-turbo",
      "glm-5",
      "glm-4.7",
      "glm-4.6",
      "glm-4.5-air",
      "glm-4.5",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyPrefix: "sk-or-",
    keySlot: "futuraria-chat-key-openrouter",
    modelSlot: "futuraria-chat-model-openrouter",
    models: [
      // Slugs vigentes en el catálogo público de OpenRouter (sept 2026).
      "anthropic/claude-sonnet-5",
      "openai/gpt-6-sol",
      "google/gemini-3.8-flash",
      "moonshotai/kimi-k3",
      "deepseek/deepseek-chat",
    ],
  },
];

/** Default model for a provider (first in the list). */
export function defaultModelFor(providerId: string): string {
  return AI_PROVIDERS.find(p => p.id === providerId)?.models[0] || "";
}

/** Provider by id (safe lookup, returns undefined if not found). */
export function getProvider(providerId: string): AIProvider | undefined {
  return AI_PROVIDERS.find(p => p.id === providerId);
}

// ── Backwards-compatible aliases for the chat component ──
// ChatFAB/ChatTab previously used PROVIDERS with endpoint info. We keep
// the old shape for those components but source models from AI_PROVIDERS.

export interface ChatProviderCompat {
  id: string;
  label: string;
  defaultModel: string;
  endpoint: string;
  keyPrefix: string;
  models: string[];
}

export const CHAT_PROVIDERS: ChatProviderCompat[] = [
  {
    id: "google",
    label: "Google Gemini",
    // Google exposes an OpenAI-compatible surface, so the chat's generic
    // Bearer + messages/tools path works unchanged. Native-only models
    // (image/audio generation, embeddings, robotics) are not listed — the
    // chat needs text/vision models that answer with code and text.
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  },
  { id: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1/chat/completions" },
  { id: "anthropic", label: "Anthropic", endpoint: "https://api.anthropic.com/v1/messages" },
  { id: "deepseek", label: "DeepSeek", endpoint: "https://api.deepseek.com/v1/chat/completions" },
  {
    id: "kimi",
    label: "Kimi",
    // Kimi API (platform.kimi.ai) — OpenAI-compatible Chat Completions.
    endpoint: "https://api.moonshot.ai/v1/chat/completions",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    // Moonshot China (platform.moonshot.cn) — same family as Kimi,
    // different keys/region.
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
  },
  { id: "qwen", label: "Qwen", endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions" },
  {
    id: "zhipu",
    label: "Zhipu (Z.ai)",
    // Base coding/: la suscripción GLM Coding Plan SOLO funciona aquí
    // (la base paas/v4 estándar le responde 1113 sin balance). Mismos
    // modelos en ambas bases; una key pay-as-you-go necesitaría paas/v4.
    endpoint: "https://api.z.ai/api/coding/paas/v4/chat/completions",
  },
  { id: "openrouter", label: "OpenRouter", endpoint: "https://openrouter.ai/api/v1/chat/completions" },
].map(base => {
  const full = AI_PROVIDERS.find(p => p.id === base.id)!;
  return {
    ...base,
    defaultModel: full.models[0],
    keyPrefix: full.keyPrefix,
    models: full.models,
  };
});

// ── Nano Banana image-gen models (editor 🍌) ──
// Curated image-output Gemini models. { id, label } so the UI can show a
// friendly name while storing the real model id (prefs nanoBananaModel).
export const NANO_BANANA_MODELS = [
  { id: "gemini-3.1-flash-image", label: "Nano Banana 2 — rápido y equilibrado" },
  { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite — ultra rápido" },
  { id: "gemini-3-pro-image", label: "Nano Banana Pro — máxima calidad" },
  { id: "gemini-2.5-flash-image", label: "Nano Banana (2.5) — generación previa" },
];
