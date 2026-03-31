import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase, supabaseError } from "./supabaseClient";

export const AuthContext = createContext({
  user: null,
  session: null,
  loading: true,
  error: "",
  signIn: async () => ({ error: null }),
  signOut: async () => ({ error: null }),
  isDemoMode: false,
  enterDemoMode: async () => ({ error: null }),
  exitDemoMode: async () => ({ error: null }),
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(supabaseError || "");
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!isMounted) return;
        if (sessionError) {
          setError(sessionError.message);
        }
        setSession(data?.session || null);
        setUser(data?.session?.user || null);
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setUser(nextSession?.user || null);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async ({ email, password }) => {
    if (!supabase) {
      return { error: new Error(supabaseError || "Supabase client is not configured.") };
    }

    setError("");
    return supabase.auth.signInWithPassword({ email, password });
  };

  const signOut = async () => {
    if (isDemoMode) {
      setIsDemoMode(false);
      setUser(null);
      setSession(null);
      return { error: null };
    }

    if (!supabase) {
      return { error: new Error(supabaseError || "Supabase client is not configured.") };
    }

    return supabase.auth.signOut();
  };

  const enterDemoMode = async () => {
    setIsDemoMode(true);
    setUser({
      id: "demo-user-id",
      email: "demo@falconmed.local",
      user_metadata: { plan: "enterprise" },
      app_metadata: { plan: "enterprise" },
    });
    setSession({});
    setError("");
    return { error: null };
  };

  const exitDemoMode = async () => {
    setIsDemoMode(false);
    setUser(null);
    setSession(null);
    return { error: null };
  };

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      error,
      signIn,
      signOut,
      isDemoMode,
      enterDemoMode,
      exitDemoMode,
    }),
    [error, isDemoMode, loading, session, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuthContext = () => useContext(AuthContext);
