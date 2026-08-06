/**
 * Shared payment application helpers (staff + customer portal + Stripe).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { remainingBalance } from "@/lib/calculations";

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
      return {
        ok: true,
        paymentNumber: existing.payment_number,
        newBalance: Number(input.remaining),
        status: Number(input.remaining) <= 0.005 ? "Paid" : "Partially Paid",
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
  const status = newBalance <= 0.005 ? "Paid" : "Partially Paid";

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

export type PayMethodKind = "card" | "bank" | "check";

export function formatPaymentMethodLabel(kind: PayMethodKind, last4?: string): string {
  if (kind === "card") return last4 ? `Credit card ···· ${last4}` : "Credit card";
  if (kind === "bank") return last4 ? `Bank account ···· ${last4}` : "Bank transfer (ACH)";
  return "Check";
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
