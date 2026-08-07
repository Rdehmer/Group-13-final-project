"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatCard, StatusBadge, statusTone } from "@/components/ui";
import { InvoicePaymentDialog, type PaymentDialogInvoice } from "@/components/InvoicePaymentDialog";
import { formatMoney } from "@/lib/calculations";
import { daysPastDue, calendarMonthsForYear, formatMonthLabel, monthKeyFromDate } from "@/lib/billing";
import { loadPaymentBatchMap, type BatchLookup } from "@/lib/batches";
import { jumpToSection } from "@/lib/scrollToSection";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedInvoice = searchParams.get("invoice");
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [payInvoice, setPayInvoice] = useState<PaymentDialogInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<AgingBucket | null>(null);
  const [paymentMonth, setPaymentMonth] = useState<string>("all");
  const [paymentBatchMap, setPaymentBatchMap] = useState<Map<string, BatchLookup>>(new Map());

  async function load() {
    const [{ data: inv }, { data: pay }, batchRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("*, customers(name), work_orders(work_order_number)")
        .gt("remaining_balance", 0)
        .not("status", "eq", "Canceled")
        .order("due_date", { ascending: true }),
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
        openAcceptFor(match);
      } else {
        setError("That invoice is not on the open-AR list (paid, zero balance, or canceled).");
      }
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when deep-link invoice changes
  }, [preselectedInvoice]);

  function openAcceptFor(inv: OpenInvoice) {
    setError(null);
    setPayInvoice({
      id: inv.id,
      invoice_number: inv.invoice_number,
      customer_id: inv.customer_id,
      customer_name: inv.customers?.name ?? null,
      invoice_total: Number(inv.invoice_total),
      amount_paid: Number(inv.amount_paid),
      remaining_balance: Number(inv.remaining_balance),
      status: inv.status,
    });
    setShowForm(true);
  }

  function openRecordPayment() {
    setError(null);
    if (invoices.length === 0) {
      setShowForm(true);
      setPayInvoice(null);
      return;
    }
    if (invoices.length === 1) {
      openAcceptFor(invoices[0]);
      return;
    }
    // Multi open invoices: show picker modal
    setPayInvoice(null);
    setShowForm(true);
  }

  function closeRecordPayment() {
    setShowForm(false);
    setPayInvoice(null);
    setError(null);
  }

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
    jumpToSection("ar-aging-detail", () => {
      setSelectedBucket((prev) => (prev === bucket ? null : bucket));
    });
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Accept customer payments and monitor AR aging (ServiceTitan-style tendering)"
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => router.push("/billing")}
            >
              Invoices
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => router.push("/batches")}
            >
              Batches
            </button>
            <button type="button" className="btn btn-success btn-sm" onClick={openRecordPayment}>
              Accept payment
            </button>
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error mb-4 py-2 text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
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
        <div id="ar-aging-detail" className="card bg-base-100 shadow mb-6 scroll-mt-4">
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
              <DualHorizontalScroll>
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
              </DualHorizontalScroll>
            )}
          </div>
        </div>
      ) : null}

      {showForm && !payInvoice ? (
        <dialog className="modal modal-open" open>
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-bold">Accept payment</h3>
            <p className="mt-1 text-sm opacity-70">Choose an open invoice to tender against.</p>
            {invoices.length === 0 ? (
              <div className="mt-4 space-y-4">
                <p className="text-sm opacity-70">
                  There are no open invoices with a balance. Create or send an invoice first.
                </p>
                <div className="modal-action">
                  <button type="button" className="btn btn-ghost" onClick={closeRecordPayment}>
                    Close
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      closeRecordPayment();
                      router.push("/billing");
                    }}
                  >
                    Go to invoices
                  </button>
                </div>
              </div>
            ) : (
              <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                {invoices.map((inv) => (
                  <li key={inv.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-base-300 bg-base-100 px-3 py-2.5 text-left transition hover:border-success/40 hover:bg-success/5"
                      onClick={() => openAcceptFor(inv)}
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-sm font-semibold">{inv.invoice_number}</span>
                        <span className="block truncate text-xs opacity-60">
                          {inv.customers?.name ?? "Customer"}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-sm font-bold text-success">
                        {formatMoney(inv.remaining_balance)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {invoices.length > 0 ? (
              <div className="modal-action">
                <button type="button" className="btn btn-ghost" onClick={closeRecordPayment}>
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={closeRecordPayment}>
              close
            </button>
          </form>
        </dialog>
      ) : null}

      <InvoicePaymentDialog
        open={Boolean(payInvoice)}
        invoice={payInvoice}
        onClose={closeRecordPayment}
        onPaid={async () => {
          closeRecordPayment();
          await load();
        }}
      />

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
            <DualHorizontalScroll>
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
            </DualHorizontalScroll>
          )}
        </div>
      </div>
    </div>
  );
}
