import { useState, useEffect, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "../lib/supabase";

export interface AuthState {
  user: User | null;
  loading: boolean;
  isLocal: boolean; // true when Supabase is not configured
  login: (email: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
}

/**
 * Supabase Auth hook.
 * - If Supabase is configured: magic-link email login.
 * - If not configured: local mode (no auth, userId = "local").
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseClient();
  const isLocal = !supabase;

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const login = useCallback(
    async (email: string) => {
      if (!supabase) {
        return { error: "Supabase not configured" };
      }

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        return { error: error.message };
      }

      return {};
    },
    [supabase]
  );

  const logout = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  return { user, loading, isLocal, login, logout };
}
