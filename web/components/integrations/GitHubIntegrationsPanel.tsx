"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  GitBranch,
  Loader2,
  Trash2,
} from "lucide-react";
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

type AppInstallationRow = {
  id: string;
  installation_id: number;
  account_login: string;
  account_type: string;
  auto_fix_comments: boolean;
  repo_count: number;
  avatar_url: string;
  configure_url: string;
};

type Props = {
  installationIdFromQuery?: string | null;
  setupAction?: string | null;
  onQueryConsumed?: () => void;
};

export function GitHubIntegrationsPanel({
  installationIdFromQuery,
  setupAction,
  onQueryConsumed,
}: Props) {
  const { accessToken } = useAuth();
  const { usage } = useUsage();
  const isPro = (usage?.plan || "free").toLowerCase() === "pro";
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [appInstallations, setAppInstallations] = useState<AppInstallationRow[]>([]);
  const [appConfigured, setAppConfigured] = useState(false);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkingApp, setLinkingApp] = useState(false);

  const webhookUrl =
    repos[0]?.webhook_url || `${apiBase()}/api/webhook/github`;

  const loadApp = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [urlRes, listRes] = await Promise.all([
        apiFetch("/api/integrations/github-app/install-url", {}, accessToken),
        apiFetch("/api/integrations/github-app/installations", {}, accessToken),
      ]);
      if (urlRes.ok) {
        const u = (await urlRes.json()) as { configured?: boolean; url?: string };
        setAppConfigured(Boolean(u.configured));
        setInstallUrl(u.url ?? null);
      }
      if (listRes.ok) {
        const data = (await listRes.json()) as {
          configured?: boolean;
          installations?: AppInstallationRow[];
        };
        setAppConfigured(Boolean(data.configured));
        setAppInstallations(data.installations ?? []);
      }
    } catch {
      /* optional — app may be unconfigured */
    }
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/integrations/github", {}, accessToken);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = (await res.json()) as { repos?: RepoRow[] };
      setRepos(data.repos ?? []);
      await loadApp();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load repos");
    } finally {
      setLoading(false);
    }
  }, [accessToken, loadApp]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!accessToken || !installationIdFromQuery) return;
    const id = Number.parseInt(installationIdFromQuery, 10);
    if (!Number.isFinite(id) || id < 1) return;
    let cancelled = false;
    const run = async () => {
      setLinkingApp(true);
      setError(null);
      try {
        const res = await apiFetch(
          "/api/integrations/github-app/callback",
          {
            method: "POST",
            body: JSON.stringify({ installation_id: id }),
          },
          accessToken,
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Link failed (${res.status})`);
        }
        const data = (await res.json()) as {
          account_login?: string;
          repo_count?: number;
        };
        if (!cancelled) {
          setToast(
            `GitHub App linked to ${data.account_login ?? "account"} (${data.repo_count ?? 0} repos).`,
          );
          onQueryConsumed?.();
          await load();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not link installation");
        }
      } finally {
        if (!cancelled) setLinkingApp(false);
      }
    };
    if (setupAction === "install" || setupAction === "update") {
      void run();
    }
    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    installationIdFromQuery,
    setupAction,
    load,
    onQueryConsumed,
  ]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

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
        setToast("Repository already connected — PAT saved.");
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

  const toggleAppAutofix = async (installationId: number, enabled: boolean) => {
    if (!accessToken) return;
    await apiFetch(
      `/api/integrations/github-app/installations/${installationId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ auto_fix_comments: enabled }),
      },
      accessToken,
    );
    await load();
  };

  const unlinkApp = async (installationId: number) => {
    if (!accessToken) return;
    await apiFetch(
      `/api/integrations/github-app/installations/${installationId}`,
      { method: "DELETE" },
      accessToken,
    );
    await load();
  };

  return (
    <div className="space-y-6">
      {toast ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {toast}
        </p>
      ) : null}

      <article className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-5">
        <h2 className="text-sm font-semibold text-zinc-100">Install RuleCloud GitHub App</h2>
        <p className="mt-2 text-sm text-zinc-500">
          One-click install — no PAT or manual webhook. PR scans, statuses, and inline comments use
          short-lived installation tokens.
        </p>
        <InstallButton
          configured={appConfigured}
          installUrl={installUrl}
          loading={linkingApp || loading}
        />
        {!appConfigured ? (
          <p className="mt-2 text-xs text-zinc-600">
            Server: set <code className="text-zinc-400">GITHUB_APP_ID</code>,{" "}
            <code className="text-zinc-400">GITHUB_APP_PRIVATE_KEY</code>, and{" "}
            <code className="text-zinc-400">GITHUB_APP_WEBHOOK_SECRET</code> on Railway. Set the
            GitHub App Setup URL to{" "}
            <code className="text-zinc-400">/dashboard/integrations</code> on this console.
          </p>
        ) : null}
      </article>

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0F0F12]">
        <div className="border-b border-white/[0.08] px-4 py-3">
          <h3 className="text-sm font-medium text-zinc-200">GitHub App installations</h3>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            Loading…
          </p>
        ) : appInstallations.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">
            No GitHub App linked yet — install the app above.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Repos</th>
                <th className="px-4 py-2">AI on PRs</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {appInstallations.map((inst) => (
                <tr key={inst.id} className="border-t border-white/[0.06] text-zinc-300">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={inst.avatar_url}
                        alt=""
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded-full"
                      />
                      <span className="font-mono text-xs">
                        {inst.account_login}
                        <span className="ml-1 text-zinc-600">({inst.account_type})</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{inst.repo_count}</td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={inst.auto_fix_comments}
                        disabled={!isPro}
                        onChange={(e) =>
                          void toggleAppAutofix(inst.installation_id, e.target.checked)
                        }
                      />
                      <span>
                        Auto-Fix {!isPro ? <span className="text-violet-400">PRO</span> : null}
                      </span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <InstallationActions
                      configureUrl={inst.configure_url}
                      onUnlink={() => void unlinkApp(inst.installation_id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <article className="rounded-xl border border-white/[0.08] bg-[#0F0F12]">
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-white/[0.02]"
        >
          Advanced: Manual Webhook &amp; PAT
          <ChevronDown
            className={`h-4 w-4 transition ${manualOpen ? "rotate-180" : ""}`}
            strokeWidth={1.5}
          />
        </button>
        {manualOpen ? (
          <div className="space-y-6 border-t border-white/[0.08] p-5">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
              <h2 className="text-sm font-semibold text-zinc-100">Connect with PAT</h2>
            </div>
            <p className="text-sm text-zinc-500">
              Fine-grained token: <span className="text-zinc-300">Contents (Read)</span>,{" "}
              <span className="text-zinc-300">Pull requests (Read &amp; Write)</span>,{" "}
              <span className="text-zinc-300">Commit statuses (Read &amp; Write)</span>.
            </p>
            <form onSubmit={(e) => void onConnect(e)} className="space-y-3">
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
                placeholder="GitHub fine-grained token"
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
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-100">
                Webhook secret: <code className="font-mono">{createdSecret}</code>
              </p>
            ) : null}

            <LegacyRepoTable
              repos={repos}
              loading={loading}
              webhookUrl={webhookUrl}
              isPro={isPro}
              copied={copied}
              onCopy={copyText}
              onDisconnect={disconnect}
              onToggleAutofix={toggleAutofix}
            />
          </div>
        ) : null}
      </article>

      {error ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function InstallButton({
  configured,
  installUrl,
  loading,
}: {
  configured: boolean;
  installUrl: string | null;
  loading: boolean;
}) {
  if (!configured || !installUrl) {
    return (
      <button
        type="button"
        disabled
        className="mt-4 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-400"
      >
        GitHub App not configured on API
      </button>
    );
  }
  return (
    <a
      href={installUrl}
      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#FAFAFA] px-4 py-2 text-sm font-semibold text-zinc-900"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      Install RuleCloud GitHub App
      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
    </a>
  );
}

function InstallationActions({
  configureUrl,
  onUnlink,
}: {
  configureUrl: string;
  onUnlink: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <a
        href={configureUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
      >
        Configure repos on GitHub
        <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
      </a>
      <button
        type="button"
        onClick={onUnlink}
        className="inline-flex items-center gap-1 text-xs text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        Unlink
      </button>
    </div>
  );
}

function LegacyRepoTable(props: {
  repos: RepoRow[];
  loading: boolean;
  webhookUrl: string;
  isPro: boolean;
  copied: string | null;
  onCopy: (key: string, text: string) => Promise<void>;
  onDisconnect: (id: string) => void;
  onToggleAutofix: (id: string, enabled: boolean) => void;
}) {
  const { repos, loading, webhookUrl, isPro, copied, onCopy, onDisconnect, onToggleAutofix } =
    props;
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#09090B]">
      <div className="border-b border-white/[0.08] px-4 py-3">
        <h3 className="text-sm font-medium text-zinc-200">Legacy connected repositories</h3>
      </div>
      {loading ? (
        <p className="p-4 text-sm text-zinc-500">Loading…</p>
      ) : repos.length === 0 ? (
        <p className="p-4 text-sm text-zinc-500">No legacy PAT repos.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Repository</th>
              <th className="px-4 py-2">Webhook</th>
              <th className="px-4 py-2">PAT</th>
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
                      onClick={() => void onCopy(`url-${r.id}`, r.webhook_url)}
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
                      onClick={() => void onCopy(`sec-${r.id}`, r.webhook_secret)}
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
                    <span className="text-amber-400">Missing</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={r.auto_fix_comments}
                      disabled={!isPro}
                      onChange={(e) => void onToggleAutofix(r.id, e.target.checked)}
                    />
                    Auto-Fix
                  </label>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => void onDisconnect(r.id)}
                    className="text-xs text-red-400"
                  >
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
  );
}