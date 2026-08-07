import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RecipientKind = "customer" | "service_vendor";

type EmailBody = {
  recipients?: Array<{ kind: RecipientKind; to: string }>;
  subject?: string;
  message?: string;
  pdfBase64?: string;
};

const STAFF_ROLES = new Set(["administrator", "service_manager", "billing"]);

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || !STAFF_ROLES.has(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: EmailBody;
  try {
    body = (await request.json()) as EmailBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const recipients = (body.recipients ?? [])
    .map((r) => ({
      kind: r.kind,
      to: (r.to ?? "").trim(),
    }))
    .filter((r) => r.kind === "customer" || r.kind === "service_vendor");

  if (recipients.length === 0) {
    return NextResponse.json({ error: "Select at least one recipient." }, { status: 400 });
  }
  for (const r of recipients) {
    if (!isValidEmail(r.to)) {
      return NextResponse.json(
        { error: `Invalid email for ${r.kind.replace("_", " ")}: ${r.to || "(empty)"}` },
        { status: 400 },
      );
    }
  }

  const subject = (body.subject ?? "").trim();
  if (!subject) {
    return NextResponse.json({ error: "Subject is required." }, { status: 400 });
  }

  const pdfBase64 = (body.pdfBase64 ?? "").trim();
  if (!pdfBase64 || pdfBase64.length < 32) {
    return NextResponse.json({ error: "Invoice PDF is required." }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Email is not configured. Add RESEND_API_KEY (and optionally INVOICE_FROM_EMAIL) to .env.local.",
      },
      { status: 503 },
    );
  }

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, customer_id, work_order_id, customers(name, email), work_orders(id, work_order_number, service_vendor_id)",
    )
    .eq("id", id)
    .maybeSingle();

  if (invErr || !invoice) {
    return NextResponse.json({ error: invErr?.message || "Invoice not found." }, { status: 404 });
  }

  const woRaw = invoice.work_orders as
    | { id: string; work_order_number: string; service_vendor_id: string | null }
    | { id: string; work_order_number: string; service_vendor_id: string | null }[]
    | null
    | undefined;
  const wo = Array.isArray(woRaw) ? woRaw[0] : woRaw;

  let serviceVendorEmail: string | null = null;
  let serviceVendorName: string | null = null;
  if (wo?.service_vendor_id) {
    const { data: sv } = await supabase
      .from("service_vendors")
      .select("id, name, email")
      .eq("id", wo.service_vendor_id)
      .maybeSingle();
    serviceVendorEmail = (sv?.email as string | null) ?? null;
    serviceVendorName = (sv?.name as string | null) ?? null;
  }

  const customerRaw = invoice.customers as
    | { name?: string; email?: string | null }
    | { name?: string; email?: string | null }[]
    | null;
  const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;
  const customerName = customer?.name?.trim() || "Customer";

  const from =
    process.env.INVOICE_FROM_EMAIL?.trim() || "EquipmentIQ Billing <onboarding@resend.dev>";
  const message =
    (body.message ?? "").trim() ||
    `Please find invoice ${invoice.invoice_number} attached.`;

  const resend = new Resend(apiKey);
  const filename = `${invoice.invoice_number}.pdf`;
  const sent: Array<{ kind: RecipientKind; to: string; id?: string }> = [];
  const failures: Array<{ kind: RecipientKind; to: string; error: string }> = [];

  for (const recipient of recipients) {
    if (recipient.kind === "customer" && !invoice.customer_id) {
      failures.push({ kind: recipient.kind, to: recipient.to, error: "Invoice has no customer." });
      continue;
    }
    if (recipient.kind === "service_vendor" && !wo?.service_vendor_id) {
      failures.push({
        kind: recipient.kind,
        to: recipient.to,
        error: "Work order has no service vendor assigned.",
      });
      continue;
    }

    const greeting =
      recipient.kind === "customer"
        ? customerName
        : serviceVendorName || "Service partner";

    const html = `
      <p>Hello ${greeting},</p>
      <p>${message.replace(/\n/g, "<br/>")}</p>
      <p>Invoice <strong>${invoice.invoice_number}</strong>${
        wo?.work_order_number ? ` for work order <strong>${wo.work_order_number}</strong>` : ""
      } is attached as a PDF.</p>
      <p style="color:#64748b;font-size:12px">Sent by EquipmentIQ billing.</p>
    `;

    const { data, error } = await resend.emails.send({
      from,
      to: [recipient.to],
      subject,
      html,
      attachments: [
        {
          filename,
          content: pdfBase64,
        },
      ],
    });

    if (error) {
      failures.push({
        kind: recipient.kind,
        to: recipient.to,
        error: error.message || "Send failed.",
      });
    } else {
      sent.push({ kind: recipient.kind, to: recipient.to, id: data?.id });
    }
  }

  if (sent.length === 0) {
    return NextResponse.json(
      {
        error: failures.map((f) => `${f.kind}: ${f.error}`).join(" · ") || "Send failed.",
        failures,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    sent,
    failures,
    hints: {
      customerEmail: customer?.email ?? null,
      serviceVendorEmail,
    },
  });
}
