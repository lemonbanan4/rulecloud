-- RuleCloud SaaS: workspaces + scan_jobs (paste into Supabase SQL Editor)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces (id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  source_type text NOT NULL DEFAULT 'api'
    CHECK (source_type IN ('snippet', 'github_webhook', 'api')),
  rules_yaml text,
  result_json jsonb,
  violation_count int NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX scan_jobs_user_created_idx ON public.scan_jobs (user_id, created_at DESC);
CREATE INDEX scan_jobs_workspace_idx ON public.scan_jobs (workspace_id);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspaces_select ON public.workspaces
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY workspaces_insert ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY workspaces_update ON public.workspaces
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY workspaces_delete ON public.workspaces
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY scan_jobs_select ON public.scan_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY scan_jobs_insert ON public.scan_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY scan_jobs_update ON public.scan_jobs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.workspaces (owner_id, name, plan)
  VALUES (NEW.id, 'Personal Workspace', 'free');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- PostgREST roles (required when SQL is applied via editor, not only via Supabase CLI)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;