import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { AuthProvider } from "@/contexts/auth-context";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://rulecloud.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "RuleCloud — Architectural Guardrails",
    template: "%s · RuleCloud",
  },
  description:
    "Guardrail static analysis, GitHub PR bot with inline suggestions, API keys, and AI rule generation.",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "RuleCloud",
    title: "RuleCloud — Architectural Guardrails for AI-Speed Engineering",
    description:
      "Enforce architecture, secrets, and hygiene on every PR. Playground, API, and GitHub integration.",
  },
  twitter: {
    card: "summary_large_image",
    title: "RuleCloud — Architectural Guardrails",
    description:
      "Enforce architecture, secrets, and hygiene on every PR. Playground, API, and GitHub integration.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#09090B] text-zinc-100">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}