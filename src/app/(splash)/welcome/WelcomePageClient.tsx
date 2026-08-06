"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginWelcomeSplash } from "@/components/LoginWelcomeSplash";
import { homeForRole } from "@/lib/roles";
import type { UserRole } from "@/lib/types";

type Props = {
  displayName?: string | null;
  role: UserRole;
};

export function WelcomePageClient({ displayName, role }: Props) {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minMs = reducedMotion ? 800 : 2000;
    const exitMs = reducedMotion ? 0 : 400;
    const destination = homeForRole(role);

    const exitTimer = window.setTimeout(() => setExiting(true), minMs);
    const navTimer = window.setTimeout(() => router.replace(destination), minMs + exitMs);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(navTimer);
    };
  }, [router, role]);

  return <LoginWelcomeSplash exiting={exiting} displayName={displayName} role={role} />;
}
