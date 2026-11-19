"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";

import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { useScanRunner } from "@/hooks/use-scan-runner";

const DEMO_SNIPPET = `import pg from "pg";

export function SettingsPanel() {
  // Violation 1: hardcoded secret
  const api_key = "sk_live_rulecloud_demo_key_9f2a";

  // Violation 2: forbidden DB driver in UI code
  return pg.connect(process.env.DATABASE_URL);
}
`;

const DEMO_RULES = `version: 1
timeout_ms: 5000
include:
  - "**/*.ts"
  - "**/*.tsx"
rules:
  - id: hardcoded-api-key
    type: regex
    description: Block literal API keys in source.
    pattern: '(?i)(api_key|apikey)\\s*=\\s*"[^"]{8,}"'
    message: Hardcoded API key detected
  - id: no-pg-in-ui
    type: regex
    description: UI layer must not import pg directly.
    pattern: 'from\\s+["'']pg["'']|require\\(["'']pg["'']\\)'
    message: Forbidden database driver import in presentation code
`;

export function LiveSandbox() {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { phase, result, jobError, elapsedSec, runScan } = useScanRunner();

  const onRun = () => {
    setSubmitError(null);
    void runScan({
      code_snippet: DEMO_SNIPPET,
      filename: "SettingsPanel.tsx",
      rules_yaml: DEMO_RULES,
    });
  };

  const findings = result?.findings ?? [];
  const scanning = phase === "scanning";

  return (
    <section
      id="live-demo"
      className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6"
    >
      <div className="mb-8 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-cyan-400/90">
          Try without signing in
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
          Live Guardrail scan on real infrastructure
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-500">
          Runs on the same Railway API as production — anonymous IP rate limits apply.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0F0F12]/90 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-white/[0.08] bg-[#09090B] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
          <span className="ml-2 font-mono text-xs text-zinc-500">demo · SettingsPanel.tsx</span>
        </div>
        <div className="grid gap-0 lg:grid-cols-2">
          <pre className="max-h-80 overflow-auto border-b border-white/[0.08] p-4 font-mono text-[11px] leading-relaxed text-emerald-100/85 lg:border-b-0 lg:border-r">
            {DEMO_SNIPPET}
          </pre>
          <div className="flex flex-col p-4">
            <button
              type="button"
              disabled={scanning}
              onClick={onRun}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#FAFAFA] py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-60"
            >
              {scanning ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              ) : (
                <Play className="h-4 w-4" strokeWidth={1.5} />
              )}
              {scanning ? `Scanning… ${elapsedSec}s` : "Run Live Scan"}
            </button>

            {submitError || jobError ? (
              <p className="mt-3 text-sm text-red-300">{submitError || jobError}</p>
            ) : null}

            <div className="mt-4 min-h-[8rem] flex-1 space-y-2">
              {scanning && findings.length === 0 ? (
                <p className="text-sm text-cyan-300/80">Waiting for Guardrail…</p>
              ) : null}
              {!scanning && phase === "idle" ? (
                <p className="text-sm text-zinc-600">
                  Two intentional violations — hit Run to see results.
                </p>
              ) : null}
              {findings.map((f, i) => (
                <div
                  key={`${f.id}-${i}`}
                  className="rounded-lg border border-white/[0.08] bg-[#09090B] px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={f.severity || "warning"} />
                    <span className="font-mono text-xs text-zinc-500">
                      {f.file}
                      {f.line != null ? `:${f.line}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-zinc-300">{f.message || f.id}</p>
                </div>
              ))}
              {phase === "pass" && findings.length === 0 ? (
                <p className="text-sm text-emerald-400">Clean pass (unexpected for demo snippet).</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}