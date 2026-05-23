import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key || url.includes("your-project")) {
    console.warn("[SUPABASE] Not configured — using in-memory storage");
    return null;
  }

  if (!client) {
    client = createClient(url, key);
  }

  return client;
}
