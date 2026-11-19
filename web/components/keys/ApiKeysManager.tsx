"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api";
import type { ApiKeyRow } from "@/lib/types";
import { formatWhen } from "@/lib/format";
import { ConsoleCard } from "@/components/ui/ConsoleCard";

export function ApiKeysManager() {
  const { accessToken, user } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/keys", {}, accessToken);
      if (!res.ok) throw new Error(`Keys failed (${res.status})`);
      const data = (await res.json()) as { keys?: ApiKeyRow[] };
      setKeys(data.keys ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load keys");
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !name.trim()) return;
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const res = await apiFetch(
        "/api/keys",
        { method: "POST", body: JSON.stringify({ name: name.trim() }) },
        accessToken,
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { api_key?: string };
      if (data.api_key) setNewKey(data.api_key);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!accessToken) return;
    await apiFetch(`/api/keys/${id}`, { method: "DELETE" }, accessToken);
    await load();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">API Keys</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Authenticate CI jobs with the <code className="text-zinc-300">X-API-Key</code> header.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <ConsoleCard>
        <form onSubmit={(e) => void onCreate(e)} className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. GitHub Actions)"
            className="min-w-[12rem] flex-1 rounded-lg border border-white/[0.08] bg-[#09090B] px-3 py-2 text-sm outline-none focus:border-white/20"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="rounded-lg bg-[#FAFAFA] px-4 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create API key"}
          </button>
        </form>

        {newKey ? (
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
            <p className="text-sm text-amber-200">Copy this key once — it won’t be shown again.</p>
            <code className="mt-2 block break-all font-mono text-xs text-emerald-300">{newKey}</code>
          </div>
        ) : null}
      </ConsoleCard>

      <ConsoleCard className="overflow-x-auto p-0">
        {loading ? (
          <p className="p-5 text-sm text-zinc-500">Loading…</p>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <KeyRound className="h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="text-sm text-zinc-500">No API keys yet. Create one for CI/CD.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/[0.08] text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Prefix</th>
                <th className="px-4 py-3">Last used</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t border-white/[0.06] text-zinc-300">
                  <td className="px-4 py-3">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{k.key_prefix}…</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{formatWhen(k.last_used_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void revoke(k.id)}
                      className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ConsoleCard>
    </div>
  );
}