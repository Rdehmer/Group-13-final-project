"use client";

import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Lock } from "lucide-react";
import { formatMoney } from "@/lib/calculations";

type CheckoutProps = {
  clientSecret: string;
  publishableKey: string;
  amount: number;
  paymentIntentId: string;
  onSuccess: (paymentIntentId: string) => void;
  onError: (message: string) => void;
  onCancel: () => void;
};

function PaymentForm({
  amount,
  paymentIntentId,
  onSuccess,
  onError,
  onCancel,
}: Omit<CheckoutProps, "clientSecret" | "publishableKey">) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      setMessage(error.message ?? "Payment failed.");
      onError(error.message ?? "Payment failed.");
      setBusy(false);
      return;
    }

    const status = paymentIntent?.status;
    if (status === "succeeded" || status === "processing") {
      onSuccess(paymentIntent?.id ?? paymentIntentId);
      setBusy(false);
      return;
    }

    setMessage(`Payment status: ${status ?? "unknown"}`);
    onError(`Payment not completed (${status ?? "unknown"}).`);
    setBusy(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <button type="submit" className="btn btn-success w-full gap-2" disabled={!stripe || busy}>
        {busy ? <span className="loading loading-spinner loading-sm" /> : <Lock className="h-4 w-4" />}
        {busy ? "Processing…" : `Pay ${formatMoney(amount)} with Stripe`}
      </button>
      <button type="button" className="btn btn-ghost btn-sm w-full" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <p className="text-[11px] leading-snug opacity-50">
        Secured by Stripe. Test card: 4242 4242 4242 4242 · any future expiry · any CVC.
      </p>
    </form>
  );
}

export function StripeCheckout({
  clientSecret,
  publishableKey,
  amount,
  paymentIntentId,
  onSuccess,
  onError,
  onCancel,
}: CheckoutProps) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    setStripePromise(loadStripe(publishableKey));
  }, [publishableKey]);

  const options = useMemo(
    () => ({
      clientSecret,
      appearance: {
        theme: "stripe" as const,
        variables: {
          colorPrimary: "#047857",
          borderRadius: "8px",
        },
      },
    }),
    [clientSecret],
  );

  if (!stripePromise) {
    return (
      <div className="flex justify-center py-8">
        <span className="loading loading-spinner loading-md text-success" />
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <PaymentForm
        amount={amount}
        paymentIntentId={paymentIntentId}
        onSuccess={onSuccess}
        onError={onError}
        onCancel={onCancel}
      />
    </Elements>
  );
}
