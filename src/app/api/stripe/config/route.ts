import { NextResponse } from "next/server";
import {
  canAcceptPortalPayments,
  getStripePublishableKey,
  getStripeSetupHint,
  isStripeConfigured,
  isStripeDemoMode,
} from "@/lib/stripe";

export const runtime = "nodejs";

/** GET /api/stripe/config — public key + configured flag for the pay portal. */
export async function GET() {
  return NextResponse.json({
    configured: canAcceptPortalPayments(),
    live: isStripeConfigured(),
    demo: isStripeDemoMode(),
    publishableKey: getStripePublishableKey() || null,
    setupHint: getStripeSetupHint(),
  });
}
