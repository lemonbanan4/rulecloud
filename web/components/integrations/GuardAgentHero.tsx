"use client";

import Link from "next/link";
import { Copy, Check, Terminal, GitBranch } from "lucide-react";
import { useState } from "react";

import { ConsoleCard } from "@/components/ui/ConsoleCard";

export function GuardAgentHero() {
  const [copied, setCopied] = useState(false);
  const initCmd = "npx rulecloud init";

  const copy = async () => {
    await navigator.clipboard.writeText(initCmd);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
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
              Pulls Cloud Rulespacks into <code className="text-zinc-400">.guardrail.yml</code>,
              configures Cursor MCP, and enables <code className="text-zinc-400">rulecloud watch</code>.
            </p>
            <hgroup className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200">
              <span className="min-w-0 flex-1 truncate">{initCmd}</span>
              <button
                type="button"
                onClick={() => void copy()}
                className="shrink-0 text-zinc-400 hover:text-zinc-200"
                aria-label="Copy command"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </hgroup>
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