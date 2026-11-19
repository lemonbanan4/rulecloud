"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/contexts/auth-context";
import { apiBase, apiFetch } from "@/lib/api";

type Usage = {
  plan: string;
  used: number;
  limit: number;
};

type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at?: string | null;
  created_at?: string | null;
};

function formatWhen(iso?: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ApiKeysCicdPanel() {
  const { accessToken, user } = useAuth();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const apiUrl = apiBase();

  const curlSnippet = useMemo(() => {
    const placeholder = "rc_live_YOUR_KEY";
    return `curl -sS -X POST "${apiUrl}/api/jobs/scan" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${placeholder}" \\
  -d '{
    "code_snippet": "const password = \\"secret\\";",
    "filename": "demo.ts"
  }'`;
  }, [apiUrl]);

  const ghSnippet = useMemo(() => {
    const repoExpr = "${{ github.repository }}";
    return `name: RuleCloud scan
on:
  pull_request:
    branches: [main]
jobs:
  guardrail:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run RuleCloud Guardrail
        env:
          RULECLOUD_API_URL: ${apiUrl}
          RULECLOUD_API_KEY: \${{ secrets.RULECLOUD_API_KEY }}
        run: |
          curl -sS -X POST "$RULECLOUD_API_URL/api/jobs/scan" \\
            -H "Content-Type: application/json" \\
            -H "X-API-Key: $RULECLOUD_API_KEY" \\
            -d '{"repo_url":"https://github.com/${repoExpr}"}'`;
  }, [apiUrl]);

  const load = useCallback(async () => {
    if (!user || !accessToken) {
      setUsage(null);
      setKeys([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [usageRes, keysRes] = await Promise.all([
        apiFetch("/api/usage", {}, accessToken),
        apiFetch("/api/keys", {}, accessToken),
      ]);
      if (!usageRes.ok) {
        throw new Error(`Usage failed (${usageRes.status})`);
      }
      if (!keysRes.ok) {
        throw new Error(`Keys failed (${keysRes.status})`);
      }
      setUsage((await usageRes.json()) as Usage);
      const keyPayload = (await keysRes.json()) as { keys?: ApiKeyRow[] };
      setKeys(keyPayload.keys ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load API settings");
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(handle);
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
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Create failed (${res.status})`);
      }
      const data = (await res.json()) as { api_key?: string };
      if (data.api_key) {
        setNewKey(data.api_key);
      }
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (keyId: string) => {
    if (!accessToken) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/keys/${keyId}`, { method: "DELETE" }, accessToken);
      if (!res.ok) {
        throw new Error(`Revoke failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke key");
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Clipboard copy failed");
    }
  };

  if (!user) {
    return (
      <p className="text-sm text-slate-500">Sign in to manage API keys and view usage.</p>
    );
  }

  const pct = usage
    ? Math.min(100, Math.round((usage.used / Math.max(usage.limit, 1)) * 100))
    : 0;

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <section className="glass-panel rounded-2xl p-5 shadow-xl shadow-black/20 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Workspace usage</h2>
          {usage && (
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-200">
              {usage.plan} plan
            </span>
          )}
        </div>
        {loading && !usage ? (
          <p className="mt-4 text-sm text-slate-500">Loading usage…</p>
        ) : usage ? (
          <div className="mt-4">
            <p className="text-sm text-slate-300">
              <span className="font-mono text-cyan-200">{usage.used}</span>
              {" / "}
              <span className="font-mono">{usage.limit}</span> scans used this month
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : null}
      </section>

      <section className="glass-panel rounded-2xl p-5 shadow-xl shadow-black/20 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-100">API keys</h2>
        <p className="mt-1 text-xs text-slate-500">
          Use keys for CI/CD with the <code className="text-cyan-300/80">X-API-Key</code> header.
        </p>

        <form onSubmit={(e) => void onCreate(e)} className="mt-4 flex flex-wrap gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. GitHub Actions)"
            className="min-w-[12rem] flex-1 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/40"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create API key"}
          </button>
        </form>

        {newKey && (
          <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4">
            <p className="text-sm font-medium text-amber-100">
              Copy this key now — it will not be shown again.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all rounded-lg bg-black/40 px-2 py-1 font-mono text-xs text-emerald-200">
                {newKey}
              </code>
              <button
                type="button"
                onClick={() => void copyText(newKey, "key")}
                className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-200 hover:bg-white/5"
              >
                {copied === "key" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No API keys yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-500">
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Prefix</th>
                  <th className="pb-2 pr-3">Last used</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-white/10 text-slate-300">
                    <td className="py-2 pr-3">{k.name}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-cyan-300/90">
                      {k.key_prefix}…
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-400">
                      {formatWhen(k.last_used_at)}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void revoke(k.id)}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="glass-panel rounded-2xl p-5 shadow-xl shadow-black/20 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-100">CI/CD snippets</h2>
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">curl</p>
              <button
                type="button"
                onClick={() => void copyText(curlSnippet, "curl")}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                {copied === "curl" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
              {curlSnippet}
            </pre>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                GitHub Actions
              </p>
              <button
                type="button"
                onClick={() => void copyText(ghSnippet, "gh")}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                {copied === "gh" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-56 overflow-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
              {ghSnippet}
            </pre>
            <p className="mt-2 text-xs text-slate-500">
              Add your raw key to the repo secret <code>RULECLOUD_API_KEY</code>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}