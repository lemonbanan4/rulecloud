"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api";
import type { JobRecord, JobSummary } from "@/lib/types";

export function useJobs(refreshKey?: number) {
  const { user, accessToken } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user || !accessToken) {
      setJobs([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/jobs", {}, accessToken);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = (await res.json()) as { jobs?: JobSummary[] };
      setJobs(data.jobs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load jobs");
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(t);
  }, [refresh, refreshKey]);

  const fetchJob = useCallback(
    async (jobId: string): Promise<JobRecord | null> => {
      if (!accessToken) return null;
      const res = await apiFetch(`/api/jobs/${jobId}`, {}, accessToken);
      if (!res.ok) return null;
      return (await res.json()) as JobRecord;
    },
    [accessToken],
  );

  return { jobs, loading, error, refresh, fetchJob };
}