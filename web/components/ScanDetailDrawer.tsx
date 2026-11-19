"use client";

import { X } from "lucide-react";

import { CodeEditor } from "@/components/CodeEditor";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { formatDuration, formatWhen } from "@/lib/format";
import type { JobRecord } from "@/lib/types";

export function ScanDetailDrawer({
  job,
  onClose,
}: {
  job: JobRecord | null;
  onClose: () => void;
}) {
  if (!job) return null;

  const rulesYaml =
    (typeof job.request?.rules_yaml === "string" && job.request.rules_yaml) || "";
  const findings = job.result?.findings ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <button type="button" className="flex-1" aria-label="Close" onClick={onClose} />
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-white/[0.08] bg-[#0F0F12] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <div>
            <p className="font-mono text-xs text-zinc-500">{job.job_id}</p>
            <p className="text-sm font-medium text-zinc-100">{job.state}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-zinc-800">
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-white/[0.08] p-2">
              <p className="text-zinc-500">Created</p>
              <p className="mt-1 text-zinc-200">{formatWhen(job.created_at)}</p>
            </div>
            <div className="rounded-lg border border-white/[0.08] p-2">
              <p className="text-zinc-500">Duration</p>
              <p className="mt-1 font-mono text-zinc-200">
                {formatDuration(job.result?.duration_ms)}
              </p>
            </div>
          </div>

          {rulesYaml ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                guardrail.yaml
              </p>
              <CodeEditor value={rulesYaml} readOnly rows={10} />
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Violations ({findings.length})
            </p>
            <ul className="space-y-2">
              {findings.map((f, i) => (
                <li
                  key={`${f.id}-${i}`}
                  className="rounded-lg border border-white/[0.08] bg-[#09090B] p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <span className="font-mono text-xs text-cyan-300/80">
                      {f.file}
                      {f.line != null ? `:${f.line}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-zinc-300">{f.message || f.id}</p>
                </li>
              ))}
              {findings.length === 0 ? (
                <li className="text-sm text-zinc-500">No violations recorded.</li>
              ) : null}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Raw JSON
            </p>
            <pre className="max-h-64 overflow-auto rounded-lg border border-white/[0.08] bg-black/40 p-3 font-mono text-[11px] text-zinc-400">
              {JSON.stringify(job.result ?? job, null, 2)}
            </pre>
          </div>
        </div>
      </aside>
    </div>
  );
}