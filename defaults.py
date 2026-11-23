"""Default Guardrail rules (.guard/ + root guardrail.yaml)."""

DEFAULT_RULES_YAML = """\
version: 1
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
    match: "**/*.ts"
    type: regex
    pattern: '(?i)(sk_live_[a-zA-Z0-9]{6,}|ghp_[a-zA-Z0-9]{20,}|\\b(API_KEY|SECRET|TOKEN|PASSWORD)\\s*=\\s*\"[^\"]{4,}\")'
    message: Hardcoded secret or credential — use environment variables or a secret manager
  - id: no-hardcoded-secrets-js
    severity: error
    match: "**/*.js"
    type: regex
    pattern: '(?i)(sk_live_[a-zA-Z0-9]{6,}|ghp_[a-zA-Z0-9]{20,}|\\b(API_KEY|SECRET|TOKEN|PASSWORD)\\s*=\\s*\"[^\"]{4,}\")'
    message: Hardcoded secret or credential — use environment variables or a secret manager
  - id: no-hardcoded-secrets-py
    severity: error
    match: "**/*.py"
    type: regex
    pattern: '(?i)(sk_live_[a-zA-Z0-9]{6,}|ghp_[a-zA-Z0-9]{20,}|\\b(api_key|secret|password|token)\\s*=\\s*\"[^\"]{4,}\")'
    message: Hardcoded secret or credential — use environment variables or a secret manager
  - id: no-hardcoded-secrets-cs
    severity: error
    match: "**/*.cs"
    type: regex
    pattern: '(?i)(sk_live_[a-zA-Z0-9]{6,}|\\b(API_KEY|SECRET|PASSWORD)\\s*=\\s*"[^"]{4,}")'
    message: Hardcoded secret or credential — use environment variables or a secret manager
  - id: no-hardcoded-secrets-go
    severity: error
    match: "**/*.go"
    type: regex
    pattern: '(?i)(sk_live_[a-zA-Z0-9]{6,}|ghp_[a-zA-Z0-9]{20,})'
    message: Hardcoded secret or credential — use environment variables or a secret manager

  - id: presentation-imports-data
    severity: warn
    from: "**/presentation/**"
    to: "**/data/**"
    message: Layer violation — presentation must not import the data layer directly

  - id: hygiene-todo
    severity: info
    match: "**/*.ts"
    type: regex
    pattern: '(?i)\\b(TODO|FIXME)\\b'
    message: Resolve TODO/FIXME before merging

  - id: no-hardcoded-secrets
    severity: high
    type: regex
    pattern: (?i)(sk-ant-[a-z0-9_-]{8,}|sk-[a-z0-9]{16,}|rc_live_[a-z0-9_-]{8,}|ghp_[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|(api[_-]?key|api[_-]?secret|auth[_-]?token|password)\s*[:=]\s*["'][^"'\s]{8,}["']|dangerouslyAllowBrowser\s*:\s*true)
    message: Hardcoded secret or unsafe browser API key usage — move to server/env
"""