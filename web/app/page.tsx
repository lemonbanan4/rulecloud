"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  ArrowDown,
  ArrowRight,
  Bot,
  Cloud,
  FileCode2,
  GitBranch,
  Layers,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";

import { HeroMockup } from "@/components/landing/HeroMockup";
import { LiveSandbox } from "@/components/landing/LiveSandbox";
import { useAuth } from "@/contexts/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase";

const BENTO = [
  {
    icon: Zap,
    title: "Sub-second Go Engine",
    body: "MoeidHeidari/guardrail on AST + regex — millisecond feedback on every push.",
  },
  {
    icon: Sparkles,
    title: "Plain-English → YAML",
    body: "AI Compiler turns policy intent into valid guardrail.yaml your CLI understands.",
  },
  {
    icon: Bot,
    title: "One-Click AI Auto-Fix",
    body: "Pro workspaces get patch + unified diff on every violation card.",
  },
  {
    icon: GitBranch,
    title: "GitHub Actions & Webhooks",
    body: "Drop-in workflow YAML and signed webhooks — block merges before drift lands.",
  },
  {
    icon: Layers,
    title: "Central Audit Logs",
    body: "Workspace scan history, API keys, and quota in one developer console.",
  },
  {
    icon: FileCode2,
    title: "Multi-Language",
    body: "C#, TypeScript, Python, and more via include globs and custom rules.",
  },
];

function scrollToDemo() {
  document.getElementById("live-demo")?.scrollIntoView({ behavior: "smooth" });
}

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) {
      router.replace("/dashboard");
    }
  }, [user, loading, router]);

  const consoleHref = isSupabaseConfigured()
    ? user
      ? "/dashboard"
      : "/login?next=/dashboard"
    : "/dashboard";

  const playgroundHref = user ? "/dashboard/playground" : "/dashboard/playground";
  const signInHref = "/login?next=/dashboard";

  if (loading || user) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[#09090B] text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="relative min-h-full bg-[#09090B] text-zinc-100">
      {/* Spotlight grid */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 70% 55% at 50% -10%, rgba(34, 211, 238, 0.12), transparent),
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "auto, 48px 48px, 48px 48px",
        }}
      />

      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#09090B]/70 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Shield className="h-5 w-5" strokeWidth={1.5} />
            RuleCloud
          </Link>
          <div className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
            <a href="#features" className="hover:text-zinc-200">
              Features
            </a>
            <Link href="/dashboard/playground" className="hover:text-zinc-200">
              Playground
            </Link>
            <a href="#pricing" className="hover:text-zinc-200">
              Pricing
            </a>
            <Link href="/dashboard/integrations" className="hover:text-zinc-200">
              Docs
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={signInHref}
              className="hidden rounded-lg px-3 py-1.5 text-sm text-zinc-300 hover:text-white sm:inline"
            >
              Sign In
            </Link>
            <Link
              href={consoleHref}
              className="inline-flex items-center gap-1 rounded-lg bg-[#FAFAFA] px-3 py-1.5 text-sm font-semibold text-zinc-900"
            >
              Open Console
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Link>
          </div>
        </nav>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-16 sm:px-6 lg:grid-cols-2 lg:pt-24">
          <div>
            <p className="inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium tracking-wide text-cyan-300/90">
              Powered by Go Guardrail Engine · Sub-second AST & Regex Checks
            </p>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight text-zinc-50 sm:text-5xl">
              Architectural Guardrails for AI-Speed Engineering.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-400">
              Stop Cursor and Copilot drift before it hits <code className="text-zinc-300">main</code>.
              Enforce custom code rules via cloud API, GitHub Actions, and one-click AI Auto-Fix—zero
              self-hosting.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={playgroundHref}
                className="inline-flex items-center gap-2 rounded-lg bg-[#FAFAFA] px-4 py-2.5 text-sm font-semibold text-zinc-900"
              >
                Start Free in Console
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </Link>
              <button
                type="button"
                onClick={scrollToDemo}
                className="inline-flex items-center gap-2 rounded-lg border border-white/[0.1] px-4 py-2.5 text-sm text-zinc-300 hover:bg-[#18181B]"
              >
                Try Live Demo
                <ArrowDown className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
          <HeroMockup />
        </section>

        <LiveSandbox />

        <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-2xl font-semibold text-zinc-50 sm:text-3xl">
            Built for platform teams shipping with AI
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BENTO.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="rounded-2xl border border-white/[0.08] bg-[#0F0F12] p-5 transition hover:border-white/[0.14] hover:bg-[#18181B]"
                >
                  <Icon className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
                  <h3 className="mt-3 font-medium text-zinc-100">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">{item.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section id="pricing" className="border-t border-white/[0.06] bg-[#0F0F12]/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-center text-2xl font-semibold text-zinc-50">Transparent pricing</h2>
            <p className="mx-auto mt-2 max-w-md text-center text-sm text-zinc-500">
              Start on Free, upgrade when CI volume and AI Auto-Fix matter.
            </p>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              <article className="rounded-2xl border border-white/[0.08] bg-[#0F0F12] p-6">
                <p className="text-sm font-medium text-zinc-400">Free</p>
                <p className="mt-2 text-4xl font-semibold">
                  $0<span className="text-lg font-normal text-zinc-500">/mo</span>
                </p>
                <ul className="mt-6 space-y-2 text-sm text-zinc-400">
                  <li>50 scans / month</li>
                  <li>Playground + API keys</li>
                  <li>AI rule generation (daily cap)</li>
                </ul>
                <Link
                  href={signInHref}
                  className="mt-8 inline-flex w-full items-center justify-center rounded-lg border border-white/[0.1] py-2.5 text-sm font-medium text-zinc-200 hover:bg-[#18181B]"
                >
                  Sign up free
                </Link>
              </article>
              <article className="relative rounded-2xl border border-emerald-500/25 bg-[#0F0F12] p-6 ring-1 ring-emerald-500/10">
                <p className="text-sm font-medium text-emerald-400">Pro</p>
                <p className="mt-2 text-4xl font-semibold">
                  $29<span className="text-lg font-normal text-zinc-500">/mo</span>
                </p>
                <ul className="mt-6 space-y-2 text-sm text-zinc-400">
                  <li>2,000 scans / month</li>
                  <li>Unlimited AI Auto-Fix diffs</li>
                  <li>Priority limits + billing portal</li>
                </ul>
                <Link
                  href="/login?next=/dashboard/billing"
                  className="mt-8 inline-flex w-full items-center justify-center rounded-lg bg-[#FAFAFA] py-2.5 text-sm font-semibold text-zinc-900"
                >
                  Upgrade with Stripe
                </Link>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06] py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Cloud className="h-4 w-4" strokeWidth={1.5} />
            RuleCloud · Guardrail as a Service
          </div>
          <div className="flex flex-wrap justify-center gap-4 text-sm text-zinc-500">
            <Link href="/dashboard/integrations" className="hover:text-zinc-300">
              API docs
            </Link>
            <Link href="/dashboard/billing" className="hover:text-zinc-300">
              Billing
            </Link>
            <Link href="/login" className="hover:text-zinc-300">
              Sign in
            </Link>
          </div>
          <p className="text-xs text-zinc-600">© 2026 RuleCloud</p>
        </div>
      </footer>
    </div>
  );
}