/**
 * Supabase Client Service
 * ──────────────────────────────────────────────────────────────
 * Initializes the Supabase admin client using service_role key
 * for server-side operations. The client handles all database
 * queries (templates, styles, comments, versions, etc.),
 * authentication verification, and storage operations.
 *
 * @module services/supabase
 *
 * Environment variables:
 *   SUPABASE_URL                        → https://<project>.supabase.co
 *   SUPABASE_SECRET_KEY                 → modern secret key (server-side only)
 *   SUPABASE_PUBLISHABLE_KEY            → modern browser-safe key
 *   SUPABASE_SERVICE_KEY                → legacy service_role fallback
 *   SUPABASE_ANON_KEY                   → legacy anon fallback
 *   SUPABASE_PROJECT_URL_DE_REPO_DESIGN → Netlify-deployed fallback URL
 *   SUPABASE_SECRET_KEY_DE_REPO_DESIGN  → Netlify-deployed fallback key
 *
 * DB tables accessed: ALL (via .from() queries)
 * Storage buckets: design-exports (rendered images)
 *
 * Optional fallback: all route handlers have Map<string, any>
 * in-memory stores for development without Supabase.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RequestAuth } from "./requestContext.js";

let adminClient: SupabaseClient | null = null;
let authClient: SupabaseClient | null = null;
const AUTH_FETCH_TIMEOUT_MS = 2_500;
const DATABASE_FETCH_TIMEOUT_MS = 5_000;

export function supabaseRequestDeadlineMs(input: RequestInfo | URL): number | null {
  try {
    const pathname = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    if (pathname.startsWith("/auth/v1/")) return AUTH_FETCH_TIMEOUT_MS;
    if (pathname.startsWith("/rest/v1/")) return DATABASE_FETCH_TIMEOUT_MS;
  } catch { /* Let fetch report malformed URLs in its normal way. */ }
  // Storage uploads/downloads and realtime connections must not inherit a
  // short database deadline: large assets legitimately take longer.
  return null;
}

export function createSupabaseFetch(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  deadlineFor: (input: RequestInfo | URL) => number | null = supabaseRequestDeadlineMs,
): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const deadlineMs = deadlineFor(input);
    if (deadlineMs === null) return fetchImpl(input, init);
    const controller = new AbortController();
    const upstreamSignal = init.signal;
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) abortFromUpstream();
    else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException("Supabase request timed out", "TimeoutError")),
      deadlineMs,
    );
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  };
}

export const supabaseFetch = createSupabaseFetch();

export function supabaseClientOptions(accessToken?: string) {
  return {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
      fetch: supabaseFetch,
    },
  };
}

function currentRequestAuth(): RequestAuth | undefined {
  const context = (globalThis as any)[Symbol.for("futuraria.requestContext")];
  return context?.getStore?.();
}

export function parseSupabaseKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const keySet = JSON.parse(trimmed) as Record<string, unknown>;
    const preferred = keySet.default;
    if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
    return Object.values(keySet).find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()))?.trim();
  } catch {
    return undefined;
  }
}

function firstSupabaseKey(...values: Array<string | undefined>) {
  for (const value of values) {
    const key = parseSupabaseKey(value);
    if (key) return key;
  }
  return undefined;
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL_DE_REPO_DESIGN;
  const secretKey = firstSupabaseKey(
    process.env.SUPABASE_SECRET_KEY,
    process.env.SUPABASE_SECRET_KEYS,
    process.env.SUPABASE_SERVICE_KEY,
    process.env.SUPABASE_SECRET_KEY_DE_REPO_DESIGN,
  );
  const publishableKey = firstSupabaseKey(
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEYS,
    process.env.SUPABASE_ANON_KEY,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
  );
  return { url, secretKey, publishableKey };
}

/** The publishable key is public by design; secret/service keys never leave the server. */
export function getPublicSupabaseConfig(): { url: string; publishableKey: string } | null {
  const { url, publishableKey } = supabaseConfig();
  if (!url || !publishableKey || url.includes("your-project") || publishableKey.includes("your_publishable_key") || publishableKey.includes("your_anon_key")) return null;
  return { url, publishableKey };
}

export function getSupabaseAdmin(): SupabaseClient | null {
  const { url, secretKey } = supabaseConfig();
  if (!url || !secretKey || url.includes("your-project")) return null;
  if (!adminClient) {
    adminClient = createClient(url, secretKey, supabaseClientOptions());
  }
  return adminClient;
}

export function getSupabaseAuthClient(): SupabaseClient | null {
  const { url, publishableKey } = supabaseConfig();
  if (!url || !publishableKey || url.includes("your-project")) return null;
  if (!authClient) {
    authClient = createClient(url, publishableKey, supabaseClientOptions());
  }
  return authClient;
}

/**
 * Get or initialize the Supabase client (lazy singleton).
 *
 * @returns SupabaseClient | null  (null if env vars are missing
 *                                  or contain placeholder values)
 *
 * Called by: middleware.ts (auth), all route handlers (CRUD),
 *            webhooks.ts (dispatch), renderer.ts (storage)
 */
export function getSupabase(): SupabaseClient | null {
  const { url, publishableKey } = supabaseConfig();
  const auth = currentRequestAuth();
  if (auth?.accessToken && url && publishableKey) {
    if (!auth.scopedClient) {
      auth.scopedClient = createClient(url, publishableKey, supabaseClientOptions(auth.accessToken));
    }
    return auth.scopedClient;
  }

  const client = getSupabaseAdmin();
  if (!client) console.warn("[SUPABASE] Not configured — using in-memory storage");
  return client;
}

// ── Storage helpers ────────────────────────────────────────

const LOCAL_ASSETS_DIR = resolve(process.cwd(), "public", "assets");

export function sanitizeAssetFileName(fileName: string) {
  const baseName = fileName.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || "";
  if (!baseName || baseName === "." || baseName === "..") throw new Error("Invalid asset filename");
  return baseName;
}

/** Image extensions a preview capture can end up with, depending on the mime
 *  type the browser produced for that particular snapshot. */
const PREVIEW_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

/**
 * Delete older preview files for the same design.
 *
 * Preview captures upsert to `{dir}/{templateId}.{ext}`, so re-capturing in the
 * SAME format overwrites cleanly. But the extension follows the capture's mime
 * type: a design first captured as PNG and later as JPEG left the PNG behind
 * forever, and nothing ever removed it. One stale file per design per format
 * silently eats the storage budget.
 *
 * `keepPath` is the file just written — everything else for that design goes.
 * Supabase ignores paths that do not exist, so this is a single cheap call.
 */
export function stalePreviewPaths(dir: string, templateId: string, keepPath: string): string[] {
  return PREVIEW_EXTENSIONS
    .map(ext => `${dir}/${templateId}.${ext}`)
    .filter(path => path !== keepPath);
}

export async function removeStalePreviewFiles(
  bucket: string, dir: string, templateId: string, keepPath: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const stale = stalePreviewPaths(dir, templateId, keepPath);
  if (stale.length === 0) return;
  try {
    await sb.storage.from(bucket).remove(stale);
  } catch { /* best effort: a failed cleanup must never fail the upload */ }
}

/**
 * Remove every preview image belonging to a design (thumbnail + curated
 * cover, in any format). Used when a design is permanently deleted, so its
 * pictures do not outlive it in the bucket.
 */
export function allPreviewPaths(templateId: string, workspaceId: string): string[] {
  return ["thumbnails", "covers"].flatMap(dir =>
    PREVIEW_EXTENSIONS.map(ext => `${workspaceId}/${dir}/${templateId}.${ext}`));
}

export async function removeAllPreviewFiles(templateId: string, workspaceId?: string | null): Promise<number> {
  const sb = getSupabase();
  if (!sb || !workspaceId) return 0;
  const paths = allPreviewPaths(templateId, workspaceId);
  try {
    const { data } = await sb.storage.from("design-covers").remove(paths);
    return data?.length || 0;
  } catch { return 0; }
}

/** Upload a file buffer to Supabase Storage. Falls back to local disk. */
export async function uploadAsset(
  fileName: string, buffer: Buffer, contentType: string, workspaceId = "default"
): Promise<string> {
  const safeName = sanitizeAssetFileName(fileName);
  const sb = getSupabase();
  if (sb) {
    const filePath = `${workspaceId}/${safeName}`;
    const { error } = await sb.storage.from("design-assets").upload(filePath, buffer, {
      contentType, upsert: true,
    });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    const { data } = await sb.storage.from("design-assets").createSignedUrl(filePath, 31_536_000);
    return data?.signedUrl || "";
  }

  // Local disk fallback
  const dir = resolve(LOCAL_ASSETS_DIR, workspaceId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const localPath = resolve(dir, safeName);
  writeFileSync(localPath, buffer);
  return `/assets/${workspaceId}/${safeName}`;
}

/** Delete an asset from Supabase Storage or local disk. */
export async function deleteAsset(fileName: string, workspaceId = "default"): Promise<void> {
  const safeName = sanitizeAssetFileName(fileName);
  const sb = getSupabase();
  if (sb) {
    await sb.storage.from("design-assets").remove([`${workspaceId}/${safeName}`]);
    return;
  }
  // Local cleanup
  const localPath = resolve(LOCAL_ASSETS_DIR, workspaceId, safeName);
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(localPath);
  } catch { /* file may not exist */ }
}

/**
 * Migrate base64 images in template HTML to Storage URLs.
 * Returns the migrated HTML and a count of images migrated.
 * Only migrates images larger than minSizeBytes (default 100KB).
 */
export async function migrateBase64FromHtml(
  html: string, css: string, workspaceId = "default", minSizeBytes = 100_000
): Promise<{ html: string; css: string; migrated: number }> {
  let migrated = 0;

  // Match base64 data URIs in HTML: src="data:image/...;base64,..."
  // Also match CSS url(data:...) and background: url(...) syntax
  const base64Re = /(?:src|href)\s*=\s*["'](data:image\/[^;]+;base64,([^"']+))["']|(?:url|background)\s*\(\s*(data:image\/[^;]+;base64,([^)]+))\s*\)/gi;

  const matches = [...html.matchAll(base64Re)];
  let cursor = 0;
  const chunks: string[] = [];

  for (const match of matches) {
    const matchIndex = match.index ?? 0;
    const fullMatch = match[0];
    const attrDataUri = match[1];
    const attrB64 = match[2];
    const cssDataUri = match[3];
    const cssB64 = match[4];
    const dataUri = attrDataUri || cssDataUri;
    const b64 = attrB64 || cssB64;
    chunks.push(html.slice(cursor, matchIndex));
    cursor = matchIndex + fullMatch.length;
    if (!b64 || !dataUri) {
      chunks.push(fullMatch);
      continue;
    }

    const buffer = Buffer.from(b64, "base64");
    if (buffer.length < minSizeBytes) {
      chunks.push(fullMatch);
      continue;
    }

    const mimeMatch = dataUri.match(/data:(image\/\w+);base64,/);
    const mimeType = mimeMatch?.[1] || "image/png";
    const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const fileName = `migrated_${hash}.${ext}`;

    const assetUrl = await uploadAsset(fileName, buffer, mimeType, workspaceId);
    migrated++;
    chunks.push(fullMatch.replace(dataUri, assetUrl));
  }

  chunks.push(html.slice(cursor));
  const replaced = chunks.join("");

  return { html: replaced, css, migrated };
}
