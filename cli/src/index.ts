#!/usr/bin/env node

import path from "node:path";

import { runInit } from "./commands/init.js";
import { runCheck } from "./commands/check.js";
import { runWatch } from "./commands/watch.js";
import { loadConfig } from "./config.js";

function usage(): never {
  console.log(`RuleCloud CLI — real-time AI agent guardrails

Usage:
  rulecloud init              Pull Cloud Rulespacks + configure Cursor
  rulecloud watch [--cloud]   Watch repo; optional cloud sync to console
  rulecloud check [--staged]  One-shot scan (exit 1 on critical/high)

Environment:
  RULECLOUD_API_URL   API base (default: production)
  RULECLOUD_API_KEY   Workspace API key (rc_live_...)
`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const cwd = process.cwd();

if (!cmd || cmd === "-h" || cmd === "--help") usage();

const cfg = loadConfig();

try {
  if (cmd === "init") {
    await runInit(cwd, cfg);
  } else if (cmd === "watch") {
    const cloud = argv.includes("--cloud");
    await runWatch(cwd, cfg, { cloud: cloud || Boolean(cfg.apiKey) });
  } else if (cmd === "check") {
    const staged = argv.includes("--staged");
    const code = runCheck(cwd, staged);
    process.exit(code);
  } else {
    usage();
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}