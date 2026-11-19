"use client";

import { Bot, Check, Copy, Key } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";

import { apiBase } from "@/lib/api";

export function McpIntegrationsPanel() {
  const [copied, setCopied] = useState<string | null>(null);
  const mcpUrl = `${apiBase()}/mcp`;

  const cursorMcp = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            rulecloud: {
              url: mcpUrl,
              headers: {
                "X-API-Key": "rc_live_YOUR_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
    [mcpUrl],
  );

  const vscodeMcp = useMemo(
    () =>
      JSON.stringify(
        {
          servers: {
            rulecloud: {
              type: "http",
              url: mcpUrl,
              headers: {
                "X-API-Key": "rc_live_YOUR_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
    [mcpUrl],
  );

  const claudeCli = useMemo(
    () =>
      `claude mcp add --transport http rulecloud ${mcpUrl} \\
  --header "X-API-Key: rc_live_YOUR_KEY"`,
    [mcpUrl],
  );

  const cursorRule = useMemo(
    () => `---
description: Run RuleCloud guardrail scans before finishing features or opening PRs
globs:
  - "**/*"
alwaysApply: true
---

Before you mark a coding task complete or open a pull request:

1. Call the RuleCloud MCP tool \`scan_code\` with the changed file contents and filename.
2. If \`violation_count\` > 0, fix issues or call \`suggest_fix\` (Pro) before proceeding.
3. For new policy constraints, use \`get_default_rules\` or \`generate_guardrail_rules\` to align \`guardrail.yaml\`.
`,
    [],
  );

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 2000);
  };

  const blocks = [
    { key: "cursor", title: "Cursor — .cursor/mcp.json", body: cursorMcp },
    { key: "claude", title: "Claude Code — CLI", body: claudeCli },
    { key: "vscode", title: "VS Code / GitHub Copilot — .vscode/mcp.json", body: vscodeMcp },
    { key: "rule", title: "Cursor rule — .cursor/rules/rulecloud.mdc", body: cursorRule },
  ];

  return (
    <div className="space-y-6">
      <article className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-5">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-cyan-400" strokeWidth={1.5} />
          <h2 className="text-sm font-semibold text-zinc-100">RuleCloud MCP (Streamable HTTP)</h2>
        </div>
        <p className="mt-2 text-sm text-zinc-500">
          Connect your IDE agent to{" "}
          <code className="text-zinc-300">{mcpUrl}</code> with an API key. Tools:{" "}
          <code className="text-zinc-300">scan_code</code>,{" "}
          <code className="text-zinc-300">get_default_rules</code>,{" "}
          <code className="text-zinc-300">generate_guardrail_rules</code>,{" "}
          <code className="text-zinc-300">suggest_fix</code> (Pro).
        </p>
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <Key className="h-3.5 w-3.5" strokeWidth={1.5} />
          Create a key in{" "}
          <Link href="/dashboard/keys" className="text-cyan-400 hover:underline">
            API Keys
          </Link>{" "}
          and replace <code className="text-zinc-300">rc_live_YOUR_KEY</code> below.
        </p>
      </article>

      {blocks.map((b) => (
        <article
          key={b.key}
          className="rounded-xl border border-white/[0.08] bg-[#0F0F12] p-5"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-zinc-200">{b.title}</h3>
            <button
              type="button"
              onClick={() => void copy(b.key, b.body)}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              {copied === b.key ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              Copy
            </button>
          </div>
          <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-white/[0.06] bg-[#09090B] p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
            {b.body}
          </pre>
        </article>
      ))}
    </div>
  );
}