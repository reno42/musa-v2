import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabasePublicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export let isSupabaseAuthConfigured = Boolean(supabaseUrl && supabasePublicKey);

export let browserSupabase: SupabaseClient | null = isSupabaseAuthConfigured
  ? createClient(supabaseUrl, supabasePublicKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export type BrowserAuthInitialization = {
  client: SupabaseClient | null;
  authRequired: boolean;
  error: string | null;
};

let initialization: Promise<BrowserAuthInitialization> | null = null;

export function initializeBrowserSupabase(): Promise<BrowserAuthInitialization> {
  if (browserSupabase) {
    return Promise.resolve({ client: browserSupabase, authRequired: true, error: null });
  }
  if (initialization) return initialization;

  initialization = fetch("/api/auth/config", { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`No se pudo cargar la configuración (${response.status}).`);
      const payload = await response.json();
      const config = payload?.data;
      const publishableKey = config?.publishableKey || config?.anonKey;
      if (!config?.configured || !config.url || !publishableKey) {
        return {
          client: null,
          authRequired: Boolean(config?.authRequired),
          error: config?.authRequired
            ? "Falta SUPABASE_PUBLISHABLE_KEY en el entorno del servidor."
            : null,
        };
      }
      browserSupabase = createClient(config.url, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      isSupabaseAuthConfigured = true;
      return { client: browserSupabase, authRequired: true, error: null };
    })
    .catch((cause: unknown) => ({
      client: null,
      authRequired: true,
      error: cause instanceof Error ? cause.message : "No se pudo iniciar la autenticación.",
    }));

  return initialization;
}
