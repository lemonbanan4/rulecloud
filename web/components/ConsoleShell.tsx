"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  Menu,
  PanelLeftClose,
  Plus,
  Shield,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BillingActions } from "@/components/BillingActions";
import { CommandPalette } from "@/components/CommandPalette";
import { useAuth } from "@/contexts/auth-context";
import { useHealth } from "@/hooks/use-health";
import { useUsage } from "@/hooks/use-usage";
import { breadcrumbForPath, CONSOLE_NAV } from "@/lib/nav";
import { planPill } from "@/lib/format";

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, accessToken, signOut } = useAuth();
  const { usage } = useUsage();
  const health = useHealth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const breadcrumbs = breadcrumbForPath(pathname);
  const workspaceName = user?.email?.split("@")[0] || "Personal Workspace";

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen(true);
    }
    if (e.key === "Escape") setPaletteOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  const healthLabel =
    health === "ok"
      ? "API healthy"
      : health === "degraded"
        ? "API degraded"
        : health === "offline"
          ? "API offline"
          : "Checking…";

  const healthDot =
    health === "ok"
      ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
      : health === "degraded"
        ? "bg-amber-400"
        : "bg-red-400";

  const usagePct = usage
    ? Math.min(100, Math.round((usage.used / Math.max(usage.limit, 1)) * 100))
    : 0;

  return (
    <div className="flex min-h-full bg-[#09090B] text-zinc-100">
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Mobile overlay */}
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`console-sidebar fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/[0.08] bg-[#0F0F12] transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-4">
          <Shield className="h-5 w-5 text-zinc-100" strokeWidth={1.5} />
          <span className="text-sm font-semibold tracking-tight">RuleCloud</span>
          <button
            type="button"
            className="ml-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close"
          >
            <PanelLeftClose className="h-4 w-4 text-zinc-500" strokeWidth={1.5} />
          </button>
        </div>

        <button
          type="button"
          className="mx-3 mt-3 flex items-center justify-between rounded-lg border border-white/[0.08] bg-[#18181B] px-3 py-2 text-left text-sm hover:bg-zinc-800/80"
        >
          <span className="truncate font-medium">{workspaceName}</span>
          <span className="flex items-center gap-1.5">
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
              {planPill(usage?.plan)}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.5} />
          </span>
        </button>

        <nav className="mt-4 flex-1 space-y-0.5 px-2">
          {CONSOLE_NAV.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "border-l-2 border-zinc-100 bg-[#18181B] text-zinc-50"
                    : "border-l-2 border-transparent text-zinc-400 hover:bg-[#18181B] hover:text-zinc-200"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/[0.08] p-3">
          {usage ? (
            <div className="mb-3 rounded-lg border border-white/[0.08] bg-[#09090B] p-2.5">
              <p className="text-[11px] text-zinc-500">Monthly scans</p>
              <p className="mt-1 font-mono text-xs text-zinc-200">
                {usage.used} / {usage.limit}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${usagePct}%` }}
                />
              </div>
              {(usage.plan || "free").toLowerCase() !== "pro" ? (
                <div className="mt-2">
                  <BillingActions accessToken={accessToken} plan={usage.plan} compact />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
              {(user?.email?.[0] || "?").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-zinc-300">{user?.email}</p>
              <button
                type="button"
                onClick={() => void signOut()}
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/[0.08] bg-[#09090B]/80 px-4 backdrop-blur-md lg:px-6">
          <button
            type="button"
            className="rounded-lg border border-white/[0.08] p-2 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" strokeWidth={1.5} />
          </button>

          <div className="min-w-0 flex-1 text-sm text-zinc-400">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb}>
                {i > 0 ? <span className="mx-1.5 text-zinc-600">/</span> : null}
                <span className={i === breadcrumbs.length - 1 ? "text-zinc-200" : ""}>
                  {crumb}
                </span>
              </span>
            ))}
          </div>

          <div
            className="hidden sm:flex items-center gap-2 rounded-full border border-white/[0.08] px-2.5 py-1 text-xs text-zinc-400"
            title={healthLabel}
          >
            <span className={`h-2 w-2 rounded-full ${healthDot}`} />
            <span className="font-mono">{health === "ok" ? "live" : health}</span>
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-lg border border-white/[0.08] bg-[#0F0F12] px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-[#18181B] sm:flex"
          >
            <kbd className="text-zinc-500">⌘K</kbd>
          </button>

          <button
            type="button"
            onClick={() => router.push("/dashboard/playground")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#FAFAFA] px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            New Scan
          </button>
        </header>

        <main className="flex-1 overflow-x-hidden p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}