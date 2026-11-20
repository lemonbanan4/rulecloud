# rulecloud CLI

Real-time guardrails for AI coding agents. Pulls **Cloud Rulespacks** from your RuleCloud workspace, watches file saves, and reports violations in the terminal (optionally syncing to the Live Agent Monitor).

## Install

From this directory:

```bash
npm install
npm run build
npm link
```

Or run once without linking:

```bash
npx rulecloud init
```

## Configure

```bash
export RULECLOUD_API_URL=https://rulecloud-production.up.railway.app
export RULECLOUD_API_KEY=rc_live_...
```

Create API keys in the [RuleCloud console](https://rulecloud.vercel.app/dashboard/keys).

## Commands

| Command | Description |
|---------|-------------|
| `rulecloud init` | Download merged `.guardrail.yml`, wire `.cursor/mcp.json` + agent rule |
| `rulecloud watch` | Debounced file watcher with colorized `[BLOCKED]` alerts |
| `rulecloud watch --cloud` | Also POST events to `/api/watch/events` (default when API key set) |
| `rulecloud check` | Scan entire repo; exit `1` on high/critical violations |
| `rulecloud check --staged` | Pre-commit scan of staged git files only |

## Ignored paths

`node_modules`, `.git`, `.next`, `dist`, `venv`, `.venv`, `build`, `target`, `__pycache__`