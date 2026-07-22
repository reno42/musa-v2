import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { initializeBrowserSupabase, isSupabaseAuthConfigured } from "./supabaseClient";
import { setAccessToken } from "./apiKey";

type AuthContextValue = {
  configured: boolean;
  authRequired: boolean;
  configurationError: string | null;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [configured, setConfigured] = useState(isSupabaseAuthConfigured);
  const [authRequired, setAuthRequired] = useState(isSupabaseAuthConfigured);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const activateSession = async (nextSession: Session | null) => {
      if (!active) return;
      setAccessToken(nextSession?.access_token || "");
      if (nextSession) {
        const headers = { Authorization: `Bearer ${nextSession.access_token}`, "Content-Type": "application/json; charset=utf-8" };
        await fetch("/api/account/bootstrap", { method: "POST", headers, body: "{}" }).catch(() => undefined);
        const inviteToken = new URLSearchParams(window.location.search).get("invite");
        if (inviteToken) {
          await fetch("/api/account/invitations/accept", {
            method: "POST",
            headers,
            body: JSON.stringify({ token: inviteToken }),
          }).then((response) => {
            if (response.ok) {
              const url = new URL(window.location.href);
              url.searchParams.delete("invite");
              window.history.replaceState(null, "", `${url.pathname}${url.search}#workspace`);
            }
          }).catch(() => undefined);
        }
      }
      if (active) setSession(nextSession);
    };

    void initializeBrowserSupabase().then(async ({ client, authRequired: required, error }) => {
      if (!active) return;
      setConfigured(Boolean(client));
      setAuthRequired(required);
      setConfigurationError(error);
      if (!client) return;

      const { data } = await client.auth.getSession();
      await activateSession(data.session);
      if (!active) return;

      const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
        void activateSession(nextSession).finally(() => {
          if (active) setLoading(false);
        });
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
    signOut: async () => {
      const { client } = await initializeBrowserSupabase();
      if (client) await client.auth.signOut();
      setAccessToken("");
    },
  }), [authRequired, configurationError, configured, loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
