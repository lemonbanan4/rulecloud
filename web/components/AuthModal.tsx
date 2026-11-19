"use client";

import { FormEvent, useState } from "react";

import { getSupabase } from "@/lib/supabase";

type Mode = "sign_in" | "sign_up";

export function AuthModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const supabase = getSupabase();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setMessage("Supabase is not configured.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "sign_up") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Check your email to confirm signup, or sign in if already verified.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onClose();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const signInWithGitHub = async () => {
    if (!supabase) {
      setMessage("Supabase is not configured.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${origin}/` },
    });
    if (error) {
      setMessage(error.message);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-label="Sign in to Rule Cloud"
    >
      <div className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">
            {mode === "sign_in" ? "Sign in" : "Create account"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm text-slate-300">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/40"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm text-slate-300">Password</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/40"
            />
          </label>
          {message && (
            <p className="text-sm text-amber-200/90">{message}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {mode === "sign_in" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <button
          type="button"
          disabled={busy}
          onClick={() => void signInWithGitHub()}
          className="mt-3 w-full rounded-xl border border-white/15 bg-slate-900/60 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800/80 disabled:opacity-50"
        >
          Continue with GitHub
        </button>

        <p className="mt-4 text-center text-xs text-slate-500">
          {mode === "sign_in" ? (
            <>
              New here?{" "}
              <button
                type="button"
                className="text-cyan-400 hover:underline"
                onClick={() => setMode("sign_up")}
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="text-cyan-400 hover:underline"
                onClick={() => setMode("sign_in")}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}