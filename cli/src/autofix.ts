import { writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import pc from "picocolors";

import { postAutofix } from "./api.js";
import type { CliConfig } from "./config.js";
import { requireApiKey } from "./config.js";
import type { Finding } from "./eval.js";
import { severityTier } from "./severity.js";

function printColoredDiff(diff: string, plain: boolean): void {
  for (const line of diff.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("+++") || line.startsWith("---")) {
      console.log(plain ? line : pc.cyan(line));
    } else if (line.startsWith("+")) {
      console.log(plain ? line : pc.green(line));
    } else if (line.startsWith("-")) {
      console.log(plain ? line : pc.red(line));
    } else {
      console.log(plain ? line : pc.dim(line));
    }
  }
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export async function runAutofixForFile(opts: {
  cwd: string;
  cfg: CliConfig;
  relPath: string;
  absPath: string;
  code: string;
  findings: Finding[];
  rulesYaml: string;
  plain: boolean;
  interactive: boolean;
}): Promise<boolean> {
  requireApiKey(opts.cfg);
  const targets = opts.findings
    .filter((f) => f.file === opts.relPath)
    .sort((a, b) => {
      const rank = (f: Finding) =>
        severityTier(f.severity) === "error" ? 0 : severityTier(f.severity) === "warn" ? 1 : 2;
      return rank(a) - rank(b) || a.line - b.line;
    });
  if (targets.length === 0) {
    console.log(pc.yellow(`No violations in ${opts.relPath}`));
    return false;
  }
  const violation = targets[0];
  const { status, body } = await postAutofix(opts.cfg, {
    code: opts.code,
    violation: violation as unknown as Record<string, unknown>,
    rules_yaml: opts.rulesYaml,
  });
  if (status === 402) {
    const msg = body.detail || "AI Auto-Fix requires RuleCloud Pro";
    console.log(opts.plain ? msg : pc.yellow(msg));
    console.log(
      opts.plain
        ? "Upgrade: https://rulecloud.vercel.app/dashboard/billing"
        : pc.cyan("Upgrade: https://rulecloud.vercel.app/dashboard/billing"),
    );
    return false;
  }
  if (status >= 400) {
    throw new Error(body.detail || body.error || `Auto-fix failed (${status})`);
  }
  if (body.explanation) {
    console.log(opts.plain ? body.explanation : pc.bold(body.explanation));
  }
  if (body.diff) {
    printColoredDiff(body.diff, opts.plain);
  }
  const patched = (body.patched_code || "").trim();
  if (!patched) {
    console.log(opts.plain ? "No patched_code returned" : pc.yellow("No patched_code returned"));
    return false;
  }
  if (!opts.interactive) return false;
  const ok = await confirm(`Apply fix to ${opts.relPath}? [y/N] `);
  if (!ok) return false;
  writeFileSync(opts.absPath, patched, "utf8");
  console.log(opts.plain ? "Applied." : pc.green("Applied."));
  return true;
}

export async function runFixCommand(
  cwd: string,
  cfg: CliConfig,
  relFile: string | undefined,
  plain: boolean,
): Promise<void> {
  const { loadRulesFromRepo } = await import("./rules-config.js");
  const { evaluateFile } = await import("./eval.js");
  const { readFileSync } = await import("node:fs");
  const loaded = loadRulesFromRepo(cwd);
  let targetRel = relFile;
  if (!targetRel) {
    const { walkSourceFiles } = await import("./walk.js");
    const { evaluateFile } = await import("./eval.js");
    const { severityTier } = await import("./severity.js");
    for (const abs of walkSourceFiles(cwd)) {
      const rel = path.relative(cwd, abs).replace(/\\/g, "/");
      const findings = evaluateFile(rel, readFileSync(abs, "utf8"), loaded.doc);
      if (findings.some((f) => severityTier(f.severity) === "error")) {
        targetRel = rel;
        break;
      }
    }
  }
  if (!targetRel) {
    console.log(plain ? "No file with errors found" : pc.yellow("No file with errors found"));
    return;
  }
  const absPath = path.join(cwd, targetRel);
  const code = readFileSync(absPath, "utf8");
  const findings = evaluateFile(targetRel, code, loaded.doc);
  await runAutofixForFile({
    cwd,
    cfg,
    relPath: targetRel.replace(/\\/g, "/"),
    absPath,
    code,
    findings,
    rulesYaml: loaded.rulesText,
    plain,
    interactive: true,
  });
}