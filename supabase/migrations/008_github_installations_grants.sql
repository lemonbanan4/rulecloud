-- Re-apply service_role / authenticated grants after 007_github_app.sql

GRANT ALL ON TABLE public.github_installations TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.github_installations TO authenticated;