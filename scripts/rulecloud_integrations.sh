#!/usr/bin/env bash
# RuleCloud GitHub integration helpers (needs console session JWT in RULECLOUD_ACCESS_TOKEN).
set -euo pipefail

API_URL="${RULECLOUD_API_URL:-https://rulecloud-production.up.railway.app}"
TOKEN="${RULECLOUD_ACCESS_TOKEN:?set RULECLOUD_ACCESS_TOKEN from browser session}"

auth=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")

cmd="${1:-}"
shift || true

case "$cmd" in
  list)
    curl -sS "${API_URL}/api/integrations/github" "${auth[@]}"
    ;;
  connect)
    repo="${1:?owner/repo}"
    pat="${2:?github_pat}"
    curl -sS -X POST "${API_URL}/api/integrations/github" "${auth[@]}" \
      -d "$(printf '{"repo_full_name":"%s","github_token":"%s"}' "$repo" "$pat")"
    ;;
  patch-token)
    id="${1:?connection uuid}"
    pat="${2:?github_pat}"
    curl -sS -X PATCH "${API_URL}/api/integrations/github/${id}" "${auth[@]}" \
      -d "$(printf '{"github_token":"%s"}' "$pat")"
    ;;
  *)
    echo "Usage: $0 list | connect OWNER/REPO PAT | patch-token CONNECTION_ID PAT"
    exit 1
    ;;
esac