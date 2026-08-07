"use client";

/**
 * ServiceTitan / Jobber-style staff payment acceptance.
 * Tender method dropdown + chips, balance display, quick amounts, receipt confirmation.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  FileText,
  MoreHorizontal,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { formatMoney } from "@/lib/calculations";
import {
  applyInvoicePayment,
  staffTenderById,
  STAFF_PAYMENT_TENDERS,
  type StaffPaymentTenderId,
} from "@/lib/payments";

export type PaymentDialogInvoice = {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name?: string | null;
  invoice_total: number;
  amount_paid: number;
  remaining_balance: number;
  status?: string;
};

const TENDER_ICONS: Record<StaffPaymentTenderId, typeof CreditCard> = {
  cash: Banknote,
  check: FileText,
  card: CreditCard,
  ach: Building2,
  other: MoreHorizontal,
};

export type InvoicePaymentDialogProps = {
  open: boolean;
  invoice: PaymentDialogInvoice | null;
  onClose: () => void;
  onPaid?: () => void | Promise<void>;
};

/**
 * ServiceTitan-style quick payment dialog for a single invoice.
 */
export function InvoicePaymentDialog({ open, invoice, onClose, onPaid }: InvoicePaymentDialogProps) {
  const supabase = createClient();
  const [tender, setTender] = useState<StaffPaymentTenderId>("card");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    paymentNumber: string;
    amount: number;
    method: string;
    newBalance: number;
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!open || !invoice) return;
    setTender("card");
    setAmount(String(Number(invoice.remaining_balance) || ""));
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setReference("");
    setCardLast4("");
    setAuthCode("");
    setNotes("");
    setError(null);
    setBusy(false);
    setReceipt(null);
  }, [open, invoice?.id, invoice?.remaining_balance]);

  const balance = Number(invoice?.remaining_balance ?? 0);
  const payAmount = Number(amount);
  const afterBalance = useMemo(() => {
    if (!Number.isFinite(payAmount) || payAmount <= 0) return balance;
    return Math.max(0, Math.round((balance - payAmount) * 100) / 100);
  }, [balance, payAmount]);

  if (!open || !invoice) return null;

  const tenderMeta = staffTenderById(tender);
  const SubmitIcon = TENDER_ICONS[tender];

  function setQuickAmount(pct: number | "full") {
    if (pct === "full") {
      setAmount(String(balance));
      return;
    }
    const raw = Math.round(balance * pct * 100) / 100;
    setAmount(String(raw > 0 ? raw : balance));
  }

  function buildReference(): string | null {
    if (tender === "card") {
      const last4 = cardLast4.replace(/\D/g, "").slice(-4);
      const auth = authCode.trim();
      if (last4 && auth) return `····${last4} · auth ${auth}`;
      if (last4) return `····${last4}`;
      if (auth) return `auth ${auth}`;
      return reference.trim() || null;
    }
    return reference.trim() || null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setBusy(true);
    setError(null);

    if (tender === "check" && !reference.trim()) {
      setError("Enter the check number.");
      setBusy(false);
      return;
    }
    if (
      tender === "card" &&
      cardLast4.replace(/\D/g, "").length > 0 &&
      cardLast4.replace(/\D/g, "").length < 4
    ) {
      setError("Enter the last 4 digits of the card.");
      setBusy(false);
      return;
    }

    // Brief pause for card tenders (terminal-style accept feel)
    if (tender === "card") {
      await new Promise((r) => setTimeout(r, 450));
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const methodLabel =
      tender === "card" && cardLast4.replace(/\D/g, "").length === 4
        ? `Credit Card ···· ${cardLast4.replace(/\D/g, "").slice(-4)}`
        : tenderMeta.method;

    const result = await applyInvoicePayment(supabase, {
      invoiceId: invoice.id,
      customerId: invoice.customer_id,
      invoiceTotal: Number(invoice.invoice_total),
      amountPaidSoFar: Number(invoice.amount_paid),
      remaining: balance,
      amount: payAmount,
      paymentMethod: methodLabel,
      referenceNumber: buildReference(),
      notes: notes.trim() || null,
      userId: user?.id ?? null,
      paymentDate,
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
      recordId: invoice.id,
      newValue: result.paymentNumber,
    });

    setReceipt({
      paymentNumber: result.paymentNumber,
      amount: payAmount,
      method: methodLabel,
      newBalance: result.newBalance,
      status: result.status,
    });
    setBusy(false);
  }

  async function finish() {
    onClose();
    await onPaid?.();
  }

  return (
    <dialog className="modal modal-open" open>
      <div className="modal-box max-h-[min(92dvh,40rem)] w-full max-w-lg overflow-y-auto p-0">
        {receipt ? (
          <div className="p-5 sm:p-6">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-bold tracking-tight">Payment accepted</h3>
              <p className="mt-1 text-sm opacity-70">
                {invoice.customer_name?.trim() || "Customer"} · {invoice.invoice_number}
              </p>
            </div>

            <div className="mt-5 rounded-xl border border-base-300 bg-base-200/40 p-4 text-sm">
              <div className="flex justify-between gap-2">
                <span className="opacity-60">Payment #</span>
                <span className="font-mono font-semibold">{receipt.paymentNumber}</span>
              </div>
              <div className="mt-2 flex justify-between gap-2">
                <span className="opacity-60">Method</span>
                <span className="font-medium">{receipt.method}</span>
              </div>
              <div className="mt-2 flex justify-between gap-2 text-base">
                <span className="opacity-60">Amount</span>
                <span className="font-bold text-success">{formatMoney(receipt.amount)}</span>
              </div>
              <div className="mt-3 flex justify-between gap-2 border-t border-base-300 pt-3">
                <span className="opacity-60">Balance remaining</span>
                <span className="font-semibold">{formatMoney(receipt.newBalance)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-2">
                <span className="opacity-60">Invoice status</span>
                <span className="font-medium">{receipt.status}</span>
              </div>
            </div>

            <div className="modal-action mt-5">
              <button type="button" className="btn btn-success w-full sm:w-auto" onClick={() => void finish()}>
                <Check className="h-4 w-4" /> Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="border-b border-base-300 bg-base-200/40 px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success text-success-content shadow-sm">
                  <Wallet className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-success">
                    Accept payment
                  </p>
                  <h3 className="text-lg font-bold leading-tight sm:text-xl">
                    {invoice.customer_name?.trim() || "Customer"}
                  </h3>
                  <p className="mt-0.5 text-sm opacity-70">
                    Invoice <span className="font-mono font-semibold">{invoice.invoice_number}</span>
                    {invoice.status ? (
                      <>
                        {" "}
                        · <span>{invoice.status}</span>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-base-100 px-3 py-2 ring-1 ring-base-300">
                  <p className="text-[10px] font-semibold uppercase opacity-50">Invoice total</p>
                  <p className="font-mono text-sm font-semibold">{formatMoney(invoice.invoice_total)}</p>
                </div>
                <div className="rounded-lg bg-base-100 px-3 py-2 ring-1 ring-base-300">
                  <p className="text-[10px] font-semibold uppercase opacity-50">Already paid</p>
                  <p className="font-mono text-sm font-semibold">{formatMoney(invoice.amount_paid)}</p>
                </div>
                <div className="col-span-2 rounded-lg bg-success/15 px-3 py-2 ring-1 ring-success/30 sm:col-span-1">
                  <p className="text-[10px] font-semibold uppercase text-success/80">Balance due</p>
                  <p className="font-mono text-base font-bold text-success">{formatMoney(balance)}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4 px-5 py-4 sm:px-6">
              {error ? <div className="alert alert-error py-2 text-sm">{error}</div> : null}

              <div>
                <label className="form-control w-full" htmlFor="pay-method">
                  <span className="mb-1.5 text-xs font-semibold uppercase tracking-wide opacity-55">
                    Payment method
                  </span>
                  <select
                    id="pay-method"
                    className="select select-bordered w-full"
                    value={tender}
                    disabled={busy}
                    onChange={(e) => setTender(e.target.value as StaffPaymentTenderId)}
                    required
                  >
                    {STAFF_PAYMENT_TENDERS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.selectLabel}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5" role="group" aria-label="Quick method">
                  {STAFF_PAYMENT_TENDERS.map((t) => {
                    const Icon = TENDER_ICONS[t.id];
                    const active = tender === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={busy}
                        title={t.selectLabel}
                        onClick={() => setTender(t.id)}
                        className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-center transition ${
                          active
                            ? "border-success bg-success/10 text-success shadow-sm"
                            : "border-base-300 bg-base-100 hover:bg-base-200/60"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="text-[10px] font-semibold leading-tight">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] opacity-50">{tenderMeta.hint}</p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide opacity-55" htmlFor="pay-amount">
                    Amount to apply
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={busy}
                      onClick={() => setQuickAmount(0.25)}
                    >
                      25%
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={busy}
                      onClick={() => setQuickAmount(0.5)}
                    >
                      50%
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-xs btn-success"
                      disabled={busy}
                      onClick={() => setQuickAmount("full")}
                    >
                      Pay balance
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold opacity-45">
                    $
                  </span>
                  <input
                    id="pay-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={balance > 0 ? balance : undefined}
                    className="input input-bordered w-full pl-7 font-mono text-lg font-semibold"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    disabled={busy}
                    autoFocus
                  />
                </div>
                {Number.isFinite(payAmount) && payAmount > 0 ? (
                  <p className="mt-1.5 text-xs opacity-60">
                    After this payment:{" "}
                    <strong className="font-mono">{formatMoney(afterBalance)}</strong> remaining
                    {afterBalance <= 0.005 ? " · paid in full" : null}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text mb-1 text-xs font-semibold opacity-60">Payment date</span>
                  <input
                    type="date"
                    className="input input-bordered input-sm w-full"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    disabled={busy}
                    required
                  />
                </label>

                {tender === "check" ? (
                  <label className="form-control">
                    <span className="label-text mb-1 text-xs font-semibold opacity-60">
                      Check number <span className="text-error">*</span>
                    </span>
                    <input
                      className="input input-bordered input-sm w-full font-mono"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="e.g. 4521"
                      disabled={busy}
                      required
                    />
                  </label>
                ) : null}

                {tender === "card" ? (
                  <>
                    <label className="form-control">
                      <span className="label-text mb-1 text-xs font-semibold opacity-60">Card last 4</span>
                      <input
                        className="input input-bordered input-sm w-full font-mono"
                        value={cardLast4}
                        onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        placeholder="4242"
                        inputMode="numeric"
                        maxLength={4}
                        disabled={busy}
                      />
                    </label>
                    <label className="form-control sm:col-span-2">
                      <span className="label-text mb-1 text-xs font-semibold opacity-60">
                        Auth / approval code
                      </span>
                      <input
                        className="input input-bordered input-sm w-full font-mono"
                        value={authCode}
                        onChange={(e) => setAuthCode(e.target.value)}
                        placeholder="Optional processor auth #"
                        disabled={busy}
                      />
                    </label>
                  </>
                ) : null}

                {tender === "ach" || tender === "cash" || tender === "other" ? (
                  <label className="form-control">
                    <span className="label-text mb-1 text-xs font-semibold opacity-60">
                      {tender === "ach"
                        ? "Confirmation #"
                        : tender === "other"
                          ? "Reference / detail"
                          : "Reference"}
                    </span>
                    <input
                      className="input input-bordered input-sm w-full"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder={
                        tender === "ach"
                          ? "Bank confirmation"
                          : tender === "other"
                            ? "e.g. wire ref, memo"
                            : "Optional"
                      }
                      disabled={busy}
                    />
                  </label>
                ) : null}
              </div>

              <label className="form-control">
                <span className="label-text mb-1 text-xs font-semibold opacity-60">Internal notes</span>
                <input
                  className="input input-bordered input-sm w-full"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Office memo (not shown to customer)"
                  disabled={busy}
                />
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-base-300 bg-base-200/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-success gap-2 sm:min-w-[12rem]"
                disabled={busy || balance <= 0}
              >
                {busy ? (
                  <>Processing…</>
                ) : (
                  <>
                    <SubmitIcon className="h-4 w-4" />
                    Accept {Number.isFinite(payAmount) && payAmount > 0 ? formatMoney(payAmount) : "payment"}
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" disabled={busy} onClick={receipt ? () => void finish() : onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}

/** Alias matching ServiceTitan “Accept Payment” language. */
export const AcceptPaymentModal = InvoicePaymentDialog;
