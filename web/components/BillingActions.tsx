"use client";

import { useCallback, useState } from "react";

import { apiFetch } from "@/lib/api";

type Props = {
  accessToken: string | null;
  plan?: string | null;
  compact?: boolean;
};

export function BillingActions({ accessToken, plan, compact }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = (plan || "free").toLowerCase();
  const isPro = normalized === "pro";

  const startCheckout = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/billing/checkout", { method: "POST" }, accessToken);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Checkout failed (${res.status})`);
      }
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error("Missing checkout URL");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }, [accessToken]);

  const openPortal = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/billing/portal", { method: "POST" }, accessToken);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Portal failed (${res.status})`);
      }
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error("Missing portal URL");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portal failed");
      setBusy(false);
    }
  }, [accessToken]);

  if (!accessToken) {
    return null;
  }

  const btnClass = compact
    ? "rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
    : "rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-1">
      {isPro ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void openPortal()}
          className={`${btnClass} border-white/15 bg-slate-800/60 text-slate-200 hover:bg-slate-700/60`}
        >
          {busy ? "Opening…" : "Manage Billing"}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void startCheckout()}
          className={`${btnClass} border-violet-400/40 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25`}
        >
          {busy ? "Redirecting…" : compact ? "Upgrade Pro" : "Upgrade to Pro ($29/mo)"}
        </button>
      )}
      {error ? <span className="max-w-xs text-right text-[10px] text-red-300">{error}</span> : null}
    </div>
  );
}