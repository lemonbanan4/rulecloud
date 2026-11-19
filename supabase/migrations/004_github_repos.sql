-- RuleCloud Step 5: GitHub repo connections for PR Guardrail bot

CREATE TABLE public.github_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  repo_full_name text NOT NULL,
  webhook_secret text NOT NULL,
  github_token_encrypted text,
  auto_fix_comments boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX github_connections_workspace_repo_idx
  ON public.github_connections (workspace_id, repo_full_name);

CREATE INDEX github_connections_repo_idx ON public.github_connections (repo_full_name);

ALTER TABLE public.github_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY github_connections_select ON public.github_connections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_connections.workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY github_connections_insert ON public.github_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_connections.workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY github_connections_update ON public.github_connections
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_connections.workspace_id AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_connections.workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY github_connections_delete ON public.github_connections
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_connections.workspace_id AND w.owner_id = auth.uid()
    )
  );