"use client";

/**
 * Customer bill-pay portal (QBO-style) with Stripe Payment Element.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  FileText,
  Lock,
  RefreshCw,
  AlertCircle,
  CreditCard,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import { daysPastDue } from "@/lib/billing";
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

type StripeSession = {
  clientSecret: string;
  publishableKey: string;
  paymentIntentId: string;
  amount: number;
  demo?: boolean;
};

type StripeElementsInstance = {
  create: (type: "payment", options?: { layout?: string }) => {
    mount: (el: HTMLElement) => void;
    unmount: () => void;
  };
};

type StripeInstance = {
  elements: (options: {
    clientSecret: string;
    appearance?: { theme?: string; variables?: Record<string, string> };
  }) => StripeElementsInstance;
  confirmPayment: (options: {
    elements: StripeElementsInstance;
    redirect?: string;
    confirmParams?: { return_url?: string };
  }) => Promise<{ error?: { message?: string }; paymentIntent?: { id?: string; status?: string } }>;
};

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeInstance;
  }
}

const STRIPE_SCRIPT_ID = "stripe-js-v3";
const STRIPE_SCRIPT_SRC = "https://js.stripe.com/v3/";

function loadStripeScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Stripe) return Promise.resolve();

  const existing = document.getElementById(STRIPE_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing?.dataset.loaded === "true") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement("script");
    script.id = STRIPE_SCRIPT_ID;
    script.src = STRIPE_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Could not load Stripe.js."));
    if (!existing) document.head.appendChild(script);
  });
}

function PayPageStripeForm({
  clientSecret,
  publishableKey,
  amount,
  paymentIntentId,
  onSuccess,
  onError,
  onCancel,
}: StripeSession & {
  onSuccess: (paymentIntentId: string) => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElementsInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let paymentElement: { mount: (el: HTMLElement) => void; unmount: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        await loadStripeScript();
        if (cancelled || !mountRef.current || !window.Stripe) {
          throw new Error("Stripe is unavailable in this browser.");
        }

        const stripe = window.Stripe(publishableKey);
        const elements = stripe.elements({
          clientSecret,
          appearance: {
            theme: "stripe",
            variables: {
              colorPrimary: "#047857",
              borderRadius: "8px",
            },
          },
        });

        paymentElement = elements.create("payment", { layout: "tabs" });
        paymentElement.mount(mountRef.current);

        stripeRef.current = stripe;
        elementsRef.current = elements;
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Could not load Stripe checkout.");
        }
      }
    })();

    return () => {
      cancelled = true;
      paymentElement?.unmount();
      stripeRef.current = null;
      elementsRef.current = null;
    };
  }, [clientSecret, publishableKey, onError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;

    setBusy(true);
    setMessage(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url:
          typeof window !== "undefined"
            ? `${window.location.origin}/customer/pay?stripe=return`
            : undefined,
      },
    });

    if (error) {
      const msg = error.message ?? "Payment failed.";
      setMessage(msg);
      onError(msg);
      setBusy(false);
      return;
    }

    const status = paymentIntent?.status;
    if (status === "succeeded" || status === "processing") {
      onSuccess(paymentIntent?.id ?? paymentIntentId);
      setBusy(false);
      return;
    }

    const msg = `Payment not completed (${status ?? "unknown"}).`;
    setMessage(msg);
    onError(msg);
    setBusy(false);
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
      {!ready ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-base-200 bg-base-200/30 py-12">
          <span className="loading loading-spinner loading-md text-success" />
          <p className="text-sm opacity-70">Loading secure payment form…</p>
        </div>
      ) : (
        <div className="rounded-xl border border-base-200 bg-base-100 p-4">
          <div ref={mountRef} className="min-h-[220px]" />
        </div>
      )}
      {message ? (
        <div role="alert" className="alert alert-error text-sm">
          <span>{message}</span>
        </div>
      ) : null}
      <div className="space-y-3 pt-1">
        <button type="submit" className="btn btn-success btn-lg w-full gap-2" disabled={!ready || busy}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : <Lock className="h-4 w-4" />}
          {busy ? "Processing…" : `Pay ${formatMoney(amount)} Securely`}
        </button>
        <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={onCancel}>
          Cancel Payment
        </button>
      </div>
      <p className="text-center text-xs leading-relaxed opacity-60">
        Secured by Stripe. Test card: 4242 4242 4242 4242 · Any future expiry · Any CVC.
      </p>
    </form>
  );
}

function PayPortalInner() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const preselectInvoice = searchParams.get("invoice");
  const stripeReturn = searchParams.get("stripe");
  const clientSecretFromUrl = searchParams.get("payment_intent_client_secret");
  const paymentIntentFromUrl = searchParams.get("payment_intent");

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
  const [memo, setMemo] = useState("");

  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);
  const [stripeDemo, setStripeDemo] = useState(false);
  const [stripeSession, setStripeSession] = useState<StripeSession | null>(null);

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

    const [{ data: inv }, { data: pay }, { data: cust }, configRes] = await Promise.all([
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
      fetch("/api/stripe/config")
        .then((r) => r.json())
        .catch(() => ({ configured: false, demo: false })),
    ]);

    const open = (inv as OpenInvoice[]) ?? [];
    setInvoices(open);
    setHistory((pay as Payment[]) ?? []);
    setCustomerName(cust?.name ?? p.full_name ?? "Account");
    setStripeConfigured(Boolean(configRes?.configured));
    setStripeDemo(Boolean(configRes?.demo));

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

  // Handle Stripe redirect return
  useEffect(() => {
    if (!stripeReturn && !paymentIntentFromUrl) return;
    const pi = paymentIntentFromUrl;
    if (!pi) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/stripe/complete-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIntentId: pi }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Could not finalize Stripe payment.");
        } else {
          setSuccess({
            paymentNumbers: data.paymentNumbers ?? [],
            totalPaid: data.totalPaid ?? 0,
            method: data.method ?? "Stripe",
            paidAt: data.paidAt ?? new Date().toISOString(),
            invoiceLabels: data.invoiceLabels ?? [],
          });
          setStripeSession(null);
          await load();
        }
      } catch {
        if (!cancelled) setError("Could not finalize Stripe payment.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stripeReturn, paymentIntentFromUrl, load]);

  void clientSecretFromUrl; // reserved for full return_url flows

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
    setStripeSession(null);
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function selectAll() {
    setStripeSession(null);
    setSelected(new Set(invoices.map((i) => i.id)));
    setPartialMode(false);
  }

  function selectNone() {
    setStripeSession(null);
    setSelected(new Set());
  }

  async function startStripeCheckout() {
    setError(null);
    setSuccess(null);
    if (selectedInvoices.length === 0) {
      setError("Select at least one invoice to pay.");
      return;
    }
    if (payAmount <= 0) {
      setError("Payment amount must be greater than zero.");
      return;
    }
    if (payAmount < 0.5) {
      setError("Stripe requires a minimum payment of $0.50.");
      return;
    }
    if (partialMode && selectedInvoices.length !== 1) {
      setError("Partial payment applies to one invoice at a time.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/stripe/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceIds: selectedInvoices.map((i) => i.id),
          partialAmount: partialMode && selectedInvoices.length === 1 ? payAmount : null,
          memo: memo.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start Stripe checkout.");
        setBusy(false);
        return;
      }
      setStripeSession({
        clientSecret: data.clientSecret,
        publishableKey: data.publishableKey,
        paymentIntentId: data.paymentIntentId,
        amount: data.amount,
        demo: Boolean(data.demo),
      });
    } catch {
      setError("Could not reach the payment server.");
    }
    setBusy(false);
  }

  async function finalizeStripePayment(paymentIntentId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/complete-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Payment succeeded in Stripe but failed to post to invoices.");
        setBusy(false);
        return;
      }
      setSuccess({
        paymentNumbers: data.paymentNumbers ?? [],
        totalPaid: data.totalPaid ?? 0,
        method: data.method ?? "Stripe",
        paidAt: data.paidAt ?? new Date().toISOString(),
        invoiceLabels: data.invoiceLabels ?? [],
      });
      setStripeSession(null);
      setMemo("");
      setCustomAmount("");
      setPartialMode(false);
      await load();
    } catch {
      setError("Could not record payment on invoices.");
    }
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
        title="Payments"
        description={`${customerName} · Secure Stripe checkout for Ridley Equipment Services`}
        actions={
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-1"
            onClick={() => void load()}
            disabled={loading || busy}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-700/20 bg-emerald-700 px-4 py-3 text-emerald-50 shadow-sm">
        <Lock className="h-4 w-4 shrink-0 opacity-90" />
        <p className="text-sm font-medium">
          {stripeDemo
            ? "Demo checkout · Payments are simulated locally (no Stripe keys)"
            : "Powered by Stripe · Card & bank payments (PCI-compliant)"}
        </p>
        <span className="ml-auto text-xs opacity-80">Ridley Equipment Services</span>
      </div>

      {stripeConfigured === false ? (
        <div className="alert alert-warning text-sm">
          <AlertCircle className="h-4 w-4" />
          <div>
            <p className="font-semibold">Stripe keys required</p>
            <p className="opacity-80">
              Add <code className="text-xs">STRIPE_SECRET_KEY</code> and{" "}
              <code className="text-xs">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to{" "}
              <code className="text-xs">.env.local</code>, then restart the dev server. Use test keys from{" "}
              <a
                className="link"
                href="https://dashboard.stripe.com/test/apikeys"
                target="_blank"
                rel="noreferrer"
              >
                Stripe Dashboard → API keys
              </a>
              .
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Balance Due" value={formatMoney(totalDue)} danger={totalDue > 0} />
        <StatCard
          label="Past Due"
          value={formatMoney(overdueDue)}
          hint={overdueDue > 0 ? "Include these first" : "Nothing overdue"}
          danger={overdueDue > 0}
        />
        <StatCard label="Open Invoices" value={invoices.length} hint="Select which to pay" />
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
              <p className="text-lg font-bold">Payment Received</p>
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
        <section className="lg:col-span-3 rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-200 px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <FileText className="h-5 w-5" /> Open Invoices
              </h2>
              <p className="mt-1 text-sm opacity-60">Select invoices to include in this payment</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={selectAll} disabled={!invoices.length}>
                Select All
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={selectNone} disabled={!invoices.length}>
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
                            <span className="mt-0.5 block text-xs font-medium">Past Due</span>
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
                    <td colSpan={5}>Selected Balance</td>
                    <td className="text-right tabular-nums">{formatMoney(selectedTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <section className="lg:col-span-2 rounded-2xl border border-base-300 bg-base-100 shadow-sm lg:sticky lg:top-20 lg:self-start">
          <div className="border-b border-base-200 px-6 py-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-700/10 text-emerald-700 dark:text-emerald-400">
                <CreditCard className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold">Make a Payment</h2>
                <p className="mt-0.5 text-sm opacity-60">Review your total and continue to secure checkout</p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-emerald-700/15 bg-emerald-50 px-5 py-4 dark:bg-emerald-950/20">
              <p className="text-sm font-medium uppercase tracking-wide text-emerald-800/70 dark:text-emerald-300/70">
                Payment Amount
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-800 dark:text-emerald-300">
                {formatMoney(payAmount)}
              </p>
              <p className="mt-2 text-sm opacity-70">
                {selectedInvoices.length === 0
                  ? "No invoices selected"
                  : `${selectedInvoices.length} Invoice${selectedInvoices.length === 1 ? "" : "s"} Selected`}
              </p>
            </div>

            {selectedInvoices.length > 0 ? (
              <ul className="mt-4 space-y-2 border-t border-base-200 pt-4">
                {selectedInvoices.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate font-medium">{inv.invoice_number}</span>
                    <span className="shrink-0 tabular-nums opacity-80">
                      {formatMoney(inv.remaining_balance)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="space-y-6 p-6">
            {stripeSession ? (
              stripeSession.demo ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/30">
                    <p className="font-semibold">Demo checkout</p>
                    <p className="mt-1 opacity-80">
                      No Stripe keys are configured. Confirm to simulate a successful card payment of{" "}
                      <span className="font-medium tabular-nums">{formatMoney(stripeSession.amount)}</span>.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-success btn-lg w-full gap-2"
                    disabled={busy}
                    onClick={() => void finalizeStripePayment(stripeSession.paymentIntentId)}
                  >
                    {busy ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <CreditCard className="h-5 w-5" />
                    )}
                    Confirm Demo Payment
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-full"
                    disabled={busy}
                    onClick={() => setStripeSession(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <PayPageStripeForm
                  clientSecret={stripeSession.clientSecret}
                  publishableKey={stripeSession.publishableKey}
                  amount={stripeSession.amount}
                  paymentIntentId={stripeSession.paymentIntentId}
                  onSuccess={(id) => void finalizeStripePayment(id)}
                  onError={(msg) => setError(msg)}
                  onCancel={() => setStripeSession(null)}
                />
              )
            ) : (
              <>
                {selectedInvoices.length === 1 ? (
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-base-200 bg-base-200/20 px-4 py-4">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm mt-0.5"
                      checked={partialMode}
                      onChange={(e) => {
                        setPartialMode(e.target.checked);
                        if (e.target.checked) {
                          setCustomAmount(
                            String(Number(selectedInvoices[0].remaining_balance).toFixed(2)),
                          );
                        }
                      }}
                    />
                    <span>
                      <span className="block text-sm font-medium">Pay a Different Amount</span>
                      <span className="mt-0.5 block text-sm opacity-60">
                        Enter a partial payment toward this invoice
                      </span>
                    </span>
                  </label>
                ) : null}

                {partialMode && selectedInvoices.length === 1 ? (
                  <label className="form-control w-full gap-2">
                    <span className="text-sm font-medium">Amount to Pay</span>
                    <input
                      type="number"
                      min="0.50"
                      step="0.01"
                      max={Number(selectedInvoices[0].remaining_balance)}
                      className="input input-bordered w-full"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                    />
                    <span className="text-xs opacity-60">
                      Maximum {formatMoney(selectedInvoices[0].remaining_balance)} remaining on this invoice
                    </span>
                  </label>
                ) : null}

                <label className="form-control w-full gap-2">
                  <span className="text-sm font-medium">Memo (Optional)</span>
                  <input
                    className="input input-bordered w-full"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="Add a note for your records"
                  />
                </label>

                <div className="space-y-3 border-t border-base-200 pt-2">
                  <button
                    type="button"
                    className="btn btn-success btn-lg w-full gap-2"
                    disabled={
                      busy ||
                      selectedInvoices.length === 0 ||
                      payAmount < 0.5 ||
                      stripeConfigured === false
                    }
                    onClick={() => void startStripeCheckout()}
                  >
                    {busy ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <CreditCard className="h-5 w-5" />
                    )}
                    Continue to Secure Checkout
                  </button>
                  <p className="text-center text-sm font-medium tabular-nums opacity-80">
                    Total: {formatMoney(payAmount)}
                  </p>
                </div>

                <p className="text-center text-xs leading-relaxed opacity-60">
                  Card and bank details are entered on Stripe&apos;s secure form and are never stored by Ridley
                  Equipment Services. Minimum charge $0.50.
                </p>
              </>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
        <div className="border-b border-base-200 px-5 py-4">
          <h2 className="text-lg font-bold">Payment History</h2>
          <p className="mt-1 text-sm opacity-60">Recent payments on this account</p>
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
                    <td className="max-w-[12rem] truncate text-xs opacity-60" title={p.reference_number ?? ""}>
                      {p.reference_number ?? "—"}
                    </td>
                    <td className="text-right font-medium tabular-nums">
                      {formatMoney(p.payment_amount)}
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

export default function CustomerPayPortalPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm opacity-60">Loading payment portal…</div>}>
      <PayPortalInner />
    </Suspense>
  );
}
