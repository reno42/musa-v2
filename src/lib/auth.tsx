import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { browserSupabase, isSupabaseAuthConfigured } from "./supabaseClient";
import { setAccessToken } from "./apiKey";

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseAuthConfigured);

  useEffect(() => {
    if (!browserSupabase) {
      setLoading(false);
      return;
    }
    let active = true;
    const activateSession = (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      setAccessToken(nextSession?.access_token || "");
      if (!nextSession) return;
      const headers = { Authorization: `Bearer ${nextSession.access_token}`, "Content-Type": "application/json; charset=utf-8" };
      void fetch("/api/account/bootstrap", { method: "POST", headers, body: "{}" }).catch(() => undefined);
      const inviteToken = new URLSearchParams(window.location.search).get("invite");
      if (inviteToken) {
        void fetch("/api/account/invitations/accept", {
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
    };
    browserSupabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      activateSession(data.session);
      setLoading(false);
    });
    const { data: listener } = browserSupabase.auth.onAuthStateChange((_event, nextSession) => {
      activateSession(nextSession);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: isSupabaseAuthConfigured,
    loading,
    session,
    user: session?.user || null,
    signOut: async () => {
      if (browserSupabase) await browserSupabase.auth.signOut();
      setAccessToken("");
    },
  }), [loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
