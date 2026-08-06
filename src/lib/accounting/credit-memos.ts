/**
 * Credit memos — negative AR documents applied against customer balances.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { postCreditMemoJournal } from "@/lib/accounting/postings";

export async function createCreditMemo(
  supabase: SupabaseClient,
  input: {
    customerId: string;
    invoiceId?: string | null;
    amount: number;
    tax?: number;
    reason: string;
    userId: string | null;
    asOf?: string;
  },
): Promise<{ ok: true; creditMemoId: string; number: string } | { ok: false; error: string }> {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  const tax = Math.round(Number(input.tax ?? 0) * 100) / 100;
  if (amount <= 0) return { ok: false, error: "Credit amount must be positive." };
  const service = Math.max(0.01, amount - tax);
  const asOf = input.asOf || new Date().toISOString().slice(0, 10);
  const number = `CM-${Date.now().toString().slice(-8)}`;

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number: number,
      customer_id: input.customerId,
      work_order_id: null,
      contract_id: null,
      invoice_date: asOf,
      due_date: asOf,
      billing_period: null,
      labor_charges: 0,
      parts_charges: 0,
      recurring_service_charge: 0,
      additional_charges: -service,
      warranty_deductions: 0,
      discounts: 0,
      tax: -tax,
      invoice_total: -amount,
      amount_paid: 0,
      remaining_balance: -amount,
      status: "Credit Memo",
      notes: input.reason.trim() || "Credit memo",
      created_by: input.userId,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Failed to create credit memo." };

  // If tied to an open invoice, apply as a pseudo-payment reducing that invoice
  if (input.invoiceId) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, invoice_total, amount_paid, remaining_balance, status")
      .eq("id", input.invoiceId)
      .maybeSingle();
    if (inv && Number(inv.remaining_balance) > 0) {
      const apply = Math.min(amount, Number(inv.remaining_balance));
      const newPaid = Number(inv.amount_paid) + apply;
      const newBal = Math.max(0, Number(inv.invoice_total) - newPaid);
      await supabase
        .from("invoices")
        .update({
          amount_paid: newPaid,
          remaining_balance: newBal,
          status: newBal <= 0.005 ? "Paid" : "Partially Paid",
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.invoiceId);
      await supabase
        .from("invoices")
        .update({
          amount_paid: -apply,
          remaining_balance: -(amount - apply),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);
    }
  }

  postCreditMemoJournal({
    creditMemoId: data.id,
    creditMemoNumber: number,
    amount,
    tax,
    asOf,
    userId: input.userId,
  });

  return { ok: true, creditMemoId: data.id, number };
}
