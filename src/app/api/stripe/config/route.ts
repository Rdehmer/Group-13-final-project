import { NextResponse } from "next/server";
import { getStripePublishableKey, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

/** GET /api/stripe/config — public key + configured flag for the pay portal. */
export async function GET() {
  return NextResponse.json({
    configured: isStripeConfigured(),
    publishableKey: getStripePublishableKey() || null,
  });
}
