/** Parse FastAPI / JSON error bodies for UI messages. */
export async function parseApiError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { detail?: unknown; error?: string };
    if (typeof data.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: string }).msg);
          }
          return String(item);
        })
        .join("; ");
    }
    if (data.error) return data.error;
  } catch {
    /* not JSON */
  }
  if (text.trim()) return text.slice(0, 400);
  const labels: Record<number, string> = {
    401: "Sign in required",
    403: "Not allowed",
    429: "Rate limit reached — upgrade to Pro or try again later",
    503: "AI Copilot is not configured on the server",
  };
  return labels[res.status] ?? `Request failed (${res.status})`;
}