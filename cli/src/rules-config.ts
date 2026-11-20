import { readFileSync } from "node:fs";
import path from "node:path";

import { parseRulesYaml, type RuleDoc } from "./eval.js";

const CANDIDATES = [".guardrail.yml", "guardrail.yaml", "guardrail.yml"] as const;

export type LoadedRules = {
  configPath: string;
  configLabel: string;
  rulesText: string;
  doc: RuleDoc;
  ruleCount: number;
  warnReason?: string;
};

export function loadRulesFromRepo(cwd: string): LoadedRules {
  for (const name of CANDIDATES) {
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
  throw new Error(
    `No guardrail config found in ${cwd} (tried ${CANDIDATES.join(", ")}) — run rulecloud init`,
  );
}