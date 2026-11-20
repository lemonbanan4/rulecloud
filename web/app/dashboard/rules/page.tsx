"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";

import { ConsoleCard } from "@/components/ui/ConsoleCard";
import { useAuth } from "@/contexts/auth-context";
import { parseApiError } from "@/lib/api-error";
import { apiFetch } from "@/lib/api";
import {
  deriveRulespackMeta,
  uniqueSlug,
} from "@/lib/rulespack-meta";

export type Rulespack = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  rules_yaml: string;
  enabled: boolean;
  updated_at?: string;
};

type NewPackDraft = {
  name: string;
  slug: string;
  description: string;
  rules_yaml: string;
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
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPackDraft, setNewPackDraft] = useState<NewPackDraft | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/rulespacks", {}, accessToken);
      if (!res.ok) throw new Error(await parseApiError(res));
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
      if (!res.ok) throw new Error(await parseApiError(res));
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

  const openBlankEditor = () => {
    const slug = uniqueSlug(
      `custom-${Date.now().toString(36)}`,
      packs.map((p) => p.slug),
    );
    setNewPackDraft({
      name: "Custom pack",
      slug,
      description: "Custom Cloud Rulespack",
      rules_yaml: `version: 1\ninclude:\n  - "**/*"\nrules:\n  - id: example-rule\n    type: regex\n    pattern: 'FIXME'\n    message: Example rule — edit me\n`,
    });
  };

  const saveNewPack = async () => {
    if (!accessToken || !newPackDraft) return;
    setBusy(true);
    setError(null);
    try {
      const slug = uniqueSlug(
        newPackDraft.slug.trim() || "custom-pack",
        packs.map((p) => p.slug),
      );
      const res = await apiFetch(
        "/api/rulespacks",
        {
          method: "POST",
          body: JSON.stringify({
            slug,
            name: newPackDraft.name.trim() || "Custom pack",
            description: newPackDraft.description.trim() || null,
            rules_yaml: newPackDraft.rules_yaml,
          }),
        },
        accessToken,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = (await res.json()) as { pack?: Rulespack };
      const pack = data.pack;
      setNewPackDraft(null);
      await refresh();
      if (pack?.id) {
        setEditingId(pack.id);
        setYamlDraft(pack.rules_yaml);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const handleAiGenerate = async () => {
    const prompt = aiPrompt.trim();
    if (!accessToken || !prompt) return;
    setAiGenerating(true);
    setAiError(null);
    try {
      const res = await apiFetch(
        "/api/ai/generate-rules",
        { method: "POST", body: JSON.stringify({ prompt }) },
        accessToken,
      );
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      const data = (await res.json()) as { rules_yaml?: string };
      if (!data.rules_yaml?.trim()) {
        throw new Error("AI returned empty rules YAML");
      }
      const meta = deriveRulespackMeta(prompt);
      const slug = uniqueSlug(
        meta.slug,
        packs.map((p) => p.slug),
      );
      setNewPackDraft({
        name: meta.name,
        slug,
        description: meta.description,
        rules_yaml: data.rules_yaml,
      });
      setAiPrompt("");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setAiGenerating(false);
    }
  };

  const generateYamlForPack = async (packId: string) => {
    if (!accessToken || !aiPrompt.trim()) {
      setAiError("Enter a prompt in the bar above first.");
      return;
    }
    setBusy(true);
    setAiError(null);
    try {
      const res = await apiFetch(
        "/api/ai/generate-rules",
        { method: "POST", body: JSON.stringify({ prompt: aiPrompt.trim() }) },
        accessToken,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
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
      setAiError(err instanceof Error ? err.message : "Generate failed");
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

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleAiGenerate();
        }}
      >
        <ConsoleCard className="flex items-center gap-3">
          <Sparkles
            className="h-4 w-4 shrink-0 text-violet-400"
            strokeWidth={1.5}
          />
          <input
            value={aiPrompt}
            onChange={(e) => {
              setAiPrompt(e.target.value);
              if (aiError) setAiError(null);
            }}
            disabled={aiGenerating}
            placeholder="Describe a new rulespack in plain English…"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600 disabled:opacity-60"
            aria-label="Rulespack prompt"
          />
          <button
            type="submit"
            disabled={aiGenerating || !aiPrompt.trim() || !accessToken}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Sparkles className="h-4 w-4" strokeWidth={1.5} />
            )}
            Generate
          </button>
        </ConsoleCard>
        {aiError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {aiError}
          </div>
        ) : null}
      </form>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {loading ? <p className="text-sm text-zinc-500">Loading rulespacks…</p> : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={openBlankEditor}
          className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-zinc-200 hover:bg-[#18181B]"
        >
          <Plus className="h-4 w-4" />
          New pack
        </button>
      </div>

      {newPackDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label="Close"
            onClick={() => !busy && setNewPackDraft(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-pack-title"
            className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-white/10 bg-[#0F0F12] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 id="new-pack-title" className="text-sm font-semibold text-zinc-100">
                Review new rulespack
              </h2>
              <button
                type="button"
                disabled={busy}
                onClick={() => setNewPackDraft(null)}
                className="text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-zinc-500">
                  Name
                  <input
                    value={newPackDraft.name}
                    onChange={(e) =>
                      setNewPackDraft({ ...newPackDraft, name: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/50"
                  />
                </label>
                <label className="block text-xs text-zinc-500">
                  Slug
                  <input
                    value={newPackDraft.slug}
                    onChange={(e) =>
                      setNewPackDraft({ ...newPackDraft, slug: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-violet-500/50"
                  />
                </label>
              </div>
              <label className="block text-xs text-zinc-500">
                Description
                <input
                  value={newPackDraft.description}
                  onChange={(e) =>
                    setNewPackDraft({ ...newPackDraft, description: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/50"
                />
              </label>
              <label className="block text-xs text-zinc-500">
                rules YAML
                <textarea
                  value={newPackDraft.rules_yaml}
                  onChange={(e) =>
                    setNewPackDraft({ ...newPackDraft, rules_yaml: e.target.value })
                  }
                  rows={16}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-4 py-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setNewPackDraft(null)}
                className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveNewPack()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#FAFAFA] px-4 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : null}
                Save rulespack
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                    onClick={() => void generateYamlForPack(pack.id)}
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