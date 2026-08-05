import Stripe from "stripe";

let stripeSingleton: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim());
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
