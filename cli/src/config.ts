import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type CliConfig = {
  apiUrl: string;
  apiKey: string;
};

const ENV_URL = "RULECLOUD_API_URL";
const ENV_KEY = "RULECLOUD_API_KEY";
const LOCAL_RC = path.join(homedir(), ".rulecloudrc");

function loadDotEnv(cwd: string): void {
  for (const name of [".env", ".env.local"]) {
    const p = path.join(cwd, name);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const url = trimmed.match(/^RULECLOUD_API_URL=(.+)$/);
        if (url) process.env[ENV_URL] = url[1].trim().replace(/^["']|["']$/g, "");
        const key = trimmed.match(/^RULECLOUD_API_KEY=(.+)$/);
        if (key) process.env[ENV_KEY] = key[1].trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      /* ignore */
    }
  }
}

function loadProjectJson(cwd: string): Partial<CliConfig> {
  const p = path.join(cwd, ".rulecloud.json");
  if (!existsSync(p)) return {};
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as {
      apiUrl?: string;
      apiKey?: string;
    };
    return {
      apiUrl: data.apiUrl,
      apiKey: data.apiKey,
    };
  } catch {
    return {};
  }
}

export function loadConfig(cwd = process.cwd()): CliConfig {
  loadDotEnv(cwd);
  const project = loadProjectJson(cwd);
  const apiUrl = (
    project.apiUrl ||
    process.env[ENV_URL] ||
    process.env.NEXT_PUBLIC_API_URL ||
    "https://rulecloud-production.up.railway.app"
  ).replace(/\/$/, "");
  let apiKey = (project.apiKey || process.env[ENV_KEY] || "").trim();
  if (!apiKey && existsSync(LOCAL_RC)) {
    const raw = readFileSync(LOCAL_RC, "utf8");
    const m = raw.match(/^RULECLOUD_API_KEY=(.+)$/m);
    if (m) apiKey = m[1].trim();
  }
  return { apiUrl, apiKey };
}

export function requireApiKey(cfg: CliConfig): string {
  if (!cfg.apiKey) {
    throw new Error(
      `Missing API key. Set ${ENV_KEY}, add .rulecloud.json, .env, or ${LOCAL_RC}`,
    );
  }
  return cfg.apiKey;
}