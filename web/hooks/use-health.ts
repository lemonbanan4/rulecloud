"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

export type HealthState = "ok" | "degraded" | "unknown" | "offline";

export function useHealth(pollMs = 30_000) {
  const [health, setHealth] = useState<HealthState>("unknown");

  const poll = useCallback(async () => {
    try {
      const res = await apiFetch("/health", { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        setHealth("offline");
        return;
      }
      const data = (await res.json()) as { status?: string };
      setHealth(data.status === "ok" ? "ok" : "degraded");
    } catch {
      setHealth("offline");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void poll();
    }, 0);
    const id = window.setInterval(() => {
      void poll();
    }, pollMs);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, [poll, pollMs]);

  return health;
}