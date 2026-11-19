"use client";

import { useMemo } from "react";

export function CodeEditor({
  value,
  onChange,
  rows = 18,
  readOnly = false,
  className = "",
}: {
  value: string;
  onChange?: (v: string) => void;
  rows?: number;
  readOnly?: boolean;
  className?: string;
}) {
  const lineCount = useMemo(() => Math.max(value.split("\n").length, rows), [value, rows]);
  const lines = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1),
    [lineCount],
  );

  return (
    <div
      className={`flex overflow-hidden rounded-lg border border-white/[0.08] bg-[#09090B] ${className}`}
    >
      <div
        aria-hidden
        className="select-none border-r border-white/[0.06] bg-[#0F0F12] px-2 py-3 text-right font-mono text-[11px] leading-relaxed text-zinc-600"
      >
        {lines.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <textarea
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        rows={rows}
        spellCheck={false}
        className="min-h-0 w-full resize-none bg-transparent px-3 py-3 font-mono text-xs leading-relaxed text-zinc-100 outline-none"
      />
    </div>
  );
}