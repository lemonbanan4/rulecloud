-- RuleCloud: GitHub App installations (1-click connect)

CREATE TABLE public.github_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  installation_id bigint NOT NULL UNIQUE,
  account_login text NOT NULL,
  account_type text NOT NULL DEFAULT 'User',
  auto_fix_comments boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX github_installations_workspace_idx
  ON public.github_installations (workspace_id);

ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;

CREATE POLICY github_installations_select ON public.github_installations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_installations.workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY github_installations_insert ON public.github_installations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_installations.workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY github_installations_update ON public.github_installations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_installations.workspace_id AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_installations.workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY github_installations_delete ON public.github_installations
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = github_installations.workspace_id AND w.owner_id = auth.uid()
    )
  );