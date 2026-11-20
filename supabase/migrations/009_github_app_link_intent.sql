-- Pending workspace link when user starts GitHub App install from RuleCloud console

CREATE TABLE public.github_app_link_intents (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours')
);

CREATE INDEX github_app_link_intents_expires_idx
  ON public.github_app_link_intents (expires_at);

ALTER TABLE public.github_app_link_intents ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.github_app_link_intents TO postgres, service_role;