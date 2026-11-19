"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { ScanDetailDrawer } from "@/components/ScanDetailDrawer";
import { ConsoleCard } from "@/components/ui/ConsoleCard";
import { StatusDot } from "@/components/ui/StatusDot";
import { useJobs } from "@/hooks/use-jobs";
import { formatWhen, sourceLabel } from "@/lib/format";
import type { JobRecord } from "@/lib/types";

type Filter = "all" | "pass" | "violations" | "failed";

export default function ScansPage() {
  const params = useSearchParams();
  const { jobs, loading, fetchJob } = useJobs();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [drawerJob, setDrawerJob] = useState<JobRecord | null>(null);

  useEffect(() => {
    const jobId = params.get("job");
    if (!jobId) return;
    let cancelled = false;
    const run = async () => {
      const job = await fetchJob(jobId);
      if (!cancelled && job) setDrawerJob(job);
    };
    const t = window.setTimeout(() => {
      void run();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [params, fetchJob]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (filter === "pass" && j.scan_status !== "pass") return false;
      if (filter === "violations" && j.scan_status !== "violations") return false;
      if (filter === "failed" && j.state !== "failed") return false;
      if (q && !j.job_id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [jobs, filter, query]);

  const open = async (id: string) => {
    const job = await fetchJob(id);
    if (job) setDrawerJob(job);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Scan Logs</h1>
        <p className="text-sm text-zinc-500">Full workspace job history with inspection drawer.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["pass", "Passed"],
            ["violations", "Violations"],
            ["failed", "Failed"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              filter === key
                ? "bg-[#FAFAFA] text-zinc-900"
                : "border border-white/[0.08] text-zinc-400 hover:bg-[#18181B]"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#0F0F12] px-2">
          <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.5} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by job id…"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
          />
        </div>
      </div>

      <ConsoleCard className="overflow-x-auto p-0">
        {loading ? (
          <p className="p-4 text-sm text-zinc-500">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-white/[0.08] text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left">Job</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Source</th>
                <th className="px-4 py-2 text-left">Findings</th>
                <th className="px-4 py-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => (
                <tr
                  key={j.job_id}
                  onClick={() => void open(j.job_id)}
                  className="cursor-pointer border-t border-white/[0.06] hover:bg-[#18181B]"
                >
                  <td className="px-4 py-2.5 font-mono text-xs">{j.job_id.slice(0, 12)}…</td>
                  <td className="px-4 py-2.5">
                    <StatusDot state={j.state} scanStatus={j.scan_status} />
                  </td>
                  <td className="px-4 py-2.5 text-xs">{sourceLabel(j.source_type)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{j.violation_count ?? 0}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500">{formatWhen(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ConsoleCard>

      <ScanDetailDrawer job={drawerJob} onClose={() => setDrawerJob(null)} />
    </div>
  );
}