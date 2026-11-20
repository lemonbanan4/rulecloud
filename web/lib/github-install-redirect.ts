/** Build integrations URL when GitHub redirects after App install/update. */
export function githubInstallIntegrationsPath(params: { get: (key: string) => string | null }): string | null {
  const installationId = params.get("installation_id");
  if (!installationId) return null;
  const q = new URLSearchParams();
  q.set("installation_id", installationId);
  const setupAction = params.get("setup_action");
  if (setupAction) q.set("setup_action", setupAction);
  const state = params.get("state");
  if (state) q.set("state", state);
  return `/dashboard/integrations?${q.toString()}`;
}