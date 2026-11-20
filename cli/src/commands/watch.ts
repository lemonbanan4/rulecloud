import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import pc from "picocolors";
import chokidar from "chokidar";

import { runAutofixForFile } from "../autofix.js";
import { postWatchEvent } from "../api.js";
import type { CliConfig } from "../config.js";
import { evaluateFile, type Finding } from "../eval.js";
import {
  printFinding,
  printHeader,
  printRulesWarning,
  printScanLine,
  printStatusLine,
} from "../hud.js";
import { loadRulesFromRepo } from "../rules-config.js";
import { walkSourceFiles } from "../walk.js";

export type WatchOpts = {
  cloud: boolean;
  plain: boolean;
};

function readFileContent(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

export async function runWatch(
  cwd: string,
  cfg: CliConfig,
  opts: WatchOpts,
): Promise<void> {
  const loaded = loadRulesFromRepo(cwd);
  const doc = loaded.doc;
  const debounce = new Map<string, ReturnType<typeof setTimeout>>();
  const allByKey = new Map<string, Finding>();
  let lastRel: string | null = null;
  let lastAbs: string | null = null;
  let lastFindings: Finding[] = [];

  const cloudOn = opts.cloud && Boolean(cfg.apiKey);

  const allFindings = (): Finding[] => [...allByKey.values()];

  const hudArgs = () => ({
    plain: opts.plain,
    cloud: cloudOn,
    ruleCount: loaded.ruleCount,
    configLabel: loaded.configLabel,
    findings: allFindings(),
  });

  const syncCloud = (rel: string, findings: Finding[], duration_ms: number) => {
    if (!cloudOn || !findings.length) return;
    void postWatchEvent(cfg, {
      file: rel,
      findings: findings as unknown as Record<string, unknown>[],
      duration_ms,
      repo_label: path.basename(cwd),
    }).catch((err: Error) => {
      if (!opts.plain) console.log(pc.dim(`cloud sync: ${err.message}`));
    });
  };

  const mergeFindings = (rel: string, findings: Finding[]) => {
    for (const [key, f] of [...allByKey.entries()]) {
      if (f.file === rel) allByKey.delete(key);
    }
    for (const f of findings) {
      allByKey.set(`${f.id}:${f.file}:${f.line}`, f);
    }
  };

  const renderViolations = (findings: Finding[]) => {
    for (const f of findings) {
      printFinding(f, opts.plain);
    }
  };

  const scanFile = (absPath: string) => {
    const rel = path.relative(cwd, absPath).replace(/\\/g, "/");
    const content = readFileContent(absPath);
    if (content === null) return;
    const start = Date.now();
    const findings = evaluateFile(rel, content, doc);
    const duration_ms = Date.now() - start;
    mergeFindings(rel, findings);
    lastRel = rel;
    lastAbs = absPath;
    lastFindings = findings;
    printScanLine(rel, duration_ms, findings.length, opts.plain);
    if (findings.length) renderViolations(findings);
    syncCloud(rel, findings, duration_ms);
    printStatusLine(allFindings(), opts.plain);
  };

  const rescanAll = () => {
    if (!opts.plain) console.clear();
    console.log(
      opts.plain
        ? `Loaded ${loaded.configLabel} (${loaded.ruleCount} rules)`
        : pc.cyan(`Loaded ${loaded.configLabel} (${loaded.ruleCount} rules)`),
    );
    allByKey.clear();
    const files = walkSourceFiles(cwd);
    let filesWithIssues = 0;
    for (const abs of files) {
      const rel = path.relative(cwd, abs).replace(/\\/g, "/");
      const content = readFileContent(abs);
      if (content === null) continue;
      const start = Date.now();
      const findings = evaluateFile(rel, content, doc);
      const duration_ms = Date.now() - start;
      mergeFindings(rel, findings);
      if (findings.length) {
        filesWithIssues += 1;
        printScanLine(rel, duration_ms, findings.length, opts.plain);
        renderViolations(findings);
        if (!lastRel) {
          lastRel = rel;
          lastAbs = abs;
          lastFindings = findings;
        }
      }
    }
    if (filesWithIssues === 0) {
      console.log(
        opts.plain
          ? "Initial scan: all files clean"
          : pc.green("Initial scan: all files clean"),
      );
    }
    printHeader(hudArgs());
    if (!opts.plain) {
      console.log(
        pc.dim(
          `Watching ${files.length} files under ${cwd} (awaitWriteFinish 200ms)…`,
        ),
      );
    } else {
      console.log(`Watching ${files.length} files…`);
    }
  };

  const runFix = async () => {
    if (!lastAbs || !lastRel) {
      console.log(
        opts.plain
          ? "No recent file — save a file or press r to rescan first"
          : pc.yellow("No recent file — save a file or press r to rescan first"),
      );
      return;
    }
    const content = readFileContent(lastAbs);
    if (content === null) return;
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* noop */
      }
    }
    const targets =
      lastFindings.length > 0
        ? lastFindings
        : evaluateFile(lastRel, content, doc);
    try {
      await runAutofixForFile({
        cwd,
        cfg,
        relPath: lastRel,
        absPath: lastAbs,
        code: content,
        findings: targets,
        rulesYaml: loaded.rulesText,
        plain: opts.plain,
        interactive: true,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Auto-fix failed";
      console.log(
        opts.plain
          ? `✖ Auto-fix unavailable: ${message}`
          : pc.red(`✖ Auto-fix unavailable: ${message}`),
      );
    } finally {
      if (process.stdin.isTTY && !opts.plain) {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
      }
    }
    scanFile(lastAbs);
  };

  console.log(
    opts.plain
      ? `Config: ${loaded.configLabel}`
      : pc.bold(`Config: ${pc.white(loaded.configLabel)}`),
  );
  console.log(`Rules: ${loaded.ruleCount} active`);
  if (loaded.warnReason) {
    printRulesWarning(loaded.warnReason, opts.plain);
  }

  rescanAll();

  const schedule = (absPath: string) => {
    const prev = debounce.get(absPath);
    if (prev) clearTimeout(prev);
    debounce.set(
      absPath,
      setTimeout(() => {
        debounce.delete(absPath);
        scanFile(absPath);
      }, 200),
    );
  };

  const watcher = chokidar.watch(cwd, {
    ignored: (watchPath) => {
      if (watchPath === cwd) return false;
      return path
        .relative(cwd, watchPath)
        .split(path.sep)
        .some((p) =>
          [
            "node_modules",
            ".git",
            ".next",
            "dist",
            ".cursor",
            "venv",
            ".venv",
          ].includes(p),
        );
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
    atomic: true,
    depth: 99,
  });

  watcher.on("change", schedule);
  watcher.on("add", schedule);

  const stop = async () => {
    await watcher.close();
    for (const t of debounce.values()) clearTimeout(t);
    if (process.stdin.isTTY && !opts.plain) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* noop */
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void stop();
  });

  if (process.stdin.isTTY && !opts.plain) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", (str, key) => {
      if (key?.ctrl && key.name === "c") {
        void stop();
        return;
      }
      const ch = (str || "").toLowerCase();
      if (ch === "q") void stop();
      else if (ch === "c") {
        console.clear();
        printHeader(hudArgs());
      } else if (ch === "r") rescanAll();
      else if (ch === "f") void runFix();
    });
  }
}