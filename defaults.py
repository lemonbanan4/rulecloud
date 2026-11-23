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
    type: regex
    pattern: '(?i)(sk-ant-[a-z0-9_-]{8,}|sk_live_[a-z0-9]{6,}|sk-[a-z0-9]{16,}|rc_live_[a-z0-9_-]{8,}|ghp_[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|dangerouslyAllowBrowser\\s*:\\s*true)'
    message: Hardcoded secret or unsafe browser API key usage — move to server/env

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
"""