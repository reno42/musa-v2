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
    id: "openai",
    label: "OpenAI",
    keyPrefix: "sk-",
    keySlot: "futuraria-chat-key-openai",
    modelSlot: "futuraria-chat-model-openai",
    models: [
      "gpt-4o-mini",
      "gpt-4o",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "o4-mini",
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keyPrefix: "sk-ant-",
    keySlot: "futuraria-chat-key-anthropic",
    modelSlot: "futuraria-chat-model-anthropic",
    models: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    keyPrefix: "sk-",
    keySlot: "futuraria-chat-key-deepseek",
    modelSlot: "futuraria-chat-model-deepseek",
    models: [
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyPrefix: "sk-or-",
    keySlot: "futuraria-chat-key-openrouter",
    modelSlot: "futuraria-chat-model-openrouter",
    models: [
      "anthropic/claude-sonnet-4",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-flash",
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
