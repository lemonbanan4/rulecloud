import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fetchBundle } from "../api.js";
import type { CliConfig } from "../config.js";
import { requireApiKey } from "../config.js";

const CURSOR_RULE = `---
description: Run RuleCloud guardrail checks before finishing edits
globs:
  - "**/*"
alwaysApply: true
---

Before marking a coding task complete:

1. Run \`rulecloud check\` on changed files (or use the RuleCloud MCP \`scan_code\` tool).
2. Fix any \`[BLOCKED]\` violations before proceeding.
3. Keep \`.guardrail.yml\` synced via \`rulecloud init\` when Cloud Rulespacks change in the console.
`;

export async function runInit(cwd: string, cfg: CliConfig): Promise<void> {
  requireApiKey(cfg);
  console.log(`API: ${cfg.apiUrl}`);
  console.log("Fetching Cloud Rulespacks bundle…");
  const bundle = await fetchBundle(cfg);
  if (bundle.source === "defaults") {
    console.log("(Starter defaults — redeploy API for full Cloud Rulespacks merge)");
  }
  const guardrailPath = path.join(cwd, ".guardrail.yml");
  writeFileSync(guardrailPath, bundle.rules_yaml, "utf8");
  console.log(`Wrote ${guardrailPath} (etag: ${bundle.etag})`);

  const rcPath = path.join(cwd, ".rulecloud.json");
  writeFileSync(
    rcPath,
    JSON.stringify(
      {
        apiUrl: cfg.apiUrl,
        apiKey: cfg.apiKey,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`Wrote ${rcPath} (Cloud Sync enabled for watch)`);

  const cursorDir = path.join(cwd, ".cursor");
  mkdirSync(cursorDir, { recursive: true });
  mkdirSync(path.join(cursorDir, "rules"), { recursive: true });

  const mcpJson = {
    mcpServers: {
      rulecloud: {
        url: `${cfg.apiUrl}/mcp/`,
        headers: {
          "X-API-Key": "${env:RULECLOUD_API_KEY}",
        },
      },
    },
  };
  writeFileSync(
    path.join(cursorDir, "mcp.json"),
    JSON.stringify(mcpJson, null, 2) + "\n",
    "utf8",
  );
  writeFileSync(path.join(cursorDir, "rules", "rulecloud.mdc"), CURSOR_RULE, "utf8");
  console.log("Configured .cursor/mcp.json and .cursor/rules/rulecloud.mdc");
  console.log("\nNext: rulecloud watch   # real-time agent guardrails");
}