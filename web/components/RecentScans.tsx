"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api";

export type JobSummary = {
  job_id: string;
  state: string;
  created_at?: string;
  source_type?: string;
  violation_count?: number;
  scan_status?: string | null;
  error?: string | null;
};

function formatWhen(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function RecentScans({
  onSelectJob,
  refreshKey,
}: {
  onSelectJob: (jobId: string) => void;
  refreshKey?: number;
}) {
  const { accessToken, user } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !accessToken) {
      setJobs([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/jobs", {}, accessToken);
      if (!res.ok) {
        throw new Error(`Failed to load scans (${res.status})`);
      }
      const data = (await res.json()) as { jobs?: JobSummary[] };
      setJobs(data.jobs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load scans");
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [load, refreshKey]);

  if (!user) {
    return null;
  }

  return (
    <aside className="glass-panel rounded-2xl p-5 shadow-xl shadow-black/20 sm:p-6 lg:col-span-1">
      <h2 className="text-lg font-semibold text-slate-100">Recent scans</h2>
      <p className="mt-1 text-xs text-slate-500">Your last 50 workspace jobs</p>

      {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {error && (
        <p className="mt-4 text-sm text-red-300/90">{error}</p>
      )}

      {!loading && !error && jobs.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No saved scans yet.</p>
      )}

      <ul className="mt-4 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {jobs.map((job) => (
          <li key={job.job_id}>
            <button
              type="button"
              onClick={() => onSelectJob(job.job_id)}
              className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-left transition hover:border-cyan-500/30 hover:bg-slate-900/60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-cyan-300/80">
                  {job.job_id.slice(0, 8)}…
                </span>
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {job.state}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{formatWhen(job.created_at)}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {job.violation_count ?? 0} findings
                {job.scan_status ? ` · ${job.scan_status}` : ""}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}