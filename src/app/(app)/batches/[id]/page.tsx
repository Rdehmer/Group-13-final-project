"use client";

/**
 * Batch detail — review lines, post (lock), export CSV, unpost/delete when allowed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Lock,
  Unlock,
  Download,
  Trash2,
  RefreshCw,
  Plus,
  X,
  Send,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import {
  BATCH_STATUS_HINT,
  addInvoicesToBatch,
  addPaymentsToBatch,
  deleteEmptyOpenBatch,
  exportBatch,
  exportBatchCsv,
  exportBatchJournalCsv,
  loadBatchDetail,
  loadUnbatchedInvoices,
  loadUnbatchedPayments,
  postBatch,
  removeInvoiceLine,
  removePaymentLine,
  unexportBatch,
  unpostBatch,
  type InvoiceForBatch,
  type PaymentForBatch,
} from "@/lib/batches";
import type { AccountingBatch } from "@/lib/types";

export default function BatchDetailPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [batch, setBatch] = useState<AccountingBatch | null>(null);
  const [invoices, setInvoices] = useState<
    (InvoiceForBatch & { lineId: string; lineAmount: number })[]
  >([]);
  const [payments, setPayments] = useState<
    (PaymentForBatch & { lineId: string; lineAmount: number })[]
  >([]);
  const [showAddInv, setShowAddInv] = useState(false);
  const [showAddPay, setShowAddPay] = useState(false);
  const [poolInv, setPoolInv] = useState<InvoiceForBatch[]>([]);
  const [poolPay, setPoolPay] = useState<PaymentForBatch[]>([]);
  const [addSel, setAddSel] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const detail = await loadBatchDetail(supabase, id);
    if (detail.error) setError(detail.error);
    setBatch(detail.batch);
    setInvoices(detail.invoices);
    setPayments(detail.payments);
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOpen = batch?.status === "Open";
  const isPosted = batch?.status === "Posted";
  const isExported = batch?.status === "Exported";

  async function doPost() {
    if (!batch) return;
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const { error: err } = await postBatch(supabase, batch.id, data.user?.id ?? null);
    if (err) setError(err);
    else {
      await logActivity(supabase, {
        userId: data.user?.id ?? null,
        action: "posted",
        recordType: "accounting_batch",
        recordId: batch.id,
        newValue: batch.batch_number,
      });
      await load();
    }
    setBusy(false);
  }

  async function doUnpost() {
    if (!batch) return;
    if (!confirm("Unpost this batch? It will become editable again.")) return;
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const { error: err } = await unpostBatch(supabase, batch.id);
    if (err) setError(err);
    else {
      await logActivity(supabase, {
        userId: data.user?.id ?? null,
        action: "unposted",
        recordType: "accounting_batch",
        recordId: batch.id,
        previousValue: "Posted",
        newValue: "Open",
      });
      await load();
    }
    setBusy(false);
  }

  async function doExport(kind: "transactions" | "journal" | "both" = "both") {
    if (!batch) return;
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.getUser();
    if (kind === "transactions" || kind === "both") {
      exportBatchCsv(batch, invoices, payments);
    }
    if (kind === "journal" || kind === "both") {
      exportBatchJournalCsv(batch, invoices, payments);
    }
    if (batch.status === "Posted") {
      const { error: err } = await exportBatch(supabase, batch.id, data.user?.id ?? null);
      if (err) setError(err);
      else {
        await logActivity(supabase, {
          userId: data.user?.id ?? null,
          action: "exported",
          recordType: "accounting_batch",
          recordId: batch.id,
          newValue: batch.batch_number,
        });
        await load();
      }
    }
    setBusy(false);
  }

  /** Download G/L files without Post/Export status change (demo / emergency handoff). */
  async function doBypassExport() {
    if (!batch) return;
    if (invoices.length + payments.length === 0) {
      setError("Add invoices or payments before exporting.");
      setSuccess(null);
      return;
    }
    setError(null);
    exportBatchCsv(batch, invoices, payments);
    exportBatchJournalCsv(batch, invoices, payments);
    const { data } = await supabase.auth.getUser();
    await logActivity(supabase, {
      userId: data.user?.id ?? null,
      action: "bypass_export",
      recordType: "accounting_batch",
      recordId: batch.id,
      newValue: batch.batch_number,
    });
    setSuccess(
      `Bypass export downloaded journal + transactions for ${batch.batch_number}. Batch status stays ${batch.status}.`,
    );
  }

  async function doUnexport() {
    if (!batch) return;
    if (!confirm("Return this batch to Posted so it can be re-exported?")) return;
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const { error: err } = await unexportBatch(supabase, batch.id);
    if (err) setError(err);
    else {
      await logActivity(supabase, {
        userId: data.user?.id ?? null,
        action: "unexported",
        recordType: "accounting_batch",
        recordId: batch.id,
        previousValue: "Exported",
        newValue: "Posted",
      });
      await load();
    }
    setBusy(false);
  }

  async function doDelete() {
    if (!batch) return;
    if (!confirm("Delete this empty open batch?")) return;
    setBusy(true);
    const { error: err } = await deleteEmptyOpenBatch(supabase, batch.id);
    setBusy(false);
    if (err) setError(err);
    else router.push("/batches");
  }

  async function removeInv(lineId: string) {
    if (!batch) return;
    setBusy(true);
    const { error: err } = await removeInvoiceLine(supabase, batch.id, lineId);
    if (err) setError(err);
    else await load();
    setBusy(false);
  }

  async function removePay(lineId: string) {
    if (!batch) return;
    setBusy(true);
    const { error: err } = await removePaymentLine(supabase, batch.id, lineId);
    if (err) setError(err);
    else await load();
    setBusy(false);
  }

  async function openAddInv() {
    setShowAddInv(true);
    setShowAddPay(false);
    setAddSel(new Set());
    const { data } = await loadUnbatchedInvoices(supabase);
    setPoolInv(data);
  }

  async function openAddPay() {
    setShowAddPay(true);
    setShowAddInv(false);
    setAddSel(new Set());
    const { data } = await loadUnbatchedPayments(supabase);
    setPoolPay(data);
  }

  async function confirmAddInv() {
    if (!batch || addSel.size === 0) return;
    setBusy(true);
    const { error: err } = await addInvoicesToBatch(supabase, batch.id, [...addSel]);
    if (err) setError(err);
    else {
      setShowAddInv(false);
      await load();
    }
    setBusy(false);
  }

  async function confirmAddPay() {
    if (!batch || addSel.size === 0) return;
    setBusy(true);
    const { error: err } = await addPaymentsToBatch(supabase, batch.id, [...addSel]);
    if (err) setError(err);
    else {
      setShowAddPay(false);
      await load();
    }
    setBusy(false);
  }

  if (loading) {
    return <p className="p-10 text-center text-sm opacity-50">Loading batch…</p>;
  }

  if (!batch) {
    return (
      <div className="space-y-4">
        <Link href="/batches" className="btn btn-ghost btn-sm gap-1">
          <ArrowLeft className="h-4 w-4" /> Batches
        </Link>
        <EmptyState title="Batch not found" description={error ?? "It may have been deleted."} />
      </div>
    );
  }

  const grand = Number(batch.invoice_total) + Number(batch.payment_total);

  return (
    <div className="space-y-5">
      <PageHeader
        title={batch.batch_number}
        description={batch.name || BATCH_STATUS_HINT[batch.status]}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm gap-1"
              disabled={busy || invoices.length + payments.length === 0}
              title="Download journal + transaction CSVs without posting or changing status"
              onClick={() => void doBypassExport()}
            >
              <Download className="h-4 w-4" /> Bypass export
            </button>
            <Link href="/batches" className="btn btn-ghost btn-sm gap-1">
              <ArrowLeft className="h-4 w-4" /> All batches
            </Link>
            <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => load()} disabled={busy}>
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error text-sm">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {success ? (
        <div className="alert alert-success py-2 text-sm">
          <span>{success}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSuccess(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {isOpen ? (
        <div className="alert alert-warning text-sm">
          <Unlock className="h-4 w-4" />
          <span>Open batch — add or remove lines, then <strong>Post</strong> to lock for export.</span>
        </div>
      ) : null}
      {isPosted ? (
        <div className="alert alert-info text-sm">
          <Lock className="h-4 w-4" />
          <span>Posted — lines are locked. Export downloads G/L files and marks exported.</span>
        </div>
      ) : null}
      {isExported ? (
        <div className="alert alert-success text-sm">
          <Send className="h-4 w-4" />
          <span>Exported to accounting. Re-download files anytime, or unexport to re-open export.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
        <StatusBadge label={batch.status} tone={statusTone(batch.status)} />
        <span className="badge badge-ghost capitalize">{batch.batch_type}</span>
        <span className="text-sm opacity-60">
          Batch date <strong className="text-base-content">{batch.batch_date}</strong>
        </span>
        {batch.payment_method ? (
          <span className="text-sm opacity-60">Method · {batch.payment_method}</span>
        ) : null}
        {batch.posted_at ? (
          <span className="text-xs opacity-50">Posted {new Date(batch.posted_at).toLocaleString()}</span>
        ) : null}
        {batch.exported_at ? (
          <span className="text-xs opacity-50">Exported {new Date(batch.exported_at).toLocaleString()}</span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Invoices"
          value={batch.invoice_count}
          hint={formatMoney(batch.invoice_total)}
          scrollTarget="batch-invoices"
        />
        <StatCard
          label="Payments"
          value={batch.payment_count}
          hint={formatMoney(batch.payment_total)}
          scrollTarget="batch-payments"
        />
        <StatCard label="Batch total" value={formatMoney(grand)} scrollTarget="batch-invoices" />
        <StatCard
          label="Editability"
          value={isOpen ? "Unlocked" : "Locked"}
          hint={isOpen ? "Can add/remove lines" : "Post status prevents edits"}
          scrollTarget="batch-actions"
        />
      </div>

      {/* Actions */}
      <div
        id="batch-actions"
        className="flex scroll-mt-4 flex-wrap gap-2 rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm"
      >
        <button
          type="button"
          className="btn btn-secondary gap-1"
          disabled={busy || invoices.length + payments.length === 0}
          title="Skip Post → Export. Downloads CSVs only; status stays as-is."
          onClick={() => void doBypassExport()}
        >
          <Download className="h-4 w-4" /> Bypass export
        </button>
        {isOpen ? (
          <>
            <button
              type="button"
              className="btn btn-primary gap-1"
              disabled={busy || invoices.length + payments.length === 0}
              onClick={() => void doPost()}
            >
              <Lock className="h-4 w-4" /> Post batch
            </button>
            <button type="button" className="btn btn-outline btn-sm gap-1" disabled={busy} onClick={() => void openAddInv()}>
              <Plus className="h-4 w-4" /> Add invoices
            </button>
            <button type="button" className="btn btn-outline btn-sm gap-1" disabled={busy} onClick={() => void openAddPay()}>
              <Plus className="h-4 w-4" /> Add payments
            </button>
            {invoices.length + payments.length === 0 ? (
              <button type="button" className="btn btn-ghost btn-sm gap-1 text-error" disabled={busy} onClick={() => void doDelete()}>
                <Trash2 className="h-4 w-4" /> Delete empty
              </button>
            ) : null}
          </>
        ) : null}
        {isPosted ? (
          <>
            <button type="button" className="btn btn-primary gap-1" disabled={busy} onClick={() => void doExport("both")}>
              <Send className="h-4 w-4" /> Export journal + transactions
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              disabled={busy}
              onClick={() => void doExport("journal")}
            >
              <Download className="h-4 w-4" /> Journal CSV only
            </button>
            <button type="button" className="btn btn-outline btn-sm gap-1" disabled={busy} onClick={() => void doUnpost()}>
              <Unlock className="h-4 w-4" /> Unpost
            </button>
          </>
        ) : null}
        {isExported ? (
          <>
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              disabled={busy}
              onClick={() => {
                exportBatchCsv(batch, invoices, payments);
                exportBatchJournalCsv(batch, invoices, payments);
              }}
            >
              <Download className="h-4 w-4" /> Re-download files
            </button>
            <button type="button" className="btn btn-ghost btn-sm gap-1" disabled={busy} onClick={() => void doUnexport()}>
              Unexport (return to Posted)
            </button>
          </>
        ) : null}
        {isOpen ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-1"
              disabled={busy || invoices.length + payments.length === 0}
              onClick={() => exportBatchCsv(batch, invoices, payments)}
            >
              <Download className="h-4 w-4" /> Preview transactions
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-1"
              disabled={busy || invoices.length + payments.length === 0}
              onClick={() => exportBatchJournalCsv(batch, invoices, payments)}
            >
              <Download className="h-4 w-4" /> Preview journal
            </button>
          </div>
        ) : null}
        <p className="w-full text-xs opacity-55">
          <strong>Bypass export</strong> downloads journal + transaction CSVs without posting or marking the
          batch Exported. Use formal <strong>Export</strong> after Post when you want the G/L handoff recorded.
        </p>
      </div>

      {batch.notes ? (
        <p className="rounded-xl bg-base-200/60 px-4 py-2 text-sm">
          <span className="font-medium">Notes: </span>
          {batch.notes}
        </p>
      ) : null}

      {/* Add panes */}
      {showAddInv ? (
        <div className="rounded-2xl border border-primary/30 bg-base-100 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Add unbatched invoices</h3>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowAddInv(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {poolInv.length === 0 ? (
            <p className="text-sm opacity-50">No unbatched invoices available.</p>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              <table className="table table-sm">
                <tbody>
                  {poolInv.map((inv) => {
                    const on = addSel.has(inv.id);
                    return (
                      <tr
                        key={inv.id}
                        className={`cursor-pointer ${on ? "bg-primary/10" : ""}`}
                        onClick={() =>
                          setAddSel((s) => {
                            const n = new Set(s);
                            if (n.has(inv.id)) n.delete(inv.id);
                            else n.add(inv.id);
                            return n;
                          })
                        }
                      >
                        <td className="font-medium">{inv.invoice_number}</td>
                        <td>{inv.customers?.name}</td>
                        <td className="text-right">{formatMoney(inv.invoice_total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm mt-3"
            disabled={busy || addSel.size === 0}
            onClick={() => void confirmAddInv()}
          >
            Add {addSel.size || ""} to batch
          </button>
        </div>
      ) : null}

      {showAddPay ? (
        <div className="rounded-2xl border border-sky-500/30 bg-base-100 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Add unbatched payments</h3>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowAddPay(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {poolPay.length === 0 ? (
            <p className="text-sm opacity-50">No unbatched payments available.</p>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              <table className="table table-sm">
                <tbody>
                  {poolPay.map((p) => {
                    const on = addSel.has(p.id);
                    return (
                      <tr
                        key={p.id}
                        className={`cursor-pointer ${on ? "bg-sky-500/10" : ""}`}
                        onClick={() =>
                          setAddSel((s) => {
                            const n = new Set(s);
                            if (n.has(p.id)) n.delete(p.id);
                            else n.add(p.id);
                            return n;
                          })
                        }
                      >
                        <td className="font-medium">{p.payment_number}</td>
                        <td>
                          {p.payment_method} · {p.payment_date}
                        </td>
                        <td className="text-right">{formatMoney(p.payment_amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm mt-3"
            disabled={busy || addSel.size === 0}
            onClick={() => void confirmAddPay()}
          >
            Add {addSel.size || ""} to batch
          </button>
        </div>
      ) : null}

      {/* Invoice lines */}
      <section
        id="batch-invoices"
        className="scroll-mt-4 rounded-2xl border border-base-300 bg-base-100 shadow-sm"
      >
        <div className="border-b border-base-200 px-4 py-3">
          <h2 className="font-bold">Invoices in batch</h2>
        </div>
        {invoices.length === 0 ? (
          <p className="p-6 text-sm opacity-50">No invoices in this batch.</p>
        ) : (
          <DualHorizontalScroll>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="text-right">Amount</th>
                  {isOpen ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.lineId}>
                    <td>
                      <Link href={`/billing/${inv.id}`} className="link link-primary font-medium">
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td>
                      {inv.customer_id ? (
                        <Link href={`/customers/${inv.customer_id}`} className="link link-hover">
                          {inv.customers?.name ?? "—"}
                        </Link>
                      ) : (
                        inv.customers?.name ?? "—"
                      )}
                    </td>
                    <td className="tabular-nums">{inv.invoice_date}</td>
                    <td>
                      <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                    </td>
                    <td className="text-right tabular-nums font-medium">{formatMoney(inv.lineAmount)}</td>
                    {isOpen ? (
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-error"
                          disabled={busy}
                          onClick={() => void removeInv(inv.lineId)}
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={4}>Invoice subtotal</td>
                  <td className="text-right tabular-nums">{formatMoney(batch.invoice_total)}</td>
                  {isOpen ? <td /> : null}
                </tr>
              </tfoot>
            </table>
          </DualHorizontalScroll>
        )}
      </section>

      {/* Payment lines */}
      <section
        id="batch-payments"
        className="scroll-mt-4 rounded-2xl border border-base-300 bg-base-100 shadow-sm"
      >
        <div className="border-b border-base-200 px-4 py-3">
          <h2 className="font-bold">Payments in batch</h2>
        </div>
        {payments.length === 0 ? (
          <p className="p-6 text-sm opacity-50">No payments in this batch.</p>
        ) : (
          <DualHorizontalScroll>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Invoice</th>
                  <th className="text-right">Amount</th>
                  {isOpen ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.lineId}>
                    <td className="font-medium">{p.payment_number}</td>
                    <td>
                      {p.customer_id ? (
                        <Link href={`/customers/${p.customer_id}`} className="link link-hover">
                          {p.customers?.name ?? "—"}
                        </Link>
                      ) : (
                        p.customers?.name ?? "—"
                      )}
                    </td>
                    <td className="tabular-nums">{p.payment_date}</td>
                    <td>{p.payment_method}</td>
                    <td>
                      {p.invoice_id ? (
                        <Link href={`/billing/${p.invoice_id}`} className="link link-primary">
                          {p.invoices?.invoice_number ?? "Invoice"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-right tabular-nums font-medium">{formatMoney(p.lineAmount)}</td>
                    {isOpen ? (
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-error"
                          disabled={busy}
                          onClick={() => void removePay(p.lineId)}
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={5}>Payment subtotal</td>
                  <td className="text-right tabular-nums">{formatMoney(batch.payment_total)}</td>
                  {isOpen ? <td /> : null}
                </tr>
              </tfoot>
            </table>
          </DualHorizontalScroll>
        )}
      </section>
    </div>
  );
}
