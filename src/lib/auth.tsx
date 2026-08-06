import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { initializeBrowserSupabase, isSupabaseAuthConfigured } from "./supabaseClient";
import { setAccessToken } from "./apiKey";

/**
 * Remove ALL Futuraria user-specific data from localStorage on sign-out.
 * localStorage is shared across accounts on the same browser, so without
 * this cleanup the next user would inherit the previous user's chat history,
 * LLM provider keys, workspace API key, template cache, etc. — a real
 * cross-account data leak.
 */
function purgeUserLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("futuraria-") || key.startsWith("futuraria_"))) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) localStorage.removeItem(key);
  } catch { /* localStorage may be blocked — best-effort */ }
}

type AuthContextValue = {
  configured: boolean;
  authRequired: boolean;
  configurationError: string | null;
  loading: boolean;
  session: Session | null;
  user: User | null;
  /** The signed-in user's personal workspace id (from /account/bootstrap). */
  workspaceId: string | null;
  passwordRecovery: boolean;
  needsPasswordSetup: boolean;
  completePasswordRecovery: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Parse tokens from the URL hash fragment, handling double-hash URLs. */
function parseHashParams(): URLSearchParams {
  const raw = window.location.hash.replace(/^#/, "");
  const lastHash = raw.lastIndexOf("#");
  const fragment = lastHash >= 0 ? raw.slice(lastHash + 1) : raw;
  return new URLSearchParams(fragment);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // ── Snapshot hash params at mount — these survive detectSessionInUrl cleanup ──
  const hashParams = parseHashParams();
  const isRecoveryInHash = hashParams.get("type") === "recovery";
  const hasResetParam = new URLSearchParams(window.location.search).get("reset") === "1";

  const [session, setSession] = useState<Session | null>(null);
  const [configured, setConfigured] = useState(isSupabaseAuthConfigured);
  const [authRequired, setAuthRequired] = useState(isSupabaseAuthConfigured);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(hasResetParam || isRecoveryInHash);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  // Track the previous user id so we can purge localStorage when the identity
  // changes — not just on explicit signOut but also when Supabase fires
  // SIGNED_IN for a different user (e.g. switching accounts in another tab).
  const prevUserIdRef = useRef<string | null>(null);

  // ── Cross-account purge: when the signed-in user changes, wipe ALL
  // Futuraria localStorage so the new user doesn't inherit the previous
  // user's chat history, LLM keys, workspace API key, etc. ──
  const currentUserId = session?.user?.id ?? null;
  useEffect(() => {
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentUserId) {
      purgeUserLocalStorage();
      setWorkspaceId(null);
    }
    prevUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const activateSession = (nextSession: Session | null) => {
      if (!active) return;
      setAccessToken(nextSession?.access_token || "");
      setSession(nextSession);
    };

    const bootstrapAccount = (nextSession: Session | null) => {
      if (!nextSession) return;
      const headers = { Authorization: `Bearer ${nextSession.access_token}`, "Content-Type": "application/json; charset=utf-8" };
      // Bootstrap creates/returns the user's personal workspace; capture its id
      // so the dashboard loads the right (per-user) workspace instead of a
      // hardcoded one.
      void fetch("/api/account/bootstrap", { method: "POST", headers, body: "{}" })
        .then((r) => (r.ok ? r.json() : null))
        .then((payload) => {
          const id = payload?.data?.personalWorkspaceId;
          if (typeof id === "string" && id) setWorkspaceId(id);
        })
        .catch(() => undefined);
    };

    void initializeBrowserSupabase().then(async ({ client, authRequired: required, error }) => {
      if (!active) return;
      setConfigured(Boolean(client));
      setAuthRequired(required);
      setConfigurationError(error);
      if (!client) return;

      // Standard session check (handles persisted sessions + detectSessionInUrl).
      const { data } = await client.auth.getSession();
      activateSession(data.session);
      bootstrapAccount(data.session);

      // ── PKCE fallback ──────────────────────────────────────────────
      // detectSessionInUrl relies on a PKCE code_verifier stored in the
      // browser when the email was requested. If the user opens the link
      // in a different tab or after storage was cleared the exchange
      // fails silently → no session → "expired". Extract tokens from the
      // hash directly as a safety net.
      if (!data.session && isRecoveryInHash) {
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        if (accessToken && refreshToken) {
          try {
            const { data: recovered } = await client.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (recovered.session) {
              activateSession(recovered.session);
              bootstrapAccount(recovered.session);
              setPasswordRecovery(true);
              // Clean hash so the URL doesn't carry stale tokens.
              window.history.replaceState(
                null,
                "",
                window.location.pathname + window.location.search + "#workspace",
              );
            }
          } catch {
            // Token is genuinely expired or invalid — let the UI handle it.
          }
        }
      }

      if (!active) return;

      const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
        if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
        activateSession(nextSession);
        bootstrapAccount(nextSession);
        if (active) setLoading(false);
      });
      unsubscribe = () => listener.subscription.unsubscribe();
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured,
    authRequired,
    configurationError,
    loading,
    session,
    user: session?.user || null,
    workspaceId,
    passwordRecovery,
    needsPasswordSetup: Boolean(session?.user?.user_metadata?.needs_password_setup),
    completePasswordRecovery: () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("reset");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash || "#workspace"}`);
      setPasswordRecovery(false);
    },
    signOut: async () => {
      const { client } = await initializeBrowserSupabase();
      if (client) await client.auth.signOut({ scope: "local" });
      setAccessToken("");
      // Purge all user-specific localStorage so the next account starts clean
      // (chat history, LLM keys, workspace API key, template cache, etc.).
      purgeUserLocalStorage();
      setWorkspaceId(null);
    },
  }), [authRequired, configurationError, configured, loading, passwordRecovery, session, workspaceId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
