"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api";
import type { JobRecord, JobSummary } from "@/lib/types";

export function useJobsPoll(intervalMs = 5000, enabled = true) {
  const { user, accessToken } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || !accessToken) {
      setJobs([]);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/jobs", {}, accessToken);
      if (res.ok) {
        const data = (await res.json()) as { jobs?: JobSummary[] };
        setJobs(data.jobs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    if (!enabled) return;
    const t0 = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(id);
    };
  }, [refresh, intervalMs, enabled]);

  const fetchJob = useCallback(
    async (jobId: string): Promise<JobRecord | null> => {
      if (!accessToken) return null;
      const res = await apiFetch(`/api/jobs/${jobId}`, {}, accessToken);
      if (!res.ok) return null;
      return (await res.json()) as JobRecord;
    },
    [accessToken],
  );

  return { jobs, loading, refresh, fetchJob };
}