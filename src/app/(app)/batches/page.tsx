"use client";

/**
 * ServiceTitan-style Accounting Batch Center
 * Workflow: gather unbatched → create Open batch → Post (lock) → Export (GL CSV).
 */

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Layers,
  FileText,
  Banknote,
  Plus,
  RefreshCw,
  CheckSquare,
  Square,
  Sparkles,
  Lock,
  Send,
  ArrowRight,
  Inbox,
  Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import {
  BATCH_STATUS_HINT,
  createBatch,
  filterUnbatchedInvoices,
  groupPaymentsByMethod,
  invoiceOnOrBefore,
  listBatches,
  loadUnbatchedInvoices,
  loadUnbatchedPayments,
  paymentOnOrBefore,
  postBatches,
  type BatchWithMeta,
  type InvoiceForBatch,
  type PaymentForBatch,
  type UnbatchedInvoiceBucket,
} from "@/lib/batches";
import type { AccountingBatchStatus, AccountingBatchType } from "@/lib/types";

type CenterTab = "batches" | "unbatched_invoices" | "unbatched_payments";
type StatusTab = AccountingBatchStatus | "all";

export default function BatchesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as CenterTab) || "batches";

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [centerTab, setCenterTab] = useState<CenterTab>(initialTab);
  const [statusTab, setStatusTab] = useState<StatusTab>("Open");
  const [typeFilter, setTypeFilter] = useState<AccountingBatchType | "all">("all");
  const [search, setSearch] = useState("");

  const [batches, setBatches] = useState<BatchWithMeta[]>([]);
  const [unbatchedInv, setUnbatchedInv] = useState<InvoiceForBatch[]>([]);
  const [unbatchedPay, setUnbatchedPay] = useState<PaymentForBatch[]>([]);

  const [selInv, setSelInv] = useState<Set<string>>(new Set());
  const [selPay, setSelPay] = useState<Set<string>>(new Set());
  const [selBatches, setSelBatches] = useState<Set<string>>(new Set());
  const [invBucket, setInvBucket] = useState<UnbatchedInvoiceBucket>("all");

  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [batchName, setBatchName] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [b, inv, pay] = await Promise.all([
      listBatches(supabase, "all"),
      loadUnbatchedInvoices(supabase),
      loadUnbatchedPayments(supabase),
    ]);

    if (b.error) setError(b.error);
    else if (inv.error) setError(inv.error);
    else if (pay.error) setError(pay.error);
    setBatches(b.data);
    setUnbatchedInv(inv.data);
    setUnbatchedPay(pay.data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const openBatches = useMemo(() => batches.filter((b) => b.status === "Open"), [batches]);
  const postedBatches = useMemo(() => batches.filter((b) => b.status === "Posted"), [batches]);
  const readyToPost = useMemo(
    () => openBatches.filter((b) => b.invoice_count + b.payment_count > 0),
    [openBatches],
  );

  const filteredBatches = useMemo(() => {
    let list = batches;
    if (statusTab !== "all") list = list.filter((b) => b.status === statusTab);
    if (typeFilter !== "all") list = list.filter((b) => b.batch_type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) =>
          b.batch_number.toLowerCase().includes(q) ||
          (b.name || "").toLowerCase().includes(q) ||
          (b.payment_method || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [batches, statusTab, typeFilter, search]);

  const invPool = useMemo(
    () => filterUnbatchedInvoices(unbatchedInv, invBucket),
    [unbatchedInv, invBucket],
  );
  const invTotal = useMemo(
    () => unbatchedInv.reduce((s, i) => s + Number(i.invoice_total), 0),
    [unbatchedInv],
  );
  const payTotal = useMemo(
    () => unbatchedPay.reduce((s, p) => s + Number(p.payment_amount), 0),
    [unbatchedPay],
  );
  const payByMethod = useMemo(() => groupPaymentsByMethod(unbatchedPay), [unbatchedPay]);

  const selectedInvTotal = useMemo(
    () => invPool.filter((i) => selInv.has(i.id)).reduce((s, i) => s + Number(i.invoice_total), 0),
    [invPool, selInv],
  );
  const selectedPayTotal = useMemo(
    () =>
      unbatchedPay.filter((p) => selPay.has(p.id)).reduce((s, p) => s + Number(p.payment_amount), 0),
    [unbatchedPay, selPay],
  );

  function toggle(set: Dispatch<SetStateAction<Set<string>>>, id: string) {
    set((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function createFromSelection(
    invoiceIds: string[],
    paymentIds: string[],
    opts?: { name?: string; paymentMethod?: string | null },
  ) {
    if (!invoiceIds.length && !paymentIds.length) {
      setError("Select at least one invoice or payment.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    const { data: userData } = await supabase.auth.getUser();
    const res = await createBatch(supabase, {
      batchDate,
      name: opts?.name || batchName || undefined,
      notes: notes || undefined,
      paymentMethod: opts?.paymentMethod,
      invoiceIds,
      paymentIds,
      userId: userData.user?.id ?? null,
    });
    setBusy(false);
    if (res.error || !res.batch) {
      setError(res.error ?? "Create failed");
      return;
    }
    await logActivity(supabase, {
      userId: userData.user?.id ?? null,
      action: "created",
      recordType: "accounting_batch",
      recordId: res.batch.id,
      newValue: res.batch.batch_number,
    });
    setSelInv(new Set());
    setSelPay(new Set());
    setBatchName("");
    setNotes("");
    setSuccess(`Created ${res.batch.batch_number}`);
    router.push(`/batches/${res.batch.id}`);
  }

  async function smartDailyClose() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const { data: userData } = await supabase.auth.getUser();
    const today = batchDate;
    const invIds = unbatchedInv.filter((i) => invoiceOnOrBefore(i.invoice_date, today)).map((i) => i.id);
    const methods = groupPaymentsByMethod(
      unbatchedPay.filter((p) => paymentOnOrBefore(p.payment_date, today)),
    );

    let created = 0;
    let lastId: string | null = null;

    if (invIds.length) {
      const res = await createBatch(supabase, {
        batchDate: today,
        name: `Daily invoice batch · ${today}`,
        notes: "Smart daily close (ServiceTitan-style)",
        invoiceIds: invIds,
        paymentIds: [],
        userId: userData.user?.id ?? null,
      });
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      created += 1;
      lastId = res.batch?.id ?? null;
      await logActivity(supabase, {
        userId: userData.user?.id ?? null,
        action: "created",
        recordType: "accounting_batch",
        recordId: lastId,
        newValue: res.batch?.batch_number ?? null,
      });
    }

    for (const g of methods) {
      const res = await createBatch(supabase, {
        batchDate: today,
        name: `${g.method} deposit · ${today}`,
        paymentMethod: g.method,
        invoiceIds: [],
        paymentIds: g.rows.map((r) => r.id),
        userId: userData.user?.id ?? null,
      });
      if (res.error) {
        setError(res.error);
        setBusy(false);
        await load();
        return;
      }
      created += 1;
      lastId = res.batch?.id ?? lastId;
      await logActivity(supabase, {
        userId: userData.user?.id ?? null,
        action: "created",
        recordType: "accounting_batch",
        recordId: res.batch?.id,
        newValue: res.batch?.batch_number ?? null,
      });
    }

    setBusy(false);
    if (created === 0) {
      setError("Nothing unbatched through this date — day is closed.");
      return;
    }
    setSuccess(`Created ${created} open batch(es) for review.`);
    setCenterTab("batches");
    setStatusTab("Open");
    await load();
    if (created === 1 && lastId) router.push(`/batches/${lastId}`);
  }

  async function batchSelectedInvoices() {
    await createFromSelection([...selInv], []);
  }

  async function batchSelectedPayments() {
    await createFromSelection([], [...selPay]);
  }

  async function batchMethodDeposit(method: string, ids: string[]) {
    await createFromSelection([], ids, {
      name: `${method} deposit · ${batchDate}`,
      paymentMethod: method,
    });
  }

  async function bulkPostSelected() {
    const ids = [...selBatches].filter((id) => readyToPost.some((b) => b.id === id));
    if (!ids.length) {
      setError("Select open batches that contain transactions.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const res = await postBatches(supabase, ids, userData.user?.id ?? null);
    setBusy(false);
    setSelBatches(new Set());
    if (res.errors.length) setError(res.errors.join("; "));
    if (res.posted) setSuccess(`Posted ${res.posted} batch(es). They are locked for export.`);
    await load();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accounting"
        description="ServiceTitan-style batches: unbatched queues → Open → Post → Export to GL"
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <Link href="/billing" className="btn btn-outline btn-sm">
              Invoices
            </Link>
            <Link href="/payments" className="btn btn-outline btn-sm">
              Payments
            </Link>
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {success ? (
        <div className="alert alert-success text-sm">
          <span>{success}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSuccess(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Workflow */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-base-300 bg-base-100 px-4 py-3 text-sm shadow-sm">
        <span className="font-semibold text-primary">Close cycle</span>
        <span className="badge badge-outline gap-1">
          <Inbox className="h-3 w-3" /> Unbatched
        </span>
        <ArrowRight className="h-3.5 w-3.5 opacity-40" />
        <span className="badge badge-warning gap-1">
          <Layers className="h-3 w-3" /> Open
        </span>
        <ArrowRight className="h-3.5 w-3.5 opacity-40" />
        <span className="badge badge-info gap-1">
          <Lock className="h-3 w-3" /> Posted
        </span>
        <ArrowRight className="h-3.5 w-3.5 opacity-40" />
        <span className="badge badge-success gap-1">
          <Send className="h-3 w-3" /> Exported
        </span>
        <span className="ml-auto hidden text-xs opacity-55 sm:inline">
          Post locks lines. Export marks G/L handoff and downloads journal CSV.
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Unbatched invoices" value={unbatchedInv.length} hint={formatMoney(invTotal)} danger={unbatchedInv.length > 0} />
        <StatCard label="Unbatched payments" value={unbatchedPay.length} hint={formatMoney(payTotal)} danger={unbatchedPay.length > 0} />
        <StatCard label="Open batches" value={openBatches.length} hint="Editable" />
        <StatCard label="Ready to post" value={readyToPost.length} hint="Open with items" />
        <StatCard label="Posted (awaiting export)" value={postedBatches.length} />
      </div>

      {/* Center tabs (ST Accounting side panel style) */}
      <div className="tabs tabs-boxed bg-base-200/60 p-1 w-full sm:w-auto">
        <button
          type="button"
          className={`tab ${centerTab === "batches" ? "tab-active" : ""}`}
          onClick={() => setCenterTab("batches")}
        >
          <Layers className="mr-1 h-3.5 w-3.5" /> Batches
        </button>
        <button
          type="button"
          className={`tab ${centerTab === "unbatched_invoices" ? "tab-active" : ""}`}
          onClick={() => setCenterTab("unbatched_invoices")}
        >
          <FileText className="mr-1 h-3.5 w-3.5" /> Unbatched invoices
          {unbatchedInv.length ? (
            <span className="badge badge-sm badge-warning ml-1">{unbatchedInv.length}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`tab ${centerTab === "unbatched_payments" ? "tab-active" : ""}`}
          onClick={() => setCenterTab("unbatched_payments")}
        >
          <Banknote className="mr-1 h-3.5 w-3.5" /> Unbatched payments
          {unbatchedPay.length ? (
            <span className="badge badge-sm badge-warning ml-1">{unbatchedPay.length}</span>
          ) : null}
        </button>
      </div>

      {/* Shared batch date + smart close */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm">
        <label className="form-control">
          <span className="label-text text-xs">Batch / deposit date</span>
          <input
            type="date"
            className="input input-bordered input-sm"
            value={batchDate}
            onChange={(e) => setBatchDate(e.target.value)}
          />
        </label>
        <label className="form-control min-w-[12rem] flex-1">
          <span className="label-text text-xs">Default batch name (optional)</span>
          <input
            className="input input-bordered input-sm"
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            placeholder="Auto-named if blank"
          />
        </label>
        <button
          type="button"
          className="btn btn-warning btn-sm gap-1"
          disabled={busy || (unbatchedInv.length === 0 && unbatchedPay.length === 0)}
          onClick={() => void smartDailyClose()}
        >
          <Sparkles className="h-4 w-4" /> Smart daily close
        </button>
      </div>

      {/* ——— Batches list ——— */}
      {centerTab === "batches" ? (
        <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex flex-col gap-3 border-b border-base-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1">
              {(["all", "Open", "Posted", "Exported"] as StatusTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`btn btn-xs ${statusTab === t ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setStatusTab(t)}
                >
                  {t === "all" ? "All" : t}
                </button>
              ))}
              <select
                className="select select-bordered select-xs ml-1"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as AccountingBatchType | "all")}
              >
                <option value="all">All types</option>
                <option value="invoice">Invoice</option>
                <option value="payment">Payment</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="input input-bordered input-xs flex items-center gap-1">
                <Search className="h-3 w-3 opacity-50" />
                <input
                  className="grow"
                  placeholder="Search batch #"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {statusTab === "Open" || statusTab === "all" ? (
                <button
                  type="button"
                  className="btn btn-primary btn-xs gap-1"
                  disabled={busy || selBatches.size === 0}
                  onClick={() => void bulkPostSelected()}
                >
                  <Lock className="h-3 w-3" /> Post selected
                </button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <p className="p-8 text-center text-sm opacity-50">Loading batches…</p>
          ) : filteredBatches.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No batches in this view"
                description="Create a batch from Unbatched invoices or payments, or run Smart daily close."
                action={
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setCenterTab("unbatched_invoices")}
                  >
                    Open unbatched invoices
                  </button>
                }
              />
            </div>
          ) : (
            <DualHorizontalScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-8" />
                    <th>Batch</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="text-right">Invoices</th>
                    <th className="text-right">Payments</th>
                    <th className="text-right">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredBatches.map((b) => {
                    const canPost = b.status === "Open" && b.invoice_count + b.payment_count > 0;
                    const selected = selBatches.has(b.id);
                    return (
                      <tr key={b.id} className={`hover ${selected ? "bg-primary/5" : ""}`}>
                        <td>
                          {canPost ? (
                            <button type="button" onClick={() => toggle(setSelBatches, b.id)}>
                              {selected ? (
                                <CheckSquare className="h-4 w-4 text-primary" />
                              ) : (
                                <Square className="h-4 w-4 opacity-30" />
                              )}
                            </button>
                          ) : null}
                        </td>
                        <td>
                          <Link href={`/batches/${b.id}`} className="link link-primary font-semibold">
                            {b.batch_number}
                          </Link>
                          {b.name ? <span className="mt-0.5 block text-xs opacity-55">{b.name}</span> : null}
                        </td>
                        <td className="tabular-nums">{b.batch_date}</td>
                        <td>
                          <span className="badge badge-ghost badge-sm capitalize">{b.batch_type}</span>
                          {b.payment_method ? (
                            <span className="mt-0.5 block text-[11px] opacity-50">{b.payment_method}</span>
                          ) : null}
                        </td>
                        <td>
                          <StatusBadge label={b.status} tone={statusTone(b.status)} />
                          <span className="mt-0.5 block max-w-[10rem] text-[10px] opacity-45">
                            {BATCH_STATUS_HINT[b.status]}
                          </span>
                        </td>
                        <td className="text-right tabular-nums">
                          {b.invoice_count}
                          {b.invoice_count > 0 ? (
                            <span className="mt-0.5 block text-xs opacity-50">
                              {formatMoney(b.invoice_total)}
                            </span>
                          ) : null}
                        </td>
                        <td className="text-right tabular-nums">
                          {b.payment_count}
                          {b.payment_count > 0 ? (
                            <span className="mt-0.5 block text-xs opacity-50">
                              {formatMoney(b.payment_total)}
                            </span>
                          ) : null}
                        </td>
                        <td className="text-right font-semibold tabular-nums">
                          {formatMoney(Number(b.invoice_total) + Number(b.payment_total))}
                        </td>
                        <td className="text-right">
                          <Link href={`/batches/${b.id}`} className="btn btn-ghost btn-xs">
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DualHorizontalScroll>
          )}
        </section>
      ) : null}

      {/* ——— Unbatched invoices ——— */}
      {centerTab === "unbatched_invoices" ? (
        <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 p-4">
            <div>
              <h2 className="font-bold">Unbatched invoices</h2>
              <p className="text-xs opacity-55">
                Sent / Partially Paid / Paid only — Draft &amp; review statuses stay out of books.
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["all", "All ready"],
                  ["open_ar", "Open AR"],
                  ["paid", "Paid"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn btn-xs ${invBucket === id ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => {
                    setInvBucket(id);
                    setSelInv(new Set());
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setSelInv(new Set(invPool.map((i) => i.id)))}
              >
                Select all
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSelInv(new Set())}>
                Clear
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm gap-1"
                disabled={busy || selInv.size === 0}
                onClick={() => void batchSelectedInvoices()}
              >
                <Plus className="h-4 w-4" /> Batch {selInv.size || ""} selected
                {selInv.size ? ` · ${formatMoney(selectedInvTotal)}` : ""}
              </button>
            </div>
          </div>
          {invPool.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Queue clear"
                description="No finalized invoices waiting for a batch. Nice work."
              />
            </div>
          ) : (
            <DualHorizontalScroll contentClassName="max-h-[28rem] overflow-y-auto">
              <table className="table table-sm">
                <thead className="sticky top-0 bg-base-100">
                  <tr>
                    <th />
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {invPool.map((inv) => {
                    const on = selInv.has(inv.id);
                    return (
                      <tr
                        key={inv.id}
                        className={`cursor-pointer ${on ? "bg-primary/10" : "hover:bg-base-200/50"}`}
                        onClick={() => toggle(setSelInv, inv.id)}
                      >
                        <td>
                          {on ? (
                            <CheckSquare className="h-4 w-4 text-primary" />
                          ) : (
                            <Square className="h-4 w-4 opacity-30" />
                          )}
                        </td>
                        <td className="font-medium">{inv.invoice_number}</td>
                        <td>{inv.customers?.name ?? "—"}</td>
                        <td className="tabular-nums">{inv.invoice_date}</td>
                        <td>
                          <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                        </td>
                        <td className="text-right tabular-nums">{formatMoney(inv.invoice_total)}</td>
                        <td className="text-right tabular-nums">{formatMoney(inv.remaining_balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DualHorizontalScroll>
          )}
        </section>
      ) : null}

      {/* ——— Unbatched payments / deposits ——— */}
      {centerTab === "unbatched_payments" ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/5 to-base-100 p-4 shadow-sm">
            <h2 className="font-bold">Deposit by payment method</h2>
            <p className="text-xs opacity-60 mb-3">
              ServiceTitan groups collections into tender deposits — one open batch per method.
            </p>
            {payByMethod.length === 0 ? (
              <p className="text-sm opacity-50">No unbatched payments.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {payByMethod.map((g) => (
                  <button
                    key={g.method}
                    type="button"
                    disabled={busy}
                    onClick={() => void batchMethodDeposit(g.method, g.rows.map((r) => r.id))}
                    className="rounded-xl border border-base-300 bg-base-100 p-4 text-left transition hover:border-primary/40 hover:shadow-md"
                  >
                    <p className="font-semibold">{g.method}</p>
                    <p className="text-2xl font-bold tabular-nums mt-1">{formatMoney(g.total)}</p>
                    <p className="text-xs opacity-55 mt-1">
                      {g.count} payment{g.count === 1 ? "" : "s"} · Click to create deposit batch
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 p-4">
              <h2 className="font-bold">All unbatched payments</h2>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setSelPay(new Set(unbatchedPay.map((p) => p.id)))}
                >
                  Select all
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSelPay(new Set())}>
                  Clear
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm gap-1"
                  disabled={busy || selPay.size === 0}
                  onClick={() => void batchSelectedPayments()}
                >
                  <Plus className="h-4 w-4" /> Batch {selPay.size || ""} selected
                  {selPay.size ? ` · ${formatMoney(selectedPayTotal)}` : ""}
                </button>
              </div>
            </div>
            {unbatchedPay.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No unbatched payments" description="New payments appear here until deposited." />
              </div>
            ) : (
              <DualHorizontalScroll contentClassName="max-h-[24rem] overflow-y-auto">
                <table className="table table-sm">
                  <thead className="sticky top-0 bg-base-100">
                    <tr>
                      <th />
                      <th>Payment</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Method</th>
                      <th>Invoice</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unbatchedPay.map((p) => {
                      const on = selPay.has(p.id);
                      return (
                        <tr
                          key={p.id}
                          className={`cursor-pointer ${on ? "bg-sky-500/10" : "hover:bg-base-200/50"}`}
                          onClick={() => toggle(setSelPay, p.id)}
                        >
                          <td>
                            {on ? (
                              <CheckSquare className="h-4 w-4 text-sky-600" />
                            ) : (
                              <Square className="h-4 w-4 opacity-30" />
                            )}
                          </td>
                          <td className="font-medium">{p.payment_number}</td>
                          <td>{p.customers?.name ?? "—"}</td>
                          <td className="tabular-nums">{p.payment_date}</td>
                          <td>{p.payment_method}</td>
                          <td className="text-xs">{p.invoices?.invoice_number ?? "—"}</td>
                          <td className="text-right tabular-nums font-medium">
                            {formatMoney(p.payment_amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </DualHorizontalScroll>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
