import { createHmac, timingSafeEqual } from "crypto";
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

type DemoTokenPayload = {
  userId: string;
  customerId: string;
  amount: number;
  allocations: { invoiceId: string; amount: number }[];
  memo: string | null;
  exp: number;
  createdAt: number;
};

const DEMO_TOKEN_TTL_MS = 30 * 60 * 1000;

/** Secret keys that can create PaymentIntents (standard sk_ or restricted rk_/rkcs_ with intent permissions). */
export function isUsableStripeSecretKey(key: string): boolean {
  return (
    key.startsWith("sk_test_") ||
    key.startsWith("sk_live_") ||
    key.startsWith("rk_test_") ||
    key.startsWith("rk_live_") ||
    key.startsWith("rkcs_test_") ||
    key.startsWith("rkcs_live_")
  );
}

export function isStripeConfigured(): boolean {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!secret || !publishable) return false;
  return isUsableStripeSecretKey(secret);
}

/**
 * Simulated checkout when live Stripe keys are absent.
 * Opt-in only: set STRIPE_DEMO_MODE=true (local or Vercel).
 */
export function isStripeDemoMode(): boolean {
  if (isStripeConfigured()) return false;
  return process.env.STRIPE_DEMO_MODE === "true";
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

function demoSigningSecret(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "equipmentiq-demo-checkout"
  );
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signDemoPayload(encodedPayload: string): string {
  return createHmac("sha256", demoSigningSecret()).update(encodedPayload).digest("base64url");
}

export function createDemoPaymentIntent(input: {
  customerId: string;
  userId: string;
  amount: number;
  allocations: { invoiceId: string; amount: number }[];
  memo: string | null;
}): DemoPaymentIntent {
  const createdAt = Date.now();
  const payload: DemoTokenPayload = {
    userId: input.userId,
    customerId: input.customerId,
    amount: input.amount,
    allocations: input.allocations,
    memo: input.memo,
    createdAt,
    exp: createdAt + DEMO_TOKEN_TTL_MS,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signDemoPayload(encodedPayload);
  const id = `demo_pi_${encodedPayload}.${signature}`;

  return {
    id,
    customerId: input.customerId,
    userId: input.userId,
    amount: input.amount,
    allocations: input.allocations,
    memo: input.memo,
    status: "requires_confirmation",
    createdAt,
  };
}

export function verifyDemoPaymentIntent(
  id: string,
  userId: string,
  customerId: string,
): DemoPaymentIntent | null {
  if (!isDemoPaymentIntentId(id)) return null;

  const tokenBody = id.slice("demo_pi_".length);
  const dot = tokenBody.lastIndexOf(".");
  if (dot <= 0) return null;

  const encodedPayload = tokenBody.slice(0, dot);
  const signature = tokenBody.slice(dot + 1);
  if (!encodedPayload || !signature) return null;

  const expected = signDemoPayload(encodedPayload);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  const raw = fromBase64Url(encodedPayload);
  if (!raw) return null;

  let payload: DemoTokenPayload;
  try {
    payload = JSON.parse(raw) as DemoTokenPayload;
  } catch {
    return null;
  }

  if (
    payload.userId !== userId ||
    payload.customerId !== customerId ||
    !Array.isArray(payload.allocations) ||
    payload.exp <= Date.now()
  ) {
    return null;
  }

  return {
    id,
    customerId: payload.customerId,
    userId: payload.userId,
    amount: payload.amount,
    allocations: payload.allocations,
    memo: payload.memo,
    status: "requires_confirmation",
    createdAt: payload.createdAt,
  };
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
