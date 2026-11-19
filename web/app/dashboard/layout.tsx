"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { BillingToast } from "@/components/BillingToast";
import { ConsoleShell } from "@/components/ConsoleShell";
import { useAuth } from "@/contexts/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!isSupabaseConfigured()) return;
    if (!user) {
      router.replace("/login?next=/dashboard");
    }
  }, [user, loading, router]);

  if (loading || (!user && isSupabaseConfigured())) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[#09090B] text-sm text-zinc-500">
        Loading console…
      </div>
    );
  }

  return (
    <ConsoleShell>
      <Suspense fallback={null}>
        <BillingToast />
      </Suspense>
      {children}
    </ConsoleShell>
  );
}