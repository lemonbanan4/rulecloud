export function StatusDot({
  state,
  scanStatus,
}: {
  state?: string;
  scanStatus?: string | null;
}) {
  let color = "bg-zinc-500";
  if (state === "failed") color = "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]";
  else if (state === "running" || state === "queued")
    color = "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.45)]";
  else if (scanStatus === "pass")
    color = "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.45)]";
  else if (scanStatus === "violations")
    color = "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.35)]";

  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}