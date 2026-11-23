import yaml from "js-yaml";

import { parseRulesYaml, type RuleDoc } from "./eval.js";

export function mergeRuleDocs(docs: RuleDoc[]): RuleDoc {
  if (!docs.length) {
    return { include: ["**/*"], exclude: [], ignore: [], rules: [] };
  }
  const include: string[] = [];
  const exclude: string[] = [];
  const ignore: string[] = [];
  const rules: Record<string, unknown>[] = [];
  for (const doc of docs) {
    for (const g of doc.include) {
      if (!include.includes(g)) include.push(g);
    }
    for (const g of doc.exclude) {
      if (!exclude.includes(g)) exclude.push(g);
    }
    for (const g of doc.ignore ?? []) {
      if (!ignore.includes(g)) ignore.push(g);
    }
    for (const rule of doc.rules) {
      if (rule?.id) rules.push(rule);
    }
  }
  return {
    include: include.length ? include : ["**/*"],
    exclude,
    ignore,
    rules,
  };
}

export function mergeRulesYamlTexts(texts: string[]): {
  doc: RuleDoc;
  rulesText: string;
} {
  const docs = texts.map((t) => parseRulesYaml(t));
  const doc = mergeRuleDocs(docs);
  const rulesText =
    texts.length === 1 ? texts[0] : `${yaml.dump(doc, { lineWidth: -1 })}`;
  return { doc, rulesText };
}