"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney, invoiceSubtotal, invoiceTotal } from "@/lib/calculations";
import type { Invoice, WorkOrder } from "@/lib/types";

/**
 * This business faces revenue leakage risk when completed work is not invoiced.
 * Our app reduces the risk by letting billing create invoices from completed work orders.
 */
export default function BillingPage() {
  const supabase = createClient();
  const [invoices, setInvoices] = useState<(Invoice & { customers?: { name: string } })[]>([]);
  const [completedWo, setCompletedWo] = useState<(WorkOrder & { customers?: { name: string } })[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedWo, setSelectedWo] = useState("");
  const [taxRate, setTaxRate] = useState(0.0825);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: inv }, { data: wo }, { data: settings }] = await Promise.all([
      supabase.from("invoices").select("*, customers(name)").order("created_at", { ascending: false }),
      supabase.from("work_orders").select("*, customers(name)").eq("status", "Completed").eq("billing_status", "Unbilled"),
      supabase.from("company_settings").select("default_tax_rate").limit(1).single(),
    ]);
    setInvoices((inv as typeof invoices) ?? []);
    setCompletedWo((wo as typeof completedWo) ?? []);
    if (settings?.default_tax_rate) setTaxRate(Number(settings.default_tax_rate));
  }

  useEffect(() => { load(); }, []);

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedWo) return;
    setError(null);
    setBusy(true);
    const wo = completedWo.find((w) => w.id === selectedWo);
    if (!wo) return;

    const [{ data: labor }, { data: parts }] = await Promise.all([
      supabase.from("technician_labor").select("*").eq("work_order_id", selectedWo),
      supabase.from("work_order_parts").select("*").eq("work_order_id", selectedWo),
    ]);

    const laborCharges = (labor ?? []).reduce((s, l) => s + Number(l.regular_hours) * Number(l.customer_billing_rate) + Number(l.overtime_hours) * Number(l.customer_billing_rate) * 1.5, 0);
    const partsCharges = (parts ?? []).reduce((s, p) => s + Number(p.billable_amount), 0);
    const subtotal = invoiceSubtotal({ billableLabor: laborCharges, billableParts: partsCharges, recurring: 0, additional: 0, warrantyDeductions: 0, discounts: 0 });
    const tax = subtotal * taxRate;
    const total = invoiceTotal(subtotal, tax);
    const due = new Date();
    due.setDate(due.getDate() + 30);

    const { data: { user } } = await supabase.auth.getUser();
    const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

    const { data: inv, error: insertError } = await supabase.from("invoices").insert({
      invoice_number: invoiceNumber,
      customer_id: wo.customer_id,
      work_order_id: wo.id,
      contract_id: wo.contract_id,
      due_date: due.toISOString().slice(0, 10),
      labor_charges: laborCharges,
      parts_charges: partsCharges,
      tax,
      invoice_total: total,
      remaining_balance: total,
      status: "Sent",
      created_by: user?.id ?? null,
    }).select().single();

    if (insertError) { setError(insertError.message); setBusy(false); return; }

    await supabase.from("work_orders").update({ billing_status: "Billed" }).eq("id", wo.id);
    await logActivity(supabase, { userId: user?.id ?? null, action: "created", recordType: "invoice", recordId: inv.id, newValue: invoiceNumber });
    setShowForm(false);
    setSelectedWo("");
    await load();
    setBusy(false);
  }

  return (
    <div>
      <PageHeader title="Billing" description="Create and manage customer invoices" actions={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)} disabled={completedWo.length === 0}>
          Invoice from Work Order
        </button>
      } />

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="text-lg font-bold">Create Invoice</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={createInvoice} className="mt-4 space-y-3">
              <FormRow label="Work order" required>
                <select className="select select-bordered w-full" value={selectedWo} onChange={(e) => setSelectedWo(e.target.value)} required>
                  <option value="">Select completed WO…</option>
                  {completedWo.map((wo) => (
                    <option key={wo.id} value={wo.id}>{wo.work_order_number} — {wo.customers?.name}</option>
                  ))}
                </select>
              </FormRow>
              <p className="text-xs opacity-60">Tax rate from company settings: {(taxRate * 100).toFixed(2)}%</p>
              <div className="modal-action">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Create Invoice</button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop"><button type="button" onClick={() => setShowForm(false)}>close</button></form>
        </dialog>
      ) : null}

      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {invoices.length === 0 ? (
            <div className="p-6"><EmptyState title="No invoices yet" description="Complete a work order, then create an invoice from billing." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Invoice #</th><th>Customer</th><th>Date</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-medium">{inv.invoice_number}</td>
                      <td>{inv.customers?.name ?? "—"}</td>
                      <td>{inv.invoice_date}</td>
                      <td>{formatMoney(inv.invoice_total)}</td>
                      <td>{formatMoney(inv.remaining_balance)}</td>
                      <td><StatusBadge label={inv.status} tone={statusTone(inv.status)} /></td>
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
