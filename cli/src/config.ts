import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type CliConfig = {
  apiUrl: string;
  apiKey: string;
};

const ENV_URL = "RULECLOUD_API_URL";
const ENV_KEY = "RULECLOUD_API_KEY";
const LOCAL_RC = path.join(homedir(), ".rulecloudrc");

export function loadConfig(): CliConfig {
  const apiUrl = (
    process.env[ENV_URL] ||
    process.env.NEXT_PUBLIC_API_URL ||
    "https://rulecloud-production.up.railway.app"
  ).replace(/\/$/, "");
  let apiKey = (process.env[ENV_KEY] || "").trim();
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
      `Missing API key. Set ${ENV_KEY} or create ${LOCAL_RC} with RULECLOUD_API_KEY=rc_live_...`,
    );
  }
  return cfg.apiKey;
}