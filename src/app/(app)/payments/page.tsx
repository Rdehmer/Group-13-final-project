"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatCard, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import { daysPastDue, calendarMonthsForYear, formatMonthLabel, monthKeyFromDate } from "@/lib/billing";
import { loadPaymentBatchMap, type BatchLookup } from "@/lib/batches";
import { applyInvoicePayment } from "@/lib/payments";
import type { Invoice, Payment } from "@/lib/types";

type AgingBucket = "current" | "d30" | "d60" | "d90";

type OpenInvoice = Invoice & {
  customers?: { name: string };
  work_orders?: { work_order_number: string } | null;
};

type PaymentRow = Payment & { customers?: { name: string } };

const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d30: "1–30 Days",
  d60: "31–60 Days",
  d90: "61+ Days",
};

function agingBucketFor(inv: Invoice, today = new Date()): AgingBucket {
  const days = daysPastDue(inv, today);
  if (days <= 0) return "current";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  return "d90";
}

/**
 * This business faces cash flow visibility risk when AR aging is unclear.
 * Our app reduces the risk by tracking payments and aging open invoices.
 */
export default function PaymentsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const preselectedInvoice = searchParams.get("invoice");
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ invoice_id: "", payment_method: "Check", payment_amount: "", reference_number: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<AgingBucket | null>(null);
  const [paymentMonth, setPaymentMonth] = useState<string>("all");
  const [paymentBatchMap, setPaymentBatchMap] = useState<Map<string, BatchLookup>>(new Map());

  async function load() {
    const [{ data: inv }, { data: pay }, batchRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("*, customers(name), work_orders(work_order_number)")
        .gt("remaining_balance", 0)
        .not("status", "eq", "Canceled"),
      supabase
        .from("payments")
        .select("*, customers(name)")
        .order("payment_date", { ascending: false })
        .limit(200),
      loadPaymentBatchMap(supabase),
    ]);
    const openInvoices = (inv as OpenInvoice[]) ?? [];
    setInvoices(openInvoices);
    setPayments((pay as PaymentRow[]) ?? []);
    setPaymentBatchMap(batchRes.map);
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

  const { aging, byBucket, today } = useMemo(() => {
    const now = new Date();
    const totals = { current: 0, d30: 0, d60: 0, d90: 0 };
    const groups: Record<AgingBucket, OpenInvoice[]> = {
      current: [],
      d30: [],
      d60: [],
      d90: [],
    };
    for (const inv of invoices) {
      const bucket = agingBucketFor(inv, now);
      const bal = Number(inv.remaining_balance);
      totals[bucket] += bal;
      groups[bucket].push(inv);
    }
    for (const key of Object.keys(groups) as AgingBucket[]) {
      groups[key].sort((a, b) => a.due_date.localeCompare(b.due_date));
    }
    return { aging: totals, byBucket: groups, today: now };
  }, [invoices]);

  const drillInvoices = selectedBucket ? byBucket[selectedBucket] : [];

  const paymentMonthOptions = useMemo(() => calendarMonthsForYear(new Date().getFullYear()), []);

  const filteredPayments = useMemo(() => {
    if (paymentMonth === "all") return payments;
    return payments.filter((p) => monthKeyFromDate(p.payment_date) === paymentMonth);
  }, [payments, paymentMonth]);

  const paymentMonthTotal = useMemo(
    () => filteredPayments.reduce((sum, p) => sum + Number(p.payment_amount), 0),
    [filteredPayments],
  );

  function toggleBucket(bucket: AgingBucket) {
    setSelectedBucket((prev) => (prev === bucket ? null : bucket));
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const inv = invoices.find((i) => i.id === form.invoice_id);
    if (!inv) { setBusy(false); return; }
    const amount = Number(form.payment_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid payment amount.");
      setBusy(false);
      return;
    }
    if (amount > Number(inv.remaining_balance) + 0.001) {
      setError(`Amount cannot exceed the remaining balance (${formatMoney(inv.remaining_balance)}).`);
      setBusy(false);
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const result = await applyInvoicePayment(supabase, {
      invoiceId: inv.id,
      customerId: inv.customer_id,
      invoiceTotal: Number(inv.invoice_total),
      amountPaidSoFar: Number(inv.amount_paid),
      remaining: Number(inv.remaining_balance),
      amount,
      paymentMethod: form.payment_method,
      referenceNumber: form.reference_number || null,
      userId: user?.id ?? null,
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "recorded",
      recordType: "payment",
      recordId: inv.id,
      newValue: result.paymentNumber,
    });
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
          <Link href="/batches" className="btn btn-outline btn-sm">Batches</Link>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)} disabled={invoices.length === 0}>Record Payment</button>
        </div>
      } />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Current"
          value={formatMoney(aging.current)}
          onClick={() => toggleBucket("current")}
          active={selectedBucket === "current"}
        />
        <StatCard
          label="1–30 Days"
          value={formatMoney(aging.d30)}
          hint="Past due"
          onClick={() => toggleBucket("d30")}
          active={selectedBucket === "d30"}
        />
        <StatCard
          label="31–60 Days"
          value={formatMoney(aging.d60)}
          danger={aging.d60 > 0}
          onClick={() => toggleBucket("d60")}
          active={selectedBucket === "d60"}
        />
        <StatCard
          label="61+ Days"
          value={formatMoney(aging.d90)}
          danger={aging.d90 > 0}
          onClick={() => toggleBucket("d90")}
          active={selectedBucket === "d90"}
        />
      </div>

      {selectedBucket ? (
        <div className="card bg-base-100 shadow mb-6">
          <div className="card-body">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="card-title text-base">
                {BUCKET_LABELS[selectedBucket]} — open invoices
              </h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedBucket(null)}>
                Clear
              </button>
            </div>
            {drillInvoices.length === 0 ? (
              <EmptyState
                title="No invoices in this bucket"
                description="Open invoices in other aging buckets may still need attention."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Customer</th>
                      <th>Work order</th>
                      <th>Invoice date</th>
                      <th>Due date</th>
                      <th>Days past due</th>
                      <th>Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillInvoices.map((inv) => {
                      const days = daysPastDue(inv, today);
                      const woNumber = inv.work_orders?.work_order_number;
                      return (
                        <tr key={inv.id}>
                          <td>
                            <Link href={`/billing/${inv.id}`} className="link link-primary font-medium">
                              {inv.invoice_number}
                            </Link>
                          </td>
                          <td>{inv.customers?.name ?? "—"}</td>
                          <td>
                            {inv.work_order_id && woNumber ? (
                              <Link href={`/work-orders/${inv.work_order_id}`} className="link link-primary">
                                {woNumber}
                              </Link>
                            ) : inv.work_order_id ? (
                              <Link href={`/work-orders/${inv.work_order_id}`} className="link link-primary">
                                View WO
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{inv.invoice_date}</td>
                          <td>{inv.due_date}</td>
                          <td>{days <= 0 ? "Current" : days}</td>
                          <td>{formatMoney(inv.remaining_balance)}</td>
                          <td>
                            <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

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
          <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="card-title text-base">Payments received</h2>
              <p className="text-sm opacity-60">
                {paymentMonth === "all" ? (
                  <>
                    All months · Received {formatMoney(paymentMonthTotal)} · {filteredPayments.length}{" "}
                    {filteredPayments.length === 1 ? "payment" : "payments"}
                  </>
                ) : (
                  <>
                    {formatMonthLabel(paymentMonth)} · Received {formatMoney(paymentMonthTotal)} ·{" "}
                    {filteredPayments.length} {filteredPayments.length === 1 ? "payment" : "payments"}
                  </>
                )}
              </p>
            </div>
            <label className="form-control w-full sm:max-w-[14rem]">
              <select
                className="select select-bordered select-sm w-full"
                value={paymentMonth}
                onChange={(e) => setPaymentMonth(e.target.value)}
                aria-label="Payment month"
              >
                <option value="all">All months</option>
                {paymentMonthOptions.map((key) => (
                  <option key={key} value={key}>
                    {formatMonthLabel(key)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {filteredPayments.length === 0 ? (
            <EmptyState
              title={
                paymentMonth !== "all"
                  ? `No payments in ${formatMonthLabel(paymentMonth)}`
                  : "No payments recorded"
              }
              description={
                paymentMonth !== "all"
                  ? "Try All months or another month, or record a simulated payment against an open invoice."
                  : "Record a simulated payment against an open invoice."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Payment #</th>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Batch</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((p) => {
                    const batchInfo = paymentBatchMap.get(p.id);
                    return (
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
                      <td>
                        {batchInfo ? (
                          <Link
                            href={`/batches/${batchInfo.batchId}`}
                            className="badge badge-primary badge-outline badge-sm"
                            title={batchInfo.status}
                          >
                            {batchInfo.batchNumber}
                          </Link>
                        ) : (
                          <span className="text-xs opacity-40">—</span>
                        )}
                      </td>
                      <td>{formatMoney(p.payment_amount)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
