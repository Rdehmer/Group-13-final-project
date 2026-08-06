import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { allocateAcrossInvoices, type AllocatableInvoice } from "@/lib/payments";
import {
  createDemoPaymentIntent,
  encodeAllocations,
  getStripe,
  getStripePublishableKey,
  isStripeConfigured,
  isStripeDemoMode,
} from "@/lib/stripe";

export const runtime = "nodejs";

type Body = {
  invoiceIds?: string[];
  /** When set with a single invoice, pay this amount instead of full balance. */
  partialAmount?: number | null;
  memo?: string | null;
};

/**
 * POST /api/stripe/create-payment-intent
 * Creates a Stripe PaymentIntent for the signed-in customer's selected invoices.
 */
export async function POST(req: Request) {
  try {
    if (!isStripeConfigured() && !isStripeDemoMode()) {
      return NextResponse.json(
        {
          error:
            "Stripe is not configured. Add STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to .env.local.",
        },
        { status: 503 },
      );
    }

    const body = (await req.json()) as Body;
    const invoiceIds = [...new Set((body.invoiceIds ?? []).filter(Boolean))];
    if (!invoiceIds.length) {
      return NextResponse.json({ error: "Select at least one invoice." }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, customer_id, email, full_name")
      .eq("id", user.id)
      .single();

    if (!profile?.customer_id) {
      return NextResponse.json({ error: "No customer account linked." }, { status: 403 });
    }

    const { data: invRows, error: invError } = await supabase
      .from("invoices")
      .select("id, invoice_number, remaining_balance, amount_paid, invoice_total, due_date, customer_id, status")
      .in("id", invoiceIds)
      .eq("customer_id", profile.customer_id)
      .gt("remaining_balance", 0)
      .not("status", "eq", "Canceled");

    if (invError) {
      return NextResponse.json({ error: invError.message }, { status: 400 });
    }

    const invoices = (invRows as AllocatableInvoice[]) ?? [];
    if (invoices.length !== invoiceIds.length) {
      return NextResponse.json(
        { error: "One or more invoices are invalid or already paid." },
        { status: 400 },
      );
    }

    let total = invoices.reduce((s, i) => s + Number(i.remaining_balance), 0);
    let partial = body.partialAmount != null ? Number(body.partialAmount) : null;
    if (partial != null) {
      if (invoices.length !== 1) {
        return NextResponse.json(
          { error: "Partial payment requires exactly one invoice." },
          { status: 400 },
        );
      }
      if (!Number.isFinite(partial) || partial <= 0) {
        return NextResponse.json({ error: "Invalid partial amount." }, { status: 400 });
      }
      if (partial > Number(invoices[0].remaining_balance) + 0.001) {
        return NextResponse.json({ error: "Amount exceeds invoice balance." }, { status: 400 });
      }
      total = partial;
    }

    total = Math.round(total * 100) / 100;
    const amountCents = Math.round(total * 100);
    if (amountCents < 50) {
      return NextResponse.json(
        { error: "Stripe requires a minimum charge of $0.50." },
        { status: 400 },
      );
    }

    const allocations = allocateAcrossInvoices(invoices, total, {
      singleInvoicePartial: invoices.length === 1 && partial != null,
    });
    if (!allocations.length) {
      return NextResponse.json({ error: "Nothing to charge." }, { status: 400 });
    }

    const allocationRows = allocations.map((a) => ({
      invoiceId: a.invoiceId,
      amount: a.amount,
    }));

    if (isStripeDemoMode()) {
      const demo = createDemoPaymentIntent({
        customerId: profile.customer_id,
        userId: user.id,
        amount: total,
        allocations: allocationRows,
        memo: (body.memo ?? "").slice(0, 200) || null,
      });

      return NextResponse.json({
        demo: true,
        clientSecret: `${demo.id}_secret_demo`,
        paymentIntentId: demo.id,
        amount: total,
        publishableKey: "pk_demo_local",
        allocations: allocations.map((a) => ({
          invoiceId: a.invoiceId,
          invoiceNumber: a.invoiceNumber,
          amount: a.amount,
        })),
      });
    }

    const stripe = getStripe();
    const allocationMeta = encodeAllocations(allocationRows);

    if (allocationMeta.length > 490) {
      return NextResponse.json(
        { error: "Too many invoices in one payment. Select fewer invoices." },
        { status: 400 },
      );
    }

    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        description: `EquipmentIQ payment for ${allocations.map((a) => a.invoiceNumber).join(", ")}`,
        receipt_email: profile.email || user.email || undefined,
        metadata: {
          customer_id: profile.customer_id,
          user_id: user.id,
          application: "equipmentiq_customer_portal",
          allocations: allocationMeta,
          memo: (body.memo ?? "").slice(0, 200),
          invoice_numbers: allocations
            .map((a) => a.invoiceNumber)
            .join(",")
            .slice(0, 400),
        },
      },
      {
        idempotencyKey: `equipmentiq-${profile.customer_id}-${invoiceIds.sort().join("-")}-${amountCents}-${Date.now().toString().slice(-6)}`,
      },
    );

    return NextResponse.json({
      demo: false,
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amount: total,
      publishableKey: getStripePublishableKey(),
      allocations: allocations.map((a) => ({
        invoiceId: a.invoiceId,
        invoiceNumber: a.invoiceNumber,
        amount: a.amount,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create payment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
