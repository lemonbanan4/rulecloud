import path from "node:path";

import { globMatch, matchAny } from "./glob.js";

const CONFIG_NAMES = new Set([
  ".guardrail.yml",
  "guardrail.yaml",
  "guardrail.yml",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
]);

export function isDefaultExcludedPath(relpath: string): boolean {
  const norm = relpath.replace(/\\/g, "/");
  const base = path.basename(norm);
  if (CONFIG_NAMES.has(base)) return true;
  if (LOCKFILES.has(base)) return true;
  if (norm.endsWith(".md")) return true;
  if (norm.includes("/.guard/") || norm.startsWith(".guard/")) return true;
  if (norm.startsWith(".guardrail/") || norm.includes("/.guardrail/")) return true;
  return false;
}

/** True when a rule's match/include/files is narrower than a repo-wide glob. */
export function ruleExplicitlyTargets(
  rule: Record<string, unknown>,
  relpath: string,
): boolean {
  if (rule.from) {
    return matchAny([String(rule.from)], relpath);
  }
  const patterns: string[] = [];
  for (const key of ["match", "include", "files"]) {
    const val = rule[key];
    if (typeof val === "string" && val.trim()) patterns.push(val.trim());
    if (Array.isArray(val)) patterns.push(...val.map(String));
  }
  const specific = patterns.filter((p) => {
    const t = p.trim();
    return t && t !== "**/*" && t !== "**" && t !== "*";
  });
  return specific.some((p) => matchAny([p], relpath));
}

export function shouldEvaluateSourceFile(
  relpath: string,
  rules: Record<string, unknown>[],
): boolean {
  if (!isDefaultExcludedPath(relpath)) return true;
  return rules.some((rule) => ruleExplicitlyTargets(rule, relpath));
}