-- Workspace BYOK for AI Auto-Fix and rule generation

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS llm_provider text,
  ADD COLUMN IF NOT EXISTS llm_api_key_encrypted text;

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_llm_provider_check;
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_llm_provider_check
  CHECK (
    llm_provider IS NULL OR llm_provider IN ('openai', 'gemini', 'anthropic')
  );