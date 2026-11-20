import type { Finding } from "./eval.js";

export type SeverityTier = "error" | "warn" | "info";

export function severityTier(sev: string): SeverityTier {
  const s = sev.toLowerCase();
  if (s === "error" || s.includes("crit")) return "error";
  if (s === "high") return "error";
  return s === "medium" || s.includes("warn") ? "warn" : "info";
}

export function severityLabel(sev: string): string {
  const t = severityTier(sev);
  if (t === "error") return "ERROR";
  if (t === "warn") return "WARN";
  return "INFO";
}

export type StatusSummary = {
  kind: "pass" | "blocked" | "warnings";
  errorCount: number;
  warnCount: number;
  total: number;
};

export function summarizeFindings(findings: Finding[]): StatusSummary {
  let errorCount = 0;
  let warnCount = 0;
  for (const f of findings) {
    const t = severityTier(f.severity);
    if (t === "error") errorCount += 1;
    else warnCount += 1;
  }
  const total = findings.length;
  let kind: StatusSummary["kind"] = "pass";
  if (errorCount > 0) kind = "blocked";
  else if (total > 0) kind = "warnings";
  return { kind, errorCount, warnCount, total };
}

export function formatHudStatus(summary: StatusSummary, plain: boolean): string {
  if (summary.kind === "pass") return plain ? "PASS (0)" : "PASS (0)";
  if (summary.kind === "blocked") {
    const n = summary.errorCount;
    const label = n === 1 ? "1 error" : `${n} errors`;
    return `BLOCKED (${label})`;
  }
  const n = summary.total;
  return n === 1 ? "WARNINGS (1)" : `WARNINGS (${n})`;
}

export function hasBlocking(findings: Finding[]): boolean {
  return findings.some((f) => severityTier(f.severity) === "error");
}