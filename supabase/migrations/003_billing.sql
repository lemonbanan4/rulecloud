-- RuleCloud Step 3: Stripe billing fields on workspaces (paste into Supabase SQL Editor)

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_stripe_customer_id_idx
  ON public.workspaces (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_stripe_subscription_id_idx
  ON public.workspaces (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;