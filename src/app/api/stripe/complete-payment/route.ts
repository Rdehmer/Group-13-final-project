import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { portalPaymentNotes, stripePortalPaymentMethod } from "@/lib/payments";
import {
  decodeAllocations,
  getStripe,
  isDemoPaymentIntentId,
  isStripeConfigured,
  isStripeDemoMode,
  verifyDemoPaymentIntent,
} from "@/lib/stripe";

export const runtime = "nodejs";

type Body = {
  paymentIntentId?: string;
};

type PortalPaymentRpcResult = {
  ok: boolean;
  error?: string;
  payment_number?: string;
};

async function applyPortalPayment(
  supabase: SupabaseClient,
  input: {
    invoiceId: string;
    amount: number;
    paymentMethod: string;
    referenceNumber: string;
    notes: string | null;
  },
): Promise<{ ok: true; paymentNumber: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("apply_my_portal_payment", {
    p_invoice_id: input.invoiceId,
    p_amount: input.amount,
    p_payment_method: input.paymentMethod,
    p_reference_number: input.referenceNumber,
    p_notes: input.notes,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const result = data as PortalPaymentRpcResult | null;
  if (!result?.ok || !result.payment_number) {
    return { ok: false, error: result?.error ?? "Could not apply payment." };
  }

  return { ok: true, paymentNumber: result.payment_number };
}

/**
 * POST /api/stripe/complete-payment
 * After Stripe (or local demo checkout) confirms, apply amounts to invoices in Supabase.
 */
export async function POST(req: Request) {
  try {
    if (!isStripeConfigured() && !isStripeDemoMode()) {
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

    if (isDemoPaymentIntentId(paymentIntentId)) {
      if (!isStripeDemoMode()) {
        return NextResponse.json({ error: "Demo payments are disabled." }, { status: 503 });
      }

      const demo = verifyDemoPaymentIntent(paymentIntentId, user.id, profile.customer_id);
      if (!demo) {
        return NextResponse.json(
          { error: "Demo payment expired or invalid. Start checkout again." },
          { status: 400 },
        );
      }

      const { method: paymentMethod, display: methodDisplay } = stripePortalPaymentMethod({
        type: "card",
        card: { last4: "4242" },
      });
      const reference = demo.id;
      const memo = demo.memo;
      const paymentNumbers: string[] = [];
      const invoiceLabels: string[] = [];
      let totalPaid = 0;

      for (const alloc of demo.allocations) {
        const { data: inv, error: invErr } = await supabase
          .from("invoices")
          .select("id, invoice_number")
          .eq("id", alloc.invoiceId)
          .eq("customer_id", profile.customer_id)
          .maybeSingle();

        if (invErr || !inv) {
          return NextResponse.json(
            { error: invErr?.message ?? `Invoice ${alloc.invoiceId} not found.` },
            { status: 400 },
          );
        }

        const result = await applyPortalPayment(supabase, {
          invoiceId: inv.id,
          amount: alloc.amount,
          paymentMethod,
          referenceNumber: reference,
          notes: portalPaymentNotes("Demo Stripe checkout", memo, demo.id),
        });

        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }

        paymentNumbers.push(result.paymentNumber);
        invoiceLabels.push(inv.invoice_number);
        totalPaid += alloc.amount;

        await logActivity(supabase, {
          userId: user.id,
          action: "demo_stripe_payment",
          recordType: "payment",
          recordId: inv.id,
          newValue: `${result.paymentNumber}|${demo.id}`,
        });
      }

      return NextResponse.json({
        ok: true,
        demo: true,
        paymentIntentId: demo.id,
        paymentNumbers,
        invoiceLabels,
        totalPaid: Math.round(totalPaid * 100) / 100,
        method: methodDisplay,
        paidAt: new Date().toISOString(),
      });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
    }

    const stripe = getStripe();
    let intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["payment_method"],
    });

    if (intent.metadata.user_id && intent.metadata.user_id !== user.id) {
      return NextResponse.json({ error: "Payment does not belong to this user." }, { status: 403 });
    }
    if (intent.metadata.customer_id && intent.metadata.customer_id !== profile.customer_id) {
      return NextResponse.json({ error: "Payment does not belong to this account." }, { status: 403 });
    }

    for (let attempt = 0; attempt < 6 && intent.status === "processing"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["payment_method"],
      });
    }

    if (intent.status !== "succeeded" && intent.status !== "processing") {
      return NextResponse.json(
        { error: `Payment not completed (status: ${intent.status}).` },
        { status: 400 },
      );
    }

    const allocations = decodeAllocations(intent.metadata.allocations);
    if (!allocations.length) {
      return NextResponse.json({ error: "No invoice allocations on payment." }, { status: 400 });
    }

    const pm = intent.payment_method;
    const { method: paymentMethod, display: methodDisplay } = stripePortalPaymentMethod(
      pm && typeof pm !== "string" ? pm : null,
    );

    const reference = intent.id;
    const memo = intent.metadata.memo || null;
    const paymentNumbers: string[] = [];
    const invoiceLabels: string[] = [];
    let totalPaid = 0;

    for (const alloc of allocations) {
      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .select("id, invoice_number")
        .eq("id", alloc.invoiceId)
        .eq("customer_id", profile.customer_id)
        .maybeSingle();

      if (invErr || !inv) {
        return NextResponse.json(
          { error: invErr?.message ?? `Invoice ${alloc.invoiceId} not found.` },
          { status: 400 },
        );
      }

      const result = await applyPortalPayment(supabase, {
        invoiceId: inv.id,
        amount: alloc.amount,
        paymentMethod,
        referenceNumber: reference,
        notes: portalPaymentNotes(methodDisplay, memo, intent.id),
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      paymentNumbers.push(result.paymentNumber);
      invoiceLabels.push(inv.invoice_number);
      totalPaid += alloc.amount;

      await logActivity(supabase, {
        userId: user.id,
        action: "stripe_payment",
        recordType: "payment",
        recordId: inv.id,
        newValue: `${result.paymentNumber}|${intent.id}`,
      });
    }

    return NextResponse.json({
      ok: true,
      demo: false,
      paymentIntentId: intent.id,
      paymentNumbers,
      invoiceLabels,
      totalPaid: Math.round(totalPaid * 100) / 100,
      method: methodDisplay,
      paidAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not complete payment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
