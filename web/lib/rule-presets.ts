export type RulePreset = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  yaml: string;
};

export const RULE_PACKS: RulePreset[] = [
  {
    id: "hardcoded-secrets",
    title: "Prevent Hardcoded Secrets",
    description: "Flags passwords, API keys, and tokens in source code.",
    tags: ["Security", "Secrets"],
    yaml: `version: 1
timeout_ms: 5000
include:
  - "**/*.cs"
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
rules:
  - id: hardcoded-secret
    type: regex
    description: Flags likely hardcoded credentials.
    pattern: '(?i)(password|secret|api_key)\\s*=\\s*"[^"]{8,}"'
    message: Potential hardcoded secret or credential
`,
  },
  {
    id: "clean-layering",
    title: "Enforce Clean Layering",
    description: "Discourage direct DB access from UI-facing components.",
    tags: ["Architecture", "C#"],
    yaml: `version: 1
include:
  - "**/*.cs"
rules:
  - id: no-db-in-ui
    type: regex
    description: UI must not open SQL connections directly.
    pattern: '(?i)(SqlConnection|NpgsqlConnection|DbContext)\\s*\\('
    message: Direct database access detected in presentation layer
`,
  },
  {
    id: "ai-codegen",
    title: "AI-Generated Code Hygiene",
    description: "Surface TODOs, debug prints, and placeholder credentials.",
    tags: ["AI", "Hygiene"],
    yaml: `version: 1
include:
  - "**/*"
rules:
  - id: todo-fixme
    type: regex
    pattern: '(?i)\\b(TODO|FIXME|HACK)\\b'
    message: Unresolved TODO/FIXME marker
  - id: console-log
    type: regex
    pattern: 'console\\.(log|debug)\\('
    message: Debug logging left in source
`,
  },
];

export const PLAYGROUND_PRESETS: { id: string; label: string; prompt: string }[] = [
  {
    id: "security",
    label: "Security / Secrets",
    prompt: "Block hardcoded API keys, passwords, and private keys in all languages",
  },
  {
    id: "architecture",
    label: "Clean Architecture",
    prompt: "Prevent direct database calls and HTTP clients inside UI/view components",
  },
  {
    id: "dotnet",
    label: "C# / .NET",
    prompt: "Flag hardcoded connection strings, secrets, and IDisposable leaks in C#",
  },
  {
    id: "typescript",
    label: "TypeScript / Next.js",
    prompt: "Detect env secrets in client components, console.log, and any-typed escapes",
  },
];

export const DEFAULT_SNIPPET = `using System;

namespace RuleCloud.Sample;

public class Example
{
    private const string password = "super-secret-demo-key";

    public void Run()
    {
        Console.WriteLine("Hello from Example.cs");
    }
}
`;

const STORAGE_KEY = "rc:rules_yaml";

export function loadPlaygroundYaml(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function savePlaygroundYaml(yaml: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, yaml);
}