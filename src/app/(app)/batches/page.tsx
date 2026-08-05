"use client";

/**
 * Accounting Batch Center — ServiceTitan-inspired invoice & payment batching.
 * Open → Post (lock) → Export (CSV handoff to GL / QBO).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import {
  BATCH_STATUS_HINT,
  createBatch,
  groupPaymentsByMethod,
  invoiceOnOrBefore,
  isSchemaError,
  listBatches,
  loadUnbatchedInvoices,
  loadUnbatchedPayments,
  paymentOnOrBefore,
  type BatchWithMeta,
  type InvoiceForBatch,
  type PaymentForBatch,
} from "@/lib/batches";
import type { AccountingBatchStatus } from "@/lib/types";

type StatusTab = AccountingBatchStatus | "all";
type BuildMode = "idle" | "invoice" | "payment" | "mixed" | "smart";

export default function BatchesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [batches, setBatches] = useState<BatchWithMeta[]>([]);
  const [unbatchedInv, setUnbatchedInv] = useState<InvoiceForBatch[]>([]);
  const [unbatchedPay, setUnbatchedPay] = useState<PaymentForBatch[]>([]);
  const [mode, setMode] = useState<BuildMode>("idle");
  const [selInv, setSelInv] = useState<Set<string>>(new Set());
  const [selPay, setSelPay] = useState<Set<string>>(new Set());
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

    if (isSchemaError(b.error) || isSchemaError(inv.error) || isSchemaError(pay.error)) {
      setSchemaMissing(true);
      setError(b.error || inv.error || pay.error);
      setBatches([]);
      setUnbatchedInv([]);
      setUnbatchedPay([]);
      setLoading(false);
      return;
    }

    setSchemaMissing(false);
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

  const filteredBatches = useMemo(() => {
    if (statusTab === "all") return batches;
    return batches.filter((b) => b.status === statusTab);
  }, [batches, statusTab]);

  const openBatches = useMemo(() => batches.filter((b) => b.status === "Open"), [batches]);
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
    () =>
      unbatchedInv
        .filter((i) => selInv.has(i.id))
        .reduce((s, i) => s + Number(i.invoice_total), 0),
    [unbatchedInv, selInv],
  );
  const selectedPayTotal = useMemo(
    () =>
      unbatchedPay
        .filter((p) => selPay.has(p.id))
        .reduce((s, p) => s + Number(p.payment_amount), 0),
    [unbatchedPay, selPay],
  );

  function toggleInv(id: string) {
    setSelInv((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function togglePay(id: string) {
    setSelPay((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function selectAllInv(ids: string[]) {
    setSelInv(new Set(ids));
  }

  function selectAllPay(ids: string[]) {
    setSelPay(new Set(ids));
  }

  function startCreate(m: BuildMode) {
    setMode(m);
    setSelInv(new Set());
    setSelPay(new Set());
    setBatchName("");
    setNotes("");
    setError(null);
    if (m === "invoice") {
      const todays = unbatchedInv.filter((i) => i.invoice_date === batchDate);
      if (todays.length) setSelInv(new Set(todays.map((i) => i.id)));
    }
  }

  async function smartDailyClose() {
    setBusy(true);
    setError(null);
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
        name: `Daily invoice close · ${today}`,
        notes: "Smart daily close",
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
    setMode("idle");
    if (created === 0) {
      setError("Nothing eligible for daily close — all items are already batched or none exist.");
      return;
    }
    await load();
    if (created === 1 && lastId) router.push(`/batches/${lastId}`);
  }

  async function submitCreate() {
    if (selInv.size === 0 && selPay.size === 0) {
      setError("Select at least one invoice or payment.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const res = await createBatch(supabase, {
      batchDate,
      name: batchName || undefined,
      notes: notes || undefined,
      invoiceIds: [...selInv],
      paymentIds: [...selPay],
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
    router.push(`/batches/${res.batch.id}`);
  }

  if (schemaMissing) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Accounting Batches"
          description="Group invoices and payments for review, post, and export"
        />
        <div className="alert alert-warning">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Database tables not found</p>
            <p className="text-sm opacity-80">
              Run <code className="text-xs">supabase/migrations/20260805_accounting_batches.sql</code> in the
              Supabase SQL Editor, then refresh.
            </p>
            {error ? <p className="mt-1 text-xs opacity-60">{error}</p> : null}
          </div>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => load()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="batches-page space-y-5">
      <PageHeader
        title="Accounting Batches"
        description="ServiceTitan-style close: batch invoices & payments → post to lock → export to your GL"
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

      {error && !schemaMissing ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open batches" value={openBatches.length} hint="Editable work queues" />
        <StatCard
          label="Unbatched invoices"
          value={unbatchedInv.length}
          hint={formatMoney(invTotal)}
          danger={unbatchedInv.length > 12}
        />
        <StatCard
          label="Unbatched payments"
          value={unbatchedPay.length}
          hint={formatMoney(payTotal)}
        />
        <StatCard
          label="Ready to post"
          value={openBatches.filter((b) => b.invoice_count + b.payment_count > 0).length}
          hint="Open with transactions"
        />
      </div>

      {/* Lifecycle strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-base-300 bg-base-100 px-4 py-3 text-sm shadow-sm">
        <span className="font-semibold text-primary">Workflow</span>
        <span className="badge badge-outline gap-1">
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
        <span className="ml-auto text-xs opacity-55 hidden sm:inline">
          Post locks the batch. Export marks G/L handoff and downloads CSV.
        </span>
      </div>

      {/* Smart actions */}
      {mode === "idle" ? (
        <section className="grid gap-3 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => startCreate("invoice")}
            className="group rounded-2xl border border-base-300 bg-base-100 p-5 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 text-teal-700">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">Invoice batch</p>
                <p className="text-xs opacity-60">Group finalized invoices for the GL</p>
              </div>
            </div>
            <p className="mt-3 text-sm opacity-70">
              {unbatchedInv.length} available · {formatMoney(invTotal)}
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition group-hover:opacity-100">
              Build batch <Plus className="h-4 w-4" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => startCreate("payment")}
            className="group rounded-2xl border border-base-300 bg-base-100 p-5 text-left shadow-sm transition hover:border-sky-400/40 hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-700">
                <Banknote className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">Payment deposit batch</p>
                <p className="text-xs opacity-60">Group collections by tender type</p>
              </div>
            </div>
            <p className="mt-3 text-sm opacity-70">
              {unbatchedPay.length} available · {formatMoney(payTotal)}
            </p>
            {payByMethod.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {payByMethod.slice(0, 4).map((g) => (
                  <span key={g.method} className="badge badge-ghost badge-sm">
                    {g.method} ({g.count})
                  </span>
                ))}
              </div>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => void smartDailyClose()}
            disabled={busy || (unbatchedInv.length === 0 && unbatchedPay.length === 0)}
            className="group rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-base-100 p-5 text-left shadow-sm transition hover:border-amber-500/50 hover:shadow-md disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-800">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">Smart daily close</p>
                <p className="text-xs opacity-60">One invoice batch + deposits per payment method</p>
              </div>
            </div>
            <p className="mt-3 text-sm opacity-70">
              Through {batchDate} · creates multiple open batches ready to review
            </p>
          </button>
        </section>
      ) : null}

      {/* Builder */}
      {mode !== "idle" && mode !== "smart" ? (
        <section className="rounded-2xl border border-primary/25 bg-base-100 p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold">
                {mode === "invoice"
                  ? "Build invoice batch"
                  : mode === "payment"
                    ? "Build payment batch"
                    : "Build mixed batch"}
              </h2>
              <p className="text-sm opacity-60">Select transactions, then create an open batch for review.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="form-control">
              <span className="label-text text-xs">Batch date</span>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={batchDate}
                onChange={(e) => setBatchDate(e.target.value)}
              />
            </label>
            <label className="form-control sm:col-span-2">
              <span className="label-text text-xs">Name (optional)</span>
              <input
                className="input input-bordered input-sm"
                placeholder="Auto-named if blank"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
              />
            </label>
          </div>
          <label className="form-control mt-2">
            <span className="label-text text-xs">Notes</span>
            <input
              className="input input-bordered input-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. end of day deposit"
            />
          </label>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {(mode === "invoice" || mode === "mixed") && (
              <div className="rounded-xl border border-base-300">
                <div className="flex items-center justify-between border-b border-base-200 px-3 py-2">
                  <p className="text-sm font-semibold">
                    Invoices{" "}
                    <span className="font-normal opacity-50">
                      ({selInv.size} selected · {formatMoney(selectedInvTotal)})
                    </span>
                  </p>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => selectAllInv(unbatchedInv.map((i) => i.id))}
                    >
                      All
                    </button>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSelInv(new Set())}>
                      None
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {unbatchedInv.length === 0 ? (
                    <p className="p-4 text-sm opacity-50">No unbatched invoices.</p>
                  ) : (
                    <table className="table table-sm">
                      <tbody>
                        {unbatchedInv.map((inv) => {
                          const on = selInv.has(inv.id);
                          return (
                            <tr
                              key={inv.id}
                              className={`cursor-pointer ${on ? "bg-primary/10" : "hover:bg-base-200/60"}`}
                              onClick={() => toggleInv(inv.id)}
                            >
                              <td className="w-8">
                                {on ? (
                                  <CheckSquare className="h-4 w-4 text-primary" />
                                ) : (
                                  <Square className="h-4 w-4 opacity-30" />
                                )}
                              </td>
                              <td>
                                <span className="font-medium">{inv.invoice_number}</span>
                                <span className="mt-0.5 block text-xs opacity-55">
                                  {inv.customers?.name} · {inv.invoice_date}
                                </span>
                              </td>
                              <td>
                                <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                              </td>
                              <td className="text-right tabular-nums font-medium">
                                {formatMoney(inv.invoice_total)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {(mode === "payment" || mode === "mixed") && (
              <div className="rounded-xl border border-base-300">
                <div className="flex items-center justify-between border-b border-base-200 px-3 py-2">
                  <p className="text-sm font-semibold">
                    Payments{" "}
                    <span className="font-normal opacity-50">
                      ({selPay.size} selected · {formatMoney(selectedPayTotal)})
                    </span>
                  </p>
                  <div className="flex gap-1">
                    {payByMethod.map((g) => (
                      <button
                        key={g.method}
                        type="button"
                        className="btn btn-ghost btn-xs"
                        title={`Select all ${g.method}`}
                        onClick={() => selectAllPay(g.rows.map((r) => r.id))}
                      >
                        {g.method}
                      </button>
                    ))}
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSelPay(new Set())}>
                      None
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {unbatchedPay.length === 0 ? (
                    <p className="p-4 text-sm opacity-50">No unbatched payments.</p>
                  ) : (
                    <table className="table table-sm">
                      <tbody>
                        {unbatchedPay.map((p) => {
                          const on = selPay.has(p.id);
                          return (
                            <tr
                              key={p.id}
                              className={`cursor-pointer ${on ? "bg-sky-500/10" : "hover:bg-base-200/60"}`}
                              onClick={() => togglePay(p.id)}
                            >
                              <td className="w-8">
                                {on ? (
                                  <CheckSquare className="h-4 w-4 text-sky-600" />
                                ) : (
                                  <Square className="h-4 w-4 opacity-30" />
                                )}
                              </td>
                              <td>
                                <span className="font-medium">{p.payment_number}</span>
                                <span className="mt-0.5 block text-xs opacity-55">
                                  {p.customers?.name} · {p.payment_date} · {p.payment_method}
                                </span>
                              </td>
                              <td className="text-xs opacity-60">{p.invoices?.invoice_number ?? "—"}</td>
                              <td className="text-right tabular-nums font-medium">
                                {formatMoney(p.payment_amount)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>

          {mode === "invoice" || mode === "payment" ? (
            <button
              type="button"
              className="btn btn-ghost btn-xs mt-3"
              onClick={() => setMode("mixed")}
            >
              + Include both invoices and payments (mixed batch)
            </button>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-base-200 pt-4">
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{formatMoney(selectedInvTotal + selectedPayTotal)}</span>
              <span className="opacity-60">
                {" "}
                · {selInv.size} invoice{selInv.size === 1 ? "" : "s"} · {selPay.size} payment
                {selPay.size === 1 ? "" : "s"}
              </span>
            </p>
            <button
              type="button"
              className="btn btn-primary gap-1"
              disabled={busy || (selInv.size === 0 && selPay.size === 0)}
              onClick={() => void submitCreate()}
            >
              <Plus className="h-4 w-4" /> Create open batch
            </button>
          </div>
        </section>
      ) : null}

      {/* Existing batches */}
      <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 px-4 py-3">
          <h2 className="font-bold">Batches</h2>
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
          </div>
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm opacity-50">Loading batches…</p>
        ) : filteredBatches.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={batches.length === 0 ? "No batches yet" : `No ${statusTab === "all" ? "" : statusTab + " "}batches`}
              description={
                batches.length === 0
                  ? "Create an invoice batch, payment deposit, or run smart daily close."
                  : "Try another status filter, or create a new batch."
              }
              action={
                batches.length === 0 ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => startCreate("invoice")}>
                    Start first batch
                  </button>
                ) : (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setStatusTab("all")}>
                    Show all
                  </button>
                )
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
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
                {filteredBatches.map((b) => (
                  <tr key={b.id} className="hover">
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
                      <span className="mt-0.5 block text-[10px] opacity-45 max-w-[9rem]">
                        {BATCH_STATUS_HINT[b.status]}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">
                      {b.invoice_count}
                      {b.invoice_count > 0 ? (
                        <span className="mt-0.5 block text-xs opacity-50">{formatMoney(b.invoice_total)}</span>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">
                      {b.payment_count}
                      {b.payment_count > 0 ? (
                        <span className="mt-0.5 block text-xs opacity-50">{formatMoney(b.payment_total)}</span>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
