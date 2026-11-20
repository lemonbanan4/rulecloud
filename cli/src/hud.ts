import pc from "picocolors";

import type { Finding } from "./eval.js";
import { formatHudStatus, severityLabel, summarizeFindings } from "./severity.js";

export type HudOptions = { plain: boolean; cloud: boolean };

function c(enabled: boolean, fn: (s: string) => string, s: string): string {
  return enabled ? fn(s) : s;
}

function timeStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function printRulesWarning(reason: string, plain: boolean): void {
  const line = `⚠ ${reason}`;
  console.log(plain ? line : pc.yellow(line));
}

export function printHeader(
  opts: HudOptions & {
    ruleCount: number;
    configLabel: string;
    findings: Finding[];
  },
): void {
  const { plain, cloud, ruleCount, configLabel, findings } = opts;
  const cloudLabel = cloud ? "ON" : "OFF";
  const summary = summarizeFindings(findings);
  const statusText = formatHudStatus(summary, plain);
  const status =
    summary.kind === "pass"
      ? c(plain, pc.green, statusText)
      : summary.kind === "blocked"
        ? c(plain, pc.red, statusText)
        : c(plain, pc.yellow, statusText);
  const bar = [
    c(plain, pc.bold, "RuleCloud Watch"),
    `Rules: ${ruleCount} loaded (${configLabel})`,
    `Cloud Sync: ${cloudLabel}`,
    `Status: ${status}`,
  ].join(" · ");
  console.log(bar);
  if (!plain && process.stdin.isTTY) {
    console.log(pc.dim("r rescan · f ai-fix · c clear · q quit"));
  }
  console.log("");
}

export function printScanLine(
  rel: string,
  durationMs: number,
  count: number,
  plain: boolean,
): void {
  const ts = `[${timeStamp()}]`;
  if (count === 0) {
    console.log(
      `${ts} Scanned ${rel} (${durationMs}ms) — ${c(plain, pc.green, "✓ clean")}`,
    );
    return;
  }
  const n = count === 1 ? "1 violation" : `${count} violations`;
  console.log(
    `${ts} Scanned ${rel} (${durationMs}ms) — ${c(plain, pc.yellow, n)}`,
  );
}

export function printFinding(f: Finding, plain: boolean): void {
  const label = severityLabel(f.severity);
  const loc = `${f.file}:${f.line}`;
  const color =
    label === "ERROR" ? pc.red : label === "WARN" ? pc.yellow : pc.dim;
  const head = c(plain, color, `  ✖ [${label}] ${loc}  ${f.id}`);
  console.log(head);
  console.log(c(plain, pc.dim, `    └─ ${f.message}`));
}

export function printStatusLine(findings: Finding[], plain: boolean): void {
  const summary = summarizeFindings(findings);
  const statusText = formatHudStatus(summary, plain);
  const colored =
    summary.kind === "pass"
      ? c(plain, pc.green, statusText)
      : summary.kind === "blocked"
        ? c(plain, pc.red, statusText)
        : c(plain, pc.yellow, statusText);
  console.log(c(plain, pc.dim, `Status: ${colored}`));
}