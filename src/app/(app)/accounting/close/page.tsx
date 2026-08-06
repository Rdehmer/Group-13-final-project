"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, Lock, RefreshCw, Scale, Unlock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatCard, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import { buildCloseChecklist, monthEndPackCsv } from "@/lib/accounting/close";
import {
  ensurePeriod,
  listJournals,
  listJournalLines,
  setPeriodStatus,
  trialBalance,
  getPeriod,
} from "@/lib/accounting/ledger-local";
import {
  postAllowance,
  postApBill,
  postDeferredRecognition,
  postDepositClearing,
  postPayrollAccrual,
  postTaxRemittance,
} from "@/lib/accounting/postings";
import { createCreditMemo } from "@/lib/accounting/credit-memos";
import { seedPrepaidContractPrices } from "@/lib/accounting/seed-prepaid";
import { contractAssetRollforward } from "@/lib/accounting/earned-revenue";
import { CHART_OF_ACCOUNTS } from "@/lib/accounting/coa";
import {
  arAgingSummary,
  deferredRevenueSchedule,
  openInvoicesAt,
  type InvoiceWithCustomer,
} from "@/lib/reports";
import type { Payment, ServiceContract, WorkOrder } from "@/lib/types";

type ContractRow = ServiceContract & { customers?: { name: string } };

export default function AccountingClosePage() {
  const supabase = createClient();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceWithCustomer[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [jobs, setJobs] = useState<WorkOrder[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [tick, setTick] = useState(0);

  // Forms
  const [taxAmount, setTaxAmount] = useState("");
  const [taxRef, setTaxRef] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState("Check");
  const [payrollAmount, setPayrollAmount] = useState("");
  const [apVendor, setApVendor] = useState("");
  const [apAmount, setApAmount] = useState("");
  const [cmCustomerId, setCmCustomerId] = useState("");
  const [cmAmount, setCmAmount] = useState("");
  const [cmReason, setCmReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    setUserId(auth.user?.id ?? null);
    const [inv, pay, sc, wo, cust] = await Promise.all([
      supabase.from("invoices").select("*, customers(name)").order("invoice_date", { ascending: false }),
      supabase.from("payments").select("*").order("payment_date", { ascending: false }),
      supabase.from("service_contracts").select("*, customers(name)"),
      supabase.from("work_orders").select("*"),
      supabase.from("customers").select("id, name").order("name"),
    ]);
    if (inv.error) setError(inv.error.message);
    setInvoices((inv.data as InvoiceWithCustomer[]) ?? []);
    setPayments((pay.data as Payment[]) ?? []);
    setContracts((sc.data as ContractRow[]) ?? []);
    setJobs((wo.data as WorkOrder[]) ?? []);
    setCustomers((cust.data as { id: string; name: string }[]) ?? []);
    ensurePeriod(period);
    setLoading(false);
    setTick((t) => t + 1);
  }, [supabase, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodEnd = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${period}-${String(last).padStart(2, "0")}`;
  }, [period]);

  const checklist = useMemo(() => {
    void tick;
    return buildCloseChecklist({
      period,
      invoices,
      payments,
      contracts,
      jobs,
      parts: [],
      partsUsed: [],
      labor: [],
    });
  }, [period, invoices, payments, contracts, jobs, tick]);

  const tb = useMemo(() => {
    void tick;
    return trialBalance(asOf);
  }, [asOf, tick]);

  const journals = useMemo(() => {
    void tick;
    return listJournals().slice(0, 40);
  }, [tick]);

  const deferred = useMemo(() => deferredRevenueSchedule(contracts, periodEnd), [contracts, periodEnd]);
  const asset = useMemo(() => contractAssetRollforward(jobs, invoices, periodEnd), [jobs, invoices, periodEnd]);
  const aging = useMemo(
    () => arAgingSummary(openInvoicesAt(invoices, new Date(periodEnd + "T12:00:00"))),
    [invoices, periodEnd],
  );
  const periodRow = useMemo(() => {
    void tick;
    return getPeriod(period);
  }, [period, tick]);

  async function run(action: () => Promise<void> | void) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
    setBusy(false);
  }

  function downloadPack() {
    const csv = monthEndPackCsv({ period, invoices, payments, contracts, jobs });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `month-end-pack-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const passCount = checklist.filter((c) => c.status === "pass").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Period Close"
        description="ASC 606 close checklist, journals, trial balance, and month-end pack"
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="form-control">
          <span className="label-text text-xs">Period</span>
          <input
            type="month"
            className="input input-bordered input-sm"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">As of (TB)</span>
          <input
            type="date"
            className="input input-bordered input-sm"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-outline btn-sm gap-1" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
        <button type="button" className="btn btn-outline btn-sm gap-1" onClick={downloadPack}>
          <Download className="h-4 w-4" />
          Month-end pack CSV
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await seedPrepaidContractPrices(supabase);
              if (!r.ok) throw new Error(r.error);
              setMessage(
                r.updated
                  ? `Seeded ${r.updated} prepaid contract(s) at $14,400 Annual Fixed Fee.`
                  : "No contracts needed seeding.",
              );
              await load();
            })
          }
        >
          Seed prepaid demo
        </button>
        <Link href="/reports" className="btn btn-ghost btn-sm">
          Reports
        </Link>
        <Link href="/batches" className="btn btn-ghost btn-sm">
          Batches
        </Link>
      </div>

      {(error || message) && (
        <div className={`alert text-sm ${error ? "alert-error" : "alert-success"}`}>
          {error ?? message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Close checklist"
          value={`${passCount}/${checklist.length}`}
          hint="Items passing"
          scrollTarget="close-checklist"
        />
        <StatCard
          label="Deferred liability"
          value={formatMoney(deferred.totalDeferred)}
          hint="Prepaid unearned"
          scrollTarget="close-deferred"
        />
        <StatCard
          label="Contract asset"
          value={formatMoney(asset.ending)}
          hint="Unbilled completions"
          scrollTarget="close-contract-asset"
        />
        <StatCard
          label="Period status"
          value={periodRow?.status ?? "Open"}
          hint={periodRow?.closed_at ? `Closed ${periodRow.closed_at.slice(0, 10)}` : "Editable"}
          scrollTarget="close-checklist"
        />
      </div>

      <section
        id="close-checklist"
        className="scroll-mt-4 rounded-box bg-base-100 p-4 shadow"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Close checklist — {period}</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              disabled={busy}
              onClick={() =>
                void run(() => {
                  const r = setPeriodStatus(period, "Soft Closed", userId);
                  if (!r.ok) throw new Error(r.error);
                  setMessage(`Period ${period} soft-closed.`);
                })
              }
            >
              Soft close
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              disabled={busy}
              onClick={() =>
                void run(() => {
                  const fails = checklist.filter((c) => c.status === "fail" && c.id !== "lock");
                  if (fails.length) {
                    throw new Error(`Resolve failing items first: ${fails.map((f) => f.label).join("; ")}`);
                  }
                  const r = setPeriodStatus(period, "Closed", userId);
                  if (!r.ok) throw new Error(r.error);
                  setMessage(`Period ${period} locked.`);
                })
              }
            >
              <Lock className="h-4 w-4" />
              Lock period
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-1"
              disabled={busy}
              onClick={() =>
                void run(() => {
                  const r = setPeriodStatus(period, "Open", userId);
                  if (!r.ok) throw new Error(r.error);
                  setMessage(`Period ${period} re-opened.`);
                })
              }
            >
              <Unlock className="h-4 w-4" />
              Re-open
            </button>
          </div>
        </div>
        <ul className="space-y-2">
          {checklist.map((item) => (
            <li
              key={item.id}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                item.status === "pass"
                  ? "border-success/30 bg-success/5"
                  : item.status === "warn"
                    ? "border-warning/40 bg-warning/5"
                    : "border-error/40 bg-error/5"
              }`}
            >
              <CheckCircle2
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  item.status === "pass" ? "text-success" : item.status === "warn" ? "text-warning" : "text-error"
                }`}
              />
              <div>
                <p className="font-medium">{item.label}</p>
                <p className="opacity-70">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section id="close-deferred" className="scroll-mt-4 space-y-3 rounded-box bg-base-100 p-4 shadow">
          <h2 className="text-base font-semibold">Post month-end journals</h2>

          <div className="rounded-lg border border-base-300 p-3">
            <p className="text-sm font-medium">Deferred revenue recognition</p>
            <p className="mb-2 text-xs opacity-70">
              Scheduled for {period}:{" "}
              {formatMoney(
                deferred.rows.reduce((s, r) => {
                  const m = r.schedule.find((x) => x.month === period);
                  return s + (m?.recognized ?? 0);
                }, 0),
              )}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() =>
                void run(() => {
                  const r = postDeferredRecognition({ period, contracts, userId });
                  if (!r.ok) throw new Error(r.error);
                  setMessage(`Posted ${r.journal.entry_number} for ${formatMoney(r.amount)}.`);
                })
              }
            >
              Post deferred recognition
            </button>
          </div>

          <div className="rounded-lg border border-base-300 p-3">
            <p className="text-sm font-medium">CECL allowance</p>
            <p className="mb-2 text-xs opacity-70">Target estimate {formatMoney(aging.allowance)}</p>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={busy}
              onClick={() =>
                void run(() => {
                  const r = postAllowance({
                    targetAllowance: aging.allowance,
                    currentAllowanceBalance: 0,
                    asOf: periodEnd,
                    userId,
                  });
                  if (!r.ok) throw new Error(r.error);
                  setMessage(`Posted ${r.journal.entry_number}.`);
                })
              }
            >
              Post allowance adjustment
            </button>
          </div>

          <div className="rounded-lg border border-base-300 p-3 space-y-2">
            <p className="text-sm font-medium">Sales tax remittance</p>
            <div className="flex flex-wrap gap-2">
              <input
                className="input input-bordered input-sm w-28"
                placeholder="Amount"
                value={taxAmount}
                onChange={(e) => setTaxAmount(e.target.value)}
              />
              <input
                className="input input-bordered input-sm flex-1"
                placeholder="Filing reference"
                value={taxRef}
                onChange={(e) => setTaxRef(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(() => {
                    const r = postTaxRemittance({
                      amount: Number(taxAmount),
                      remittanceDate: periodEnd,
                      reference: taxRef,
                      userId,
                    });
                    if (!r.ok) throw new Error(r.error);
                    setMessage(`Posted ${r.journal.entry_number}.`);
                    setTaxAmount("");
                  })
                }
              >
                Remit tax
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-base-300 p-3 space-y-2">
            <p className="text-sm font-medium">Bank deposit (clear undeposited funds)</p>
            <div className="flex flex-wrap gap-2">
              <input
                className="input input-bordered input-sm w-28"
                placeholder="Amount"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
              />
              <input
                className="input input-bordered input-sm w-32"
                value={depositMethod}
                onChange={(e) => setDepositMethod(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(() => {
                    const r = postDepositClearing({
                      amount: Number(depositAmount),
                      depositDate: periodEnd,
                      method: depositMethod,
                      userId,
                    });
                    if (!r.ok) throw new Error(r.error);
                    setMessage(`Posted ${r.journal.entry_number}.`);
                    setDepositAmount("");
                  })
                }
              >
                Post deposit
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-base-300 p-3 space-y-2">
            <p className="text-sm font-medium">Payroll accrual</p>
            <div className="flex flex-wrap gap-2">
              <input
                className="input input-bordered input-sm w-28"
                placeholder="Amount"
                value={payrollAmount}
                onChange={(e) => setPayrollAmount(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(() => {
                    const r = postPayrollAccrual({ amount: Number(payrollAmount), asOf: periodEnd, userId });
                    if (!r.ok) throw new Error(r.error);
                    setMessage(`Posted ${r.journal.entry_number}.`);
                    setPayrollAmount("");
                  })
                }
              >
                Accrue wages
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-base-300 p-3 space-y-2">
            <p className="text-sm font-medium">Vendor AP bill</p>
            <div className="flex flex-wrap gap-2">
              <input
                className="input input-bordered input-sm flex-1"
                placeholder="Vendor"
                value={apVendor}
                onChange={(e) => setApVendor(e.target.value)}
              />
              <input
                className="input input-bordered input-sm w-28"
                placeholder="Amount"
                value={apAmount}
                onChange={(e) => setApAmount(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(() => {
                    const r = postApBill({
                      vendor: apVendor || "Vendor",
                      amount: Number(apAmount),
                      asOf: periodEnd,
                      billId: `ap-${Date.now()}`,
                      userId,
                    });
                    if (!r.ok) throw new Error(r.error);
                    setMessage(`Posted ${r.journal.entry_number}.`);
                    setApAmount("");
                  })
                }
              >
                Post AP bill
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-base-300 p-3 space-y-2">
            <p className="text-sm font-medium">Credit memo</p>
            <div className="flex flex-wrap gap-2">
              <select
                className="select select-bordered select-sm flex-1"
                value={cmCustomerId}
                onChange={(e) => setCmCustomerId(e.target.value)}
              >
                <option value="">Customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className="input input-bordered input-sm w-28"
                placeholder="Amount"
                value={cmAmount}
                onChange={(e) => setCmAmount(e.target.value)}
              />
            </div>
            <input
              className="input input-bordered input-sm w-full"
              placeholder="Reason"
              value={cmReason}
              onChange={(e) => setCmReason(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={busy || !cmCustomerId}
              onClick={() =>
                void run(async () => {
                  const r = await createCreditMemo(supabase, {
                    customerId: cmCustomerId,
                    amount: Number(cmAmount),
                    reason: cmReason,
                    userId,
                    asOf: periodEnd,
                  });
                  if (!r.ok) throw new Error(r.error);
                  setMessage(`Credit memo ${r.number} created.`);
                  setCmAmount("");
                  setCmReason("");
                  await load();
                })
              }
            >
              Create credit memo
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-box bg-base-100 p-4 shadow">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4" />
            <h2 className="text-base font-semibold">Trial balance as of {asOf}</h2>
          </div>
          {tb.rows.length === 0 ? (
            <EmptyState
              title="No posted journals yet"
              description="Post batches and month-end entries to build the trial balance."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Acct</th>
                    <th>Name</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {tb.rows.map((r) => (
                    <tr key={r.accountCode}>
                      <td className="font-mono text-xs">{r.accountCode}</td>
                      <td>{r.accountName}</td>
                      <td className="text-right tabular-nums">{r.debit ? formatMoney(r.debit) : ""}</td>
                      <td className="text-right tabular-nums">{r.credit ? formatMoney(r.credit) : ""}</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td colSpan={2}>Total {tb.balanced ? "✓" : "⚠ out of balance"}</td>
                    <td className="text-right tabular-nums">{formatMoney(tb.totalDebit)}</td>
                    <td className="text-right tabular-nums">{formatMoney(tb.totalCredit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <h3 id="close-contract-asset" className="scroll-mt-4 pt-2 text-sm font-semibold">
            Contract asset rollforward
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Beginning</div>
            <div className="text-right tabular-nums">{formatMoney(asset.beginning)}</div>
            <div>+ Earned unbilled</div>
            <div className="text-right tabular-nums">{formatMoney(asset.earnedUnbilled)}</div>
            <div>− Billed</div>
            <div className="text-right tabular-nums">{formatMoney(asset.billed)}</div>
            <div className="font-semibold">Ending</div>
            <div className="text-right font-semibold tabular-nums">{formatMoney(asset.ending)}</div>
          </div>

          <h3 className="pt-2 text-sm font-semibold">Recent journals</h3>
          {journals.length === 0 ? (
            <p className="text-sm opacity-60">No journals posted.</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-auto text-sm">
              {journals.map((j) => {
                const lines = listJournalLines(j.id);
                return (
                  <li key={j.id} className="rounded-lg bg-base-200/60 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs">{j.entry_number}</span>
                      <StatusBadge label={j.status} tone={statusTone(j.status)} />
                    </div>
                    <p className="opacity-80">{j.memo}</p>
                    <p className="text-xs opacity-60">
                      {j.entry_date} · {j.source} · {lines.length} lines
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          <details className="text-xs opacity-70">
            <summary className="cursor-pointer font-medium">Chart of accounts ({CHART_OF_ACCOUNTS.length})</summary>
            <ul className="mt-2 columns-1 gap-2 sm:columns-2">
              {CHART_OF_ACCOUNTS.map((a) => (
                <li key={a.code}>
                  <span className="font-mono">{a.code}</span> {a.name}
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>
    </div>
  );
}
