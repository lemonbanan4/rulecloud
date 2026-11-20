import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { shouldIgnorePath } from "./eval.js";

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
  ".md",
  ".json",
  ".yaml",
  ".yml",
]);

export function walkSourceFiles(root: string, base = root): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const abs = path.join(root, name);
    if (shouldIgnorePath(abs, base)) continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkSourceFiles(abs, base));
    } else if (st.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (!ext || SCANNABLE_EXT.has(ext)) {
        out.push(abs);
      }
    }
  }
  return out;
}