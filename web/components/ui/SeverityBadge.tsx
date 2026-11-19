export function SeverityBadge({ severity }: { severity?: string | null }) {
  const s = (severity || "warning").toLowerCase();
  const isCritical =
    s.includes("critical") || s.includes("error") || s.includes("high");
  const isPass = s.includes("pass") || s.includes("info") || s.includes("low");

  if (isPass) {
    return (
      <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
        Pass
      </span>
    );
  }
  if (isCritical) {
    return (
      <span className="rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-400">
        Critical
      </span>
    );
  }
  return (
    <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
      Warning
    </span>
  );
}