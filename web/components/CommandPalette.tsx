"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { CONSOLE_NAV } from "@/lib/nav";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function CommandPalette({ open, onClose }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const actions = [
      { label: "Start new scan", href: "/dashboard/playground", keywords: "scan run" },
      ...CONSOLE_NAV.map((n) => ({
        label: `Go to ${n.label}`,
        href: n.href,
        keywords: n.label,
      })),
    ];
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) || a.keywords.toLowerCase().includes(q),
    );
  }, [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      role="dialog"
      aria-modal
      onClick={() => {
        setQuery("");
        onClose();
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-white/[0.08] bg-[#0F0F12] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-3 py-2.5">
          <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.5} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to… or start a scan"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-500">
            esc
          </kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1">
          {items.map((item) => (
            <li key={item.href + item.label}>
              <button
                type="button"
                className="flex w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-[#18181B]"
                onClick={() => {
                  setQuery("");
                  onClose();
                  router.push(item.href);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
          {items.length === 0 ? (
            <li className="px-3 py-4 text-sm text-zinc-500">No matches</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}