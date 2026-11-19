"use client";

import { Copy, Check } from "lucide-react";
import { useMemo, useState } from "react";

import { apiBase } from "@/lib/api";

export function SnippetsPanel() {
  const [copied, setCopied] = useState<string | null>(null);
  const apiUrl = apiBase();

  const ghWorkflow = useMemo(() => {
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

  const curlSnippet = useMemo(
    () => `curl -sS -X POST "${apiUrl}/api/jobs/scan" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: rc_live_YOUR_KEY" \\
  -d '{"code_snippet":"const x=1;","filename":"demo.ts"}'`,
    [apiUrl],
  );

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 2000);
  };

  const blocks = [
    {
      key: "gh",
      step: "1",
      title: "GitHub Actions workflow",
      body: ghWorkflow,
    },
    {
      key: "webhook",
      step: "2",
      title: "GitHub Webhook (PR bot tab)",
      body: `Use the GitHub PR Bot tab: connect the repo, then copy URL + Secret from the table.

URL: ${apiUrl}/api/webhook/github
Content type: application/json
Secret: per-repo secret from Connected repositories (not the Railway env unless you skipped connect)
Events: Pull requests (required). Push optional.

Step 1 (Actions) and Step 2 (Webhook) are different paths — pick one or use both.`,
    },
    {
      key: "curl",
      step: "3",
      title: "curl + API key",
      body: curlSnippet,
    },
  ];

  return (
    <div className="space-y-4">
      {blocks.map((b) => (
        <article
          key={b.key}
          className="rounded-xl border border-white/[0.08] bg-[#0F0F12] p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-emerald-400">Step {b.step}</p>
              <h3 className="mt-1 text-sm font-semibold text-zinc-100">{b.title}</h3>
            </div>
            <button
              type="button"
              onClick={() => void copy(b.key, b.body)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-xs text-zinc-300 hover:bg-[#18181B]"
            >
              {copied === b.key ? (
                <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              Copy
            </button>
          </div>
          <pre className="mt-3 max-h-52 overflow-auto rounded-lg border border-white/[0.08] bg-[#09090B] p-3 font-mono text-[11px] text-zinc-400">
            {b.body}
          </pre>
        </article>
      ))}
    </div>
  );
}