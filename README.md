
https://github.com/user-attachments/assets/3a7f0ed3-a862-4f10-8147-48a0a9cdb515

# RuleCloud

Guardrails for AI-speed engineering: **Cloud Rulespacks**, a **CLI watch HUD**, **GitHub PR scans**, and an **MCP server** for Cursor and other agents.

| Component | URL |
|-----------|-----|
| Console | https://rulecloud.vercel.app |
| API | https://rulecloud-production.up.railway.app |
| MCP Registry | `io.github.lemonbanan4/rulecloud` @ [MCP Registry](https://registry.modelcontextprotocol.io) |
| npm CLI | [`rulecloud`](https://www.npmjs.com/package/rulecloud) |

**Repo:** https://github.com/lemonbanan4/rulecloud (public)

## Quick start (CLI)

```bash
export RULECLOUD_API_KEY=rc_live_...   # from console → API Keys
npx rulecloud init                     # writes .guardrail/rules.yml + Cursor MCP
npx rulecloud watch                    # live violations HUD
```

## MCP (Cursor, Claude Code, VS Code)

Streamable HTTP — **do not open `/mcp/` in a browser** (you will see a JSON-RPC “text/event-stream” message; that is normal). Use this setup page or configure your IDE:

- **Setup (browser):** https://rulecloud-production.up.railway.app/api/mcp  
- **MCP endpoint:** `https://rulecloud-production.up.railway.app/mcp/` (trailing slash required)

Create `rc_live_…` at https://rulecloud.vercel.app/dashboard/keys, then add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "rulecloud": {
      "url": "https://rulecloud-production.up.railway.app/mcp/",
      "headers": {
        "X-API-Key": "rc_live_YOUR_KEY"
      }
    }
  }
}
```

**Tools:** `scan_code`, `get_default_rules`, `generate_guardrail_rules`, `suggest_fix` (Pro).

## Monorepo layout

| Path | Stack | Deploy |
|------|--------|--------|
| `/` | FastAPI + guardrail CLI + MCP | Railway (`Dockerfile`) |
| `/web` | Next.js console | Vercel (`web/`) |
| `/cli` | `rulecloud` npm package | npm |

**Env**
- Vercel: `NEXT_PUBLIC_API_URL` → Railway API URL (`web/.env.example`)
- Railway: `FRONTEND_URL` → Vercel URL (CORS), `LLM_*` for AI Copilot

## Demo repo

https://github.com/lemonbanan4/rulecloud-demo

## Health check

```bash
curl -sS https://rulecloud-production.up.railway.app/health
```
