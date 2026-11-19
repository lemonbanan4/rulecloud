export function formatWhen(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatRelativeShort(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function sourceLabel(source?: string | null): string {
  switch (source) {
    case "snippet":
      return "Playground";
    case "api":
      return "API";
    case "github_webhook":
      return "GitHub";
    case "mcp":
      return "MCP";
    default:
      return source || "API";
  }
}

export function planPill(plan?: string | null): string {
  const p = (plan || "free").toLowerCase();
  return p === "pro" ? "PRO" : "FREE";
}