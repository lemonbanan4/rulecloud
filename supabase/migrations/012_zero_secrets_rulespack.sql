-- Refresh built-in Zero Secrets pack with expanded token / key patterns.

UPDATE public.rulespacks
SET
  rules_yaml = $yaml$version: 1
timeout_ms: 5000
include:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.py"
  - "**/*.js"
  - "**/*.cs"
  - "**/*.go"
rules:
  - id: no-hardcoded-secrets
    severity: error
    type: regex
    pattern: '(?i)(sk-ant-[a-z0-9_-]{8,}|sk_live_[a-z0-9]{6,}|sk-[a-z0-9]{16,}|rc_live_[a-z0-9_-]{8,}|ghp_[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|dangerouslyAllowBrowser\s*:\s*true)'
    message: Hardcoded secret or unsafe browser API key usage — move to server/env
$yaml$,
  updated_at = now()
WHERE slug = 'zero-secrets';