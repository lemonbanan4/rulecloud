# rulecloud CLI

Real-time guardrails for AI coding agents. Pulls **Cloud Rulespacks** from your RuleCloud workspace, watches file saves, and reports violations in the terminal (optionally syncing to the Live Agent Monitor).

## Install

```bash
npm install -g rulecloud
# or run without installing:
npx rulecloud init
npx rulecloud watch
```

Develop from the monorepo `cli/` folder:

```bash
npm install
npm run build
npm link
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
| `rulecloud init` | Download merged `.guardrail/rules.yml`, wire `.cursor/mcp.json` + agent rule |
| `rulecloud watch` | Live HUD: initial scan + file saves (`r` rescan, `c` clear, `q` quit) |
| `rulecloud watch --plain` | No colors / no TTY shortcuts (CI) |
| `rulecloud watch` | Cloud Sync **ON** automatically when `RULECLOUD_API_KEY` or `.rulecloud.json` is set |
| `rulecloud fix [file]` | Pro AI Auto-Fix via API (`f` in watch) |
| `rulecloud check` | Scan entire repo; exit `1` on high/critical violations |
| `rulecloud check --staged` | Pre-commit scan of staged git files only |
| `rulecloud sync-hooks` | Write `.cursor/hooks.json` + `.claude/settings.json` from rules |
| `rulecloud sync-hooks --check` | Exit `1` when hook files drift from `.guardrail/rules.yml` (CI) |

`sync-hooks` embeds a SHA-256 of `.guardrail/rules.yml` in hook metadata and installs guard scripts. Claude hooks include **`onFailure: "block"`** so a broken guard blocks tool calls instead of failing open.

## Ignored paths

`node_modules`, `.git`, `.next`, `dist`, `venv`, `.venv`, `build`, `target`, `__pycache__`