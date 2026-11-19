"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Used only when GET /api/defaults is unreachable (offline / API down). */
const FALLBACK_RULES_YAML = `version: 1
include:
  - "**/*.cs"
rules:
  - id: hardcoded-secret
    type: regex
    pattern: '(?i)(password|secret)\\s*=\\s*"[^"]+"'
    message: Potential hardcoded secret
`;

const DEFAULT_SNIPPET = `using System;

namespace RuleCloud.Sample;

public class Example
{
    // Trigger regex: hardcoded secret
    private const string password = "super-secret-demo-key";

    public void Run()
    {
        Console.WriteLine("Hello from Example.cs");
    }
}
`;

type InputMode = "repo" | "snippet";

type ScanStatus = "pass" | "violations" | "error" | "idle" | "scanning";

type Finding = {
  id?: string | null;
  message?: string | null;
  severity?: string | null;
  file?: string | null;
  line?: number | null;
  raw?: Record<string, unknown>;
};

type ScanResult = {
  status: string;
  exit_code: number;
  findings: Finding[];
  duration_ms: number;
  stdout: string;
  stderr: string;
  error?: string;
};

type JobRecord = {
  job_id: string;
  state: "queued" | "running" | "completed" | "failed";
  result?: ScanResult | null;
  error?: string | null;
};

function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  return base || "http://localhost:8000";
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function RulesYamlPanel({
  expanded,
  onToggle,
  value,
  onChange,
  compact,
}: {
  expanded: boolean;
  onToggle: () => void;
  value: string;
  onChange: (v: string) => void;
  compact: boolean;
}) {
  return (
    <div className={compact ? "" : "w-full"}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-slate-300"
      >
        <span>Rule-set YAML</span>
        <span className="text-slate-500">{expanded ? "Hide" : "Show"}</span>
      </button>
      {expanded && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={compact ? 14 : 12}
          spellCheck={false}
          className="mt-3 w-full resize-y rounded-xl border border-white/10 bg-slate-950/80 px-4 py-3 font-mono text-xs leading-relaxed text-cyan-50/85 outline-none focus:border-cyan-500/30 focus:ring-2 focus:ring-cyan-500/15"
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ScanStatus }) {
  const config = useMemo(() => {
    switch (status) {
      case "pass":
        return {
          label: "PASS",
          className:
            "border-emerald-400/50 bg-emerald-500/15 text-emerald-300 badge-glow-pass",
        };
      case "violations":
        return {
          label: "VIOLATIONS",
          className:
            "border-amber-400/50 bg-amber-500/15 text-amber-200 badge-glow-violations",
        };
      case "scanning":
        return {
          label: "SCANNING",
          className:
            "border-cyan-400/50 bg-cyan-500/15 text-cyan-200 badge-glow-scanning animate-scan-pulse",
        };
      case "error":
        return {
          label: "ERROR",
          className:
            "border-red-400/50 bg-red-500/15 text-red-200 badge-glow-error",
        };
      default:
        return {
          label: "READY",
          className: "border-slate-500/40 bg-slate-800/40 text-slate-400",
        };
    }
  }, [status]);

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-widest ${config.className}`}
    >
      {config.label}
    </span>
  );
}

export default function Home() {
  const [mode, setMode] = useState<InputMode>("snippet");
  const [repoUrl, setRepoUrl] = useState("");
  const [filename, setFilename] = useState("Example.cs");
  const [snippet, setSnippet] = useState(DEFAULT_SNIPPET);
  const [rulesYaml, setRulesYaml] = useState(FALLBACK_RULES_YAML);
  const [rulesExpanded, setRulesExpanded] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [displayStatus, setDisplayStatus] = useState<ScanStatus>("idle");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [elapsedSec, setElapsedSec] = useState(0);
  const [showRaw, setShowRaw] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanStartedAt = useRef<number | null>(null);

  const stopTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const mapJobToUi = useCallback((job: JobRecord) => {
    if (job.state === "failed") {
      setDisplayStatus("error");
      setJobError(job.error || "Job failed");
      setResult(job.result ?? null);
      stopTimers();
      return;
    }
    if (job.state === "completed" && job.result) {
      const s = job.result.status;
      if (s === "pass") setDisplayStatus("pass");
      else if (s === "violations") setDisplayStatus("violations");
      else setDisplayStatus("error");
      setResult(job.result);
      setJobError(job.result.error ?? null);
      stopTimers();
      return;
    }
    setDisplayStatus("scanning");
  }, [stopTimers]);

  const pollJob = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${apiBase()}/api/jobs/${id}`);
        if (!res.ok) {
          throw new Error(`Poll failed (${res.status})`);
        }
        const job = (await res.json()) as JobRecord;
        mapJobToUi(job);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Poll failed");
        setDisplayStatus("error");
        stopTimers();
      }
    },
    [mapJobToUi, stopTimers],
  );

  useEffect(() => {
    return () => stopTimers();
  }, [stopTimers]);

  useEffect(() => {
    let cancelled = false;
    const loadDefaults = async () => {
      try {
        const res = await fetch(`${apiBase()}/api/defaults`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { rules_yaml?: string };
        if (!cancelled && data.rules_yaml?.trim()) {
          setRulesYaml(data.rules_yaml);
        }
      } catch {
        /* keep FALLBACK_RULES_YAML */
      }
    };
    void loadDefaults();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!jobId || displayStatus !== "scanning") return;

    pollRef.current = setInterval(() => {
      void pollJob(jobId);
    }, 3000);

    tickRef.current = setInterval(() => {
      if (scanStartedAt.current != null) {
        setElapsedSec(Math.floor((Date.now() - scanStartedAt.current) / 1000));
      }
    }, 250);

    const initialPoll = window.setTimeout(() => {
      void pollJob(jobId);
    }, 0);

    return () => {
      window.clearTimeout(initialPoll);
      stopTimers();
    };
  }, [jobId, displayStatus, pollJob, stopTimers]);

  const runScan = async () => {
    setSubmitError(null);
    setJobError(null);
    setResult(null);
    setJobId(null);
    setElapsedSec(0);
    setShowRaw(false);
    stopTimers();

    const body: Record<string, string> = { rules_yaml: rulesYaml };
    if (mode === "repo") {
      const url = repoUrl.trim();
      if (!url) {
        setSubmitError("Enter a public GitHub repository URL.");
        return;
      }
      body.repo_url = url;
    } else {
      body.code_snippet = snippet;
      body.filename = filename.trim() || "Example.cs";
    }

    setIsSubmitting(true);
    setDisplayStatus("scanning");
    scanStartedAt.current = Date.now();

    try {
      const res = await fetch(`${apiBase()}/api/jobs/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Scan request failed (${res.status})`);
      }
      const data = (await res.json()) as { job_id: string };
      setJobId(data.job_id);
    } catch (err) {
      setDisplayStatus("error");
      setSubmitError(err instanceof Error ? err.message : "Could not start scan");
      stopTimers();
    } finally {
      setIsSubmitting(false);
    }
  };

  const findings = result?.findings ?? [];
  const violationCount = findings.length;

  return (
    <div className="min-h-full w-full px-4 py-10 sm:px-6 lg:px-10">
      <header className="mx-auto mb-10 max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.35em] text-cyan-400/80">
              Rule Cloud
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
              Guardrail static analysis
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Scan a GitHub repo or a C# snippet with your{" "}
              <code className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-cyan-300/90">
                guardrail.yaml
              </code>{" "}
              ruleset. Jobs poll every 3s until complete.
            </p>
          </div>
          <StatusBadge status={displayStatus} />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
        <section className="glass-panel flex flex-col rounded-2xl p-5 shadow-xl shadow-black/20 sm:p-6">
          <div className="mb-5 flex gap-1 rounded-xl border border-white/10 bg-slate-900/50 p-1">
            {(
              [
                ["repo", "GitHub repo"],
                ["snippet", "Quick snippet"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  mode === key
                    ? "bg-cyan-500/20 text-cyan-100 shadow-inner shadow-cyan-500/10"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "repo" ? (
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-300">
                Public repository URL
              </span>
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 font-mono text-sm text-slate-100 outline-none ring-cyan-400/0 transition placeholder:text-slate-600 focus:border-cyan-500/40 focus:ring-2 focus:ring-cyan-500/20"
              />
            </label>
          ) : null}

          <div
            className={`mt-6 gap-4 ${mode === "snippet" ? "grid xl:grid-cols-2" : "border-t border-white/10 pt-5"}`}
          >
            {mode === "snippet" && (
              <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-300">Filename</span>
                  <input
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 font-mono text-sm text-slate-100 outline-none focus:border-cyan-500/40 focus:ring-2 focus:ring-cyan-500/20"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-300">Source code</span>
                  <textarea
                    value={snippet}
                    onChange={(e) => setSnippet(e.target.value)}
                    rows={14}
                    spellCheck={false}
                    className="w-full resize-y rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 font-mono text-xs leading-relaxed text-emerald-50/90 outline-none focus:border-emerald-500/30 focus:ring-2 focus:ring-emerald-500/15"
                  />
                </label>
              </div>
            )}

            <RulesYamlPanel
              expanded={rulesExpanded}
              onToggle={() => setRulesExpanded((v) => !v)}
              value={rulesYaml}
              onChange={setRulesYaml}
              compact={mode === "snippet"}
            />
          </div>

          {submitError && (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {submitError}
            </p>
          )}

          <button
            type="button"
            onClick={() => void runScan()}
            disabled={isSubmitting || displayStatus === "scanning"}
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-900/30 transition hover:from-cyan-500 hover:to-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {displayStatus === "scanning" ? "Scan in progress…" : "Run Guardrail scan"}
          </button>

          {displayStatus === "scanning" && (
            <p className="mt-3 text-center font-mono text-sm text-cyan-300/90">
              Elapsed {formatElapsed(elapsedSec)}
              {jobId ? ` · job ${jobId.slice(0, 8)}…` : ""}
            </p>
          )}
        </section>

        <section className="glass-panel flex flex-col rounded-2xl p-5 shadow-xl shadow-black/20 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-100">Results</h2>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">Status</p>
              <div className="mt-2">
                <StatusBadge status={displayStatus} />
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">Duration</p>
              <p className="mt-2 font-mono text-lg text-slate-100">
                {displayStatus === "scanning"
                  ? formatElapsed(elapsedSec)
                  : formatDuration(result?.duration_ms)}
              </p>
            </div>
            <div className="col-span-2 rounded-xl border border-white/10 bg-slate-900/40 p-3 sm:col-span-1">
              <p className="text-xs uppercase tracking-wider text-slate-500">Findings</p>
              <p className="mt-2 font-mono text-lg text-slate-100">{violationCount}</p>
            </div>
          </div>

          {jobError && (
            <p className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {jobError}
            </p>
          )}

          <div>
            <h3 className="mt-6 text-sm font-medium text-slate-300">
              Violations
            </h3>
            {findings.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                {displayStatus === "idle"
                  ? "Run a scan to see findings."
                  : displayStatus === "scanning"
                    ? "Waiting for Guardrail…"
                    : "No structured findings — check raw output."}
              </p>
            ) : (
              <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                {findings.map((f, i) => (
                  <li
                    key={`${f.id ?? "finding"}-${i}`}
                    className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {f.severity && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200/90">
                          {f.severity}
                        </span>
                      )}
                      {f.file && (
                        <span className="font-mono text-xs text-cyan-300/80">
                          {f.file}
                          {f.line != null ? `:${f.line}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-slate-300">
                      {f.message || f.id || "Issue detected"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="text-sm font-medium text-cyan-400/90 hover:text-cyan-300"
            >
              {showRaw ? "Hide" : "Show"} raw CLI output
            </button>
            {showRaw && (
              <pre className="mt-3 max-h-56 overflow-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
                  {result?.stdout?.trim() ? (
                    <>
                      <span className="text-emerald-500/80"># stdout{"\n"}</span>
                      {result.stdout}
                    </>
                  ) : null}
                  {result?.stderr?.trim() ? (
                    <>
                      {"\n"}
                      <span className="text-amber-500/80"># stderr{"\n"}</span>
                      {result.stderr}
                    </>
                  ) : null}
                  {!result?.stdout && !result?.stderr && (
                    <span className="text-slate-600">No output captured yet.</span>
                  )}
              </pre>
            )}
          </div>
        </section>
      </div>

      <p className="mx-auto mt-8 max-w-6xl text-center font-mono text-xs text-slate-600">
        API {apiBase()}
      </p>
    </div>
  );
}