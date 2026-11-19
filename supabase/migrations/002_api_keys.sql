-- RuleCloud Step 2: API keys + quota index (paste into Supabase SQL Editor)

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX api_keys_workspace_idx ON public.api_keys (workspace_id);
CREATE INDEX api_keys_key_hash_idx ON public.api_keys (key_hash);

-- Faster monthly quota counts per workspace
CREATE INDEX IF NOT EXISTS scan_jobs_workspace_created_idx
  ON public.scan_jobs (workspace_id, created_at DESC);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_select ON public.api_keys
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = api_keys.workspace_id
        AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY api_keys_insert ON public.api_keys
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = api_keys.workspace_id
        AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY api_keys_update ON public.api_keys
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = api_keys.workspace_id
        AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = api_keys.workspace_id
        AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY api_keys_delete ON public.api_keys
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = api_keys.workspace_id
        AND w.owner_id = auth.uid()
    )
  );