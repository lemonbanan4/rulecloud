"use client";

import { ShieldCheck } from "lucide-react";

import { ConsoleCard } from "@/components/ui/ConsoleCard";

export function BranchProtectionCallout() {
  return (
    <ConsoleCard className="border-amber-500/20 bg-amber-950/10">
      <div className="flex gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" strokeWidth={1.5} />
        <div>
          <p className="text-sm font-semibold text-zinc-100">Turn RuleCloud into a merge gate</p>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-zinc-400">
            <li>
              On GitHub: repo <strong className="text-zinc-300">Settings → Branches</strong> → add or
              edit branch protection for <code className="text-zinc-300">main</code>.
            </li>
            <li>
              Enable <strong className="text-zinc-300">Require status checks to pass</strong> before
              merging.
            </li>
            <li>
              Select status check{" "}
              <code className="rounded border border-white/10 px-1 text-amber-200/90">
                RuleCloud Guardrail
              </code>{" "}
              (appears after the first PR scan on that branch).
            </li>
          </ol>
        </div>
      </div>
    </ConsoleCard>
  );
}