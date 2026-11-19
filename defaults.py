"""Default Guardrail rules configuration (.guard/general/quality.yml per scan)."""

DEFAULT_RULES_YAML = """\
version: 1
timeout_ms: 5000
include:
  - "**/*.cs"
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
rules:
  - id: hardcoded-secret
    type: regex
    description: Flags likely hardcoded credentials in source.
    pattern: '(?i)(password|secret|api_key)\\s*=\\s*"[^"]{8,}"'
    message: Potential hardcoded secret or credential
  - id: todo-fixme
    type: regex
    description: Flags TODO/FIXME markers.
    pattern: '(?i)\\b(TODO|FIXME|HACK)\\b'
    message: Unresolved TODO/FIXME marker
"""