"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, Copy, GitBranch, Loader2, Trash2 } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";
import { useUsage } from "@/hooks/use-usage";
import { apiBase, apiFetch } from "@/lib/api";

type RepoRow = {
  id: string;
  repo_full_name: string;
  webhook_url: string;
  webhook_secret: string;
  has_token: boolean;
  auto_fix_comments: boolean;
  created_at?: string;
};

export function GitHubIntegrationsPanel() {
  const { accessToken } = useAuth();
  const { usage } = useUsage();
  const isPro = (usage?.plan || "free").toLowerCase() === "pro";
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState("");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const webhookUrl =
    repos[0]?.webhook_url || `${apiBase()}/api/webhook/github`;

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/integrations/github", {}, accessToken);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = (await res.json()) as { repos?: RepoRow[] };
      setRepos(data.repos ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load repos");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 2000);
  };

  const onConnect = async (e: FormEvent) => {
    e.preventDefault();
    const full = repoName.trim();
    if (!accessToken || !full) return;
    if (
      full.toLowerCase() === "owner/repo" ||
      !/^[\w.-]+\/[\w.-]+$/.test(full)
    ) {
      setError('Use your real repo slug, e.g. lemonbanan4/rulecloud (not the placeholder "owner/repo").');
      return;
    }
    setConnecting(true);
    setError(null);
    setCreatedSecret(null);
    try {
      const res = await apiFetch(
        "/api/integrations/github",
        {
          method: "POST",
          body: JSON.stringify({
            repo_full_name: repoName.trim(),
            github_token: token.trim() || undefined,
            auto_fix_comments: true,
          }),
        },
        accessToken,
      );
      if (!res.ok) {
        const text = await res.text();
        let msg = text || `Failed (${res.status})`;
        try {
          const j = JSON.parse(text) as { detail?: string };
          if (typeof j.detail === "string") msg = j.detail;
        } catch {
          /* keep raw text */
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as {
        webhook_secret?: string;
        updated?: boolean;
      };
      if (data.webhook_secret && !data.updated) setCreatedSecret(data.webhook_secret);
      if (data.updated) {
        setCreatedSecret(null);
        setError(null);
        window.alert(
          "Repository already connected — PAT saved. Copy Secret from the table into GitHub (not the PAT).",
        );
      }
      setRepoName("");
      setToken("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async (id: string) => {
    if (!accessToken) return;
    await apiFetch(`/api/integrations/github/${id}`, { method: "DELETE" }, accessToken);
    await load();
  };

  const toggleAutofix = async (id: string, enabled: boolean) => {
    if (!accessToken) return;
    await apiFetch(
      `/api/integrations/github/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ auto_fix_comments: enabled }),
      },
      accessToken,
    );
    await load();
  };

  return (
    <div className="space-y-6">
      <article className="rounded-xl border border-white/[0.08] bg-[#0F0F12] p-5">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
          <h2 className="text-sm font-semibold text-zinc-100">Connect GitHub Repository</h2>
        </div>
        <p className="mt-2 text-sm text-zinc-500">
          Enter the GitHub repository slug for this project (for RuleCloud itself, use{" "}
          <span className="font-mono text-zinc-300">lemonbanan4/rulecloud</span>). Fine-grained token
          permissions:{" "}
          <span className="text-zinc-300">Contents (Read)</span>,{" "}
          <span className="text-zinc-300">Pull requests (Read & Write)</span>,{" "}
          <span className="text-zinc-300">Commit statuses (Read & Write)</span>.
        </p>
        <form onSubmit={(e) => void onConnect(e)} className="mt-4 space-y-3">
          <input
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="lemonbanan4/rulecloud"
            className="w-full rounded-lg border border-white/[0.08] bg-[#09090B] px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="GitHub fine-grained token (recommended)"
            className="w-full rounded-lg border border-white/[0.08] bg-[#09090B] px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={connecting || !repoName.trim()}
            className="rounded-lg bg-[#FAFAFA] px-4 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect repository"}
          </button>
        </form>
        {createdSecret ? (
          <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-100">
            Webhook secret (copy into GitHub):{" "}
            <code className="font-mono">{createdSecret}</code>
          </p>
        ) : null}
      </article>

      {repos.some((r) => r.repo_full_name.toLowerCase() === "owner/repo") ? (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Connected as <span className="font-mono">owner/repo</span> — that was the form placeholder.
          Disconnect it and reconnect with your real repo (e.g.{" "}
          <span className="font-mono">lemonbanan4/rulecloud</span>), then paste the new{" "}
          <strong className="font-medium">Secret</strong> into GitHub.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0F0F12]">
        <div className="border-b border-white/[0.08] px-4 py-3">
          <h3 className="text-sm font-medium text-zinc-200">Connected repositories</h3>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            Loading…
          </p>
        ) : repos.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No repos connected yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Repository</th>
                <th className="px-4 py-2">Webhook</th>
                <th className="px-4 py-2">GitHub PAT</th>
                <th className="px-4 py-2">AI on PRs</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.06] text-zinc-300">
                  <td className="px-4 py-3 font-mono text-xs">{r.repo_full_name}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => void copyText(`url-${r.id}`, r.webhook_url)}
                        className="inline-flex items-center gap-1 text-xs text-cyan-400"
                      >
                        {copied === `url-${r.id}` ? (
                          <Check className="h-3 w-3" strokeWidth={1.5} />
                        ) : (
                          <Copy className="h-3 w-3" strokeWidth={1.5} />
                        )}
                        URL
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyText(`sec-${r.id}`, r.webhook_secret)}
                        className="inline-flex items-center gap-1 text-xs text-zinc-400"
                      >
                        {copied === `sec-${r.id}` ? (
                          <Check className="h-3 w-3" strokeWidth={1.5} />
                        ) : (
                          <Copy className="h-3 w-3" strokeWidth={1.5} />
                        )}
                        Secret
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.has_token ? (
                      <span className="text-emerald-400">Saved</span>
                    ) : (
                      <span className="text-amber-400">Add via form above</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={r.auto_fix_comments}
                        disabled={!isPro}
                        onChange={(e) => void toggleAutofix(r.id, e.target.checked)}
                      />
                      <span>
                        Auto-Fix {!isPro ? <span className="text-violet-400">PRO</span> : null}
                      </span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void disconnect(r.id)}
                      className="inline-flex items-center gap-1 text-xs text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      Disconnect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {repos.length === 0 && !loading ? (
          <p className="border-t border-white/[0.06] px-4 py-2 font-mono text-[11px] text-zinc-600">
            Webhook URL: {webhookUrl}
          </p>
        ) : null}
      </div>
    </div>
  );
}