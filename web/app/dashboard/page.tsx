"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, CheckCircle2, ShieldAlert, Gauge } from "lucide-react";

import { ScanDetailDrawer } from "@/components/ScanDetailDrawer";
import { ConsoleCard } from "@/components/ui/ConsoleCard";
import { StatusDot } from "@/components/ui/StatusDot";
import { useJobs } from "@/hooks/use-jobs";
import { useUsage } from "@/hooks/use-usage";
import { formatRelativeShort, sourceLabel } from "@/lib/format";
import type { JobRecord } from "@/lib/types";

export default function OverviewPage() {
  const { jobs, loading, fetchJob } = useJobs();
  const { usage } = useUsage();
  const [drawerJob, setDrawerJob] = useState<JobRecord | null>(null);

  const metrics = useMemo(() => {
    const anchorMs = jobs.reduce((max, j) => {
      const t = j.created_at ? new Date(j.created_at).getTime() : 0;
      return t > max ? t : max;
    }, 0);
    const now = anchorMs;
    const d30 = now - 30 * 86400000;
    const recent = jobs.filter((j) => {
      const t = j.created_at ? new Date(j.created_at).getTime() : 0;
      return t >= d30;
    });
    const completed = recent.filter((j) => j.state === "completed");
    const passed = completed.filter((j) => j.scan_status === "pass");
    const violationsSum = completed.reduce((a, j) => a + (j.violation_count ?? 0), 0);
    const passRate =
      completed.length > 0 ? Math.round((passed.length / completed.length) * 100) : 0;
    return {
      total30: recent.length,
      violationsSum,
      passRate,
      remaining: usage ? Math.max(usage.limit - usage.used, 0) : "—",
    };
  }, [jobs, usage]);

  const spark = useMemo(() => {
    const buckets = Array.from({ length: 14 }, () => 0);
    const anchorMs = jobs.reduce((max, j) => {
      const t = j.created_at ? new Date(j.created_at).getTime() : 0;
      return t > max ? t : max;
    }, 0);
    jobs.forEach((j) => {
      if (!j.created_at || !anchorMs) return;
      const diff = Math.floor(
        (anchorMs - new Date(j.created_at).getTime()) / 86400000,
      );
      if (diff >= 0 && diff < 14) buckets[13 - diff] += 1;
    });
    const max = Math.max(...buckets, 1);
    return buckets.map((c) => Math.round((c / max) * 100));
  }, [jobs]);

  const recent = jobs.slice(0, 10);

  const openJob = async (id: string) => {
    const job = await fetchJob(id);
    if (job) setDrawerJob(job);
  };

  const kpis = [
    {
      label: "Total scans (30d)",
      value: metrics.total30,
      icon: Activity,
    },
    {
      label: "Violations blocked",
      value: metrics.violationsSum,
      icon: ShieldAlert,
    },
    {
      label: "Clean pass rate",
      value: `${metrics.passRate}%`,
      icon: CheckCircle2,
    },
    {
      label: "Quota remaining",
      value: metrics.remaining,
      icon: Gauge,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500">Workspace health and recent Guardrail activity.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <ConsoleCard key={k.label}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-zinc-500">{k.label}</p>
                  <p className="mt-2 font-mono text-2xl text-zinc-100">{k.value}</p>
                </div>
                <Icon className="h-4 w-4 text-zinc-500" strokeWidth={1.5} />
              </div>
            </ConsoleCard>
          );
        })}
      </div>

      <ConsoleCard>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Scan activity</p>
        <div className="mt-4 flex h-24 items-end gap-1">
          {spark.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-gradient-to-t from-emerald-600/40 to-cyan-400/60"
              style={{ height: `${Math.max(h, 4)}%` }}
              title={`${h}%`}
            />
          ))}
        </div>
      </ConsoleCard>

      <ConsoleCard className="p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Recent scans</h2>
          <Link href="/dashboard/scans" className="text-xs text-cyan-400 hover:text-cyan-300">
            View all
          </Link>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-zinc-500">Loading…</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/[0.08] text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Findings</th>
                <th className="px-4 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((j) => (
                <tr
                  key={j.job_id}
                  className="cursor-pointer border-t border-white/[0.06] hover:bg-[#18181B]"
                  onClick={() => void openJob(j.job_id)}
                >
                  <td className="px-4 py-2.5">
                    <StatusDot state={j.state} scanStatus={j.scan_status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase">
                      {sourceLabel(j.source_type)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{j.violation_count ?? 0}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500">
                    {formatRelativeShort(j.created_at)}
                  </td>
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