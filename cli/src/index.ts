#!/usr/bin/env node

import path from "node:path";

import { runInit } from "./commands/init.js";
import { runCheck } from "./commands/check.js";
import { runFixCommand } from "./autofix.js";
import { runWatch } from "./commands/watch.js";
import { runSyncHooks } from "./commands/sync-hooks.js";
import { loadConfig } from "./config.js";

function usage(): never {
  console.log(`RuleCloud CLI — real-time AI agent guardrails

Usage:
  rulecloud init              Pull Cloud Rulespacks + configure Cursor
  rulecloud watch [--cloud] [--plain] [dir]   Live HUD
  rulecloud check [--staged] [--plain] [dir] One-shot scan
  rulecloud sync-hooks [--check]  Align Claude/Cursor hooks with .guardrail/rules.yml
  rulecloud fix [file]            AI Auto-Fix via API (Pro)

Environment:
  RULECLOUD_API_URL   API base (default: production)
  RULECLOUD_API_KEY   Workspace API key (rc_live_...)
`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith("-"));
const cwd =
  (cmd === "check" || cmd === "watch") && positional[0]
    ? path.resolve(positional[0])
    : process.cwd();
const fixFile = cmd === "fix" ? positional[0] : undefined;

if (!cmd || cmd === "-h" || cmd === "--help") usage();

const cfg = loadConfig(cwd);

try {
  if (cmd === "init") {
    await runInit(cwd, cfg);
  } else if (cmd === "watch") {
    const plain = argv.includes("--plain") || !process.stdout.isTTY;
    const cloud =
      !argv.includes("--no-cloud") &&
      (Boolean(cfg.apiKey) || argv.includes("--cloud"));
    await runWatch(cwd, cfg, { cloud, plain });
  } else if (cmd === "fix") {
    const plain = argv.includes("--plain");
    await runFixCommand(cwd, cfg, fixFile, plain);
  } else if (cmd === "check") {
    const staged = argv.includes("--staged");
    const plain = argv.includes("--plain");
    const code = runCheck(cwd, staged, plain);
    process.exit(code);
  } else if (cmd === "sync-hooks") {
    const check = argv.includes("--check");
    const code = runSyncHooks(cwd, check);
    process.exit(code);
  } else {
    usage();
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}