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
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SECRET_KEY_DE_REPO_DESIGN;

  if (!url || !key || url.includes("your-project")) {
    console.warn("[SUPABASE] Not configured — using in-memory storage");
    return null;
  }

  if (!client) {
    client = createClient(url, key);
  }

  return client;
}
