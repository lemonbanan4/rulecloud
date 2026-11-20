"use client";

import Link from "next/link";
import { Copy, Check, Terminal, GitBranch } from "lucide-react";
import { useState } from "react";

import { ConsoleCard } from "@/components/ui/ConsoleCard";
import { CLI_QUICKSTART, NPM_PACKAGE_NAME, NPX_INIT } from "@/lib/cli-install";

export function GuardAgentHero() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <ConsoleCard className="border-cyan-500/20 bg-gradient-to-br from-cyan-950/30 to-[#0F0F12]">
      <p className="text-xs font-medium uppercase tracking-wider text-cyan-400">
        Guard your AI agent in 30 seconds
      </p>
      <h2 className="mt-2 text-lg font-semibold text-zinc-50">
        Cloud Rulespacks → local watch → GitHub PR safety net
      </h2>
      <ol className="mt-4 space-y-4 text-sm text-zinc-300">
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 font-mono text-xs text-cyan-300">
            1
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-medium text-zinc-100">
              <Terminal className="h-4 w-4 text-zinc-500" strokeWidth={1.5} />
              Run the CLI once
            </div>
            <p className="mt-1 text-zinc-500">
              Install from npm (
              <a
                href={`https://www.npmjs.com/package/${NPM_PACKAGE_NAME}`}
                className="text-cyan-400 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {NPM_PACKAGE_NAME}
              </a>
              ). Pulls Cloud Rulespacks into <code className="text-zinc-400">.guardrail.yml</code>,
              wires Cursor MCP, then run watch in your repo.
            </p>
            <hgroup className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200">
              <span className="min-w-0 flex-1 truncate">{NPX_INIT}</span>
              <button
                type="button"
                onClick={() => void copy("init", NPX_INIT)}
                className="shrink-0 text-zinc-400 hover:text-zinc-200"
                aria-label="Copy init command"
              >
                {copied === "init" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </hgroup>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-zinc-600">Full quickstart (API key + watch):</p>
              <button
                type="button"
                onClick={() => void copy("full", CLI_QUICKSTART)}
                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
              >
                {copied === "full" ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy block
                  </>
                )}
              </button>
            </div>
            <pre className="mt-1 max-h-28 overflow-auto rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
              {CLI_QUICKSTART}
            </pre>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 font-mono text-xs text-cyan-300">
            2
          </span>
          <div>
            <div className="flex items-center gap-2 font-medium text-zinc-100">
              <GitBranch className="h-4 w-4 text-zinc-500" strokeWidth={1.5} />
              1-Click Install GitHub App
            </div>
            <p className="mt-1 text-zinc-500">
              PR scans use the same merged bundle — final safety net when agents push code.
            </p>
            <Link
              href="/dashboard/integrations"
              className="mt-2 inline-flex text-sm text-cyan-400 hover:text-cyan-300"
            >
              Install below ↓
            </Link>
          </div>
        </li>
      </ol>
    </ConsoleCard>
  );
}