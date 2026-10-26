/**
 * REQ-059 (bloque D) — Cliente de AI Clones (HeyGen v3) para Musa.
 *
 * Todo pasa por el proxy same-origin /api/heygen/* (worker/runtime/functions/
 * heygen.mjs): la API key de HeyGen NUNCA llega al navegador — se guarda
 * cifrada con el BYOK existente (PUT /api/keys/heygen) y el server la lee con
 * getUserKey(userId, "heygen").
 *
 * Los guiones NO los genera HeyGen: los escribe el LLM que el usuario ya tiene
 * configurado (rol leader por /api/llm, igual que el Ghost), así el texto es
 * editable y los créditos de HeyGen se gastan solo en el render. Si el usuario
 * no tiene BYOK de chat, se cae a la capa plataforma (`tier: "platform"`), que
 * usa la cuota gratis de Musa — lo mismo que hace el agente.
 *
 * Honesty rules: los DTOs vienen de shared/heygenMappers (misma norma en server
 * y client); el poll tiene techo duro y si HeyGen no dice 'completed' con
 * video_url, la UI sigue mostrando 'procesando' — nunca un link fantasma.
 */

import { apiFetch } from "./supabase";
import { getApiHeaders } from "./apiKey";
import { CHAT_PROVIDERS, defaultModelFor } from "./aiProviders";
import { fetchUserPrefs } from "./userPrefs";
import {
  HeygenMapError,
  aspectForTakeFormat,
  buildScriptPrompt,
  parseScriptsResponse,
  type GeneratedScript,
  type HeygenAccountInfo,
  type HeygenAvatarLook,
  type HeygenVideoListItem,
  type HeygenVideoStatus,
  type HeygenVoice,
} from "../../shared/heygenMappers";

export type {
  GeneratedScript,
  HeygenAccountInfo,
  HeygenAvatarLook,
  HeygenVideoListItem,
  HeygenVideoStatus,
  HeygenVoice,
};
export { aspectForTakeFormat, HeygenMapError };

export interface HeygenKeyStatus {
  configured: boolean;
  last4: string | null;
  updatedAt: string | null;
}

export async function fetchHeygenStatus(): Promise<HeygenKeyStatus> {
  return apiFetch<HeygenKeyStatus>("/api/heygen/status");
}

/** GET /v3/users/me a través del proxy: valida la clave y trae créditos. */
export async function validateHeygenKey(): Promise<HeygenAccountInfo> {
  const res = await apiFetch<{ valid: boolean; account: HeygenAccountInfo }>("/api/heygen/validate", { method: "POST" });
  return res.account;
}

export async function listHeygenClones(): Promise<HeygenAvatarLook[]> {
  const res = await apiFetch<{ avatars: HeygenAvatarLook[] }>("/api/heygen/avatars");
  return res.avatars ?? [];
}

export async function listHeygenVoices(search?: string): Promise<HeygenVoice[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await apiFetch<{ voices: HeygenVoice[] }>(`/api/heygen/voices${qs}`);
  return res.voices ?? [];
}

export async function listHeygenVideos(): Promise<HeygenVideoListItem[]> {
  const res = await apiFetch<{ videos: HeygenVideoListItem[] }>("/api/heygen/videos");
  return res.videos ?? [];
}

/** Entrena un clon (digital twin) desde una toma ya subida al estudio. */
export async function trainCloneFromTake(input: { takeId: string; name: string }): Promise<{
  avatar: HeygenAvatarLook | null;
  avatarGroupId: string | null;
  status: string | null;
}> {
  return apiFetch("/api/heygen/avatars/digital-twin", {
    method: "POST",
    body: JSON.stringify({ take_id: input.takeId, name: input.name }),
  });
}

export interface GenerateCloneVideoInput {
  avatarId: string;
  script: string;
  /** Formato del estudio (vertical/square/portrait/horizontal) o aspect literal. */
  formatId?: string | null;
  voiceId?: string | null;
  title?: string | null;
}

export async function generateCloneVideo(input: GenerateCloneVideoInput): Promise<{
  videoId: string | null;
  status: string | null;
  phase: string | null;
  videoUrl: string | null;
}> {
  return apiFetch("/api/heygen/videos", {
    method: "POST",
    body: JSON.stringify({
      avatar_id: input.avatarId,
      script: input.script,
      aspect_ratio: aspectForTakeFormat(input.formatId),
      voice_id: input.voiceId || null,
      title: input.title || null,
    }),
  });
}

export async function fetchHeygenVideo(videoId: string): Promise<HeygenVideoStatus> {
  const res = await apiFetch<{ video: HeygenVideoStatus }>(`/api/heygen/videos/${encodeURIComponent(videoId)}`);
  return res.video;
}

// ── Poll con techo (decisión §2.D: cada 5 s, máximo 10 min) ────────────────

export const HEYGEN_POLL_INTERVAL_MS = 5_000;
export const HEYGEN_POLL_TIMEOUT_MS = 10 * 60_000;

export interface PollVideoOptions {
  videoId: string;
  onUpdate?: (status: HeygenVideoStatus) => void;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Inyectable para QA: la función de poll no debe depender de la red. */
  fetcher?: (videoId: string) => Promise<HeygenVideoStatus>;
  sleeper?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("HEYGEN_POLL_ABORTED"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Poll hasta ready/failed o techo. Sale con `timedOut: true` si se cumplió el
 * máximo — el video sigue existiendo en HeyGen, la UI lo dice explícitamente.
 */
export async function pollHeygenVideo(options: PollVideoOptions): Promise<{
  status: HeygenVideoStatus;
  attempts: number;
  timedOut: boolean;
}> {
  const fetcher = options.fetcher || fetchHeygenVideo;
  const wait = options.sleeper || sleep;
  const intervalMs = options.intervalMs ?? HEYGEN_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? HEYGEN_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let last: HeygenVideoStatus | null = null;

  for (;;) {
    if (options.signal?.aborted) throw new Error("HEYGEN_POLL_ABORTED");
    attempts += 1;
    try {
      last = await fetcher(options.videoId);
    } catch {
      // Un poll fallido no mata el job: HeyGen puede tardar en indexar.
      last = last ? { ...last, phase: "processing" } : last;
    }
    if (last) options.onUpdate?.(last);
    if (last && (last.phase === "ready" || last.phase === "failed")) {
      return { status: last, attempts, timedOut: false };
    }
    if (attempts >= 600 || Date.now() + intervalMs > deadline) {
      return {
        status: last || {
          videoId: options.videoId, rawStatus: null, phase: "processing", videoUrl: null,
          thumbnailUrl: null, captionedVideoUrl: null, subtitleUrl: null, durationSec: null,
          progressPct: null, errorCode: null, errorMessage: null,
        },
        attempts,
        timedOut: true,
      };
    }
    await wait(intervalMs, options.signal);
  }
}

// ── Guiones con el LLM del usuario (topic → 3 opciones) ─────────────────────

const LOCAL_ROLES_SLOT = "futuraria-chat-role-config";

/** Rol leader resuelto con la misma precedencia que el Ghost: server → local → default. */
async function resolveLeaderRole(): Promise<{ provider: string; model: string }> {
  const fallback = { provider: "deepseek", model: defaultModelFor("deepseek") };
  let leader: { provider?: unknown; model?: unknown } = {};
  try {
    const prefs = await fetchUserPrefs();
    const roles = prefs.chatRoles && typeof prefs.chatRoles === "object" ? (prefs.chatRoles as Record<string, unknown>) : {};
    leader = (roles.leader as typeof leader) || leader;
  } catch { /* sin prefs: sigue con el local */ }
  if (!leader.provider) {
    try {
      const raw = localStorage.getItem(LOCAL_ROLES_SLOT);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && parsed.leader) leader = parsed.leader;
    } catch { /* slot corrupto: default */ }
  }
  const provider = String(leader.provider || fallback.provider);
  const known = CHAT_PROVIDERS.find(p => p.id === provider);
  if (!known) return fallback;
  const model = String(leader.model || "") || defaultModelFor(provider);
  return { provider, model };
}

const SCRIPT_MAX_TOKENS = 2_000;

/**
 * Pide tres guiones sobre `topic`. Primer intento con la BYOK del leader; si el
 * relay responde 404 "No key configured" se reintenta por la capa plataforma
 * (cuota gratis de Musa). Errores explícitos: nunca se devuelve texto roto.
 */
export async function generateScriptIdeas(input: {
  topic: string;
  tone?: string | null;
  maxSeconds?: number;
  post?: typeof fetch;
}): Promise<GeneratedScript[]> {
  const topic = String(input.topic || "").trim();
  if (topic.length < 3) throw new HeygenMapError("SCRIPT_TOPIC_TOO_SHORT", "Escribí el tema del video (al menos algunas palabras).");
  const prompt = buildScriptPrompt(topic, input.tone ?? null, input.maxSeconds ?? 45);
  const role = await resolveLeaderRole();
  const post = input.post || fetch;

  const payloadFor = (provider: string, model: string, tier?: "platform") => ({
    provider,
    ...(tier ? { tier } : {}),
    body: provider === "anthropic"
      ? { model, max_tokens: SCRIPT_MAX_TOKENS, messages: [{ role: "user", content: prompt }] }
      : { model, max_tokens: SCRIPT_MAX_TOKENS, messages: [{ role: "user", content: prompt }], ...(provider === "zhipu" ? { thinking: { type: "disabled" } } : {}) },
  });

  const call = async (body: unknown) => {
    const resp = await post("/api/llm", {
      method: "POST",
      headers: { ...getApiHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      const detail = typeof (json as any)?.error === "string" ? (json as any).error : `HTTP ${resp.status}`;
      const err = new Error(detail) as Error & { status?: number };
      err.status = resp.status;
      throw err;
    }
    return json;
  };

  let raw: unknown;
  try {
    raw = await call(payloadFor(role.provider, role.model));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const status = (cause as { status?: number })?.status;
    if (status === 404 && /no key configured/i.test(message)) {
      raw = await call(payloadFor(role.provider, role.model, "platform"));
    } else {
      throw new HeygenMapError("SCRIPT_LLM_FAILED", `No se pudieron generar los guiones: ${message}`);
    }
  }
  return parseScriptsResponse(raw);
}

/** El texto del modelo ya viene limpio de marcadores; se normaliza igual. */
export function sanitizeGeneratedScript(text: string): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
