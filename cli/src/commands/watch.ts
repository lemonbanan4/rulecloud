import { readFileSync } from "node:fs";
import path from "node:path";

import pc from "picocolors";
import chokidar from "chokidar";

import { postWatchEvent } from "../api.js";
import type { CliConfig } from "../config.js";
import { evaluateFile, parseRulesYaml, shouldIgnorePath } from "../eval.js";

function loadRules(cwd: string): string {
  const candidates = [".guardrail.yml", "guardrail.yaml", "guardrail.yml"];
  for (const name of candidates) {
    const p = path.join(cwd, name);
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error("No .guardrail.yml — run rulecloud init first");
}

function printFinding(f: { file: string; line: number; id: string; message: string; severity: string }) {
  const sev = f.severity.toLowerCase();
  const tag =
    sev.includes("crit") || sev === "high"
      ? pc.red("[BLOCKED]")
      : sev === "medium" || sev.includes("warn")
        ? pc.yellow("[WARN]")
        : pc.dim("[info]");
  console.log(
    `${tag} ${pc.cyan(f.file)}:${pc.white(String(f.line))} — ${pc.bold(f.id)} ${pc.dim(f.message)}`,
  );
}

export async function runWatch(
  cwd: string,
  cfg: CliConfig,
  opts: { cloud: boolean },
): Promise<void> {
  const rulesText = loadRules(cwd);
  const doc = parseRulesYaml(rulesText);
  const debounce = new Map<string, ReturnType<typeof setTimeout>>();

  const onFile = (absPath: string) => {
    if (shouldIgnorePath(absPath, cwd)) return;
    const rel = path.relative(cwd, absPath).replace(/\\/g, "/");
    let content: string;
    try {
      content = readFileSync(absPath, "utf8");
    } catch {
      return;
    }
    const start = Date.now();
    const findings = evaluateFile(rel, content, doc);
    const duration_ms = Date.now() - start;
    if (findings.length === 0) return;
    for (const f of findings) printFinding(f);
    if (opts.cloud && cfg.apiKey) {
      void postWatchEvent(cfg, {
        file: rel,
        findings: findings as unknown as Record<string, unknown>[],
        duration_ms,
        repo_label: path.basename(cwd),
      }).catch((err: Error) => pc.dim(`cloud sync: ${err.message}`));
    }
  };

  const schedule = (absPath: string) => {
    const prev = debounce.get(absPath);
    if (prev) clearTimeout(prev);
    debounce.set(
      absPath,
      setTimeout(() => {
        debounce.delete(absPath);
        onFile(absPath);
      }, 300),
    );
  };

  console.log(pc.green("rulecloud watch") + pc.dim(" — real-time Cloud Rulespacks (Ctrl+C to stop)"));
  if (opts.cloud) console.log(pc.dim("Cloud sync: /api/watch/events"));

  const watcher = chokidar.watch(cwd, {
    ignored: (p) => shouldIgnorePath(p, cwd),
    ignoreInitial: true,
    persistent: true,
  });
  watcher.on("change", schedule);
  watcher.on("add", schedule);
}