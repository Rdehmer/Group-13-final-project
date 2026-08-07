"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, Download, Mail, Send, FileEdit, Plus, Trash2, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { formatMoney } from "@/lib/calculations";
import { formatMonthlyPremium } from "@/lib/contract-pricing";
import {
  buildWorkOrderPreview,
  daysPastDue,
  EDITABLE_LINE_KINDS,
  invoiceBucket,
  invoiceToEditableLines,
  isUnsentInvoice,
  linesFromStoredInvoice,
  newEditableLine,
  recomputeLineAmount,
  rollupEditableLines,
  type BillableLine,
  type EditableInvoiceLine,
} from "@/lib/billing";
import { InvoiceWorkflowControls } from "@/components/InvoiceWorkflowControls";
import { EmailInvoiceModal, type EmailInvoiceRecipient } from "@/components/EmailInvoiceModal";
import { EquipmentAttachPanel, EquipmentIdentityCard, type EquipmentOption } from "@/components/EquipmentAttachPanel";
import { PurchaseOrderPanel } from "@/components/PurchaseOrderPanel";
import { loadInvoiceBatchMap, type BatchLookup } from "@/lib/batches";
import { downloadInvoicePdf, invoicePdfToBase64 } from "@/lib/invoicePdf";
import type { ServiceHistoryWorkOrder } from "@/lib/invoices";
import type { Invoice, Payment, Profile, ServiceContract, TechnicianLabor, WorkOrder, WorkOrderPart } from "@/lib/types";
import {
  coverageCapsFromContract,
  isTmBillingEligible,
  pricingSummaryFromContract,
  sameBreakdownFeeWaived,
  suggestedContractServiceFee,
} from "@/lib/contract-pricing";

type InvoiceDetail = Invoice & {
  assigned_to?: string | null;
  equipment_id?: string | null;
  customers?: {
    name: string;
    billing_address?: string | null;
    email?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
  };
  work_orders?: {
    id?: string;
    work_order_number: string;
    problem_description?: string | null;
    work_order_type?: string | null;
    service_vendor_id?: string | null;
  } | null;
  equipment?: EquipmentOption | null;
};

type ServiceVendorBrief = {
  id: string;
  name: string;
  email: string | null;
  contact_name: string | null;
};

/**
 * Full invoice document view (ServiceTitan-style invoice detail).
 * Draft / unsent invoices can edit line items before send.
 */
export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [lines, setLines] = useState<BillableLine[]>([]);
  const [editLines, setEditLines] = useState<EditableInvoiceLine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [team, setTeam] = useState<Pick<Profile, "id" | "full_name" | "email" | "role">[]>([]);
  const [customerEquipment, setCustomerEquipment] = useState<EquipmentOption[]>([]);
  const [taxRate, setTaxRate] = useState(0.0825);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notes, setNotes] = useState("");
  const [addKind, setAddKind] = useState<EditableInvoiceLine["kind"]>("additional");
  const [invoiceBatch, setInvoiceBatch] = useState<BatchLookup | null>(null);
  const [pricingBanner, setPricingBanner] = useState<{
    kind: "tm" | "contract" | "over_cap";
    message: string;
    suggestFee?: number;
  } | null>(null);
  const [serviceVendor, setServiceVendor] = useState<ServiceVendorBrief | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [{ data }, { data: pay }, { data: settings }, { data: members }, batchRes] = await Promise.all([
      supabase
        .from("invoices")
        .select(
          "*, customers(name, billing_address, email, phone, city, state), work_orders(id, work_order_number, problem_description, work_order_type, service_vendor_id), equipment(id, name, model, serial_number, installation_date, manufacturer, location, operating_status, customer_id)",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("payments").select("*").eq("invoice_id", id).order("payment_date", { ascending: false }),
      supabase.from("company_settings").select("default_tax_rate").limit(1).maybeSingle(),
      supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .in("role", ["billing", "administrator", "service_manager"])
        .eq("is_active", true)
        .order("full_name"),
      loadInvoiceBatchMap(supabase),
    ]);

    const invoice = data as InvoiceDetail | null;
    setInv(invoice);
    setPayments((pay as Payment[]) ?? []);
    setTeam((members as typeof team) ?? []);
    setInvoiceBatch(invoice ? batchRes.map.get(invoice.id) ?? null : null);
    if (settings?.default_tax_rate) setTaxRate(Number(settings.default_tax_rate));
    if (!invoice) {
      setServiceVendor(null);
      setLoading(false);
      return;
    }

    setNotes(invoice.notes ?? "");
    setDirty(false);
    setSavedMsg(null);

    const vendorId = invoice.work_orders?.service_vendor_id;
    if (vendorId) {
      const { data: sv } = await supabase
        .from("service_vendors")
        .select("id, name, email, contact_name")
        .eq("id", vendorId)
        .maybeSingle();
      setServiceVendor((sv as ServiceVendorBrief | null) ?? null);
    } else {
      setServiceVendor(null);
    }

    if (invoice.customer_id) {
      const { data: eqList } = await supabase
        .from("equipment")
        .select(
          "id, name, model, serial_number, installation_date, manufacturer, location, operating_status, customer_id",
        )
        .eq("customer_id", invoice.customer_id)
        .order("name");
      setCustomerEquipment((eqList as EquipmentOption[]) ?? []);
    } else {
      setCustomerEquipment([]);
    }

    let detailLines: BillableLine[] = [];

    if (invoice.work_order_id) {
      const [{ data: labor }, { data: parts }] = await Promise.all([
        supabase.from("technician_labor").select("*").eq("work_order_id", invoice.work_order_id),
        supabase.from("work_order_parts").select("*").eq("work_order_id", invoice.work_order_id),
      ]);
      const lab = (labor as TechnicianLabor[]) ?? [];
      const pts = (parts as WorkOrderPart[]) ?? [];
      if (lab.length > 0 || pts.length > 0) {
        const rate = settings?.default_tax_rate ? Number(settings.default_tax_rate) : 0;
        const preview = buildWorkOrderPreview(lab, pts, rate, {
          recurring: Number(invoice.recurring_service_charge),
          additional: Number(invoice.additional_charges),
          discounts: Number(invoice.discounts),
        });
        detailLines = [...preview.laborLines, ...preview.partsLines];
        if (Number(invoice.warranty_deductions) > 0) {
          detailLines.push({
            kind: "warranty",
            description: "Warranty deductions",
            quantity: null,
            unitPrice: null,
            amount: -Number(invoice.warranty_deductions),
          });
        }
        if (Number(invoice.recurring_service_charge) > 0) {
          detailLines.push({
            kind: "recurring",
            description: "Recurring service charge",
            quantity: null,
            unitPrice: null,
            amount: Number(invoice.recurring_service_charge),
          });
        }
        if (Number(invoice.additional_charges) > 0) {
          detailLines.push({
            kind: "additional",
            description: "Additional charges",
            quantity: null,
            unitPrice: null,
            amount: Number(invoice.additional_charges),
          });
        }
        if (Number(invoice.discounts) > 0) {
          detailLines.push({
            kind: "discount",
            description: "Discounts",
            quantity: null,
            unitPrice: null,
            amount: -Number(invoice.discounts),
          });
        }
      }
    }

    if (detailLines.length === 0) {
      detailLines = linesFromStoredInvoice(invoice).filter((l) => l.kind !== "tax");
    }

    setLines(detailLines);

    // Prefer stored totals as the editable source of truth so save is predictable.
    if (isUnsentInvoice(invoice.status)) {
      setEditLines(invoiceToEditableLines(invoice));
    }

    await loadPricingBanner(invoice, detailLines);
    setLoading(false);
  }

  async function loadPricingBanner(invoice: InvoiceDetail, detailLines: BillableLine[]) {
    if (!invoice.work_order_id || !invoice.customer_id) {
      setPricingBanner(null);
      return;
    }

    const [{ data: wo }, { data: contracts }] = await Promise.all([
      supabase
        .from("work_orders")
        .select(
          "id, contract_id, outside_contract, equipment_id, problem_description, completion_date, created_at",
        )
        .eq("id", invoice.work_order_id)
        .maybeSingle(),
      supabase
        .from("service_contracts")
        .select("*")
        .eq("customer_id", invoice.customer_id),
    ]);

    const workOrder = wo as Pick<
      WorkOrder,
      | "contract_id"
      | "outside_contract"
      | "equipment_id"
      | "problem_description"
      | "completion_date"
      | "created_at"
    > | null;

    const activeContracts = ((contracts as ServiceContract[]) ?? []).filter((c) =>
      /active|renewed/i.test(c.status),
    );
    const onContractWorkOrder = Boolean(workOrder?.contract_id) && !workOrder?.outside_contract;
    const tmPath = isTmBillingEligible({
      outsideContract: workOrder?.outside_contract,
      hasActiveContract: onContractWorkOrder,
    });

    if (tmPath) {
      setPricingBanner({
        kind: "tm",
        message:
          "Time & materials (non-contract) — full labor + parts + tax. Customer may save with a Gold, Silver, or Bronze plan.",
      });
      return;
    }

    const contract =
      activeContracts.find((c) => c.id === workOrder?.contract_id) ?? activeContracts[0];
    if (!contract) {
      setPricingBanner(null);
      return;
    }

    let priorRows: Pick<
      WorkOrder,
      "equipment_id" | "problem_description" | "completion_date" | "created_at"
    >[] = [];
    if (workOrder?.equipment_id) {
      const { data: prior } = await supabase
        .from("work_orders")
        .select("equipment_id, problem_description, completion_date, created_at")
        .eq("customer_id", invoice.customer_id)
        .eq("equipment_id", workOrder.equipment_id)
        .neq("id", invoice.work_order_id)
        .order("created_at", { ascending: false })
        .limit(20);
      priorRows = (prior as typeof priorRows) ?? [];
    }

    const waived = workOrder
      ? sameBreakdownFeeWaived(
          {
            equipmentId: workOrder.equipment_id,
            problemDescription: workOrder.problem_description,
            completionDate: workOrder.completion_date,
            createdAt: workOrder.created_at,
          },
          priorRows.map((row) => ({
            equipmentId: row.equipment_id,
            problemDescription: row.problem_description,
            completionDate: row.completion_date,
            createdAt: row.created_at,
          })),
        )
      : false;

    const fee = suggestedContractServiceFee(contract, waived);
    const summary = pricingSummaryFromContract(contract);
    const caps = coverageCapsFromContract(contract);
    const laborParts =
      detailLines
        .filter((l) => l.kind === "labor" || l.kind === "parts")
        .reduce((s, l) => s + Math.max(0, Number(l.amount)), 0) ||
      Number(invoice.labor_charges) + Number(invoice.parts_charges);

    let message = `Contract pricing — ${formatMonthlyPremium(summary.monthlyPremium)} · $${summary.serviceFeePerVisit}/visit`;
    if (waived) {
      message += " · Service fee waived (same breakdown within 30 days)";
    } else if (fee > 0) {
      message += ` · Suggested service fee: ${formatMoney(fee)}`;
    }

    if (caps.partsAllowance > 0 && laborParts > caps.partsAllowance) {
      setPricingBanner({
        kind: "over_cap",
        message: `${message}. May exceed annual parts allowance (${formatMoney(caps.partsAllowance)}) — ${contract.approval_requirements ?? "manager approval required"}.`,
        suggestFee: fee,
      });
      return;
    }

    setPricingBanner({
      kind: "contract",
      message,
      suggestFee: fee > 0 ? fee : undefined,
    });
  }

  function applySuggestedServiceFee() {
    if (!pricingBanner?.suggestFee || pricingBanner.suggestFee <= 0) return;
    const hasFee = editLines.some(
      (l) => l.kind === "additional" && /service fee/i.test(l.description),
    );
    if (hasFee) return;
    setEditLines((rows) => [
      ...rows,
      {
        ...newEditableLine("additional"),
        description: "Contract service fee — per service visit",
        quantity: "1",
        unitPrice: String(pricingBanner.suggestFee),
        amount: String(pricingBanner.suggestFee),
      },
    ]);
    setDirty(true);
  }

  useEffect(() => {
    load();
  }, [id]);

  const canEdit = inv ? isUnsentInvoice(inv.status) : false;

  const liveTotals = useMemo(() => {
    if (!inv || !canEdit) return null;
    return rollupEditableLines(editLines, taxRate, Number(inv.amount_paid));
  }, [editLines, taxRate, inv, canEdit]);

  function updateLine(lineId: string, patch: Partial<EditableInvoiceLine>) {
    setEditLines((rows) =>
      rows.map((row) => {
        if (row.id !== lineId) return row;
        const next = { ...row, ...patch };
        if ("quantity" in patch || "unitPrice" in patch) {
          if (next.quantity !== "" && next.unitPrice !== "") {
            next.amount = recomputeLineAmount(next);
          }
        }
        return next;
      }),
    );
    setDirty(true);
    setSavedMsg(null);
  }

  function addLine(kind: EditableInvoiceLine["kind"] = "additional") {
    setEditLines((rows) => [...rows, newEditableLine(kind)]);
    setDirty(true);
    setSavedMsg(null);
  }

  function removeLine(lineId: string) {
    setEditLines((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.id !== lineId)));
    setDirty(true);
    setSavedMsg(null);
  }

  async function saveLines() {
    if (!inv || !liveTotals) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("invoices")
      .update({
        labor_charges: liveTotals.labor_charges,
        parts_charges: liveTotals.parts_charges,
        recurring_service_charge: liveTotals.recurring_service_charge,
        additional_charges: liveTotals.additional_charges,
        warranty_deductions: liveTotals.warranty_deductions,
        discounts: liveTotals.discounts,
        tax: liveTotals.tax,
        invoice_total: liveTotals.invoice_total,
        remaining_balance: liveTotals.remaining_balance,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inv.id);

    if (updError) {
      setError(updError.message);
      setSaving(false);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "line_items_updated",
      recordType: "invoice",
      recordId: inv.id,
      newValue: formatMoney(liveTotals.invoice_total),
    });

    setDirty(false);
    setSavedMsg("Line items saved");
    await load();
    setSaving(false);
  }

  async function setStatus(status: string) {
    if (!inv) return;
    if (canEdit && dirty) {
      await saveLines();
    }
    setSaving(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("invoices")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (updError) {
      setError(updError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "status_change",
      recordType: "invoice",
      recordId: inv.id,
      newValue: status,
    });
    await load();
    setSaving(false);
  }

  async function setAssignee(userId: string | null) {
    if (!inv) return;
    setSaving(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("invoices")
      .update({ assigned_to: userId, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (updError) {
      const msg = updError.message.includes("assigned_to")
        ? `${updError.message} — run supabase/migrations/20260805_invoice_assignment_status.sql in Supabase.`
        : updError.message;
      setError(msg);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "assigned",
      recordType: "invoice",
      recordId: inv.id,
      newValue: userId ?? "unassigned",
    });
    await load();
    setSaving(false);
  }

  async function attachEquipment(equipmentId: string) {
    if (!inv) return;
    setSaving(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("invoices")
      .update({ equipment_id: equipmentId || null, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (updError) {
      const msg = updError.message.includes("equipment_id")
        ? `${updError.message} — run supabase/migrations/20260805_invoice_equipment.sql in Supabase.`
        : updError.message;
      setError(msg);
      setSaving(false);
      return;
    }
    // Keep job in sync when invoice equipment is set
    if (inv.work_order_id && equipmentId) {
      await supabase
        .from("work_orders")
        .update({ equipment_id: equipmentId, updated_at: new Date().toISOString() })
        .eq("id", inv.work_order_id);
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "equipment_attached",
      recordType: "invoice",
      recordId: inv.id,
      newValue: equipmentId || "none",
    });
    await load();
    setSaving(false);
  }

  async function saveInvoicePoNumber(poNumber: string) {
    if (!inv) return;
    setSaving(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("invoices")
      .update({ po_number: poNumber || null, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (updError) {
      const msg = updError.message.includes("po_number")
        ? `${updError.message} — run supabase/migrations/20260805_purchase_orders.sql in Supabase.`
        : updError.message;
      setError(msg);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "po_number",
      recordType: "invoice",
      recordId: inv.id,
      newValue: poNumber || "cleared",
    });
    await load();
    setSaving(false);
  }

  const emailRecipients: EmailInvoiceRecipient[] = useMemo(() => {
    if (!inv) return [];
    const customerEmail = inv.customers?.email?.trim() ?? "";
    const vendorEmail = serviceVendor?.email?.trim() ?? "";
    const hasWo = Boolean(inv.work_order_id);
    const hasVendor = Boolean(inv.work_orders?.service_vendor_id && serviceVendor);
    return [
      {
        kind: "customer",
        label: `Customer — ${inv.customers?.name ?? "Bill-to"}`,
        defaultTo: customerEmail,
        available: true,
        hint: customerEmail ? undefined : "No customer email on file — enter one to send.",
      },
      {
        kind: "service_vendor",
        label: hasVendor
          ? `Service vendor — ${serviceVendor!.name}`
          : "Service vendor",
        defaultTo: vendorEmail,
        available: hasWo && hasVendor,
        hint: !hasWo
          ? "Link a work order to email a service vendor."
          : !hasVendor
            ? "Assign a service vendor on the work order first."
            : vendorEmail
              ? undefined
              : "Vendor has no email — enter one to send.",
      },
    ];
  }, [inv, serviceVendor]);

  function pdfWorkOrder(): ServiceHistoryWorkOrder {
    return {
      id: inv!.work_orders?.id ?? inv!.work_order_id ?? "",
      work_order_number: inv!.work_orders?.work_order_number ?? "—",
      work_order_type: inv!.work_orders?.work_order_type ?? null,
      equipment: inv!.equipment
        ? {
            id: inv!.equipment.id,
            name: inv!.equipment.name,
            location: inv!.equipment.location ?? null,
          }
        : null,
    } as ServiceHistoryWorkOrder;
  }

  async function handleDownloadPdf() {
    if (!inv) return;
    setError(null);
    try {
      await downloadInvoicePdf(inv, pdfWorkOrder(), {
        name: inv.customers?.name ?? "Customer",
        email: inv.customers?.email,
        phone: inv.customers?.phone,
        city: inv.customers?.city,
        state: inv.customers?.state,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build PDF.");
    }
  }

  async function handleEmailSend(payload: {
    recipients: Array<{ kind: "customer" | "service_vendor"; to: string }>;
    subject: string;
    message: string;
  }) {
    if (!inv) return;
    if (payload.recipients.length === 0) {
      setEmailError("Select at least one recipient.");
      return;
    }
    setEmailBusy(true);
    setEmailError(null);
    try {
      const pdfBase64 = await invoicePdfToBase64(inv, pdfWorkOrder(), {
        name: inv.customers?.name ?? "Customer",
        email: inv.customers?.email,
        phone: inv.customers?.phone,
        city: inv.customers?.city,
        state: inv.customers?.state,
      });

      const res = await fetch(`/api/invoices/${inv.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, pdfBase64 }),
      });
      const json = (await res.json()) as {
        error?: string;
        sent?: Array<{ kind: string; to: string }>;
        failures?: Array<{ kind: string; error: string }>;
      };
      if (!res.ok) {
        throw new Error(json.error || "Email failed.");
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const sentKinds = (json.sent ?? []).map((s) => s.kind);
      await logActivity(supabase, {
        userId: user?.id ?? null,
        action: "invoice_emailed",
        recordType: "invoice",
        recordId: inv.id,
        newValue: sentKinds.join(","),
      });

      if (sentKinds.includes("customer") && isUnsentInvoice(inv.status)) {
        await setStatus("Sent");
      }

      const failNote =
        json.failures && json.failures.length
          ? ` Some failed: ${json.failures.map((f) => f.error).join("; ")}`
          : "";
      setSavedMsg(
        `Emailed invoice to ${(json.sent ?? []).map((s) => s.to).join(", ")}.${failNote}`,
      );
      setEmailOpen(false);
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "Email failed.");
    } finally {
      setEmailBusy(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading invoice…</div>;
  }

  if (!inv) {
    return (
      <div className="p-6">
        <EmptyState
          title="Record not found"
          description="This invoice may have been removed or the link is invalid."
          action={
            <Link href="/billing" className="btn btn-sm">
              Back to Billing
            </Link>
          }
        />
      </div>
    );
  }

  const today = new Date();
  const bucket = invoiceBucket(inv, today);
  const overdueDays = daysPastDue(inv, today);
  const displaySubtotal = liveTotals?.subtotal ??
    Number(inv.labor_charges) +
      Number(inv.parts_charges) +
      Number(inv.recurring_service_charge) +
      Number(inv.additional_charges) -
      Number(inv.warranty_deductions) -
      Number(inv.discounts);
  const displayTax = liveTotals?.tax ?? Number(inv.tax);
  const displayTotal = liveTotals?.invoice_total ?? Number(inv.invoice_total);
  const displayBalance = liveTotals?.remaining_balance ?? Number(inv.remaining_balance);

  const workOrder = inv.work_orders;
  const showLines = canEdit ? editLines : lines;
  const assignee = team.find((m) => m.id === inv.assigned_to);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => router.push("/billing")}>
          <ArrowLeft className="h-4 w-4" /> Back to invoices
        </button>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              disabled={saving || !dirty}
              onClick={saveLines}
            >
              <Save className="h-4 w-4" /> Save line items
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              disabled={saving}
              onClick={() => setStatus("Needs Review")}
            >
              Mark needs review
            </button>
          ) : null}
          {canEdit || inv.status === "Needs Review" ? (
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              disabled={saving}
              onClick={() => setStatus("Reviewed")}
            >
              Mark reviewed
            </button>
          ) : null}
          {canEdit || inv.status === "Needs Review" || inv.status === "Reviewed" || inv.status === "On Hold" ? (
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              disabled={saving}
              onClick={() => setStatus("Sent")}
            >
              <Send className="h-4 w-4" /> {dirty ? "Save & send" : "Send invoice"}
            </button>
          ) : null}
          {inv.status === "Sent" || inv.status === "Partially Paid" ? (
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              disabled={saving}
              onClick={() => setStatus("On Hold")}
            >
              Put on hold
            </button>
          ) : null}
          {inv.status === "Sent" || inv.status === "Partially Paid" || inv.status === "Reviewed" ? (
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              disabled={saving}
              onClick={() => setStatus("Draft")}
            >
              <FileEdit className="h-4 w-4" /> Revert to draft
            </button>
          ) : null}
          {Number(inv.remaining_balance) > 0 && inv.status !== "Canceled" && !canEdit ? (
            <Link href={`/payments?invoice=${inv.id}`} className="btn btn-outline btn-sm gap-1">
              <CreditCard className="h-4 w-4" /> Record payment
            </Link>
          ) : null}
          <button
            type="button"
            className="btn btn-outline btn-sm gap-1"
            disabled={saving || emailBusy}
            onClick={() => void handleDownloadPdf()}
          >
            <Download className="h-4 w-4" /> Download PDF
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm gap-1"
            disabled={saving || emailBusy || inv.status === "Canceled"}
            onClick={() => {
              setEmailError(null);
              setEmailOpen(true);
            }}
          >
            <Mail className="h-4 w-4" /> Email invoice
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-error mb-4 text-sm">{error}</div> : null}
      {savedMsg ? <div className="alert alert-success mb-4 text-sm">{savedMsg}</div> : null}

      <div className="card mb-4 bg-base-100 shadow">
        <div className="card-body py-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Status & assignment</h2>
            {assignee ? (
              <p className="text-sm opacity-70">
                Currently: <span className="font-medium">{assignee.full_name || assignee.email}</span>
              </p>
            ) : (
              <p className="text-sm opacity-50">No one assigned</p>
            )}
          </div>
          <InvoiceWorkflowControls
            status={inv.status}
            assignedTo={inv.assigned_to}
            team={team}
            busy={saving}
            onStatusChange={setStatus}
            onAssignChange={setAssignee}
          />
          <p className="mt-2 text-xs opacity-60">
            Workflow queues: Draft → Needs Review → Reviewed → Sent (or On Hold anytime before paid).
          </p>
        </div>
      </div>

      <div className="card mb-4 bg-base-100 shadow">
        <div className="card-body py-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-70">
            Equipment worked on
          </h2>
          <EquipmentIdentityCard equipment={inv.equipment} emptyLabel="No equipment linked yet" />
          <div className="mt-3">
            <EquipmentAttachPanel
              customerId={inv.customer_id}
              equipment={customerEquipment}
              selectedId={inv.equipment_id ?? ""}
              disabled={saving}
              compact
              onSelect={attachEquipment}
              onCreated={(row) =>
                setCustomerEquipment((prev) => (prev.some((e) => e.id === row.id) ? prev : [...prev, row]))
              }
            />
          </div>
        </div>
      </div>

      <div className="card mb-4 bg-base-100 shadow">
        <div className="card-body py-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-70">
            PO number &amp; receipts
          </h2>
          <PurchaseOrderPanel
            invoiceId={inv.id}
            workOrderId={inv.work_order_id}
            invoicePoNumber={inv.po_number}
            onInvoicePoChange={saveInvoicePoNumber}
            canEdit
          />
        </div>
      </div>

      {canEdit ? (
        <div className="alert alert-info mb-4 sticky top-16 z-20 text-sm shadow-sm">
          <div>
            <p className="font-semibold">Edit unsent invoice</p>
            <p>
              Workflow status: <strong>{inv.status}</strong>. Edit line items, assign an owner, attach PO/receipts, then{" "}
              <strong>Send</strong> when ready. Qty × Rate auto-fills Amount; tax updates at {(taxRate * 100).toFixed(2)}%.
              After send, lines are locked unless you <strong>Revert to draft</strong>.
            </p>
          </div>
        </div>
      ) : inv.status !== "Canceled" && inv.status !== "Paid" ? (
        <div className="alert alert-warning mb-4 text-sm">
          <div>
            <p className="font-semibold">Line items locked</p>
            <p>
              This invoice is <strong>{inv.status}</strong>, so line items cannot be edited.
              {(inv.status === "Sent" || inv.status === "Partially Paid") ? (
                <>
                  {" "}
                  Click <strong>Revert to draft</strong> above to unlock editing, then save and send again when ready.
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}

      {pricingBanner ? (
        <div
          className={`alert mb-4 text-sm ${
            pricingBanner.kind === "tm"
              ? "alert-info"
              : pricingBanner.kind === "over_cap"
                ? "alert-warning"
                : "alert-success"
          }`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>{pricingBanner.message}</p>
            {canEdit && pricingBanner.suggestFee && pricingBanner.suggestFee > 0 ? (
              <button type="button" className="btn btn-sm btn-primary" onClick={applySuggestedServiceFee}>
                Add {formatMoney(pricingBanner.suggestFee)} service fee
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <article className="card overflow-hidden bg-base-100 shadow-lg">
        <div className="border-b border-base-300 bg-base-200/50 px-6 py-5 sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
                EquipmentIQ
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{inv.invoice_number}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                {invoiceBatch ? (
                  <Link
                    href={`/batches/${invoiceBatch.batchId}`}
                    className="badge badge-primary badge-outline badge-sm"
                    title={`Batch ${invoiceBatch.status}`}
                  >
                    Batch {invoiceBatch.batchNumber}
                  </Link>
                ) : null}
                {bucket === "past_due" ? (
                  <span className="text-sm text-error">{overdueDays} days past due</span>
                ) : null}
                {dirty ? <span className="badge badge-warning badge-sm">Unsaved edits</span> : null}
              </div>
            </div>
            <div className="text-sm sm:text-right">
              <p className="opacity-60">Balance due</p>
              <p className="text-2xl font-bold">{formatMoney(displayBalance)}</p>
              <p className="mt-1 opacity-70">
                Total {formatMoney(displayTotal)} · Paid {formatMoney(inv.amount_paid)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 border-b border-base-300 px-6 py-6 sm:grid-cols-2 sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Bill to</p>
            <p className="mt-1 text-lg font-semibold">
              {inv.customer_id ? (
                <Link href={`/customers/${inv.customer_id}`} className="link link-hover">
                  {inv.customers?.name ?? "Customer"}
                </Link>
              ) : (
                inv.customers?.name ?? "Customer"
              )}
            </p>
            {inv.customers?.billing_address ? (
              <p className="mt-1 whitespace-pre-line text-sm opacity-80">{inv.customers.billing_address}</p>
            ) : null}
            {inv.customers?.email ? (
              <p className="mt-1 text-sm opacity-70">
                <a href={`mailto:${inv.customers.email}`} className="link link-hover">
                  {inv.customers.email}
                </a>
              </p>
            ) : null}
            {inv.customers?.phone ? (
              <p className="text-sm opacity-70">
                <a href={`tel:${inv.customers.phone}`} className="link link-hover">
                  {inv.customers.phone}
                </a>
              </p>
            ) : null}
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
                Email recipients
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                <li>
                  Customer:{" "}
                  {inv.customers?.email ? (
                    <span className="opacity-80">{inv.customers.email}</span>
                  ) : (
                    <span className="text-warning">No email on file</span>
                  )}
                </li>
                <li>
                  Service vendor:{" "}
                  {serviceVendor ? (
                    <>
                      <span className="font-medium">{serviceVendor.name}</span>
                      {serviceVendor.email ? (
                        <span className="opacity-80"> · {serviceVendor.email}</span>
                      ) : (
                        <span className="text-warning"> · No email on file</span>
                      )}
                    </>
                  ) : inv.work_order_id ? (
                    <span className="opacity-60">None assigned on work order</span>
                  ) : (
                    <span className="opacity-60">No work order linked</span>
                  )}
                </li>
              </ul>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:text-right">
            <div>
              <p className="opacity-60">Invoice date</p>
              <p className="font-medium">{inv.invoice_date}</p>
            </div>
            <div>
              <p className="opacity-60">Due date</p>
              <p className={`font-medium ${bucket === "past_due" ? "text-error" : ""}`}>{inv.due_date}</p>
            </div>
            {inv.po_number ? (
              <div className="col-span-2">
                <p className="opacity-60">PO number</p>
                <p className="font-mono font-semibold">{inv.po_number}</p>
              </div>
            ) : null}
            {workOrder?.work_order_number ? (
              <div className="col-span-2">
                <p className="opacity-60">Job</p>
                <p className="font-medium">
                  {inv.work_order_id ? (
                    <Link href={`/work-orders/${inv.work_order_id}`} className="link link-primary">
                      {workOrder.work_order_number}
                    </Link>
                  ) : (
                    workOrder.work_order_number
                  )}
                </p>
              </div>
            ) : null}
            {inv.equipment ? (
              <div className="col-span-2 text-left sm:text-right">
                <p className="opacity-60">Equipment</p>
                <p className="font-medium">{inv.equipment.name}</p>
                <p className="text-xs opacity-70">
                  {inv.equipment.model ? `Model ${inv.equipment.model}` : "Model —"}
                  {" · "}
                  {inv.equipment.serial_number ? `S/N ${inv.equipment.serial_number}` : "S/N —"}
                  {inv.equipment.installation_date
                    ? ` · Installed ${inv.equipment.installation_date}`
                    : ""}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="px-6 py-4 sm:px-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">
              Line items {canEdit ? <span className="badge badge-info badge-sm ml-2 normal-case">Editable</span> : null}
            </h2>
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="select select-bordered select-xs"
                  value={addKind}
                  onChange={(e) => setAddKind(e.target.value as EditableInvoiceLine["kind"])}
                  aria-label="Line type to add"
                >
                  {EDITABLE_LINE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-primary btn-xs gap-1" onClick={() => addLine(addKind)}>
                  <Plus className="h-3 w-3" /> Add line
                </button>
                <button type="button" className="btn btn-outline btn-xs gap-1" onClick={() => addLine("labor")}>
                  <Plus className="h-3 w-3" /> Labor
                </button>
                <button type="button" className="btn btn-outline btn-xs gap-1" onClick={() => addLine("parts")}>
                  <Plus className="h-3 w-3" /> Parts
                </button>
              </div>
            ) : null}
          </div>

          <DualHorizontalScroll className="rounded-box border border-base-300">
            {canEdit ? (
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th className="min-w-[7rem]">Type</th>
                    <th className="min-w-[12rem]">Description</th>
                    <th className="w-24 text-right">Qty</th>
                    <th className="w-28 text-right">Rate</th>
                    <th className="w-32 text-right">Amount</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {editLines.map((line) => {
                    const isDeduction = line.kind === "warranty" || line.kind === "discount";
                    return (
                      <tr key={line.id}>
                        <td>
                          <select
                            className="select select-bordered select-sm w-full max-w-[9rem]"
                            value={line.kind}
                            onChange={(e) =>
                              updateLine(line.id, {
                                kind: e.target.value as EditableInvoiceLine["kind"],
                              })
                            }
                          >
                            {EDITABLE_LINE_KINDS.map((k) => (
                              <option key={k.value} value={k.value}>
                                {k.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input input-bordered input-sm w-full min-w-[10rem]"
                            value={line.description}
                            onChange={(e) => updateLine(line.id, { description: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            className="input input-bordered input-sm w-full text-right"
                            placeholder="—"
                            value={line.quantity}
                            onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="input input-bordered input-sm w-full text-right"
                            placeholder="—"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                          />
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            {isDeduction ? <span className="text-error">−</span> : null}
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="input input-bordered input-sm w-full text-right"
                              value={line.amount}
                              onChange={(e) => updateLine(line.id, { amount: e.target.value })}
                            />
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-error"
                            onClick={() => removeLine(line.id)}
                            disabled={editLines.length <= 1}
                            aria-label="Remove line"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {showLines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="opacity-60">
                        No line detail stored for this invoice.
                      </td>
                    </tr>
                  ) : (
                    (showLines as BillableLine[]).map((line, i) => (
                      <tr key={i}>
                        <td>{line.description}</td>
                        <td className="text-right">{line.quantity != null ? line.quantity : "—"}</td>
                        <td className="text-right">
                          {line.unitPrice != null ? formatMoney(line.unitPrice) : "—"}
                        </td>
                        <td className="text-right font-medium">{formatMoney(line.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </DualHorizontalScroll>

          {canEdit ? (
            <p className="mt-2 text-xs opacity-60">
              Tip: enter Qty and Rate to auto-calc amount, or type Amount directly. Warranty and discounts reduce the
              subtotal. Keep at least one line; $0 lines are allowed until you adjust them.
            </p>
          ) : null}

          <div className="mt-6 ml-auto max-w-sm rounded-box border border-base-300 bg-base-200/40 p-4 space-y-2 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
              {canEdit ? "Live totals (unsaved until you save)" : "Totals"}
            </p>
            {liveTotals ? (
              <>
                <div className="flex justify-between text-xs opacity-70">
                  <span>Labor</span>
                  <span>{formatMoney(liveTotals.labor_charges)}</span>
                </div>
                <div className="flex justify-between text-xs opacity-70">
                  <span>Parts</span>
                  <span>{formatMoney(liveTotals.parts_charges)}</span>
                </div>
                {liveTotals.recurring_service_charge > 0 ? (
                  <div className="flex justify-between text-xs opacity-70">
                    <span>Recurring</span>
                    <span>{formatMoney(liveTotals.recurring_service_charge)}</span>
                  </div>
                ) : null}
                {liveTotals.additional_charges > 0 ? (
                  <div className="flex justify-between text-xs opacity-70">
                    <span>Additional</span>
                    <span>{formatMoney(liveTotals.additional_charges)}</span>
                  </div>
                ) : null}
                {liveTotals.warranty_deductions > 0 ? (
                  <div className="flex justify-between text-xs opacity-70">
                    <span>Warranty</span>
                    <span>−{formatMoney(liveTotals.warranty_deductions)}</span>
                  </div>
                ) : null}
                {liveTotals.discounts > 0 ? (
                  <div className="flex justify-between text-xs opacity-70">
                    <span>Discounts</span>
                    <span>−{formatMoney(liveTotals.discounts)}</span>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-between">
              <span className="opacity-70">Subtotal</span>
              <span>{formatMoney(displaySubtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Tax ({(taxRate * 100).toFixed(2)}%)</span>
              <span>{formatMoney(displayTax)}</span>
            </div>
            <div className="flex justify-between border-t border-base-300 pt-2 text-base font-bold">
              <span>Invoice total</span>
              <span>{formatMoney(displayTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Payments</span>
              <span>−{formatMoney(inv.amount_paid)}</span>
            </div>
            <div className="flex justify-between border-t border-base-300 pt-2 text-lg font-bold">
              <span>Balance due</span>
              <span>{formatMoney(displayBalance)}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-base-300 px-6 py-4 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Notes</p>
          {canEdit ? (
            <textarea
              className="textarea textarea-bordered mt-2 w-full"
              rows={2}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
              placeholder="Internal or customer-facing notes…"
            />
          ) : inv.notes ? (
            <p className="mt-1 whitespace-pre-line text-sm">{inv.notes}</p>
          ) : (
            <p className="mt-1 text-sm opacity-50">No notes</p>
          )}
        </div>

        {payments.length > 0 ? (
          <div className="border-t border-base-300 px-6 py-4 sm:px-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-70">Payments</h2>
            <DualHorizontalScroll>
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Payment #</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.payment_number}</td>
                      <td>{p.payment_date}</td>
                      <td>{p.payment_method}</td>
                      <td className="text-right">{formatMoney(p.payment_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DualHorizontalScroll>
          </div>
        ) : null}
      </article>

      <EmailInvoiceModal
        open={emailOpen}
        invoiceNumber={inv.invoice_number}
        customerName={inv.customers?.name ?? "Customer"}
        recipients={emailRecipients}
        busy={emailBusy}
        error={emailError}
        onClose={() => {
          if (!emailBusy) setEmailOpen(false);
        }}
        onSend={(payload) => void handleEmailSend(payload)}
      />
    </div>
  );
}
