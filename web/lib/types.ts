export type UsageSnapshot = {
  plan: string;
  used: number;
  limit: number;
};

export type JobSummary = {
  job_id: string;
  state: string;
  created_at?: string;
  source_type?: string;
  violation_count?: number;
  scan_status?: string | null;
  error?: string | null;
};

export type Finding = {
  id?: string | null;
  message?: string | null;
  severity?: string | null;
  file?: string | null;
  line?: number | null;
  rule?: string | null;
  raw?: Record<string, unknown>;
};

export type SuppressionRecord = {
  file?: string;
  line?: number;
  rule_id?: string;
  reason?: string;
  directive_line?: number;
};

export type ScanResult = {
  status: string;
  exit_code: number;
  findings: Finding[];
  suppressions?: SuppressionRecord[];
  duration_ms: number;
  stdout: string;
  stderr: string;
  error?: string;
  rules_yaml?: string;
};

export type JobRecord = {
  job_id: string;
  state: "queued" | "running" | "completed" | "failed";
  created_at?: string;
  request?: Record<string, unknown>;
  result?: ScanResult | null;
  error?: string | null;
  source_type?: string;
};

export type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at?: string | null;
  created_at?: string | null;
};