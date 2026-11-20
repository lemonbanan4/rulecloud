import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import pc from "picocolors";

import { evaluateFile, type Finding } from "../eval.js";
import { hasBlocking } from "../severity.js";
import { printFinding, printRulesWarning } from "../hud.js";
import { loadRulesFromRepo } from "../rules-config.js";
import { shouldIgnorePath } from "../eval.js";
import { walkSourceFiles } from "../walk.js";

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

export function runCheck(cwd: string, staged: boolean, plain = false): number {
  const loaded = loadRulesFromRepo(cwd);
  console.log(
    plain
      ? `Loaded ${loaded.configLabel} — ${loaded.ruleCount} rules`
      : pc.cyan(`Loaded ${loaded.configLabel} — ${loaded.ruleCount} rules`),
  );
  if (loaded.warnReason) printRulesWarning(loaded.warnReason, plain);

  const doc = loaded.doc;
  const files = staged ? stagedFiles(cwd) : walkSourceFiles(cwd);
  if (staged && files === null) {
    console.error(pc.red("git not available — scanning full tree"));
    return runCheck(cwd, false, plain);
  }
  const targets = files ?? walkSourceFiles(cwd);
  const all: Finding[] = [];
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
  const unique = all.filter((f, i, arr) => {
    const k = `${f.id}:${f.file}:${f.line}`;
    return arr.findIndex((x) => `${x.id}:${x.file}:${x.line}` === k) === i;
  });
  if (unique.length === 0) {
    console.log(plain ? "PASS (0)" : pc.green("✓ PASS (0)"));
    return 0;
  }
  for (const f of unique) {
    printFinding(f, plain);
  }
  console.log(plain ? `\n${unique.length} finding(s)` : pc.dim(`\n${unique.length} finding(s)`));
  return hasBlocking(unique) ? 1 : 0;
}