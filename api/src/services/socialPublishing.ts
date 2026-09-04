import crypto from "node:crypto";
import { platformToChannel, type SocialAccountRef } from "../../../shared/socialProviders.ts";

export type SocialPublishMode = "now" | "schedule";
export type SocialContentType = "post" | "story" | "reel";

export interface ZernioAccount {
  id: string;
  platform: string;
  username: string;
  displayName: string;
  profileUrl: string | null;
  isActive: boolean;
}

export interface SocialPublishRequest {
  requestId: string;
  content: string;
  channels: string[];
  mode: SocialPublishMode;
  scheduledFor?: string;
  timezone: string;
  contentType?: SocialContentType;
  mediaUrl?: string;
  destinations?: Record<string, BufferDestination>;
  saveDestinations?: (destinations: Record<string, BufferDestination>) => Promise<void>;
  /** Explicit multi-account picks: one ref per destination, platforms may
   *  repeat (two Instagram accounts = two refs). When present they replace
   *  the channel→account mapping entirely. */
  accountRefs?: SocialAccountRef[];
}

export interface BufferDestination {
  channelId: string;
  externalId?: string;
  status: "pending" | "sending" | "unknown" | "rejected" | SocialPublishResult["status"];
  permalink?: string | null;
  error?: string | null;
}

export interface SocialPublishResult {
  externalId: string;
  status: "scheduled" | "publishing" | "published" | "failed" | "partial";
  permalink: string | null;
  platformUrls: Record<string, string>;
  error: string | null;
}

export interface SocialPublisher {
  readonly name: string;
  publish(request: SocialPublishRequest): Promise<SocialPublishResult>;
  retry(externalId: string, requestId: string): Promise<SocialPublishResult>;
}

export interface ZernioWebhookUpdate {
  eventId: string;
  eventAt: string;
  externalId: string;
  status: "published" | "failed" | "partial";
  permalink: string | null;
  platformUrls: Record<string, string>;
  error: string | null;
}

const ZERNIO_PLATFORMS: Record<string, string> = {
  instagram: "instagram",
  facebook: "facebook",
  tiktok: "tiktok",
  linkedin: "linkedin",
  youtube: "youtube",
  x: "twitter",
  // The live account list speaks Zernio's vocabulary ("twitter"), so
  // explicit refs must pass through unchanged, not only UI channels.
  twitter: "twitter",
};

export function zernioPlatform(channel: string): string | null {
  return ZERNIO_PLATFORMS[channel.trim().toLowerCase()] || null;
}

export function parseZernioAccounts(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("ZERNIO_ACCOUNTS_JSON no es JSON válido"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ZERNIO_ACCOUNTS_JSON debe mapear canales a accountId");
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([channel, accountId]) => [channel.trim().toLowerCase(), String(accountId || "").trim()])
    .filter(([, accountId]) => Boolean(accountId)));
}

export function buildZernioPayload(
  request: SocialPublishRequest,
  accounts: Record<string, string>,
): Record<string, unknown> {
  // Explicit account picks win: one platform entry per ref, so a single post
  // can carry two Instagram accounts side by side. Refs arrive in Zernio's
  // own platform vocabulary (from the live account list), which
  // zernioPlatform passes through unchanged.
  const platforms = request.accountRefs?.length
    ? request.accountRefs.map(ref => {
      const platform = zernioPlatform(ref.platform);
      if (!platform) throw new Error(`Zernio no soporta la plataforma ${ref.platform || "desconocida"}`);
      return {
        platform,
        accountId: ref.accountId,
        ...(request.contentType && request.contentType !== "post"
          ? { platformSpecificData: { contentType: request.contentType } }
          : {}),
      };
    })
    : request.channels.map(channel => {
      const platform = zernioPlatform(channel);
      const accountId = accounts[channel.trim().toLowerCase()];
      if (!platform) throw new Error(`Zernio no soporta el canal ${channel}`);
      if (!accountId) throw new Error(`Falta configurar la cuenta de Zernio para ${channel}`);
      return {
        platform,
        accountId,
        ...(request.contentType && request.contentType !== "post"
          ? { platformSpecificData: { contentType: request.contentType } }
          : {}),
      };
    });
  if (platforms.length === 0) throw new Error("Elige al menos un canal para publicar");

  return {
    content: request.content,
    platforms,
    timezone: request.timezone,
    ...(request.mediaUrl ? { mediaItems: [{ type: request.contentType === "reel" ? "video" : "image", url: request.mediaUrl }] } : {}),
    ...(request.mode === "now"
      ? { publishNow: true }
      : { scheduledFor: request.scheduledFor }),
  };
}

function firstString(...values: unknown[]): string | null {
  return values.find(value => typeof value === "string" && value.length > 0) as string | null || null;
}

function platformDetails(post: any): { permalink: string | null; platformUrls: Record<string, string>; error: string | null } {
  const platforms = Array.isArray(post?.platforms) ? post.platforms : [];
  const platformUrls: Record<string, string> = {};
  const errors: string[] = [];
  for (const item of platforms) {
    const platform = String(item?.platform || "social");
    const url = firstString(item?.platformPostUrl, item?.permalink);
    if (url) platformUrls[platform] = url;
    const error = firstString(item?.errorMessage, item?.error?.message, item?.error);
    if (error) errors.push(`${platform}: ${error}`);
  }
  return {
    permalink: firstString(post?.platformPostUrl, post?.permalink, ...Object.values(platformUrls)),
    platformUrls,
    error: firstString(post?.errorMessage, post?.error?.message, post?.error, errors.join(" · ")),
  };
}

export function parseZernioPost(payload: any, fallbackStatus: SocialPublishResult["status"]): SocialPublishResult {
  const post = payload?.post || payload?.existingPost || payload?.data?.post || payload?.data || payload;
  const externalId = firstString(post?._id, post?.id, payload?.postId);
  if (!externalId) throw new Error("Zernio no devolvió el ID de la publicación");
  const rawStatus = String(post?.status || "").toLowerCase();
  const known = new Set(["scheduled", "publishing", "published", "failed", "partial"]);
  const status = (known.has(rawStatus) ? rawStatus : fallbackStatus) as SocialPublishResult["status"];
  return { externalId, status, ...platformDetails(post) };
}

export function verifyZernioSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const actualBytes = Buffer.from(signature.toLowerCase(), "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

export function parseZernioWebhook(payload: any): ZernioWebhookUpdate | null {
  const event = String(payload?.event || "");
  const status = event === "post.published" ? "published"
    : event === "post.failed" ? "failed"
      : event === "post.partial" ? "partial" : null;
  if (!status) return null;
  const eventId = firstString(payload?.id);
  const eventAt = firstString(payload?.timestamp);
  const post = payload?.post || payload?.data?.post;
  const externalId = firstString(post?._id, post?.id, payload?.postId);
  if (!eventId || !eventAt || !Number.isFinite(Date.parse(eventAt)) || !externalId) {
    throw new Error("Webhook de Zernio incompleto");
  }
  return { eventId, eventAt: new Date(eventAt).toISOString(), externalId, status, ...platformDetails(post) };
}

export class ZernioPublisher implements SocialPublisher {
  readonly name = "zernio";
  private readonly apiKey: string;
  private readonly accounts: Record<string, string>;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    accounts: Record<string, string>,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.accounts = accounts;
    this.fetcher = fetcher;
  }

  async publish(request: SocialPublishRequest): Promise<SocialPublishResult> {
    const response = await this.fetcher("https://zernio.com/api/v1/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "x-request-id": request.requestId,
      },
      body: JSON.stringify(buildZernioPayload(request, this.accounts)),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      throw new Error(firstString(payload?.message, payload?.error, payload?.details?.message)
        || `Zernio respondió HTTP ${response.status}`);
    }
    return parseZernioPost(payload, request.mode === "schedule" ? "scheduled" : "publishing");
  }

  async retry(externalId: string, requestId: string): Promise<SocialPublishResult> {
    const response = await this.fetcher(`https://zernio.com/api/v1/posts/${encodeURIComponent(externalId)}/retry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "x-request-id": requestId },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      throw new Error(firstString(payload?.message, payload?.error, payload?.details?.message)
        || `Zernio respondió HTTP ${response.status}`);
    }
    return parseZernioPost(payload, "publishing");
  }
}

function gqlString(value: string): string {
  return JSON.stringify(value);
}

async function bufferGraphql(apiKey: string, query: string, fetcher: typeof fetch): Promise<any> {
  const response = await fetcher("https://api.buffer.com", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  const message = firstString(payload?.errors?.[0]?.message, payload?.error);
  if (!response.ok || message) throw new Error(message || `Buffer respondió HTTP ${response.status}`);
  return payload?.data || {};
}

export class BufferPublisher implements SocialPublisher {
  readonly name = "buffer";
  private readonly apiKey: string;
  private readonly accounts: Record<string, string>;
  private readonly fetcher: typeof fetch;
  constructor(
    apiKey: string,
    accounts: Record<string, string>,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.accounts = accounts;
    this.fetcher = fetcher;
  }

  async publish(request: SocialPublishRequest): Promise<SocialPublishResult> {
    if (request.contentType && request.contentType !== "post") {
      throw new Error("Stories y Reels se publican con Zernio; Buffer está habilitado para posts");
    }
    // One target per destination. Explicit account refs key destinations by
    // accountId (two channels of the same service coexist); the legacy
    // channel path keeps the channel-name keys.
    const targets: Array<{ key: string; channelId: string; label: string }> = request.accountRefs?.length
      ? request.accountRefs.map(ref => ({
        key: ref.accountId,
        channelId: ref.accountId,
        label: platformToChannel(ref.platform) || ref.platform || "canal",
      }))
      : request.channels.map(channel => {
        const key = channel.trim().toLowerCase();
        const channelId = this.accounts[key];
        if (!channelId) throw new Error(`Falta elegir el canal de Buffer para ${channel}`);
        return { key, channelId, label: channel };
      });
    if (targets.length === 0) throw new Error("Elige al menos un canal para publicar");

    const destinations = structuredClone(request.destinations || {});
    // Validate every destination before any mutation can reach the provider.
    for (const target of targets) {
      const previous = destinations[target.key];
      if (previous && previous.channelId !== target.channelId) throw new Error("No cambies de cuenta durante un reintento");
      destinations[target.key] ||= { channelId: target.channelId, status: "pending" };
    }
    await request.saveDestinations?.(structuredClone(destinations));
    for (const target of targets) {
      const previous = destinations[target.key];
      if (previous && previous.channelId !== target.channelId) throw new Error("No cambies de cuenta durante un reintento");
      if (previous?.externalId) continue;
      if (previous && !["rejected", "pending"].includes(previous.status)) {
        throw new Error(`Resultado incierto en ${target.label}. Revisa Buffer antes de volver a enviar; no se duplicará automáticamente.`);
      }
      const mode = request.mode === "now" ? "shareNow" : "customScheduled";
      const assets = request.mediaUrl ? `, assets: [{ image: { url: ${gqlString(request.mediaUrl)} } }]` : "";
      const dueAt = request.mode === "schedule" ? `, dueAt: ${gqlString(request.scheduledFor || "")}` : "";
      destinations[target.key] = { channelId: target.channelId, status: "sending" };
      await request.saveDestinations?.(structuredClone(destinations));
      try {
        const data = await bufferGraphql(this.apiKey, `mutation CreatePost { createPost(input: { text: ${gqlString(request.content)}, channelId: ${gqlString(target.channelId)}, schedulingType: automatic, mode: ${mode}${dueAt}${assets} }) { ... on PostActionSuccess { post { id dueAt status } } ... on MutationError { message } } }`, this.fetcher);
        const result = data?.createPost;
        if (result?.message && !result?.post?.id) {
          destinations[target.key] = { channelId: target.channelId, status: "rejected", error: String(result.message) };
          await request.saveDestinations?.(structuredClone(destinations));
          continue;
        }
        if (!result?.post?.id) throw new Error("Buffer no devolvió el ID de la publicación");
        destinations[target.key] = { channelId: target.channelId, externalId: String(result.post.id), status: bufferPostStatus(result.post.status, request.mode === "schedule" ? "scheduled" : "publishing") };
      } catch (error) {
        destinations[target.key] = { ...destinations[target.key], status: "unknown", error: error instanceof Error ? error.message : "Resultado incierto" };
        await request.saveDestinations?.(structuredClone(destinations));
        throw error;
      }
      await request.saveDestinations?.(structuredClone(destinations));
    }
    return summarizeBufferDestinations(destinations);
  }

  async retry(): Promise<SocialPublishResult> {
    throw new Error("Buffer no expone reintento por ID; vuelve a publicar la pieza");
  }
}

export function bufferPostStatus(value: unknown, fallback: SocialPublishResult["status"] = "publishing"): SocialPublishResult["status"] {
  const status = String(value || "").toLowerCase();
  if (["sent", "published"].includes(status)) return "published";
  if (["error", "failed", "not_sent"].includes(status)) return "failed";
  if (["scheduled", "pending", "queued"].includes(status)) return "scheduled";
  return fallback;
}

export function summarizeBufferDestinations(destinations: Record<string, BufferDestination>): SocialPublishResult {
  const items = Object.values(destinations);
  const platformUrls = Object.fromEntries(Object.entries(destinations).filter(([, item]) => item.permalink).map(([key, item]) => [key, item.permalink!]));
  const failed = items.some(item => ["failed", "rejected", "unknown", "sending", "pending"].includes(item.status));
  return {
    externalId: items.flatMap(item => item.externalId ? [item.externalId] : []).join(","),
    status: failed ? (items.some(item => item.externalId) ? "partial" : "failed") : items.every(item => item.status === "published") ? "published" : items.some(item => item.status === "publishing") ? "publishing" : "scheduled",
    permalink: Object.values(platformUrls)[0] || null, platformUrls,
    error: failed ? items.map(item => item.error).filter(Boolean).join(" · ") || "Hay destinos pendientes de revisión en Buffer" : null,
  };
}

export async function syncBufferDestinations(apiKey: string, destinations: Record<string, BufferDestination>, fetcher: typeof fetch = fetch): Promise<Record<string, BufferDestination>> {
  const updated = structuredClone(destinations);
  for (const [key, item] of Object.entries(updated)) {
    if (!item.externalId || (item.status === "published" && item.permalink)) continue;
    const data = await bufferGraphql(apiKey, `query Post { post(input: { id: ${gqlString(item.externalId)} }) { id status externalLink } }`, fetcher);
    if (!data?.post || String(data.post.id) !== item.externalId) throw new Error("Buffer no devolvió la publicación solicitada");
    updated[key] = { ...item, status: bufferPostStatus(data.post.status), permalink: firstString(data.post.externalLink, item.permalink), error: data.post.status === "error" ? "Buffer no pudo publicar este destino; revísalo en Buffer" : null };
  }
  return updated;
}

export function validateSocialAccounts(accounts: Record<string, unknown>, available: ZernioAccount[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, id] of Object.entries(accounts)) {
    const key = name.trim().toLowerCase() === "twitter" ? "x" : name.trim().toLowerCase();
    const match = available.find(item => item.id === id && item.isActive && (item.platform === "twitter" ? "x" : item.platform) === key);
    if (!match || !zernioPlatform(key)) throw new Error(`Cuenta inválida para ${name}`);
    result[key] = match.id;
  }
  return result;
}

export function createSocialPublisher(apiKey: string, accounts: Record<string, string>, provider = "zernio"): SocialPublisher {
  if (!apiKey.trim()) throw new Error("Conecta Zernio en Configuración antes de publicar");
  if (provider === "buffer") return new BufferPublisher(apiKey.trim(), accounts);
  if (provider === "zernio") return new ZernioPublisher(apiKey.trim(), accounts);
  throw new Error(`Proveedor social no soportado: ${provider}`);
}

export async function listBufferAccounts(apiKey: string, fetcher: typeof fetch = fetch): Promise<ZernioAccount[]> {
  const organizations = await bufferGraphql(apiKey, "query Organizations { organizations { id name } }", fetcher);
  const output: ZernioAccount[] = [];
  for (const organization of organizations?.organizations || []) {
    const data = await bufferGraphql(apiKey, `query Channels { channels(input: { organizationId: ${gqlString(String(organization.id))}, filter: { isLocked: false } }) { id name displayName service } }`, fetcher);
    for (const channel of data?.channels || []) output.push({
      id: String(channel.id), platform: String(channel.service || "").toLowerCase(),
      username: String(channel.name || ""), displayName: String(channel.displayName || channel.name || channel.service || "Canal"),
      profileUrl: null, isActive: true,
    });
  }
  return output.filter(account => account.id && account.platform);
}

export async function listZernioAccounts(apiKey: string, fetcher: typeof fetch = fetch): Promise<ZernioAccount[]> {
  const response = await fetcher("https://zernio.com/api/v1/accounts?status=connected", {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new Error(firstString(payload?.message, payload?.error) || `Zernio respondió HTTP ${response.status}`);
  }
  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
  return accounts.map((account: any) => ({
    id: String(account?._id || account?.id || ""),
    platform: String(account?.platform || "").toLowerCase(),
    username: String(account?.username || ""),
    displayName: String(account?.displayName || account?.username || account?.platform || "Cuenta"),
    profileUrl: firstString(account?.profileUrl),
    isActive: account?.isActive !== false,
  })).filter((account: ZernioAccount) => account.id && account.platform);
}

/**
 * Resolve explicit account picks against a provider's live account list.
 * Unknown ids fail here — BEFORE any mutation reaches the provider — because
 * a silently dropped destination would publish to fewer accounts than the
 * user asked for. Duplicates collapse: picking the same account twice is one
 * destination, not a double post.
 */
export function pickAccountsByIds(accounts: ZernioAccount[], ids: unknown): SocialAccountRef[] {
  const wanted = [...new Set((Array.isArray(ids) ? ids : [])
    .map(id => String(id ?? "").trim())
    .filter(Boolean))];
  if (wanted.length === 0) throw new Error("Elige al menos una cuenta de destino");
  const byId = new Map(accounts.map(account => [account.id, account]));
  const refs: SocialAccountRef[] = [];
  const missing: string[] = [];
  for (const id of wanted) {
    const account = byId.get(id);
    if (!account) { missing.push(id); continue; }
    if (!account.isActive) throw new Error(`La cuenta ${account.displayName} está inactiva en el proveedor`);
    refs.push({ platform: account.platform, accountId: account.id });
  }
  if (missing.length > 0) {
    throw new Error(`El proveedor no reconoce ${missing.length === 1 ? "la cuenta" : "las cuentas"} ${missing.join(", ")}. Actualiza las cuentas (Probar y listar) y vuelve a intentar.`);
  }
  return refs;
}

// ── Zernio inbox: messages and comments. Buffer has no conversation
// surface, so every inbox consumer resolves the Zernio connection only. ──

export interface ZernioInboxItem {
  externalId: string;
  kind: "message" | "comment";
  platform: string;
  authorName: string;
  authorHandle: string;
  authorEmail: string | null;
  avatarUrl: string | null;
  content: string;
  occurredAt: string | null;
  permalink: string | null;
}

/** Tolerant parse — the publish parser's rule applies here too: the provider
 *  wraps ids, authors and texts in slightly different envelopes per endpoint. */
export function parseZernioInboxItem(raw: any): ZernioInboxItem | null {
  const item = raw?.item || raw?.data || raw;
  const externalId = firstString(item?._id, item?.id);
  if (!externalId) return null;
  const kindRaw = String(item?.type || item?.kind || "message").toLowerCase();
  const author = item?.author || item?.sender || item?.user || {};
  const occurred = firstString(item?.createdAt, item?.occurredAt, item?.timestamp);
  return {
    externalId,
    kind: kindRaw.includes("comment") ? "comment" : "message",
    platform: String(item?.platform || "").toLowerCase(),
    authorName: firstString(author?.name, author?.displayName, author?.username, item?.authorName) || "Sin nombre",
    authorHandle: firstString(author?.username, author?.handle, item?.authorHandle) || "",
    authorEmail: firstString(author?.email, item?.authorEmail),
    avatarUrl: firstString(author?.avatarUrl, author?.avatar, item?.authorAvatarUrl),
    content: firstString(item?.content, item?.text, item?.message, item?.body) || "",
    occurredAt: occurred && Number.isFinite(Date.parse(occurred)) ? new Date(occurred).toISOString() : null,
    permalink: firstString(item?.postUrl, item?.permalink, item?.url),
  };
}

export async function fetchZernioInbox(apiKey: string, fetcher: typeof fetch = fetch): Promise<ZernioInboxItem[]> {
  const response = await fetcher("https://zernio.com/api/v1/inbox?limit=100", {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new Error(firstString(payload?.message, payload?.error) || `Zernio respondió HTTP ${response.status}`);
  }
  const items = payload?.items || payload?.messages || payload?.data || (Array.isArray(payload) ? payload : []);
  return (Array.isArray(items) ? items : [])
    .map(parseZernioInboxItem)
    .filter((item: ZernioInboxItem | null): item is ZernioInboxItem => Boolean(item));
}

export async function replyZernioInboxItem(apiKey: string, externalId: string, content: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`https://zernio.com/api/v1/inbox/${encodeURIComponent(externalId)}/reply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new Error(firstString(payload?.message, payload?.error) || `Zernio respondió HTTP ${response.status}`);
  }
}

export function newPublishRequestId(): string {
  return crypto.randomUUID();
}
