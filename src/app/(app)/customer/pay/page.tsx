"use client";

/**
 * Customer bill-pay portal (QuickBooks Online–style):
 * account balance, select invoices, pay by card/ACH (simulated), history & receipt.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CreditCard,
  Building2,
  CheckCircle2,
  FileText,
  Lock,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import { daysPastDue } from "@/lib/billing";
import {
  applyInvoicePayment,
  formatPaymentMethodLabel,
  type PayMethodKind,
} from "@/lib/payments";
import type { Invoice, Payment, Profile } from "@/lib/types";

type OpenInvoice = Invoice & {
  work_orders?: { work_order_number: string } | null;
};

type Receipt = {
  paymentNumbers: string[];
  totalPaid: number;
  method: string;
  paidAt: string;
  invoiceLabels: string[];
};

export default function CustomerPayPortalPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const preselectInvoice = searchParams.get("invoice");

  const [profile, setProfile] = useState<Profile | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [history, setHistory] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Receipt | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [partialMode, setPartialMode] = useState(false);
  const [customAmount, setCustomAmount] = useState("");

  const [method, setMethod] = useState<PayMethodKind>("card");
  // Simulated card / bank fields (never sent to a processor)
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [bankName, setBankName] = useState("");
  const [routing, setRouting] = useState("");
  const [account, setAccount] = useState("");
  const [memo, setMemo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    setProfile(p as Profile);
    if (!p?.customer_id) {
      setLoading(false);
      return;
    }

    const [{ data: inv }, { data: pay }, { data: cust }] = await Promise.all([
      supabase
        .from("invoices")
        .select("*, work_orders(work_order_number)")
        .eq("customer_id", p.customer_id)
        .gt("remaining_balance", 0)
        .not("status", "eq", "Canceled")
        .order("due_date", { ascending: true }),
      supabase
        .from("payments")
        .select("*")
        .eq("customer_id", p.customer_id)
        .order("payment_date", { ascending: false })
        .limit(50),
      supabase.from("customers").select("name").eq("id", p.customer_id).maybeSingle(),
    ]);

    const open = (inv as OpenInvoice[]) ?? [];
    setInvoices(open);
    setHistory((pay as Payment[]) ?? []);
    setCustomerName(cust?.name ?? p.full_name ?? "Account");

    setSelected((prev) => {
      if (preselectInvoice && open.some((i) => i.id === preselectInvoice)) {
        return new Set([preselectInvoice]);
      }
      if (prev.size === 0 && open.length) {
        return new Set(open.map((i) => i.id));
      }
      const still = new Set([...prev].filter((id) => open.some((i) => i.id === id)));
      return still.size ? still : new Set(open.map((i) => i.id));
    });

    setLoading(false);
  }, [supabase, preselectInvoice]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = useMemo(() => new Date(), []);

  const totalDue = useMemo(
    () => invoices.reduce((s, i) => s + Number(i.remaining_balance), 0),
    [invoices],
  );
  const overdueDue = useMemo(
    () =>
      invoices
        .filter((i) => daysPastDue(i, today) > 0)
        .reduce((s, i) => s + Number(i.remaining_balance), 0),
    [invoices, today],
  );

  const selectedInvoices = useMemo(
    () => invoices.filter((i) => selected.has(i.id)),
    [invoices, selected],
  );

  const selectedTotal = useMemo(
    () => selectedInvoices.reduce((s, i) => s + Number(i.remaining_balance), 0),
    [selectedInvoices],
  );

  const payAmount = useMemo(() => {
    if (partialMode && selectedInvoices.length === 1) {
      const n = Number(customAmount);
      return Number.isFinite(n) ? n : 0;
    }
    return selectedTotal;
  }, [partialMode, selectedInvoices.length, customAmount, selectedTotal]);

  function toggleInvoice(id: string) {
    setSuccess(null);
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function selectAll() {
    setSelected(new Set(invoices.map((i) => i.id)));
    setPartialMode(false);
  }

  function selectNone() {
    setSelected(new Set());
  }

  function digitsOnly(s: string) {
    return s.replace(/\D/g, "");
  }

  function formatCardInput(raw: string) {
    const d = digitsOnly(raw).slice(0, 16);
    return d.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
  }

  function formatExp(raw: string) {
    const d = digitsOnly(raw).slice(0, 4);
    if (d.length <= 2) return d;
    return `${d.slice(0, 2)}/${d.slice(2)}`;
  }

  function validatePayInstrument(): string | null {
    if (method === "card") {
      if (!cardName.trim()) return "Enter the name on the card.";
      const num = digitsOnly(cardNumber);
      if (num.length < 13) return "Enter a valid card number.";
      if (digitsOnly(cardExp).length < 4) return "Enter card expiration (MM/YY).";
      if (digitsOnly(cardCvv).length < 3) return "Enter the CVV.";
    }
    if (method === "bank") {
      if (!bankName.trim()) return "Enter your bank name.";
      if (digitsOnly(routing).length !== 9) return "Routing number must be 9 digits.";
      if (digitsOnly(account).length < 4) return "Enter your account number.";
    }
    return null;
  }

  async function submitPayment() {
    setError(null);
    setSuccess(null);
    if (!profile?.customer_id || selectedInvoices.length === 0) {
      setError("Select at least one invoice to pay.");
      return;
    }
    if (payAmount <= 0) {
      setError("Payment amount must be greater than zero.");
      return;
    }
    if (partialMode && selectedInvoices.length !== 1) {
      setError("Partial payment applies to one invoice at a time.");
      return;
    }
    const instrumentErr = validatePayInstrument();
    if (instrumentErr) {
      setError(instrumentErr);
      return;
    }

    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const last4 =
      method === "card"
        ? digitsOnly(cardNumber).slice(-4)
        : method === "bank"
          ? digitsOnly(account).slice(-4)
          : undefined;
    const methodLabel = formatPaymentMethodLabel(method, last4);
    const ref =
      method === "card"
        ? `SIM-CARD-${last4}`
        : method === "bank"
          ? `SIM-ACH-${last4}`
          : memo.trim() || null;

    const paymentNumbers: string[] = [];
    const invoiceLabels: string[] = [];
    let remainingToApply = payAmount;
    let totalPaid = 0;

    // Apply full balances in due-date order, residual goes to last selected in partial mode
    const ordered = [...selectedInvoices].sort((a, b) => a.due_date.localeCompare(b.due_date));

    for (let i = 0; i < ordered.length; i++) {
      const inv = ordered[i];
      const invBal = Number(inv.remaining_balance);
      let applyAmt: number;
      if (partialMode && ordered.length === 1) {
        applyAmt = Math.min(payAmount, invBal);
      } else if (i === ordered.length - 1) {
        applyAmt = Math.min(remainingToApply, invBal);
      } else {
        applyAmt = Math.min(remainingToApply, invBal);
      }
      if (applyAmt <= 0.005) continue;

      const result = await applyInvoicePayment(supabase, {
        invoiceId: inv.id,
        customerId: profile.customer_id,
        invoiceTotal: Number(inv.invoice_total),
        amountPaidSoFar: Number(inv.amount_paid),
        remaining: invBal,
        amount: Math.round(applyAmt * 100) / 100,
        paymentMethod: methodLabel,
        referenceNumber: ref,
        notes: memo.trim() || `Customer portal · ${customerName}`,
        userId: user?.id ?? null,
      });

      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        await load();
        return;
      }

      paymentNumbers.push(result.paymentNumber);
      invoiceLabels.push(inv.invoice_number);
      totalPaid += applyAmt;
      remainingToApply -= applyAmt;
      await logActivity(supabase, {
        userId: user?.id ?? null,
        action: "customer_portal_payment",
        recordType: "payment",
        recordId: inv.id,
        newValue: result.paymentNumber,
      });
    }

    setSuccess({
      paymentNumbers,
      totalPaid,
      method: methodLabel,
      paidAt: new Date().toISOString(),
      invoiceLabels,
    });
    setCardNumber("");
    setCardCvv("");
    setCardExp("");
    setAccount("");
    setRouting("");
    setMemo("");
    setCustomAmount("");
    setPartialMode(false);
    await load();
    setBusy(false);
  }

  if (loading || !profile) {
    return <div className="p-8 text-center text-sm opacity-60">Loading payment portal…</div>;
  }

  if (!profile.customer_id) {
    return (
      <EmptyState
        title="No customer account linked"
        description="Contact Ridley Equipment Services to link your portal account."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pay bills"
        description={`${customerName} · Secure online payments for Ridley Equipment Services`}
        actions={
          <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => void load()} disabled={loading || busy}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {/* Trust strip — QBO-style */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-700/20 bg-emerald-700 px-4 py-3 text-emerald-50 shadow-sm">
        <Lock className="h-4 w-4 shrink-0 opacity-90" />
        <p className="text-sm font-medium">
          Secure payment portal · Simulated checkout (demo — no live card processing)
        </p>
        <span className="ml-auto text-xs opacity-80">Ridley Equipment Services</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Balance due" value={formatMoney(totalDue)} danger={totalDue > 0} />
        <StatCard
          label="Past due"
          value={formatMoney(overdueDue)}
          hint={overdueDue > 0 ? "Include these first" : "Nothing overdue"}
          danger={overdueDue > 0}
        />
        <StatCard label="Open invoices" value={invoices.length} hint="Select which to pay" />
      </div>

      {error ? (
        <div className="alert alert-error text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {success ? (
        <div className="rounded-2xl border border-emerald-600/30 bg-emerald-50 p-5 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-50">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
            <div className="space-y-1">
              <p className="text-lg font-bold">Payment received</p>
              <p className="text-sm opacity-80">
                {formatMoney(success.totalPaid)} via {success.method}
              </p>
              <p className="text-xs opacity-60">
                Confirmation {success.paymentNumbers.join(", ")} ·{" "}
                {new Date(success.paidAt).toLocaleString()}
              </p>
              <p className="text-sm">
                Applied to: <strong>{success.invoiceLabels.join(", ")}</strong>
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Invoice statement */}
        <section className="lg:col-span-3 rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 px-4 py-3">
            <div>
              <h2 className="font-bold flex items-center gap-2">
                <FileText className="h-4 w-4" /> Open invoices
              </h2>
              <p className="text-xs opacity-55">Select invoices to include in this payment</p>
            </div>
            <div className="flex gap-1">
              <button type="button" className="btn btn-ghost btn-xs" onClick={selectAll} disabled={!invoices.length}>
                Select all
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={selectNone} disabled={!invoices.length}>
                Clear
              </button>
            </div>
          </div>

          {invoices.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="You're all paid up"
                description="No open balances. Thank you!"
                action={
                  <Link href="/customer/order-history" className="btn btn-outline btn-sm">
                    View service history
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-10" />
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Due</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const on = selected.has(inv.id);
                    const late = daysPastDue(inv, today) > 0;
                    return (
                      <tr
                        key={inv.id}
                        className={`cursor-pointer ${on ? "bg-emerald-500/10" : "hover:bg-base-200/50"} ${late ? "text-error" : ""}`}
                        onClick={() => toggleInvoice(inv.id)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm checkbox-success"
                            checked={on}
                            onChange={() => toggleInvoice(inv.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="font-semibold">
                          {inv.invoice_number}
                          {inv.work_orders?.work_order_number ? (
                            <span className="mt-0.5 block text-[11px] font-normal opacity-50">
                              Job {inv.work_orders.work_order_number}
                            </span>
                          ) : null}
                        </td>
                        <td className="tabular-nums text-sm">{inv.invoice_date}</td>
                        <td className="tabular-nums text-sm">
                          {inv.due_date}
                          {late ? (
                            <span className="mt-0.5 block text-[10px] font-medium">Past due</span>
                          ) : null}
                        </td>
                        <td className="text-right tabular-nums text-sm">{formatMoney(inv.invoice_total)}</td>
                        <td className="text-right font-semibold tabular-nums">
                          {formatMoney(inv.remaining_balance)}
                        </td>
                        <td>
                          <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={5}>Selected balance</td>
                    <td className="text-right tabular-nums">{formatMoney(selectedTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Checkout panel */}
        <section className="lg:col-span-2 rounded-2xl border border-base-300 bg-base-100 shadow-sm lg:sticky lg:top-20 lg:self-start">
          <div className="border-b border-base-200 bg-base-200/40 px-4 py-3">
            <h2 className="font-bold">Make a payment</h2>
            <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
              {formatMoney(payAmount)}
            </p>
            <p className="text-xs opacity-55">
              {selectedInvoices.length} invoice{selectedInvoices.length === 1 ? "" : "s"} selected
            </p>
          </div>

          <div className="space-y-4 p-4">
            {selectedInvoices.length === 1 ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={partialMode}
                  onChange={(e) => {
                    setPartialMode(e.target.checked);
                    if (e.target.checked) {
                      setCustomAmount(String(Number(selectedInvoices[0].remaining_balance).toFixed(2)));
                    }
                  }}
                />
                Pay a different amount
              </label>
            ) : null}

            {partialMode && selectedInvoices.length === 1 ? (
              <label className="form-control">
                <span className="label-text text-xs">Amount to pay</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={Number(selectedInvoices[0].remaining_balance)}
                  className="input input-bordered input-sm"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
              </label>
            ) : null}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                Payment method
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`btn btn-sm gap-1 ${method === "card" ? "btn-success" : "btn-outline"}`}
                  onClick={() => setMethod("card")}
                >
                  <CreditCard className="h-4 w-4" /> Card
                </button>
                <button
                  type="button"
                  className={`btn btn-sm gap-1 ${method === "bank" ? "btn-success" : "btn-outline"}`}
                  onClick={() => setMethod("bank")}
                >
                  <Building2 className="h-4 w-4" /> Bank
                </button>
              </div>
            </div>

            {method === "card" ? (
              <div className="space-y-2">
                <label className="form-control">
                  <span className="label-text text-xs">Name on card</span>
                  <input
                    className="input input-bordered input-sm"
                    autoComplete="cc-name"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    placeholder="As printed on card"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs">Card number</span>
                  <input
                    className="input input-bordered input-sm font-mono"
                    autoComplete="cc-number"
                    inputMode="numeric"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardInput(e.target.value))}
                    placeholder="4242 4242 4242 4242"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="form-control">
                    <span className="label-text text-xs">Expires</span>
                    <input
                      className="input input-bordered input-sm font-mono"
                      autoComplete="cc-exp"
                      inputMode="numeric"
                      value={cardExp}
                      onChange={(e) => setCardExp(formatExp(e.target.value))}
                      placeholder="MM/YY"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text text-xs">CVV</span>
                    <input
                      className="input input-bordered input-sm font-mono"
                      autoComplete="cc-csc"
                      inputMode="numeric"
                      value={cardCvv}
                      onChange={(e) => setCardCvv(digitsOnly(e.target.value).slice(0, 4))}
                      placeholder="123"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="form-control">
                  <span className="label-text text-xs">Bank name</span>
                  <input
                    className="input input-bordered input-sm"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Your bank"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs">Routing number</span>
                  <input
                    className="input input-bordered input-sm font-mono"
                    inputMode="numeric"
                    value={routing}
                    onChange={(e) => setRouting(digitsOnly(e.target.value).slice(0, 9))}
                    placeholder="9 digits"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs">Account number</span>
                  <input
                    className="input input-bordered input-sm font-mono"
                    inputMode="numeric"
                    value={account}
                    onChange={(e) => setAccount(digitsOnly(e.target.value).slice(0, 17))}
                    placeholder="Account #"
                  />
                </label>
              </div>
            )}

            <label className="form-control">
              <span className="label-text text-xs">Memo (optional)</span>
              <input
                className="input input-bordered input-sm"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Invoice note for your records"
              />
            </label>

            <button
              type="button"
              className="btn btn-success w-full gap-2"
              disabled={busy || selectedInvoices.length === 0 || payAmount <= 0}
              onClick={() => void submitPayment()}
            >
              {busy ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              Pay {formatMoney(payAmount)}
            </button>

            <p className="text-[11px] leading-snug opacity-50">
              Demo portal mirrors QuickBooks Online customer payments. Card and bank details are validated
              locally only and never charged.
            </p>
          </div>
        </section>
      </div>

      {/* Payment history */}
      <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
        <div className="border-b border-base-200 px-4 py-3">
          <h2 className="font-bold">Payment history</h2>
          <p className="text-xs opacity-55">Recent payments on this account</p>
        </div>
        {history.length === 0 ? (
          <p className="p-6 text-sm opacity-50">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Payment #</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.payment_number}</td>
                    <td className="tabular-nums">{p.payment_date}</td>
                    <td>{p.payment_method}</td>
                    <td className="text-xs opacity-60">{p.reference_number ?? "—"}</td>
                    <td className="text-right font-medium tabular-nums">{formatMoney(p.payment_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-center text-xs opacity-45">
        Questions about a bill?{" "}
        <Link href="/customer" className="link link-hover">
          Contact us from Home
        </Link>{" "}
        or call Ridley support.
      </p>
    </div>
  );
}
