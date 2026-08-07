/**
 * Shared payment application helpers (staff + customer portal + Stripe).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { remainingBalance } from "@/lib/calculations";
import { suggestInvoiceStatus } from "@/lib/billing";

export type ApplyPaymentInput = {
  invoiceId: string;
  customerId: string;
  invoiceTotal: number;
  amountPaidSoFar: number;
  remaining: number;
  amount: number;
  paymentMethod: string;
  referenceNumber?: string | null;
  notes?: string | null;
  userId: string | null;
  paymentDate?: string;
};

export type ApplyPaymentResult =
  | { ok: true; paymentNumber: string; newBalance: number; status: string }
  | { ok: false; error: string };

export async function applyInvoicePayment(
  supabase: SupabaseClient,
  input: ApplyPaymentInput,
): Promise<ApplyPaymentResult> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a valid payment amount." };
  }

  // Idempotent when the same Stripe intent is applied twice (before balance checks)
  if (input.referenceNumber) {
    const { data: existing } = await supabase
      .from("payments")
      .select("id, payment_number, payment_amount")
      .eq("invoice_id", input.invoiceId)
      .eq("reference_number", input.referenceNumber)
      .maybeSingle();
    if (existing) {
      const status = suggestInvoiceStatus({
        status: "Sent",
        amount_paid: Number(input.amountPaidSoFar),
        remaining_balance: Number(input.remaining),
      });
      return {
        ok: true,
        paymentNumber: existing.payment_number,
        newBalance: Number(input.remaining),
        status,
      };
    }
  }

  if (amount > Number(input.remaining) + 0.001) {
    return {
      ok: false,
      error: `Amount cannot exceed the remaining balance.`,
    };
  }

  const paymentNumber = `PAY-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const paymentDate = input.paymentDate || new Date().toISOString().slice(0, 10);

  const { error: payError } = await supabase.from("payments").insert({
    payment_number: paymentNumber,
    customer_id: input.customerId,
    invoice_id: input.invoiceId,
    payment_date: paymentDate,
    payment_method: input.paymentMethod,
    payment_amount: amount,
    reference_number: input.referenceNumber?.trim() || null,
    notes: input.notes?.trim() || null,
    created_by: input.userId,
  });

  if (payError) return { ok: false, error: payError.message };

  const newPaid = Number(input.amountPaidSoFar) + amount;
  const newBalance = remainingBalance(Number(input.invoiceTotal), newPaid);

  // Keep workflow statuses (e.g. Canceled) when appropriate; otherwise AR from amounts
  const { data: currentInv } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", input.invoiceId)
    .maybeSingle();
  const status = suggestInvoiceStatus({
    status: (currentInv as { status?: string } | null)?.status ?? "Sent",
    amount_paid: newPaid,
    remaining_balance: newBalance,
  });

  const { error: invError } = await supabase
    .from("invoices")
    .update({
      amount_paid: newPaid,
      remaining_balance: newBalance,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.invoiceId);

  if (invError) return { ok: false, error: invError.message };

  return { ok: true, paymentNumber, newBalance, status };
}

/** Staff Accept/Record Payment tenders (stored on payments.payment_method). */
export type StaffPaymentTenderId = "cash" | "check" | "card" | "ach" | "other";

export type StaffPaymentTender = {
  id: StaffPaymentTenderId;
  /** Short chip label */
  label: string;
  /** Value written to payments.payment_method */
  method: string;
  /** Full select option label */
  selectLabel: string;
  hint: string;
};

/** Canonical tender list for Accept Payment (ServiceTitan / Jobber style). */
export const STAFF_PAYMENT_TENDERS: readonly StaffPaymentTender[] = [
  { id: "cash", label: "Cash", method: "Cash", selectLabel: "Cash", hint: "Counter or field cash" },
  { id: "check", label: "Check", method: "Check", selectLabel: "Check", hint: "Paper check — number required" },
  {
    id: "card",
    label: "Card",
    method: "Credit Card",
    selectLabel: "Credit Card",
    hint: "Keyed, swipe, or terminal card",
  },
  {
    id: "ach",
    label: "ACH",
    method: "ACH",
    selectLabel: "ACH / Bank Transfer",
    hint: "ACH or bank transfer",
  },
  { id: "other", label: "Other", method: "Other", selectLabel: "Other", hint: "Wire, money order, credit memo, etc." },
] as const;

export function staffTenderById(id: StaffPaymentTenderId): StaffPaymentTender {
  return STAFF_PAYMENT_TENDERS.find((t) => t.id === id) ?? STAFF_PAYMENT_TENDERS[0];
}

export type PayMethodKind = "card" | "bank" | "check";

export function formatPaymentMethodLabel(kind: PayMethodKind, last4?: string): string {
  if (kind === "card") return last4 ? `Credit Card ···· ${last4}` : "Credit Card";
  if (kind === "bank") return last4 ? `Bank account ···· ${last4}` : "ACH / Bank Transfer";
  return "Check";
}

/** Values allowed by payments_payment_method_check in Postgres. */
export const ALLOWED_PAYMENT_METHODS = [
  "Check",
  "Credit Card",
  "ACH",
  "Bank Transfer",
  "Other",
] as const;

export type AllowedPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];

export function normalizePaymentMethod(raw: string): AllowedPaymentMethod {
  const trimmed = raw.trim();
  if ((ALLOWED_PAYMENT_METHODS as readonly string[]).includes(trimmed)) {
    return trimmed as AllowedPaymentMethod;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("card")) return "Credit Card";
  if (lower.includes("ach")) return "ACH";
  if (lower.includes("bank")) return "Bank Transfer";
  if (lower.includes("check")) return "Check";
  return "Other";
}

type StripePaymentMethodShape = {
  type?: string | null;
  card?: { last4?: string | null } | null;
  us_bank_account?: { last4?: string | null } | null;
};

/** Map Stripe PaymentMethod to DB-safe tender + customer-facing label. */
export function stripePortalPaymentMethod(
  pm: StripePaymentMethodShape | null | string | undefined,
): { method: AllowedPaymentMethod; display: string } {
  if (!pm || typeof pm === "string") {
    return { method: "Credit Card", display: "Credit Card" };
  }
  if (pm.card) {
    const last4 = pm.card.last4;
    return {
      method: "Credit Card",
      display: last4 ? `Credit Card ···· ${last4}` : "Credit Card",
    };
  }
  if (pm.us_bank_account) {
    const last4 = pm.us_bank_account.last4;
    return {
      method: "ACH",
      display: last4 ? `ACH ···· ${last4}` : "ACH",
    };
  }
  const type = pm.type ?? "";
  if (type === "card") return { method: "Credit Card", display: "Credit Card" };
  if (type === "us_bank_account") return { method: "ACH", display: "ACH" };
  return { method: "Other", display: type ? `Stripe ${type}` : "Stripe" };
}

export function portalPaymentNotes(
  detail: string,
  memo?: string | null,
  reference?: string | null,
): string {
  const parts = [detail.trim()];
  if (memo?.trim()) parts.push(memo.trim());
  if (reference?.trim()) parts.push(reference.trim());
  return parts.join(" · ").slice(0, 500);
}

export type AllocatableInvoice = {
  id: string;
  invoice_number: string;
  remaining_balance: number;
  amount_paid: number;
  invoice_total: number;
  due_date: string;
  customer_id: string;
};

export type PaymentAllocation = {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  remaining: number;
  amountPaid: number;
  invoiceTotal: number;
  customerId: string;
};

/** Split a payment across open invoices (due-date order). */
export function allocateAcrossInvoices(
  invoices: AllocatableInvoice[],
  totalAmount: number,
  options?: { singleInvoicePartial?: boolean },
): PaymentAllocation[] {
  if (!invoices.length || totalAmount <= 0) return [];
  const ordered = [...invoices].sort((a, b) => a.due_date.localeCompare(b.due_date));
  let left = Math.round(totalAmount * 100) / 100;
  const out: PaymentAllocation[] = [];

  for (let i = 0; i < ordered.length; i++) {
    if (left <= 0.005) break;
    const inv = ordered[i];
    const bal = Math.round(Number(inv.remaining_balance) * 100) / 100;
    if (bal <= 0.005) continue;
    let apply = Math.min(left, bal);
    if (options?.singleInvoicePartial && ordered.length === 1) {
      apply = Math.min(totalAmount, bal);
    }
    apply = Math.round(apply * 100) / 100;
    if (apply <= 0.005) continue;
    out.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      amount: apply,
      remaining: bal,
      amountPaid: Number(inv.amount_paid),
      invoiceTotal: Number(inv.invoice_total),
      customerId: inv.customer_id,
    });
    left = Math.round((left - apply) * 100) / 100;
  }
  return out;
}
