"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  originalCode: string;
  explanation: string;
  patchedCode: string;
  diff: string;
  slideOver?: boolean;
};

export function AutoFixModal({
  open,
  onClose,
  originalCode,
  explanation,
  patchedCode,
  diff,
  slideOver = false,
}: Props) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const copyFixed = async () => {
    try {
      await navigator.clipboard.writeText(patchedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const panel = (
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden border border-white/[0.08] bg-[#0F0F12] shadow-2xl ${
          slideOver ? "h-full max-w-xl rounded-none" : "max-w-4xl rounded-2xl"
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-50">AI Auto-Fix</h3>
            <p className="mt-1 text-sm text-slate-400">{explanation}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
          >
            Close
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Original
            </p>
            <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-slate-300">
              {originalCode}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-400/80">
              Fixed
            </p>
            <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 font-mono text-[11px] text-emerald-100/90">
              {patchedCode}
            </pre>
          </div>
        </div>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Diff</p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-[11px] text-cyan-100/80">
            {diff || "—"}
          </pre>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void copyFixed()}
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
            >
              {copied ? "Copied" : "Copy Fixed Code"}
            </button>
          </div>
        </div>
      </div>
  );

  if (slideOver) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal>
        <button type="button" className="flex-1" aria-label="Close" onClick={onClose} />
        {panel}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      {panel}
    </div>
  );
}