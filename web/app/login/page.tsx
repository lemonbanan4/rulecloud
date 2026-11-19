"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/contexts/auth-context";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(true);
  const next = params.get("next") || "/dashboard";

  useEffect(() => {
    if (!loading && user) {
      router.replace(next);
    }
  }, [user, loading, router, next]);

  useEffect(() => {
    if (!open && !user) {
      router.replace("/");
    }
  }, [open, router, user]);

  return (
    <div className="flex min-h-full items-center justify-center bg-[#09090B] px-4 py-16">
      <AuthModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center text-zinc-500">Loading…</div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}