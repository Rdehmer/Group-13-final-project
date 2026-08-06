import Stripe from "stripe";

let stripeSingleton: Stripe | null = null;

export type DemoPaymentIntent = {
  id: string;
  customerId: string;
  userId: string;
  amount: number;
  allocations: { invoiceId: string; amount: number }[];
  memo: string | null;
  status: "requires_confirmation" | "succeeded";
  createdAt: number;
};

const demoIntents = new Map<string, DemoPaymentIntent>();

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim());
}

/**
 * Local simulated checkout when live Stripe keys are absent.
 * Off in production unless STRIPE_DEMO_MODE=true; force-off with STRIPE_DEMO_MODE=false.
 */
export function isStripeDemoMode(): boolean {
  if (isStripeConfigured()) return false;
  if (process.env.STRIPE_DEMO_MODE === "false") return false;
  if (process.env.STRIPE_DEMO_MODE === "true") return true;
  return process.env.NODE_ENV !== "production";
}

export function canAcceptPortalPayments(): boolean {
  return isStripeConfigured() || isStripeDemoMode();
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add Stripe keys to .env.local.");
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key, {
      typescript: true,
    });
  }
  return stripeSingleton;
}

export function getStripePublishableKey(): string {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
}

export function createDemoPaymentIntent(input: {
  customerId: string;
  userId: string;
  amount: number;
  allocations: { invoiceId: string; amount: number }[];
  memo: string | null;
}): DemoPaymentIntent {
  const id = `demo_pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const intent: DemoPaymentIntent = {
    id,
    customerId: input.customerId,
    userId: input.userId,
    amount: input.amount,
    allocations: input.allocations,
    memo: input.memo,
    status: "requires_confirmation",
    createdAt: Date.now(),
  };
  demoIntents.set(id, intent);
  return intent;
}

export function getDemoPaymentIntent(id: string): DemoPaymentIntent | null {
  return demoIntents.get(id) ?? null;
}

export function markDemoPaymentSucceeded(id: string): DemoPaymentIntent | null {
  const intent = demoIntents.get(id);
  if (!intent) return null;
  intent.status = "succeeded";
  demoIntents.set(id, intent);
  return intent;
}

export function isDemoPaymentIntentId(id: string): boolean {
  return id.startsWith("demo_pi_");
}

/** Encode invoice allocations for Stripe metadata (500 char limit). */
export function encodeAllocations(
  rows: { invoiceId: string; amount: number }[],
): string {
  return rows.map((r) => `${r.invoiceId}:${r.amount.toFixed(2)}`).join("|");
}

export function decodeAllocations(raw: string | undefined | null): { invoiceId: string; amount: number }[] {
  if (!raw) return [];
  return raw
    .split("|")
    .map((part) => {
      const [invoiceId, amountStr] = part.split(":");
      const amount = Number(amountStr);
      if (!invoiceId || !Number.isFinite(amount) || amount <= 0) return null;
      return { invoiceId, amount: Math.round(amount * 100) / 100 };
    })
    .filter(Boolean) as { invoiceId: string; amount: number }[];
}
