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
rules:
  - id: hardcoded-secret
    severity: high
    match: "**/*"
    type: regex
    pattern: '(?i)(api_key|password|secret|token)\\s*=\\s*"[^"]{6,}"'
    message: Hardcoded credential — use environment variables or a secret manager

  - id: presentation-imports-data
    severity: medium
    from: "**/presentation/**"
    to: "**/data/**"
    message: Layer violation — presentation must not import the data layer directly

  - id: hygiene-todo
    severity: low
    match: "**/*"
    type: regex
    pattern: '(?i)\\b(TODO|FIXME)\\b'
    message: Resolve TODO/FIXME before merging
"""