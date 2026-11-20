-- Cloud Rulespacks + cli_watch / playground source types

CREATE TABLE public.rulespacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  rules_yaml text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX rulespacks_workspace_idx ON public.rulespacks (workspace_id);

ALTER TABLE public.rulespacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY rulespacks_select ON public.rulespacks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = rulespacks.workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY rulespacks_insert ON public.rulespacks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = rulespacks.workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY rulespacks_update ON public.rulespacks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = rulespacks.workspace_id AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = rulespacks.workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY rulespacks_delete ON public.rulespacks
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = rulespacks.workspace_id AND w.owner_id = auth.uid()
    )
  );

ALTER TABLE public.scan_jobs DROP CONSTRAINT IF EXISTS scan_jobs_source_type_check;
ALTER TABLE public.scan_jobs ADD CONSTRAINT scan_jobs_source_type_check
  CHECK (source_type IN (
    'snippet', 'playground', 'github_webhook', 'api', 'mcp', 'cli_watch'
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rulespacks TO authenticated;
GRANT ALL ON public.rulespacks TO service_role;