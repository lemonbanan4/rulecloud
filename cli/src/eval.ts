import yaml from "js-yaml";
import path from "node:path";

export type Finding = {
  id: string;
  message: string;
  file: string;
  line: number;
  severity: string;
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "venv",
  ".venv",
  "build",
  "target",
  "__pycache__",
]);

type RuleDoc = {
  include: string[];
  exclude: string[];
  rules: Record<string, unknown>[];
};

function globMatch(pattern: string, relpath: string): boolean {
  const norm = relpath.replace(/\\/g, "/").replace(/^\.\//, "");
  const p = pattern.replace(/\\/g, "/");
  const esc = p
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  try {
    return new RegExp(`^${esc}$`, "i").test(norm);
  } catch {
    return norm.includes(p);
  }
}

function matchAny(patterns: string[], relpath: string): boolean {
  return patterns.some((p) => globMatch(p, relpath));
}

function rulePatterns(rule: Record<string, unknown>, include: string[]): string[] {
  for (const key of ["match", "include", "files"]) {
    const val = rule[key];
    if (typeof val === "string" && val.trim()) return [val.trim()];
    if (Array.isArray(val) && val.length) return val.map(String);
  }
  return include;
}

function severityRank(sev: string): number {
  const s = sev.toLowerCase();
  if (s.includes("crit") || s === "high" || s.includes("error")) return 2;
  if (s.includes("warn") || s === "medium") return 1;
  return 0;
}

export function parseRulesYaml(text: string): RuleDoc {
  const data = yaml.load(text) as Record<string, unknown>;
  const include = Array.isArray(data?.include)
    ? data.include.map(String)
    : ["**/*"];
  const exclude = Array.isArray(data?.exclude) ? data.exclude.map(String) : [];
  const rules = Array.isArray(data?.rules)
    ? (data.rules as Record<string, unknown>[]).filter((r) => r?.id)
    : [];
  return { include, exclude, rules };
}

function evalRegex(
  rule: Record<string, unknown>,
  relpath: string,
  lines: string[],
  patterns: string[],
): Finding[] {
  if (!matchAny(patterns, relpath)) return [];
  const raw = (rule.pattern || rule.regex) as string | undefined;
  if (!raw) return [];
  let rx: RegExp;
  try {
    rx = new RegExp(String(raw));
  } catch {
    return [];
  }
  const rid = String(rule.id);
  const msg = String(rule.message || rule.description || rid);
  const sev = String(rule.severity || "warning");
  const out: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (rx.test(lines[i])) {
      out.push({ id: rid, message: msg, file: relpath, line: i + 1, severity: sev });
    }
  }
  return out;
}

function evalLayer(
  rule: Record<string, unknown>,
  relpath: string,
  lines: string[],
): Finding[] {
  const from = rule.from as string | undefined;
  const to = rule.to as string | undefined;
  if (!from || !to) return [];
  if (!globMatch(from, relpath)) return [];
  const rid = String(rule.id);
  const msg = String(rule.message || "Forbidden layer dependency");
  const sev = String(rule.severity || "medium");
  const toNorm = to.replace(/\\/g, "/");
  const importRe = /^\s*(import|from|using)\s+/;
  const out: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!importRe.test(line)) continue;
    const ln = line.replace(/\\/g, "/");
    if (ln.includes(toNorm) || /\/data\//.test(toNorm) && /['"].*(\.\.\/data\/|\/data\/)/.test(ln)) {
      out.push({ id: rid, message: msg, file: relpath, line: i + 1, severity: sev });
    }
  }
  return out;
}

function evalMaxLines(
  rule: Record<string, unknown>,
  relpath: string,
  lines: string[],
  patterns: string[],
): Finding[] {
  const max = rule.max_lines;
  if (max == null || !matchAny(patterns, relpath)) return [];
  const limit = Number(max);
  if (Number.isNaN(limit) || lines.length <= limit) return [];
  return [
    {
      id: String(rule.id),
      message: String(rule.message || `File exceeds ${limit} lines (${lines.length})`),
      file: relpath,
      line: 1,
      severity: String(rule.severity || "warning"),
    },
  ];
}

export function evaluateFile(
  relpath: string,
  content: string,
  doc: RuleDoc,
): Finding[] {
  if (doc.exclude.length && matchAny(doc.exclude, relpath)) return [];
  if (!matchAny(doc.include, relpath)) return [];
  if (!content.trim()) return [];
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];
  for (const rule of doc.rules) {
    const patterns = rulePatterns(rule, doc.include);
    const rtype = String(rule.type || "").toLowerCase();
    if (rule.from && rule.to) findings.push(...evalLayer(rule, relpath, lines));
    if (rule.max_lines != null) findings.push(...evalMaxLines(rule, relpath, lines, patterns));
    if (rtype === "regex" || rule.pattern || rule.regex) {
      findings.push(...evalRegex(rule, relpath, lines, patterns));
    }
  }
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = `${f.id}:${f.file}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function shouldIgnorePath(absPath: string, root: string): boolean {
  const rel = path.relative(root, absPath);
  if (rel.startsWith("..")) return true;
  const parts = rel.split(path.sep);
  return parts.some((p) => SKIP_DIRS.has(p));
}

export function hasCritical(findings: Finding[]): boolean {
  return findings.some((f) => severityRank(f.severity) >= 2);
}