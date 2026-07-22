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
 *   SUPABASE_SERVICE_KEY                → service_role JWT (server-side only)
 *   SUPABASE_ANON_KEY                   → fallback anon key
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

function currentRequestAuth(): RequestAuth | undefined {
  const context = (globalThis as any)[Symbol.for("futuraria.requestContext")];
  return context?.getStore?.();
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL_DE_REPO_DESIGN;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY_DE_REPO_DESIGN;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  return { url, serviceKey, anonKey };
}

/** Public browser configuration. The anon key is intentionally public; the service key never is. */
export function getPublicSupabaseConfig(): { url: string; anonKey: string } | null {
  const { url, anonKey } = supabaseConfig();
  if (!url || !anonKey || url.includes("your-project") || anonKey.includes("your_anon_key")) return null;
  return { url, anonKey };
}

export function getSupabaseAdmin(): SupabaseClient | null {
  const { url, serviceKey, anonKey } = supabaseConfig();
  const key = serviceKey || anonKey;
  if (!url || !key || url.includes("your-project")) return null;
  if (!adminClient) {
    adminClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return adminClient;
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
  const { url, anonKey } = supabaseConfig();
  const auth = currentRequestAuth();
  if (auth?.accessToken && url && anonKey) {
    if (!auth.scopedClient) {
      auth.scopedClient = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${auth.accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
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
