"use client";

import { useState } from "react";

import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/contexts/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase";

export function AuthNav() {
  const { user, loading, signOut } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  if (!isSupabaseConfigured()) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-3">
        {loading ? (
          <span className="text-xs text-slate-500">…</span>
        ) : user ? (
          <>
            <span className="hidden max-w-[180px] truncate text-sm text-slate-300 sm:inline">
              {user.email}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20"
          >
            Sign in
          </button>
        )}
      </div>
      <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}