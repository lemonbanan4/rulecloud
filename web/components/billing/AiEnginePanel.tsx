"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, Loader2 } from "lucide-react";

import { ConsoleCard } from "@/components/ui/ConsoleCard";
import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api";

type AiSettings = {
  llm_provider?: string | null;
  has_api_key?: boolean;
  platform_llm_configured?: boolean;
  allowed_providers?: string[];
};

export function AiEnginePanel({ isPro }: { isPro: boolean }) {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !isPro) return;
    try {
      const res = await apiFetch("/api/workspace/ai-settings", {}, accessToken);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as AiSettings;
      setSettings(data);
      if (data.llm_provider) setProvider(data.llm_provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load AI settings");
    }
  }, [accessToken, isPro]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const save = async () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        "/api/workspace/ai-settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            llm_provider: provider,
            llm_api_key: apiKey.trim() || undefined,
          }),
        },
        accessToken,
      );
      if (!res.ok) throw new Error(await res.text());
      setApiKey("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!accessToken) return;
    setBusy(true);
    setTestMsg(null);
    try {
      const res = await apiFetch(
        "/api/workspace/ai-settings/test",
        { method: "POST", body: "{}" },
        accessToken,
      );
      const data = (await res.json()) as { status?: string; reply?: string; detail?: string };
      if (!res.ok) throw new Error(String(data.detail || res.status));
      setTestMsg(data.reply ? `Connected — ${data.reply}` : "Connected");
    } catch (err) {
      setTestMsg(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  };

  if (!isPro) {
    return (
      <ConsoleCard>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          AI Engine & BYOK
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Upgrade to Pro to bring your own LLM API key for Auto-Fix and rule generation.
        </p>
      </ConsoleCard>
    );
  }

  return (
    <ConsoleCard>
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
        <p className="text-sm font-semibold text-zinc-100">AI Engine & BYOK</p>
      </div>
      <p className="mt-2 text-sm text-zinc-500">
        Optional workspace key overrides platform AI.{" "}
        {settings?.platform_llm_configured
          ? "Platform LLM is also available."
          : "No platform key — BYOK required for Auto-Fix."}
      </p>
      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-zinc-500">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100"
          >
            {(settings?.allowed_providers || ["openai", "gemini", "anthropic"]).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-zinc-500">
          API key {settings?.has_api_key ? "(saved — leave blank to keep)" : ""}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-… or workspace key"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100"
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-lg bg-[#FAFAFA] px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void test()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Test Auto-Fix connection
        </button>
      </div>
      {testMsg ? <p className="mt-2 text-xs text-zinc-400">{testMsg}</p> : null}
    </ConsoleCard>
  );
}