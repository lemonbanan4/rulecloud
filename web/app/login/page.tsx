"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthModal } from "@/components/AuthModal";

export default function LoginPage() {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) {
      router.replace("/");
    }
  }, [open, router]);

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <AuthModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}