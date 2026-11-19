import type { ReactNode } from "react";

export function ConsoleCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-white/[0.08] bg-[#0F0F12] p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}