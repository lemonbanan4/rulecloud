import { Bot, GitPullRequest } from "lucide-react";

export function HeroMockup() {
  return (
    <div className="relative w-full max-w-lg">
      <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-cyan-500/10 via-transparent to-emerald-500/10 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0F0F12] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <GitPullRequest className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
            PR #1842 · guardrail / check
          </div>
          <span className="rounded border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
            Blocked
          </span>
        </div>
        <div className="space-y-3 p-4 font-mono text-[11px] leading-relaxed">
          <p className="text-red-400/90">✕ hardcoded-api-key — SettingsPanel.tsx:5</p>
          <p className="text-amber-300/80">  api_key = &quot;sk_live_…&quot;</p>
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <p className="flex items-center gap-1.5 text-xs text-violet-200">
              <Bot className="h-3.5 w-3.5" strokeWidth={1.5} />
              AI Auto-Fix suggested
            </p>
            <pre className="mt-2 text-[10px] text-zinc-400">
              {`- const api_key = "sk_live_…";
+ const api_key = process.env.RULECLOUD_API_KEY;`}
            </pre>
          </div>
          <p className="text-xs text-zinc-600">guardrail check · 412ms · 2 violations</p>
        </div>
      </div>
    </div>
  );
}