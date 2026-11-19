import Link from "next/link";
import { Shield, Copy, GitBranch, Key, Webhook } from "lucide-react";

import { apiBase } from "@/lib/api";

const apiUrl = apiBase();

const GUARDRAIL_EXAMPLE = `version: 1
timeout_ms: 5000
include:
  - "**/*.ts"
  - "**/*.py"
rules:
  - id: hardcoded-secret
    severity: high
    type: regex
    pattern: '(?i)(api_key|password|secret)\\s*=\\s*"[^"]{6,}"'
    message: Hardcoded credential

  - id: layer-violation
    severity: medium
    from: "**/presentation/**"
    to: "**/data/**"
    message: Presentation must not import data layer

  - id: max-file-lines
    severity: low
    match: "**/*.py"
    max_lines: 400
    message: File exceeds line budget`;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-lg border border-white/[0.08] bg-[#09090B] p-4 font-mono text-[11px] leading-relaxed text-zinc-400">
      {children}
    </pre>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100">
      <header className="border-b border-white/[0.08] bg-[#09090B]/90 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Shield className="h-5 w-5" strokeWidth={1.5} />
            RuleCloud
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg bg-[#FAFAFA] px-3 py-1.5 text-sm font-semibold text-zinc-900"
          >
            Open Console
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Documentation</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Guardrails for AI-speed engineering — playground, API, and GitHub PR bot.
        </p>

        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            60-second quickstart
          </h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-zinc-400">
            <li>
              <Link href="/dashboard/playground" className="text-cyan-400 hover:underline">
                Playground
              </Link>
              — paste code, tune <code className="text-zinc-300">guardrail.yaml</code>, run a scan.
            </li>
            <li>
              <Link href="/dashboard/api-keys" className="text-cyan-400 hover:underline">
                API Keys
              </Link>
              — create <code className="text-zinc-300">rc_live_…</code> for CI or scripts.
            </li>
            <li>
              <Link href="/dashboard/integrations" className="text-cyan-400 hover:underline">
                Integrations → GitHub PR Bot
              </Link>
              — connect repo, copy webhook secret, add GitHub webhook (
              <code className="text-zinc-300">pull_request</code>, JSON).
            </li>
          </ol>
          <p className="mt-4 text-xs text-zinc-600">
            Demo repo:{" "}
            <a
              href="https://github.com/lemonbanan4/rulecloud-demo"
              className="text-cyan-500 hover:underline"
            >
              lemonbanan4/rulecloud-demo
            </a>
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">guardrail.yaml schema</h2>
          <p className="mt-2 text-sm text-zinc-500">
            RuleCloud runs the Moeid Guardrail CLI plus a Python evaluator. Supported rule shapes:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-400">
            <li>
              <strong className="font-medium text-zinc-300">regex</strong> —{" "}
              <code className="text-zinc-300">pattern</code> or <code className="text-zinc-300">regex</code>
              , optional <code className="text-zinc-300">match</code> glob
            </li>
            <li>
              <strong className="font-medium text-zinc-300">max_lines</strong> —{" "}
              <code className="text-zinc-300">max_lines</code> on files matching{" "}
              <code className="text-zinc-300">match</code>
            </li>
            <li>
              <strong className="font-medium text-zinc-300">layer</strong> —{" "}
              <code className="text-zinc-300">from</code> + <code className="text-zinc-300">to</code>{" "}
              globs for forbidden imports
            </li>
          </ul>
          <p className="mt-2 text-xs text-zinc-600">
            Place at repo root: <code>guardrail.yaml</code>, <code>.guardrail.yml</code>, or under{" "}
            <code>.guard/general/quality.yml</code>.
          </p>
          <CodeBlock>{GUARDRAIL_EXAMPLE}</CodeBlock>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">REST API</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Base URL: <code className="text-cyan-400">{apiUrl}</code>
          </p>
          <div className="mt-4 space-y-4 text-sm text-zinc-400">
            <div className="rounded-xl border border-white/[0.08] bg-[#0F0F12] p-4">
              <p className="font-mono text-xs text-emerald-400">POST /api/scan</p>
              <p className="mt-1">Synchronous snippet or repo scan (session or API key).</p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#0F0F12] p-4">
              <p className="font-mono text-xs text-emerald-400">POST /api/jobs/scan</p>
              <p className="mt-1">Async job — returns <code className="text-zinc-300">job_id</code>.</p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#0F0F12] p-4">
              <p className="font-mono text-xs text-emerald-400">GET /api/jobs/{"{id}"}</p>
              <p className="mt-1">Poll job status, findings, CLI metadata.</p>
            </div>
          </div>
          <CodeBlock>{`curl -sS -X POST "${apiUrl}/api/jobs/scan" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: rc_live_YOUR_KEY" \\
  -d '{"code_snippet":"const x=1;","filename":"demo.ts","rules_yaml":"..."}'`}</CodeBlock>
        </section>

        <section className="mt-12">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <GitBranch className="h-5 w-5" strokeWidth={1.5} />
            GitHub webhook &amp; PAT
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <article className="rounded-xl border border-white/[0.08] bg-[#0F0F12] p-4">
              <Webhook className="h-4 w-4 text-cyan-400" strokeWidth={1.5} />
              <h3 className="mt-2 text-sm font-medium">Webhook</h3>
              <ul className="mt-2 list-disc pl-4 text-xs text-zinc-500">
                <li>URL: {apiUrl}/api/webhook/github</li>
                <li>Content type: application/json</li>
                <li>Secret: per-repo from Integrations table</li>
                <li>Events: Pull requests</li>
              </ul>
            </article>
            <article className="rounded-xl border border-white/[0.08] bg-[#0F0F12] p-4">
              <Key className="h-4 w-4 text-cyan-400" strokeWidth={1.5} />
              <h3 className="mt-2 text-sm font-medium">Fine-grained PAT</h3>
              <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                <li>Contents — Read</li>
                <li>Pull requests — Read &amp; Write</li>
                <li>Commit statuses — Read &amp; Write</li>
              </ul>
            </article>
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            PR bot posts a summary comment, commit status, and up to five{" "}
            <strong className="font-medium text-zinc-300">inline review comments</strong> with optional{" "}
            <code className="text-zinc-300">suggestion</code> blocks (Pro + Auto-Fix).
          </p>
        </section>

        <section className="mt-12 flex items-center gap-2 border-t border-white/[0.08] pt-8 text-xs text-zinc-600">
          <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
          Need help? Open Integrations in the console or file an issue on GitHub.
        </section>
      </main>
    </div>
  );
}