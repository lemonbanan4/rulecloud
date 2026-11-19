"use client";

type Props = {
  open: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  detail?: string;
};

export function UpgradeProModal({ open, onClose, onUpgrade, detail }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-50">Unlock AI Auto-Fix with Pro</h3>
        <p className="mt-2 text-sm text-slate-400">
          {detail ||
            "AI Auto-Fix is a Pro feature. Upgrade to unlock one-click code fixes."}
        </p>
        <ul className="mt-4 space-y-2 text-sm text-slate-300">
          <li>• 2,000 Guardrail scans per month</li>
          <li>• Unlimited AI Auto-Fix on violations</li>
          <li>• Priority API rate limits</li>
        </ul>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onUpgrade}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}