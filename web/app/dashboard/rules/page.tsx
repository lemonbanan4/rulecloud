"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";

import { ConsoleCard } from "@/components/ui/ConsoleCard";
import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api";

export type Rulespack = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  rules_yaml: string;
  enabled: boolean;
  updated_at?: string;
};

export default function RulesStudioPage() {
  const { accessToken } = useAuth();
  const [packs, setPacks] = useState<Rulespack[]>([]);
  const [bundleEtag, setBundleEtag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [yamlDraft, setYamlDraft] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/rulespacks", {}, accessToken);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        packs?: Rulespack[];
        bundle_etag?: string;
      };
      setPacks(data.packs ?? []);
      setBundleEtag(data.bundle_etag ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  const togglePack = async (pack: Rulespack) => {
    if (!accessToken) return;
    const res = await apiFetch(
      `/api/rulespacks/${pack.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ enabled: !pack.enabled }),
      },
      accessToken,
    );
    if (res.ok) void refresh();
  };

  const saveYaml = async (id: string) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/rulespacks/${id}`,
        { method: "PATCH", body: JSON.stringify({ rules_yaml: yamlDraft }) },
        accessToken,
      );
      if (!res.ok) throw new Error(await res.text());
      setEditingId(null);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const deletePack = async (id: string) => {
    if (!accessToken || !confirm("Delete this rulespack?")) return;
    await apiFetch(`/api/rulespacks/${id}`, { method: "DELETE" }, accessToken);
    void refresh();
  };

  const createPack = async () => {
    if (!accessToken) return;
    const slug = `custom-${Date.now().toString(36)}`;
    const res = await apiFetch(
      "/api/rulespacks",
      {
        method: "POST",
        body: JSON.stringify({
          slug,
          name: "Custom pack",
          description: "Custom Cloud Rulespack",
          rules_yaml: `version: 1\ninclude:\n  - "**/*"\nrules:\n  - id: example-rule\n    type: regex\n    pattern: 'FIXME'\n    message: Example rule — edit me\n`,
        }),
      },
      accessToken,
    );
    if (res.ok) void refresh();
  };

  const generateYaml = async (packId: string) => {
    if (!accessToken || !aiPrompt.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(
        "/api/ai/generate-rules",
        { method: "POST", body: JSON.stringify({ prompt: aiPrompt.trim() }) },
        accessToken,
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { rules_yaml?: string };
      if (data.rules_yaml) {
        setYamlDraft(data.rules_yaml);
        setEditingId(packId);
        await apiFetch(
          `/api/rulespacks/${packId}`,
          { method: "PATCH", body: JSON.stringify({ rules_yaml: data.rules_yaml }) },
          accessToken,
        );
        void refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">Cloud Rulespacks</h1>
          <p className="text-sm text-zinc-500">
            Manage workspace guardrails synced to CLI, Cursor MCP, and GitHub PRs.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
          <Cloud className="h-3.5 w-3.5" strokeWidth={1.5} />
          Synced to CLI, Cursor MCP & GitHub PRs
          {bundleEtag ? (
            <span className="font-mono text-emerald-400/80">· {bundleEtag}</span>
          ) : null}
        </span>
      </div>

      <ConsoleCard>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Describe a new rulespack in plain English…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      </ConsoleCard>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {loading ? <p className="text-sm text-zinc-500">Loading rulespacks…</p> : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void createPack()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-zinc-200 hover:bg-[#18181B]"
        >
          <Plus className="h-4 w-4" />
          New pack
        </button>
      </div>

      <div className="grid gap-4">
        {packs.map((pack) => (
          <ConsoleCard key={pack.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-medium text-zinc-100">{pack.name}</h3>
                <p className="text-xs text-zinc-500">
                  {pack.slug}
                  {pack.description ? ` · ${pack.description}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={pack.enabled}
                    onChange={() => void togglePack(pack)}
                    className="accent-cyan-500"
                  />
                  On
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(pack.id);
                    setYamlDraft(pack.rules_yaml);
                  }}
                  className="rounded border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"
                  aria-label="Edit YAML"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {![
                  "zero-secrets",
                  "clean-architecture",
                  "ai-agent-hygiene",
                ].includes(pack.slug) ? (
                  <button
                    type="button"
                    onClick={() => void deletePack(pack.id)}
                    className="rounded border border-white/10 p-1.5 text-zinc-500 hover:text-red-300"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
            {editingId === pack.id ? (
              <div className="space-y-2">
                <textarea
                  value={yamlDraft}
                  onChange={(e) => setYamlDraft(e.target.value)}
                  rows={14}
                  className="w-full rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-zinc-200"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveYaml(pack.id)}
                    className="rounded-lg bg-[#FAFAFA] px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-50"
                  >
                    Save YAML
                  </button>
                  <button
                    type="button"
                    disabled={busy || !aiPrompt.trim()}
                    onClick={() => void generateYaml(pack.id)}
                    className="rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs text-violet-300 disabled:opacity-50"
                  >
                    AI fill from prompt
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </ConsoleCard>
        ))}
      </div>
    </div>
  );
}