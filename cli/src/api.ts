import { createHash } from "node:crypto";

import type { CliConfig } from "./config.js";

export type BundleResult = {
  rules_yaml: string;
  etag: string;
  notModified?: boolean;
  source: "rulespacks" | "defaults";
};

async function fetchDefaults(cfg: CliConfig): Promise<BundleResult> {
  const res = await fetch(`${cfg.apiUrl}/api/defaults`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`/api/defaults failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { rules_yaml: string };
  const yaml = data.rules_yaml || "";
  const etag = createHash("sha256").update(yaml).digest("hex").slice(0, 16);
  return { rules_yaml: yaml, etag, source: "defaults" };
}

export async function fetchBundle(
  cfg: CliConfig,
  etag?: string,
): Promise<BundleResult> {
  const headers: Record<string, string> = {
    "X-API-Key": cfg.apiKey,
  };
  if (etag) headers["If-None-Match"] = `"${etag}"`;
  const bundleUrl = `${cfg.apiUrl}/api/rulespacks/bundle`;
  const res = await fetch(bundleUrl, { headers });
  if (res.status === 304) {
    return {
      rules_yaml: "",
      etag: etag || "",
      notModified: true,
      source: "rulespacks",
    };
  }
  if (res.status === 404) {
    console.warn(
      `Cloud Rulespacks API is not on ${cfg.apiUrl} yet (404).\n` +
        "  → Deploy the latest RuleCloud API and run supabase/migrations/010_rulespacks.sql\n" +
        "  → Or point at a local server: export RULECLOUD_API_URL=http://127.0.0.1:8000\n" +
        "Using /api/defaults for now.",
    );
    return fetchDefaults(cfg);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Bundle fetch failed (${res.status}) from ${bundleUrl}: ${text}`,
    );
  }
  const data = (await res.json()) as { rules_yaml: string; etag: string };
  return { ...data, source: "rulespacks" };
}

export type AutofixResult = {
  explanation?: string;
  patched_code?: string;
  suggestion_lines?: string;
  diff?: string;
  error?: string;
  detail?: string;
};

export async function postAutofix(
  cfg: CliConfig,
  payload: {
    code: string;
    violation: Record<string, unknown>;
    rules_yaml: string;
  },
): Promise<{ status: number; body: AutofixResult }> {
  const res = await fetch(`${cfg.apiUrl}/api/ai/autofix`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": cfg.apiKey,
    },
    body: JSON.stringify(payload),
  });
  let body: AutofixResult = {};
  try {
    body = (await res.json()) as AutofixResult;
  } catch {
    body = { detail: await res.text() };
  }
  return { status: res.status, body };
}

export async function postWatchEvent(
  cfg: CliConfig,
  payload: {
    file: string;
    findings: Record<string, unknown>[];
    duration_ms: number;
    repo_label?: string;
  },
): Promise<void> {
  const res = await fetch(`${cfg.apiUrl}/api/watch/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": cfg.apiKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 202) {
    const text = await res.text();
    throw new Error(`Watch event failed (${res.status}): ${text}`);
  }
}