"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { ConsoleCard } from "@/components/ui/ConsoleCard";
import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api";
import { RULE_PACKS, savePlaygroundYaml } from "@/lib/rule-presets";

export default function RulesStudioPage() {
  const { accessToken } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPack = (yaml: string) => {
    savePlaygroundYaml(yaml);
  };

  const generate = async () => {
    if (!accessToken || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        "/api/ai/generate-rules",
        { method: "POST", body: JSON.stringify({ prompt: prompt.trim() }) },
        accessToken,
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { rules_yaml?: string };
      if (data.rules_yaml) {
        savePlaygroundYaml(data.rules_yaml);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Rules Studio</h1>
        <p className="text-sm text-zinc-500">Curated guardrail packs and AI rule authoring.</p>
      </div>

      <ConsoleCard>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe custom rules in plain English…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="rounded-lg bg-[#FAFAFA] px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-50"
          >
            {busy ? "…" : "Generate YAML"}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
      </ConsoleCard>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {RULE_PACKS.map((pack) => (
          <ConsoleCard key={pack.id} className="flex flex-col">
            <h3 className="font-medium text-zinc-100">{pack.title}</h3>
            <p className="mt-2 flex-1 text-sm text-zinc-500">{pack.description}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {pack.tags.map((t) => (
                <span
                  key={t}
                  className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400"
                >
                  {t}
                </span>
              ))}
            </div>
            <Link
              href="/dashboard/playground"
              onClick={() => loadPack(pack.yaml)}
              className="mt-4 inline-flex justify-center rounded-lg border border-white/[0.08] py-2 text-sm text-zinc-200 hover:bg-[#18181B]"
            >
              Load in Playground
            </Link>
          </ConsoleCard>
        ))}
      </div>
    </div>
  );
}