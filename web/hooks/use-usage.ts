"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api";
import type { UsageSnapshot } from "@/lib/types";

export function useUsage() {
  const { user, accessToken } = useAuth();
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || !accessToken) {
      setUsage(null);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/usage", {}, accessToken);
      if (res.ok) {
        setUsage((await res.json()) as UsageSnapshot);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  return { usage, loading, refresh };
}