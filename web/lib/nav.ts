import type { LucideIcon } from "lucide-react";
import {
  CreditCard,
  FileCode2,
  History,
  KeyRound,
  LayoutDashboard,
  Plug,
  Terminal,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  segment: string;
};

export const CONSOLE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, segment: "overview" },
  { href: "/dashboard/playground", label: "Playground", icon: Terminal, segment: "playground" },
  { href: "/dashboard/scans", label: "Scan Logs", icon: History, segment: "scans" },
  { href: "/dashboard/rules", label: "Rules Studio", icon: FileCode2, segment: "rules" },
  { href: "/dashboard/integrations", label: "Integrations", icon: Plug, segment: "integrations" },
  { href: "/dashboard/keys", label: "API Keys", icon: KeyRound, segment: "keys" },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard, segment: "billing" },
];

export function breadcrumbForPath(pathname: string): string[] {
  const item = CONSOLE_NAV.find((n) => n.href === pathname);
  if (item) return ["Workspace", item.label];
  if (pathname.startsWith("/dashboard")) return ["Workspace", "Console"];
  return ["RuleCloud"];
}