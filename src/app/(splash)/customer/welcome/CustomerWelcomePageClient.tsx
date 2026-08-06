"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CustomerWelcomeSplash } from "@/components/customer/CustomerWelcomeSplash";

type Props = {
  displayName?: string | null;
};

export function CustomerWelcomePageClient({ displayName }: Props) {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minMs = reducedMotion ? 800 : 2000;
    const exitMs = reducedMotion ? 0 : 400;

    const exitTimer = window.setTimeout(() => setExiting(true), minMs);
    const navTimer = window.setTimeout(() => router.replace("/customer"), minMs + exitMs);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(navTimer);
    };
  }, [router]);

  return <CustomerWelcomeSplash exiting={exiting} displayName={displayName} />;
}
