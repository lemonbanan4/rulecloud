"""Default Guardrail rules configuration written as guardrail.yaml per scan."""

DEFAULT_RULES_YAML = """\
version: "1"
include:
  extensions:
    - .cs
    - .py
    - .ts
    - .tsx
    - .js
  paths:
    - "**/*"

regex_rules:
  - id: hardcoded-secret
    pattern: '(?i)(api[_-]?key|password|secret|token)\\s*[=:]\\s*["\\'][^"\\']{8,}["\\']'
    message: Potential hardcoded secret or credential
    severity: error
  - id: todo-fixme
    pattern: '(?i)\\b(TODO|FIXME|HACK)\\b'
    message: Unresolved TODO/FIXME marker
    severity: warning

ast_rules:
  - id: no-eval
    languages: [python, javascript, typescript]
    check: disallow-eval
    message: Avoid eval() and similar dynamic execution
    severity: error
  - id: bare-except
    languages: [python]
    check: no-bare-except
    message: Avoid bare except clauses
    severity: warning

output:
  format: json
"""