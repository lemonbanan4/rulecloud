"""Default Guardrail rules configuration (.guard/rules.yaml per scan)."""

DEFAULT_RULES_YAML = """\
version: 1
include:
  - "**/*.cs"
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
rules:
  - id: hardcoded-secret
    type: regex
    pattern: '(?i)(api[_-]?key|password|secret|token)\\s*[=:]\\s*["\\'][^"\\']{8,}["\\']'
    message: Potential hardcoded secret or credential
  - id: todo-fixme
    type: regex
    pattern: '(?i)\\b(TODO|FIXME|HACK)\\b'
    message: Unresolved TODO/FIXME marker
"""