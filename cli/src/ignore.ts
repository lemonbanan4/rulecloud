import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { matchAny } from "./glob.js";
import type { RuleDoc } from "./eval.js";

/** Directory names pruned during walks (Go filepath.SkipDir equivalent). */
export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "vendor",
  "Pods",
  "build",
  "dist",
  ".dart_tool",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".next",
  ".git",
  ".cursor",
  ".guard",
  ".guardrail",
]);

export function isSkipDirName(name: string): boolean {
  return SKIP_DIR_NAMES.has(name);
}

export function relativePathParts(repoRoot: string, absPath: string): string[] {
  const rel = path.relative(repoRoot, absPath);
  if (!rel || rel.startsWith("..")) return [];
  return rel.split(path.sep).filter(Boolean);
}

export function pathHasSkipDirSegment(repoRoot: string, absPath: string): boolean {
  return relativePathParts(repoRoot, absPath).some((p) => isSkipDirName(p));
}

function gitignoreLineToGlobs(line: string): string[] {
  let raw = line.trim();
  if (!raw || raw.startsWith("#")) return [];
  if (raw.startsWith("!")) return [];
  let dirOnly = raw.endsWith("/");
  if (dirOnly) raw = raw.slice(0, -1);
  if (!raw) return [];
  if (raw.startsWith("/")) {
    raw = raw.slice(1);
    const anchored = raw.replace(/^\.\//, "");
    return dirOnly ? [`${anchored}/**`] : [anchored, `${anchored}/**`, `**/${anchored}/**`];
  }
  if (raw.includes("/")) {
    return dirOnly ? [`**/${raw}/**`, raw + "/**"] : [`**/${raw}`, `**/${raw}/**`];
  }
  return dirOnly ? [`**/${raw}/**`] : [`**/${raw}`, `**/${raw}/**`];
}

export function loadGitignoreGlobs(repoRoot: string): string[] {
  const file = path.join(repoRoot, ".gitignore");
  if (!existsSync(file)) return [];
  try {
    const text = readFileSync(file, "utf8");
    const globs: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      globs.push(...gitignoreLineToGlobs(line));
    }
    return globs;
  } catch {
    return [];
  }
}

export function ruleIgnoreGlobs(doc?: RuleDoc): string[] {
  if (!doc) return [];
  const extra = doc.ignore ?? [];
  return [...doc.exclude, ...extra];
}

export class WalkIgnoreFilter {
  private readonly _globs: string[];

  constructor(
    private readonly _repoRoot: string,
    ruleDoc?: RuleDoc,
  ) {
    this._globs = [...loadGitignoreGlobs(_repoRoot), ...ruleIgnoreGlobs(ruleDoc)];
  }

  /** Do not enter this directory (SkipDir). */
  shouldPruneDirectory(absDir: string): boolean {
    const name = path.basename(absDir);
    if (isSkipDirName(name)) return true;
    const rel = path.relative(this._repoRoot, absDir).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) return true;
    if (this._globs.length && matchAny(this._globs, `${rel}/`)) return true;
    if (this._globs.length && matchAny(this._globs, rel)) return true;
    return false;
  }

  shouldIgnoreWatchPath(absPath: string): boolean {
    if (absPath === this._repoRoot) return false;
    if (pathHasSkipDirSegment(this._repoRoot, absPath)) return true;
    const rel = path.relative(this._repoRoot, absPath).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) return true;
    if (this._globs.length && matchAny(this._globs, rel)) return true;
    return false;
  }

  shouldSkipFile(absFile: string): boolean {
    if (pathHasSkipDirSegment(this._repoRoot, absFile)) return true;
    const rel = path.relative(this._repoRoot, absFile).replace(/\\/g, "/");
    if (this._globs.length && matchAny(this._globs, rel)) return true;
    return false;
  }
}