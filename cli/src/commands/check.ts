import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import pc from "picocolors";

import { evaluateFile, hasCritical, parseRulesYaml, shouldIgnorePath } from "../eval.js";

function loadRules(cwd: string): string {
  for (const name of [".guardrail.yml", "guardrail.yaml", "guardrail.yml"]) {
    try {
      return readFileSync(path.join(cwd, name), "utf8");
    } catch {
      /* next */
    }
  }
  throw new Error("No .guardrail.yml — run rulecloud init first");
}

function walkFiles(root: string, base = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const abs = path.join(root, name);
    if (shouldIgnorePath(abs, base)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walkFiles(abs, base));
    else if (st.isFile()) out.push(abs);
  }
  return out;
}

function stagedFiles(cwd: string): string[] | null {
  const r = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((rel) => path.join(cwd, rel));
}

export function runCheck(cwd: string, staged: boolean): number {
  const doc = parseRulesYaml(loadRules(cwd));
  const files = staged ? stagedFiles(cwd) : walkFiles(cwd);
  if (staged && files === null) {
    console.error(pc.red("git not available or not a repo — scanning full tree"));
    return runCheck(cwd, false);
  }
  const targets = files ?? walkFiles(cwd);
  const all = [];
  for (const abs of targets) {
    if (shouldIgnorePath(abs, cwd)) continue;
    const rel = path.relative(cwd, abs).replace(/\\/g, "/");
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    all.push(...evaluateFile(rel, content, doc));
  }
  if (all.length === 0) {
    console.log(pc.green("✓ No violations"));
    return 0;
  }
  for (const f of all) {
    const tag = hasCritical([f]) ? pc.red("[BLOCKED]") : pc.yellow("[WARN]");
    console.log(`${tag} ${f.file}:${f.line} — ${f.id} ${f.message}`);
  }
  console.log(pc.dim(`\n${all.length} finding(s)`));
  return hasCritical(all) ? 1 : 0;
}