import { useCallback, useEffect, useState } from "react";
import { normalizePlan } from "../config/featureAccess";
import { supabase } from "../lib/supabaseClient";

const ACTIVE_STATUSES = new Set(["active", "trialing", "trial"]);

function normalizeStatus(status) {
  return String(status || "inactive").trim().toLowerCase() || "inactive";
}

export default function useSubscription(user, options = {}) {
  const { isDemoMode = false } = options;
  const [subscription, setSubscription] = useState(null);
  const [plan, setPlan] = useState("starter");
  const [status, setStatus] = useState("inactive");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isFallback, setIsFallback] = useState(false);

  const loadSubscription = useCallback(async () => {
    if (!user?.id) {
      setSubscription(null);
      setPlan("starter");
      setStatus("inactive");
      setIsFallback(false);
      setError("");
      setLoading(false);
      return;
    }

    if (isDemoMode) {
      setSubscription({
        id: "demo-preview-subscription",
        user_id: user.id,
        plan: "enterprise",
        status: "preview",
        created_at: null,
      });
      setPlan("enterprise");
      setStatus("preview");
      setIsFallback(false);
      setError("");
      setLoading(false);
      return;
    }

    if (!supabase) {
      setSubscription(null);
      setPlan("starter");
      setStatus("unavailable");
      setIsFallback(true);
      setError("Supabase client is not available.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data, error: queryError } = await supabase
        .from("subscriptions")
        .select("id, user_id, plan, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (queryError) {
        throw queryError;
      }

      const row = Array.isArray(data) ? data[0] : null;

      if (!row) {
        setSubscription(null);
        setPlan("starter");
        setStatus("inactive");
        setIsFallback(false);
        setLoading(false);
        return;
      }

      const nextStatus = normalizeStatus(row.status);
      const nextPlan = normalizePlan(row.plan);
      const effectivePlan = ACTIVE_STATUSES.has(nextStatus) ? nextPlan : "starter";

      setSubscription(row);
      setPlan(effectivePlan);
      setStatus(nextStatus);
      setIsFallback(false);
    } catch (err) {
      setSubscription(null);
      setPlan("starter");
      setStatus("unavailable");
      setIsFallback(true);
      setError(err?.message || "Unable to load subscription.");
    } finally {
      setLoading(false);
    }
  }, [isDemoMode, user]);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  return {
    subscription,
    plan,
    status,
    loading,
    error,
    isFallback,
    refresh: loadSubscription,
  };
}
