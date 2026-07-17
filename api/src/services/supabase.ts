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

let client: SupabaseClient | null = null;

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
  const url = process.env.SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL_DE_REPO_DESIGN;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY_DE_REPO_DESIGN ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key || url.includes("your-project")) {
    console.warn("[SUPABASE] Not configured — using in-memory storage");
    return null;
  }

  if (!client) {
    client = createClient(url, key);
  }

  return client;
}

// ── Storage helpers ────────────────────────────────────────

const LOCAL_ASSETS_DIR = resolve(process.cwd(), "public", "assets");

/** Upload a file buffer to Supabase Storage. Falls back to local disk. */
export async function uploadAsset(
  fileName: string, buffer: Buffer, contentType: string, workspaceId = "default"
): Promise<string> {
  const sb = getSupabase();
  if (sb) {
    const filePath = `${workspaceId}/${fileName}`;
    const { error } = await sb.storage.from("design-assets").upload(filePath, buffer, {
      contentType, upsert: true,
    });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    const { data } = sb.storage.from("design-assets").getPublicUrl(filePath);
    return data?.publicUrl || "";
  }

  // Local disk fallback
  const dir = resolve(LOCAL_ASSETS_DIR, workspaceId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const localPath = resolve(dir, fileName);
  writeFileSync(localPath, buffer);
  return `/assets/${workspaceId}/${fileName}`;
}

/** Delete an asset from Supabase Storage or local disk. */
export async function deleteAsset(fileName: string, workspaceId = "default"): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    await sb.storage.from("design-assets").remove([`${workspaceId}/${fileName}`]);
    return;
  }
  // Local cleanup
  const localPath = resolve(LOCAL_ASSETS_DIR, workspaceId, fileName);
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

  const replaced = html.replace(base64Re, (fullMatch, attrDataUri, attrB64, cssDataUri, cssB64) => {
    const dataUri = attrDataUri || cssDataUri;
    const b64 = attrB64 || cssB64;
    if (!b64 || !dataUri) return fullMatch;

    const buffer = Buffer.from(b64, "base64");
    if (buffer.length < minSizeBytes) return fullMatch; // keep small images inline

    const mimeMatch = dataUri.match(/data:(image\/\w+);base64,/);
    const mimeType = mimeMatch?.[1] || "image/png";
    const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const fileName = `migrated_${hash}.${ext}`;

    // Synchronous fallback for migration (called from template service)
    const sb = getSupabase();
    if (sb) {
      const filePath = `${workspaceId}/${fileName}`;
      sb.storage.from("design-assets").upload(filePath, buffer, {
        contentType: mimeType, upsert: true,
      }).then(() => {}).catch(() => {});
      const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/design-assets/${workspaceId}/${fileName}`;
      migrated++;
      return fullMatch.replace(dataUri, publicUrl);
    }

    // Local disk fallback
    const dir = resolve(LOCAL_ASSETS_DIR, workspaceId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, fileName), buffer);
    migrated++;
    return fullMatch.replace(dataUri, `/assets/${workspaceId}/${fileName}`);
  });

  return { html: replaced, css, migrated };
}
