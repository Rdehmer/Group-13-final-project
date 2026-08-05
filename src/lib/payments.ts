/**
 * Shared simulated payment application (staff + customer portal).
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
  if (amount > Number(input.remaining) + 0.001) {
    return {
      ok: false,
      error: `Amount cannot exceed the remaining balance.`,
    };
  }

  const paymentNumber = `PAY-${Date.now().toString().slice(-8)}`;
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
