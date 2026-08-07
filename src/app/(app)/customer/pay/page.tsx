import { Suspense } from "react";
import { canAcceptPortalPayments, isStripeDemoMode } from "@/lib/stripe";
import { PayPortalClient } from "./PayPortalClient";

export default function CustomerPayPortalPage() {
  const initialStripeConfig = {
    configured: canAcceptPortalPayments(),
    demo: isStripeDemoMode(),
  };

  return (
    <Suspense fallback={<div className="p-8 text-center text-sm opacity-60">Loading payment portal…</div>}>
      <PayPortalClient initialStripeConfig={initialStripeConfig} />
    </Suspense>
  );
}
