import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { RuleDoc } from "./eval.js";
import { WalkIgnoreFilter } from "./ignore.js";

const SCANNABLE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".cs",
  ".go",
  ".java",
  ".rb",
  ".php",
  ".rs",
  ".dart",
  ".md",
  ".json",
  ".yaml",
  ".yml",
]);

export type WalkOptions = {
  ruleDoc?: RuleDoc;
};

export function walkSourceFiles(
  root: string,
  opts?: WalkOptions,
  base = root,
): string[] {
  const filter = new WalkIgnoreFilter(base, opts?.ruleDoc);
  const out: string[] = [];

  const visit = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = path.join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (filter.shouldPruneDirectory(abs)) continue;
        visit(abs);
      } else if (st.isFile()) {
        if (filter.shouldSkipFile(abs)) continue;
        const ext = path.extname(name).toLowerCase();
        if (!ext || SCANNABLE_EXT.has(ext)) {
          out.push(abs);
        }
      }
    }
  };

  visit(root);
  return out;
}