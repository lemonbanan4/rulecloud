export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  return base || "http://localhost:8000";
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  accessToken?: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(`${apiBase()}${path}`, { ...init, headers });
}