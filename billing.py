"""Stripe Checkout, Billing Portal, and webhooks."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import stripe

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = frozenset({"active", "trialing"})


@dataclass(frozen=True)
class WorkspaceBilling:
    workspace_id: str
    plan: str
    stripe_customer_id: Optional[str]
    stripe_subscription_id: Optional[str]
    subscription_status: str


class BillingStore:
    def __init__(self) -> None:
        self._client = None
        url = (os.getenv("SUPABASE_URL") or "").strip()
        key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        if url and key:
            from supabase import create_client

            self._client = create_client(url, key)

        secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
        if secret:
            stripe.api_key = secret

    @property
    def supabase_enabled(self) -> bool:
        return self._client is not None

    @property
    def stripe_enabled(self) -> bool:
        return bool((os.getenv("STRIPE_SECRET_KEY") or "").strip())

    def pro_price_id(self) -> str:
        price = (os.getenv("STRIPE_PRO_PRICE_ID") or "").strip()
        if not price:
            raise RuntimeError("STRIPE_PRO_PRICE_ID is not configured")
        return price

    def webhook_secret(self) -> str:
        secret = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
        if not secret:
            raise RuntimeError("STRIPE_WEBHOOK_SECRET is not configured")
        return secret

    def _require_db(self) -> Any:
        if not self._client:
            raise RuntimeError("Supabase not configured for billing")
        return self._client

    def get_workspace_billing(self, workspace_id: str) -> WorkspaceBilling:
        client = self._client
        if not client:
            return WorkspaceBilling(
                workspace_id=workspace_id,
                plan="free",
                stripe_customer_id=None,
                stripe_subscription_id=None,
                subscription_status="inactive",
            )
        res = (
            client.table("workspaces")
            .select(
                "id, plan, stripe_customer_id, stripe_subscription_id, subscription_status"
            )
            .eq("id", workspace_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return WorkspaceBilling(
                workspace_id=workspace_id,
                plan="free",
                stripe_customer_id=None,
                stripe_subscription_id=None,
                subscription_status="inactive",
            )
        row = rows[0]
        return WorkspaceBilling(
            workspace_id=str(row["id"]),
            plan=str(row.get("plan") or "free"),
            stripe_customer_id=row.get("stripe_customer_id"),
            stripe_subscription_id=row.get("stripe_subscription_id"),
            subscription_status=str(row.get("subscription_status") or "inactive"),
        )

    def update_workspace_billing(
        self,
        workspace_id: str,
        *,
        plan: Optional[str] = None,
        stripe_customer_id: Optional[str] = None,
        stripe_subscription_id: Optional[str] = None,
        subscription_status: Optional[str] = None,
    ) -> None:
        client = self._require_db()
        fields: dict[str, Any] = {
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if plan is not None:
            fields["plan"] = plan
        if stripe_customer_id is not None:
            fields["stripe_customer_id"] = stripe_customer_id
        if stripe_subscription_id is not None:
            fields["stripe_subscription_id"] = stripe_subscription_id
        if subscription_status is not None:
            fields["subscription_status"] = subscription_status
        client.table("workspaces").update(fields).eq("id", workspace_id).execute()

    def find_workspace_by_stripe_customer(self, customer_id: str) -> Optional[str]:
        client = self._client
        if not client or not customer_id:
            return None
        res = (
            client.table("workspaces")
            .select("id")
            .eq("stripe_customer_id", customer_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return str(rows[0]["id"])

    def find_workspace_by_stripe_subscription(self, subscription_id: str) -> Optional[str]:
        client = self._client
        if not client or not subscription_id:
            return None
        res = (
            client.table("workspaces")
            .select("id")
            .eq("stripe_subscription_id", subscription_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return str(rows[0]["id"])

    def create_checkout_session(
        self,
        *,
        workspace_id: str,
        customer_email: Optional[str],
        success_url: str,
        cancel_url: str,
    ) -> str:
        if not self.stripe_enabled:
            raise RuntimeError("Stripe is not configured")
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": self.pro_price_id(), "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=workspace_id,
            metadata={"workspace_id": workspace_id},
            customer_email=customer_email or None,
            allow_promotion_codes=True,
        )
        if not session.url:
            raise RuntimeError("Stripe checkout session missing url")
        return session.url

    def create_portal_session(self, *, customer_id: str, return_url: str) -> str:
        if not self.stripe_enabled:
            raise RuntimeError("Stripe is not configured")
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        if not session.url:
            raise RuntimeError("Stripe portal session missing url")
        return session.url

    def verify_webhook(self, payload: bytes, signature: Optional[str]) -> dict[str, Any]:
        if not signature:
            raise ValueError("Missing Stripe-Signature header")
        event = stripe.Webhook.construct_event(
            payload, signature, self.webhook_secret()
        )
        return event

    def apply_subscription_state(
        self,
        workspace_id: str,
        *,
        customer_id: Optional[str],
        subscription_id: Optional[str],
        status: str,
    ) -> None:
        plan = "pro" if status in ACTIVE_STATUSES else "free"
        self.update_workspace_billing(
            workspace_id,
            plan=plan,
            stripe_customer_id=customer_id,
            stripe_subscription_id=subscription_id,
            subscription_status=status,
        )

    def handle_webhook_event(self, event: dict[str, Any]) -> None:
        event_type = event.get("type") or ""
        data = event.get("data") or {}
        obj = data.get("object") or {}

        if event_type == "checkout.session.completed":
            workspace_id = (
                obj.get("metadata", {}).get("workspace_id")
                or obj.get("client_reference_id")
            )
            customer_id = obj.get("customer")
            subscription_id = obj.get("subscription")
            if workspace_id and subscription_id:
                sub = stripe.Subscription.retrieve(str(subscription_id))
                status = str(sub.get("status") or "active")
                self.apply_subscription_state(
                    str(workspace_id),
                    customer_id=str(customer_id) if customer_id else None,
                    subscription_id=str(subscription_id),
                    status=status,
                )
            return

        if event_type == "customer.subscription.updated":
            subscription_id = obj.get("id")
            customer_id = obj.get("customer")
            status = str(obj.get("status") or "inactive")
            workspace_id = self.find_workspace_by_stripe_subscription(
                str(subscription_id)
            )
            if not workspace_id and customer_id:
                workspace_id = self.find_workspace_by_stripe_customer(str(customer_id))
            if workspace_id:
                self.apply_subscription_state(
                    workspace_id,
                    customer_id=str(customer_id) if customer_id else None,
                    subscription_id=str(subscription_id) if subscription_id else None,
                    status=status,
                )
            return

        if event_type == "customer.subscription.deleted":
            subscription_id = obj.get("id")
            customer_id = obj.get("customer")
            workspace_id = self.find_workspace_by_stripe_subscription(
                str(subscription_id)
            )
            if not workspace_id and customer_id:
                workspace_id = self.find_workspace_by_stripe_customer(str(customer_id))
            if workspace_id:
                self.apply_subscription_state(
                    workspace_id,
                    customer_id=str(customer_id) if customer_id else None,
                    subscription_id=None,
                    status="canceled",
                )
            return

        if event_type == "invoice.payment_failed":
            customer_id = obj.get("customer")
            subscription_id = obj.get("subscription")
            workspace_id = None
            if subscription_id:
                workspace_id = self.find_workspace_by_stripe_subscription(
                    str(subscription_id)
                )
            if not workspace_id and customer_id:
                workspace_id = self.find_workspace_by_stripe_customer(str(customer_id))
            if workspace_id:
                self.apply_subscription_state(
                    workspace_id,
                    customer_id=str(customer_id) if customer_id else None,
                    subscription_id=str(subscription_id) if subscription_id else None,
                    status="past_due",
                )


def create_billing_store() -> BillingStore:
    return BillingStore()