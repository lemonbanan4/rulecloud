import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parseRulesYaml, type RuleDoc } from "./eval.js";
import { mergeRulesYamlTexts } from "./merge-rules.js";
export { mergeRuleDocs } from "./merge-rules.js";

const ROOT_CANDIDATES = [".guardrail.yml", "guardrail.yaml", "guardrail.yml"] as const;

const GUARDRAIL_DIR = ".guardrail";

export type LoadedRules = {
  configPath: string;
  configLabel: string;
  rulesText: string;
  doc: RuleDoc;
  ruleCount: number;
  warnReason?: string;
};

function loadFromGuardrailDir(cwd: string): LoadedRules | null {
  const dir = path.join(cwd, GUARDRAIL_DIR);
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((n) => /\.(ya?ml)$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch {
    return null;
  }
  if (!names.length) return null;

  const paths = names.map((n) => path.join(dir, n));
  const texts = paths.map((p) => readFileSync(p, "utf8"));
  const { doc, rulesText } = mergeRulesYamlTexts(texts);
  const ruleCount = doc.rules.length;
  let warnReason: string | undefined;
  if (ruleCount === 0) {
    warnReason =
      "Rules file parsed but the rules array is empty — no checks will run.";
  }
  const configLabel =
    names.length === 1
      ? `${GUARDRAIL_DIR}/${names[0]}`
      : `${GUARDRAIL_DIR}/ (${names.join(", ")})`;
  return {
    configPath: paths[0],
    configLabel,
    rulesText,
    doc,
    ruleCount,
    warnReason,
  };
}

function loadFromRootFile(cwd: string): LoadedRules | null {
  for (const name of ROOT_CANDIDATES) {
    const configPath = path.join(cwd, name);
    try {
      const rulesText = readFileSync(configPath, "utf8");
      const doc = parseRulesYaml(rulesText);
      const ruleCount = doc.rules.length;
      let warnReason: string | undefined;
      if (ruleCount === 0) {
        warnReason =
          "Rules file parsed but the rules array is empty — no checks will run.";
      }
      return {
        configPath,
        configLabel: name,
        rulesText,
        doc,
        ruleCount,
        warnReason,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}

export function loadRulesFromRepo(cwd: string): LoadedRules {
  const fromDir = loadFromGuardrailDir(cwd);
  if (fromDir) return fromDir;
  const fromRoot = loadFromRootFile(cwd);
  if (fromRoot) return fromRoot;
  throw new Error(
    `No guardrail config found in ${cwd} (tried ${GUARDRAIL_DIR}/*.yml, ${ROOT_CANDIDATES.join(", ")}) — run rulecloud init`,
  );
}