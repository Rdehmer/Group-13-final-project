"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatCard } from "@/components/ui";
import { formatMoney, remainingBalance } from "@/lib/calculations";
import type { Invoice, Payment } from "@/lib/types";

/**
 * This business faces cash flow visibility risk when AR aging is unclear.
 * Our app reduces the risk by tracking payments and aging open invoices.
 */
export default function PaymentsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const preselectedInvoice = searchParams.get("invoice");
  const [invoices, setInvoices] = useState<(Invoice & { customers?: { name: string } })[]>([]);
  const [payments, setPayments] = useState<(Payment & { customers?: { name: string } })[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ invoice_id: "", payment_method: "Check", payment_amount: "", reference_number: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: inv }, { data: pay }] = await Promise.all([
      supabase.from("invoices").select("*, customers(name)").gt("remaining_balance", 0).not("status", "eq", "Canceled"),
      supabase.from("payments").select("*, customers(name)").order("created_at", { ascending: false }).limit(20),
    ]);
    const openInvoices = (inv as typeof invoices) ?? [];
    setInvoices(openInvoices);
    setPayments((pay as typeof payments) ?? []);
    if (preselectedInvoice) {
      const match = openInvoices.find((i) => i.id === preselectedInvoice);
      if (match) {
        setForm((f) => ({
          ...f,
          invoice_id: match.id,
          payment_amount: String(match.remaining_balance),
        }));
        setShowForm(true);
      }
    }
  }

  useEffect(() => { load(); }, [preselectedInvoice]);

  const today = new Date();
  const aging = { current: 0, d30: 0, d60: 0, d90: 0 };
  for (const inv of invoices) {
    const due = new Date(inv.due_date);
    const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
    const bal = Number(inv.remaining_balance);
    if (days <= 0) aging.current += bal;
    else if (days <= 30) aging.d30 += bal;
    else if (days <= 60) aging.d60 += bal;
    else aging.d90 += bal;
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const inv = invoices.find((i) => i.id === form.invoice_id);
    if (!inv) { setBusy(false); return; }
    const amount = Number(form.payment_amount);
    const { data: { user } } = await supabase.auth.getUser();
    const paymentNumber = `PAY-${Date.now().toString().slice(-8)}`;

    const { error: payError } = await supabase.from("payments").insert({
      payment_number: paymentNumber,
      customer_id: inv.customer_id,
      invoice_id: inv.id,
      payment_method: form.payment_method,
      payment_amount: amount,
      reference_number: form.reference_number || null,
      created_by: user?.id ?? null,
    });
    if (payError) { setError(payError.message); setBusy(false); return; }

    const newPaid = Number(inv.amount_paid) + amount;
    const newBalance = remainingBalance(Number(inv.invoice_total), newPaid);
    const status = newBalance <= 0 ? "Paid" : "Partially Paid";

    await supabase.from("invoices").update({
      amount_paid: newPaid,
      remaining_balance: newBalance,
      status,
    }).eq("id", inv.id);

    await logActivity(supabase, { userId: user?.id ?? null, action: "recorded", recordType: "payment", recordId: inv.id, newValue: paymentNumber });
    setShowForm(false);
    setForm({ invoice_id: "", payment_method: "Check", payment_amount: "", reference_number: "" });
    await load();
    setBusy(false);
  }

  return (
    <div>
      <PageHeader title="Payments" description="Record payments and monitor AR aging" actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/billing" className="btn btn-outline btn-sm">Invoices</Link>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)} disabled={invoices.length === 0}>Record Payment</button>
        </div>
      } />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Current" value={formatMoney(aging.current)} />
        <StatCard label="1–30 Days" value={formatMoney(aging.d30)} hint="Past due" />
        <StatCard label="31–60 Days" value={formatMoney(aging.d60)} danger={aging.d60 > 0} />
        <StatCard label="61+ Days" value={formatMoney(aging.d90)} danger={aging.d90 > 0} />
      </div>

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="text-lg font-bold">Record Payment (Simulated)</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={recordPayment} className="mt-4 space-y-3">
              <FormRow label="Invoice" required>
                <select className="select select-bordered w-full" value={form.invoice_id} onChange={(e) => {
                  const inv = invoices.find((i) => i.id === e.target.value);
                  setForm({ ...form, invoice_id: e.target.value, payment_amount: inv ? String(inv.remaining_balance) : "" });
                }} required>
                  <option value="">Select…</option>
                  {invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>{inv.invoice_number} — {formatMoney(inv.remaining_balance)}</option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Method">
                <select className="select select-bordered w-full" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                  <option>Check</option><option>Credit Card</option><option>ACH</option><option>Bank Transfer</option><option>Other</option>
                </select>
              </FormRow>
              <FormRow label="Amount" required>
                <input type="number" min="0.01" step="0.01" className="input input-bordered w-full" value={form.payment_amount} onChange={(e) => setForm({ ...form, payment_amount: e.target.value })} required />
              </FormRow>
              <FormRow label="Reference"><input className="input input-bordered w-full" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} /></FormRow>
              <div className="modal-action">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Save Payment</button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop"><button type="button" onClick={() => setShowForm(false)}>close</button></form>
        </dialog>
      ) : null}

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">Recent Payments</h2>
          {payments.length === 0 ? (
            <EmptyState title="No payments recorded" description="Record a simulated payment against an open invoice." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Payment #</th><th>Invoice</th><th>Customer</th><th>Date</th><th>Method</th><th>Amount</th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.payment_number}</td>
                      <td>
                        {p.invoice_id ? (
                          <Link href={`/billing/${p.invoice_id}`} className="link link-primary">
                            View invoice
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {p.customer_id ? (
                          <Link href={`/customers/${p.customer_id}`} className="link link-hover">
                            {p.customers?.name ?? "—"}
                          </Link>
                        ) : (
                          p.customers?.name ?? "—"
                        )}
                      </td>
                      <td>{p.payment_date}</td>
                      <td>{p.payment_method}</td>
                      <td>{formatMoney(p.payment_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
