/** Accept bare ID or GitHub settings URL …/installations/12345678 */
export function parseGithubInstallationId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/installations\/(\d+)/i);
  if (urlMatch) {
    const id = Number.parseInt(urlMatch[1], 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  if (/^\d+$/.test(trimmed)) {
    const id = Number.parseInt(trimmed, 10);
    return id > 0 ? id : null;
  }
  return null;
}