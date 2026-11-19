"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

function billingMessage(billing: string | null): string | null {
  if (!billing) return null;
  if (billing === "success") {
    return "Welcome to Pro! Your workspace will update in a few seconds.";
  }
  if (billing === "canceled") {
    return "Checkout canceled — no charges were made.";
  }
  if (billing === "portal") {
    return "Billing portal closed.";
  }
  return null;
}

export function BillingToast() {
  const params = useSearchParams();
  const message = useMemo(
    () => billingMessage(params.get("billing")),
    [params],
  );

  if (!message) return null;

  return (
    <div
      role="status"
      className="mx-auto mb-6 max-w-6xl rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
    >
      {message}
    </div>
  );
}