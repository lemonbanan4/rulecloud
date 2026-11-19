-- Allow MCP-originated scan jobs
ALTER TABLE scan_jobs DROP CONSTRAINT IF EXISTS scan_jobs_source_type_check;
ALTER TABLE scan_jobs ADD CONSTRAINT scan_jobs_source_type_check
  CHECK (source_type IN ('snippet', 'github_webhook', 'api', 'mcp'));