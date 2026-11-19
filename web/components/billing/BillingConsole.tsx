"use client";

import { Check } from "lucide-react";

import { BillingActions } from "@/components/BillingActions";
import { ConsoleCard } from "@/components/ui/ConsoleCard";
import { useAuth } from "@/contexts/auth-context";
import { useUsage } from "@/hooks/use-usage";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    features: ["50 scans / month", "15 AI rule gens / day", "API keys", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29/mo",
    features: [
      "2,000 scans / month",
      "Unlimited AI rule generation",
      "AI Auto-Fix on violations",
      "Billing portal & priority limits",
    ],
  },
];

export function BillingConsole() {
  const { accessToken } = useAuth();
  const { usage, loading } = useUsage();
  const current = (usage?.plan || "free").toLowerCase();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Billing</h1>
        <p className="text-sm text-zinc-500">Manage your RuleCloud workspace plan.</p>
      </div>

      {!loading && usage ? (
        <ConsoleCard>
          <p className="text-sm text-zinc-400">
            Current plan: <span className="font-medium text-zinc-100">{usage.plan}</span> ·{" "}
            <span className="font-mono">
              {usage.used}/{usage.limit}
            </span>{" "}
            scans this month
          </p>
          <div className="mt-3">
            <BillingActions accessToken={accessToken} plan={usage.plan} />
          </div>
        </ConsoleCard>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {PLANS.map((plan) => {
          const active = plan.id === current;
          return (
            <ConsoleCard
              key={plan.id}
              className={active ? "ring-1 ring-emerald-500/40" : ""}
            >
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                {plan.name}
              </p>
              <p className="mt-2 text-3xl font-semibold text-zinc-100">{plan.price}</p>
              <ul className="mt-4 space-y-2 text-sm text-zinc-400">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 text-emerald-400" strokeWidth={1.5} />
                    {f}
                  </li>
                ))}
              </ul>
              {active ? (
                <p className="mt-4 text-xs font-medium text-emerald-400">Current plan</p>
              ) : plan.id === "pro" ? (
                <p className="mt-4 text-xs text-zinc-500">Upgrade via Checkout above.</p>
              ) : null}
            </ConsoleCard>
          );
        })}
      </div>
    </div>
  );
}