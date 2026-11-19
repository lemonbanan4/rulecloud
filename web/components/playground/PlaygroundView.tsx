"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Sparkles } from "lucide-react";

import { AutoFixModal } from "@/components/AutoFixModal";
import { CodeEditor } from "@/components/CodeEditor";
import { UpgradeProModal } from "@/components/UpgradeProModal";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { useAuth } from "@/contexts/auth-context";
import { useScanRunner } from "@/hooks/use-scan-runner";
import { apiFetch } from "@/lib/api";
import {
  DEFAULT_SNIPPET,
  loadPlaygroundYaml,
  PLAYGROUND_PRESETS,
  savePlaygroundYaml,
} from "@/lib/rule-presets";
import type { Finding } from "@/lib/types";

const FALLBACK_RULES = `version: 1
include:
  - "**/*.cs"
rules:
  - id: hardcoded-secret
    type: regex
    pattern: '(?i)(password|secret)\\s*=\\s*"[^"]+"'
    message: Potential hardcoded secret
`;

type RightTab = "yaml" | "violations" | "raw";

export function PlaygroundView() {
  const { accessToken } = useAuth();
  const [filename, setFilename] = useState("Example.cs");
  const [snippet, setSnippet] = useState(DEFAULT_SNIPPET);
  const [rulesYaml, setRulesYaml] = useState(
    () => loadPlaygroundYaml() || FALLBACK_RULES,
  );
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [presetId, setPresetId] = useState(PLAYGROUND_PRESETS[0].id);
  const [rightTab, setRightTab] = useState<RightTab>("yaml");
  const [error, setError] = useState<string | null>(null);
  const [autofixBusy, setAutofixBusy] = useState<number | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [autofixOpen, setAutofixOpen] = useState(false);
  const [autofixPayload, setAutofixPayload] = useState<{
    explanation: string;
    patchedCode: string;
    diff: string;
  } | null>(null);

  const onScanDone = useCallback(() => {
    setRightTab("violations");
  }, []);

  const { phase, result, jobError, elapsedSec, runScan } = useScanRunner(onScanDone);

  useEffect(() => {
    void (async () => {
      if (loadPlaygroundYaml()) return;
      try {
        const res = await apiFetch("/api/defaults");
        if (res.ok) {
          const data = (await res.json()) as { rules_yaml?: string };
          if (data.rules_yaml?.trim()) {
            setRulesYaml(data.rules_yaml);
          }
        }
      } catch {
        /* fallback */
      }
    })();
  }, []);

  useEffect(() => {
    savePlaygroundYaml(rulesYaml);
  }, [rulesYaml]);

  const generateRules = async () => {
    const prompt =
      aiPrompt.trim() ||
      PLAYGROUND_PRESETS.find((p) => p.id === presetId)?.prompt ||
      "";
    if (!accessToken || !prompt) return;
    setAiGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(
        "/api/ai/generate-rules",
        { method: "POST", body: JSON.stringify({ prompt }) },
        accessToken,
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { rules_yaml?: string };
      if (data.rules_yaml) {
        setRulesYaml(data.rules_yaml);
        setRightTab("yaml");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setAiGenerating(false);
    }
  };

  const startScan = () => {
    void runScan({
      code_snippet: snippet,
      filename: filename.trim() || "Example.cs",
      rules_yaml: rulesYaml,
    });
  };

  const startCheckout = async () => {
    if (!accessToken) return;
    const res = await apiFetch("/api/billing/checkout", { method: "POST" }, accessToken);
    const data = (await res.json()) as { url?: string };
    if (data.url) window.location.href = data.url;
  };

  const runAutofix = async (finding: Finding, index: number) => {
    if (!accessToken) return;
    setAutofixBusy(index);
    try {
      const res = await apiFetch(
        "/api/ai/autofix",
        {
          method: "POST",
          body: JSON.stringify({
            code: snippet,
            violation: finding,
            rules_yaml: rulesYaml,
          }),
        },
        accessToken,
      );
      if (res.status === 402) {
        setUpgradeOpen(true);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        explanation?: string;
        patched_code?: string;
        diff?: string;
      };
      setAutofixPayload({
        explanation: data.explanation || "Suggested fix",
        patchedCode: data.patched_code || "",
        diff: data.diff || "",
      });
      setAutofixOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-fix failed");
    } finally {
      setAutofixBusy(null);
    }
  };

  const findings = result?.findings ?? [];
  const violationCount = findings.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#0F0F12] px-2 py-1.5">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-400" strokeWidth={1.5} />
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Describe a rule in plain English…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            disabled={aiGenerating}
            onClick={() => void generateRules()}
            className="shrink-0 rounded-md bg-[#18181B] px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            {aiGenerating ? "…" : "Generate YAML"}
          </button>
        </div>
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          className="rounded-lg border border-white/[0.08] bg-[#0F0F12] px-3 py-2 text-sm text-zinc-300"
        >
          {PLAYGROUND_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col rounded-xl border border-white/[0.08] bg-[#0F0F12] p-4">
          <label className="mb-2 text-xs text-zinc-500">Filename</label>
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="mb-3 rounded-lg border border-white/[0.08] bg-[#09090B] px-3 py-2 font-mono text-sm"
          />
          <CodeEditor value={snippet} onChange={setSnippet} rows={20} className="flex-1" />
          <button
            type="button"
            disabled={phase === "scanning"}
            onClick={startScan}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-[#FAFAFA] py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-50"
          >
            <Play className="h-4 w-4" strokeWidth={1.5} />
            {phase === "scanning" ? `Scanning… ${elapsedSec}s` : "Run Guardrail Scan"}
          </button>
        </section>

        <section className="flex min-h-[28rem] flex-col rounded-xl border border-white/[0.08] bg-[#0F0F12]">
          <div className="flex border-b border-white/[0.08] text-sm">
            {(
              [
                ["yaml", "guardrail.yaml"],
                ["violations", `Violations (${violationCount || "—"})`],
                ["raw", "Raw JSON"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightTab(tab)}
                className={`px-4 py-2.5 ${rightTab === tab ? "border-b border-zinc-100 text-zinc-100" : "text-zinc-500"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {rightTab === "yaml" ? (
              <CodeEditor value={rulesYaml} onChange={setRulesYaml} rows={22} />
            ) : null}
            {rightTab === "violations" ? (
              <ul className="space-y-2">
                {phase === "scanning" ? (
                  <li className="text-sm text-cyan-300/80">Waiting for Guardrail…</li>
                ) : null}
                {jobError ? (
                  <li className="text-sm text-red-300">{jobError}</li>
                ) : null}
                {findings.map((f, i) => (
                  <li
                    key={`${f.id}-${i}`}
                    className="rounded-lg border border-white/[0.08] bg-[#09090B] p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={f.severity} />
                      <span className="font-mono text-xs text-cyan-300/70">
                        {f.file}
                        {f.line != null ? `:${f.line}` : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-zinc-300">{f.message || f.id}</p>
                    <button
                      type="button"
                      disabled={autofixBusy === i}
                      onClick={() => void runAutofix(f, i)}
                      className="mt-2 rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-xs text-violet-200"
                    >
                      {autofixBusy === i ? "Fixing…" : "AI Auto-Fix"}
                    </button>
                  </li>
                ))}
                {findings.length === 0 && phase !== "scanning" ? (
                  <li className="text-sm text-zinc-500">No violations yet.</li>
                ) : null}
              </ul>
            ) : null}
            {rightTab === "raw" ? (
              <pre className="overflow-auto font-mono text-[11px] text-zinc-400">
                {JSON.stringify(result ?? { status: phase }, null, 2)}
              </pre>
            ) : null}
          </div>
        </section>
      </div>

      <UpgradeProModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onUpgrade={() => {
          setUpgradeOpen(false);
          void startCheckout();
        }}
      />
      <AutoFixModal
        open={autofixOpen}
        onClose={() => setAutofixOpen(false)}
        originalCode={snippet}
        explanation={autofixPayload?.explanation || ""}
        patchedCode={autofixPayload?.patchedCode || ""}
        diff={autofixPayload?.diff || ""}
        slideOver
      />
    </div>
  );
}