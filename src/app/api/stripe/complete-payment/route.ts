import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applyInvoicePayment, type AllocatableInvoice } from "@/lib/payments";
import { logActivity } from "@/lib/activity";
import { decodeAllocations, getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

type Body = {
  paymentIntentId?: string;
};

/**
 * POST /api/stripe/complete-payment
 * After Stripe confirms the PaymentIntent, apply amounts to invoices in Supabase.
 */
export async function POST(req: Request) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
    }

    const body = (await req.json()) as Body;
    const paymentIntentId = body.paymentIntentId?.trim();
    if (!paymentIntentId) {
      return NextResponse.json({ error: "Missing paymentIntentId." }, { status: 400 });
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
      .select("id, customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.customer_id) {
      return NextResponse.json({ error: "No customer account linked." }, { status: 403 });
    }

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["payment_method"],
    });

    if (intent.metadata.user_id && intent.metadata.user_id !== user.id) {
      return NextResponse.json({ error: "Payment does not belong to this user." }, { status: 403 });
    }
    if (intent.metadata.customer_id && intent.metadata.customer_id !== profile.customer_id) {
      return NextResponse.json({ error: "Payment does not belong to this account." }, { status: 403 });
    }

    if (intent.status !== "succeeded") {
      return NextResponse.json(
        { error: `Payment not completed (status: ${intent.status}).` },
        { status: 400 },
      );
    }

    const allocations = decodeAllocations(intent.metadata.allocations);
    if (!allocations.length) {
      return NextResponse.json({ error: "No invoice allocations on payment." }, { status: 400 });
    }

    // Method label from Stripe
    let methodLabel = "Stripe";
    const pm = intent.payment_method;
    if (pm && typeof pm !== "string") {
      if (pm.card) {
        methodLabel = `Stripe card ···· ${pm.card.last4}`;
      } else if (pm.us_bank_account) {
        methodLabel = `Stripe bank ···· ${pm.us_bank_account.last4}`;
      } else if (pm.type) {
        methodLabel = `Stripe ${pm.type}`;
      }
    }

    const reference = intent.id;
    const memo = intent.metadata.memo || null;
    const paymentNumbers: string[] = [];
    const invoiceLabels: string[] = [];
    let totalPaid = 0;

    for (const alloc of allocations) {
      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, remaining_balance, amount_paid, invoice_total, due_date, customer_id, status",
        )
        .eq("id", alloc.invoiceId)
        .eq("customer_id", profile.customer_id)
        .maybeSingle();

      if (invErr || !inv) {
        return NextResponse.json(
          { error: invErr?.message ?? `Invoice ${alloc.invoiceId} not found.` },
          { status: 400 },
        );
      }

      const invRow = inv as AllocatableInvoice;
      // Re-read current balance; allow idempotent re-apply via reference
      const result = await applyInvoicePayment(supabase, {
        invoiceId: invRow.id,
        customerId: profile.customer_id,
        invoiceTotal: Number(invRow.invoice_total),
        amountPaidSoFar: Number(invRow.amount_paid),
        remaining: Number(invRow.remaining_balance),
        amount: alloc.amount,
        paymentMethod: methodLabel,
        referenceNumber: reference,
        notes: memo || `Stripe portal payment ${intent.id}`,
        userId: user.id,
      });

      if (!result.ok) {
        // if balance already reduced by concurrent apply but ref exists, ok path covered
        // when amount > remaining because already applied partially without ref — surface error
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      paymentNumbers.push(result.paymentNumber);
      invoiceLabels.push(invRow.invoice_number);
      totalPaid += alloc.amount;

      await logActivity(supabase, {
        userId: user.id,
        action: "stripe_payment",
        recordType: "payment",
        recordId: invRow.id,
        newValue: `${result.paymentNumber}|${intent.id}`,
      });
    }

    return NextResponse.json({
      ok: true,
      paymentIntentId: intent.id,
      paymentNumbers,
      invoiceLabels,
      totalPaid: Math.round(totalPaid * 100) / 100,
      method: methodLabel,
      paidAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not complete payment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
