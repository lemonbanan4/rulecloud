---
name: rulecloud
description: >-
  Operate RuleCloud (Railway API + Vercel console) for scans, API keys, and
  GitHub PR integrations. Use when wiring repos, webhooks, PATs, or calling
  rulecloud-production.up.railway.app from scripts or MCP.
---

# RuleCloud operator skill

Production:

- API: `https://rulecloud-production.up.railway.app`
- Console: `https://rulecloud.vercel.app`

## PAT vs webhook secret

| Credential | Where it goes | Purpose |
|------------|---------------|---------|
| **Fine-grained GitHub PAT** | Integrations → connect form | List PR files, post comments, commit statuses |
| **Webhook secret** | GitHub repo → Settings → Webhooks → Change secret | HMAC on `POST /api/webhook/github` |

Never put the PAT in the GitHub webhook secret field.

## GitHub connect (upsert)

`POST /api/integrations/github` with user Bearer token (Supabase session):

```json
{
  "repo_full_name": "owner/repo",
  "github_token": "github_pat_...",
  "auto_fix_comments": true
}
```

If the repo is already connected, the API **updates the PAT** and returns the **existing** `webhook_secret` (`updated: true`).

`PATCH /api/integrations/github/{connection_id}`:

```json
{ "github_token": "github_pat_..." }
```

## Webhook on GitHub

- URL: `{API}/api/webhook/github`
- Content type: `application/json`
- Events: `pull_request`
- Secret: copy **Secret** from Integrations table (per repo)

Rule file on repo: `guardrail.yaml` (then `.guard/general/quality.yml`).

## Scans via API key

```bash
export RULECLOUD_API_URL=https://rulecloud-production.up.railway.app
export RULECLOUD_API_KEY=rc_live_...

curl -sS -X POST "$RULECLOUD_API_URL/api/jobs/scan" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $RULECLOUD_API_KEY" \
  -d '{"repo_url":"https://github.com/owner/repo","branch":"main"}'
```

## Demo repo

Public sample: `lemonbanan4/rulecloud-demo` — PR #1 on `test/violate-rules` for violation demos.

## Agent constraints

- User JWT is required for `/api/integrations/github`; do not use service role for connect in customer-facing flows.
- After saving a PAT, retrigger scan: empty commit on PR branch or redeliver `pull_request` webhook.