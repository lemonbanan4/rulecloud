"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { GitHubIntegrationsPanel } from "@/components/integrations/GitHubIntegrationsPanel";
import { McpIntegrationsPanel } from "@/components/integrations/McpIntegrationsPanel";
import { SnippetsPanel } from "@/components/integrations/SnippetsPanel";

type Tab = "mcp" | "github" | "actions";

function IntegrationsPageContent() {
  const [tab, setTab] = useState<Tab>("github");
  const searchParams = useSearchParams();
  const router = useRouter();
  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action");

  const clearGitHubQuery = useCallback(() => {
    router.replace("/dashboard/integrations");
  }, [router]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Integrations</h1>
        <p className="text-sm text-zinc-500">
          GitHub App, AI IDE MCP, Actions, and direct API access.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-white/[0.08] bg-[#0F0F12] p-1">
        {(
          [
            ["github", "GitHub PR Bot"],
            ["mcp", "AI IDE / MCP"],
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

      {tab === "github" ? (
        <GitHubIntegrationsPanel
          installationIdFromQuery={installationId}
          setupAction={setupAction}
          onQueryConsumed={clearGitHubQuery}
        />
      ) : tab === "mcp" ? (
        <McpIntegrationsPanel />
      ) : (
        <SnippetsPanel />
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading integrations…</p>}>
      <IntegrationsPageContent />
    </Suspense>
  );
}