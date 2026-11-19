"use client";

import { useState } from "react";

import { GitHubIntegrationsPanel } from "@/components/integrations/GitHubIntegrationsPanel";
import { SnippetsPanel } from "@/components/integrations/SnippetsPanel";

type Tab = "github" | "actions";

export default function IntegrationsPage() {
  const [tab, setTab] = useState<Tab>("github");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Integrations</h1>
        <p className="text-sm text-zinc-500">
          PR Guardrail bot, GitHub Actions, and direct API access.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-white/[0.08] bg-[#0F0F12] p-1">
        {(
          [
            ["github", "GitHub PR Bot"],
            ["actions", "Actions & curl"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
              tab === key
                ? "bg-[#18181B] text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "github" ? <GitHubIntegrationsPanel /> : <SnippetsPanel />}
    </div>
  );
}