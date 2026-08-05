"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  User,
  Wrench,
  Calendar,
  Package,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { FormRow } from "@/components/PageHeader";
import { StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { ActivityFeed } from "@/components/ActivityFeed";
import { EquipmentAttachPanel, EquipmentIdentityCard, type EquipmentOption } from "@/components/EquipmentAttachPanel";
import { formatMoney } from "@/lib/calculations";
import { buildWorkOrderPreview, sumLaborCharges, sumPartsCharges } from "@/lib/billing";
import { JOB_STAGES, formatJobTime, isJobUrgent, jobStageIndex } from "@/lib/jobs";
import { linkWorkOrderPosToInvoice } from "@/lib/purchaseOrders";
import { PurchaseOrderPanel } from "@/components/PurchaseOrderPanel";
import type {
  AdditionalWorkRequest,
  Invoice,
  Part,
  Profile,
  TechnicianLabor,
  WorkOrder,
  WorkOrderPart,
} from "@/lib/types";

type JobDetail = WorkOrder & {
  customers?: {
    name: string;
    billing_address?: string | null;
    phone?: string | null;
    email?: string | null;
    service_address?: string | null;
  };
  equipment?: EquipmentOption | null;
};

/**
 * ServiceTitan-style Job detail hub:
 * customer, schedule, labor, parts, approvals, billing — one connected view.
 */
export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [wo, setWo] = useState<JobDetail | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [technicians, setTechnicians] = useState<Profile[]>([]);
  const [techName, setTechName] = useState<string>("—");
  const [labor, setLabor] = useState<TechnicianLabor[]>([]);
  const [parts, setParts] = useState<(WorkOrderPart & { parts?: Part })[]>([]);
  const [additional, setAdditional] = useState<AdditionalWorkRequest[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [inventory, setInventory] = useState<Part[]>([]);
  const [customerEquipment, setCustomerEquipment] = useState<EquipmentOption[]>([]);
  const [taxRate, setTaxRate] = useState(0.0825);

  const [managerNotes, setManagerNotes] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");
  const [techNotes, setTechNotes] = useState("");
  const [assignTech, setAssignTech] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [laborForm, setLaborForm] = useState({ regular_hours: "1", overtime_hours: "0", notes: "" });
  const [partForm, setPartForm] = useState({ part_id: "", quantity_used: "1" });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "labor" | "parts" | "approvals" | "billing">("overview");

  async function load() {
    const [{ data }, { data: { user } }, { data: settings }] = await Promise.all([
      supabase
        .from("work_orders")
        .select(
          "*, customers(name, billing_address, phone, email, service_address), equipment(id, name, model, serial_number, installation_date, manufacturer, location, operating_status, customer_id)",
        )
        .eq("id", id)
        .single(),
      supabase.auth.getUser(),
      supabase.from("company_settings").select("default_tax_rate").limit(1).single(),
    ]);

    const w = data as JobDetail | null;
    setWo(w);
    if (w) {
      setManagerNotes(w.manager_notes ?? "");
      setWorkPerformed(w.work_performed ?? "");
      setTechNotes(w.technician_notes ?? "");
      setAssignTech(w.assigned_technician_id ?? "");
      setScheduleDate(w.scheduled_date ?? "");
    }
    if (settings?.default_tax_rate) setTaxRate(Number(settings.default_tax_rate));

    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
    }

    const [{ data: tech }, { data: lab }, { data: pts }, { data: awr }, { data: inv }, { data: stock }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("role", "technician").eq("is_active", true),
        supabase.from("technician_labor").select("*").eq("work_order_id", id).order("work_date", { ascending: false }),
        supabase.from("work_order_parts").select("*, parts(*)").eq("work_order_id", id),
        supabase.from("additional_work_requests").select("*").eq("work_order_id", id).order("created_at", { ascending: false }),
        supabase.from("invoices").select("*").eq("work_order_id", id).order("created_at", { ascending: false }),
        supabase.from("parts").select("*").eq("is_active", true).order("name"),
      ]);

    const techs = (tech as Profile[]) ?? [];
    setTechnicians(techs);
    setLabor((lab as TechnicianLabor[]) ?? []);
    setParts((pts as typeof parts) ?? []);
    setAdditional((awr as AdditionalWorkRequest[]) ?? []);
    setInvoices((inv as Invoice[]) ?? []);
    setInventory((stock as Part[]) ?? []);

    if (w?.customer_id) {
      const { data: eqList } = await supabase
        .from("equipment")
        .select(
          "id, name, model, serial_number, installation_date, manufacturer, location, operating_status, customer_id",
        )
        .eq("customer_id", w.customer_id)
        .order("name");
      setCustomerEquipment((eqList as EquipmentOption[]) ?? []);
    } else {
      setCustomerEquipment([]);
    }

    if (w?.assigned_technician_id) {
      const found = techs.find((t) => t.id === w.assigned_technician_id);
      if (found) setTechName(found.full_name || found.email);
      else {
        const { data: named } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", w.assigned_technician_id)
          .single();
        setTechName(named ? named.full_name || named.email : "—");
      }
    } else {
      setTechName("Unassigned");
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  const isManager = profile?.role === "administrator" || profile?.role === "service_manager";
  const isBilling = profile?.role === "billing" || profile?.role === "administrator";
  const isTech =
    profile?.role === "technician" ||
    profile?.role === "administrator" ||
    profile?.role === "service_manager";
  const canEditField = isManager || profile?.role === "technician";

  async function patchJob(updates: Record<string, unknown>, activity: string, newValue?: string) {
    setSaving(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("work_orders")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updError) {
      setError(updError.message);
      setSaving(false);
      return false;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: activity,
      recordType: "work_order",
      recordId: id,
      newValue: newValue ?? String(updates.status ?? activity),
    });
    await load();
    setSaving(false);
    return true;
  }

  async function saveAssignment() {
    const status =
      assignTech && scheduleDate
        ? "Scheduled"
        : assignTech
          ? "Assigned"
          : wo?.status === "Requested"
            ? "Requested"
            : wo?.status ?? "Requested";
    await patchJob(
      {
        assigned_technician_id: assignTech || null,
        scheduled_date: scheduleDate || null,
        status: ["Completed", "Closed", "Canceled", "Ready for Review", "In Progress"].includes(wo?.status ?? "")
          ? wo?.status
          : status,
      },
      "dispatch_update",
      assignTech ? "Assigned/Scheduled" : "Unassigned",
    );
  }

  async function setStatus(status: string, extra: Record<string, unknown> = {}) {
    await patchJob({ status, ...extra }, "status_change", status);
  }

  async function approveComplete() {
    if (!profile) return;
    await patchJob(
      {
        status: "Completed",
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
        completion_date: new Date().toISOString().slice(0, 10),
        manager_notes: managerNotes,
        work_performed: workPerformed,
      },
      "approved_completion",
      "Completed",
    );
  }

  async function saveNotes() {
    await patchJob(
      {
        manager_notes: managerNotes,
        work_performed: workPerformed,
        technician_notes: techNotes,
      },
      "notes_saved",
      "notes",
    );
  }

  async function fieldAction(action: "arrival" | "start" | "pause" | "ready") {
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {};
    if (action === "arrival") {
      updates.arrival_at = now;
      updates.status = "In Progress";
    }
    if (action === "start") {
      updates.started_at = now;
      updates.paused_at = null;
      updates.status = "In Progress";
    }
    if (action === "pause") {
      updates.paused_at = now;
    }
    if (action === "ready") {
      updates.status = "Ready for Review";
      updates.work_performed = workPerformed;
      updates.technician_notes = techNotes;
    }
    await patchJob(updates, action, String(updates.status ?? action));
  }

  async function addLabor(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    const rate = profile.hourly_cost_rate ?? 45;
    const billing = profile.hourly_billing_rate ?? 95;
    await supabase.from("technician_labor").insert({
      work_order_id: id,
      technician_id: profile.id,
      work_date: new Date().toISOString().slice(0, 10),
      regular_hours: Number(laborForm.regular_hours),
      overtime_hours: Number(laborForm.overtime_hours),
      hourly_cost_rate: rate,
      overtime_cost_rate: rate * 1.5,
      customer_billing_rate: billing,
      notes: laborForm.notes || null,
    });
    const { data: { user } } = await supabase.auth.getUser();
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "labor_added",
      recordType: "work_order",
      recordId: id,
      newValue: `${laborForm.regular_hours}h`,
    });
    setLaborForm({ regular_hours: "1", overtime_hours: "0", notes: "" });
    await load();
    setSaving(false);
  }

  async function addPart(e: React.FormEvent) {
    e.preventDefault();
    if (!partForm.part_id) return;
    setSaving(true);
    const part = inventory.find((p) => p.id === partForm.part_id);
    if (!part) {
      setSaving(false);
      return;
    }
    const qty = Number(partForm.quantity_used);
    const billable = part.standard_customer_price * qty;
    await supabase.from("work_order_parts").insert({
      work_order_id: id,
      part_id: part.id,
      quantity_used: qty,
      unit_cost: part.unit_cost,
      customer_price: part.standard_customer_price,
      billable_amount: billable,
    });
    await supabase.from("parts").update({ quantity_on_hand: part.quantity_on_hand - qty }).eq("id", part.id);
    const { data: { user } } = await supabase.auth.getUser();
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "part_used",
      recordType: "work_order",
      recordId: id,
      newValue: part.name,
    });
    setPartForm({ part_id: "", quantity_used: "1" });
    await load();
    setSaving(false);
  }

  async function decideAwr(awrId: string, approval_status: "Approved" | "Rejected") {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from("additional_work_requests")
      .update({
        approval_status,
        decided_by: profile?.id ?? null,
        decided_at: new Date().toISOString(),
      })
      .eq("id", awrId);
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "awr_decision",
      recordType: "work_order",
      recordId: id,
      newValue: approval_status,
    });
    await load();
    setSaving(false);
  }

  async function createInvoiceFromJob(asDraft: boolean) {
    if (!wo) return;
    setSaving(true);
    setError(null);
    const preview = buildWorkOrderPreview(labor, parts as WorkOrderPart[], taxRate);
    const due = new Date();
    due.setDate(due.getDate() + 30);
    const { data: { user } } = await supabase.auth.getUser();
    const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

    const { data: inv, error: insertError } = await supabase
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        customer_id: wo.customer_id,
        work_order_id: wo.id,
        contract_id: wo.contract_id,
        equipment_id: wo.equipment_id,
        due_date: due.toISOString().slice(0, 10),
        labor_charges: preview.laborCharges,
        parts_charges: preview.partsCharges,
        warranty_deductions: preview.warrantyDeductions,
        tax: preview.tax,
        invoice_total: preview.total,
        remaining_balance: preview.total,
        status: asDraft ? "Draft" : "Sent",
        created_by: user?.id ?? null,
      })
      .select()
      .single();

    if (insertError) {
      // Retry without equipment_id if column not migrated yet.
      if (insertError.message.includes("equipment_id")) {
        const retry = await supabase
          .from("invoices")
          .insert({
            invoice_number: invoiceNumber,
            customer_id: wo.customer_id,
            work_order_id: wo.id,
            contract_id: wo.contract_id,
            due_date: due.toISOString().slice(0, 10),
            labor_charges: preview.laborCharges,
            parts_charges: preview.partsCharges,
            warranty_deductions: preview.warrantyDeductions,
            tax: preview.tax,
            invoice_total: preview.total,
            remaining_balance: preview.total,
            status: asDraft ? "Draft" : "Sent",
            created_by: user?.id ?? null,
          })
          .select()
          .single();
        if (retry.error) {
          setError(retry.error.message);
          setSaving(false);
          return;
        }
        await supabase.from("work_orders").update({ billing_status: "Billed", updated_at: new Date().toISOString() }).eq("id", wo.id);
        await logActivity(supabase, {
          userId: user?.id ?? null,
          action: "created",
          recordType: "invoice",
          recordId: retry.data.id,
          newValue: invoiceNumber,
        });
        await linkWorkOrderPosToInvoice(supabase, wo.id, retry.data.id);
        setSaving(false);
        router.push(`/billing/${retry.data.id}`);
        return;
      }
      setError(insertError.message);
      setSaving(false);
      return;
    }

    await supabase.from("work_orders").update({ billing_status: "Billed", updated_at: new Date().toISOString() }).eq("id", wo.id);
    await linkWorkOrderPosToInvoice(supabase, wo.id, inv.id);
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "invoice",
      recordId: inv.id,
      newValue: invoiceNumber,
    });
    setSaving(false);
    router.push(`/billing/${inv.id}`);
  }

  async function attachEquipment(equipmentId: string) {
    if (!wo) return;
    setSaving(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("work_orders")
      .update({ equipment_id: equipmentId || null, updated_at: new Date().toISOString() })
      .eq("id", wo.id);
    if (updError) {
      setError(updError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "equipment_attached",
      recordType: "work_order",
      recordId: wo.id,
      newValue: equipmentId || "none",
    });
    await load();
    setSaving(false);
  }

  if (!wo) return <div className="p-8 text-center opacity-60">Loading job…</div>;

  const stageIdx = jobStageIndex(wo.status);
  const laborTotal = sumLaborCharges(labor);
  const partsTotal = sumPartsCharges(parts as WorkOrderPart[]);
  const estBillable = laborTotal + partsTotal;
  const urgent = isJobUrgent(wo);
  const openForField = !["Completed", "Closed", "Canceled"].includes(wo.status);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => router.push("/work-orders")}>
          <ArrowLeft className="h-4 w-4" /> Jobs board
        </button>
        <div className="flex flex-wrap gap-2">
          <Link href={`/customers/${wo.customer_id}`} className="btn btn-outline btn-sm gap-1">
            <User className="h-4 w-4" /> Customer
          </Link>
          {invoices[0] ? (
            <Link href={`/billing/${invoices[0].id}`} className="btn btn-outline btn-sm gap-1">
              <FileText className="h-4 w-4" /> Invoice
            </Link>
          ) : wo.status === "Completed" && wo.billing_status === "Unbilled" && isBilling ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => createInvoiceFromJob(false)}>
              Create invoice
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="alert alert-error mb-4 text-sm">{error}</div> : null}

      {urgent ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>
            {wo.priority === "Critical" ? "Critical priority" : "Emergency repair"} — requires immediate attention
          </span>
        </div>
      ) : null}

      <header className="mb-5 rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide opacity-60">Job</p>
            <h1 className="text-2xl font-bold sm:text-3xl">{wo.work_order_number}</h1>
            <p className="mt-1 text-sm opacity-70">
              {wo.customer_id ? (
                <Link href={`/customers/${wo.customer_id}`} className="link link-hover font-medium">
                  {wo.customers?.name ?? "Customer"}
                </Link>
              ) : (
                wo.customers?.name ?? "Customer"
              )}{" "}
              · {wo.work_order_type}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
              <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
              <StatusBadge label={wo.billing_status} tone={statusTone(wo.billing_status)} />
              <StatusBadge label={wo.warranty_coverage} tone={statusTone(wo.warranty_coverage)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:min-w-[16rem]">
            <div className="rounded-box bg-base-200/60 p-3">
              <p className="opacity-60">Technician</p>
              <p className="font-medium">{techName}</p>
            </div>
            <div className="rounded-box bg-base-200/60 p-3">
              <p className="opacity-60">Scheduled</p>
              <p className="font-medium">{wo.scheduled_date ?? "—"}</p>
            </div>
            <div className="rounded-box bg-base-200/60 p-3">
              <p className="opacity-60">Est. billable</p>
              <p className="font-medium">{formatMoney(estBillable)}</p>
            </div>
            <div className="rounded-box bg-base-200/60 p-3">
              <p className="opacity-60">Equipment</p>
              <p className="font-medium">{wo.equipment?.name ?? "—"}</p>
              {wo.equipment?.model || wo.equipment?.serial_number ? (
                <p className="mt-0.5 text-xs opacity-70">
                  {wo.equipment.model ? `Model ${wo.equipment.model}` : ""}
                  {wo.equipment.model && wo.equipment.serial_number ? " · " : ""}
                  {wo.equipment.serial_number ? `S/N ${wo.equipment.serial_number}` : ""}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <ul className="steps w-full text-[10px] sm:text-xs">
            {JOB_STAGES.map((stage, i) => (
              <li key={stage.key} className={`step ${i <= stageIdx ? "step-primary" : ""}`}>
                {stage.label}
              </li>
            ))}
          </ul>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["overview", "Overview"],
            ["labor", "Labor"],
            ["parts", "Parts"],
            ["approvals", "Approvals"],
            ["billing", "Billing"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`btn btn-sm ${tab === key ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab(key)}
          >
            {label}
            {key === "approvals" && additional.some((a) => a.approval_status === "Pending") ? (
              <span className="badge badge-warning badge-xs ml-1">
                {additional.filter((a) => a.approval_status === "Pending").length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {tab === "overview" ? (
            <>
              <div className="card bg-base-100 shadow">
                <div className="card-body space-y-4">
                  <h2 className="card-title text-base gap-2">
                    <User className="h-4 w-4" /> Customer & location
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 text-sm">
                    <div>
                      <p className="opacity-60">Customer</p>
                      <Link href={`/customers/${wo.customer_id}`} className="link link-primary font-medium">
                        {wo.customers?.name ?? "—"}
                      </Link>
                      {wo.customers?.phone ? (
                        <p className="opacity-70">
                          <a href={`tel:${wo.customers.phone}`} className="link link-hover">
                            {wo.customers.phone}
                          </a>
                        </p>
                      ) : null}
                      {wo.customers?.email ? (
                        <p className="opacity-70">
                          <a href={`mailto:${wo.customers.email}`} className="link link-hover">
                            {wo.customers.email}
                          </a>
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <p className="opacity-60">Service address</p>
                      <p className="whitespace-pre-line">
                        {wo.customers?.service_address || wo.customers?.billing_address || "—"}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="mb-2 opacity-60">Equipment worked on</p>
                      <EquipmentIdentityCard equipment={wo.equipment} />
                      {openForField || isBilling || profile?.role === "service_manager" || profile?.role === "administrator" ? (
                        <div className="mt-3">
                          <EquipmentAttachPanel
                            customerId={wo.customer_id}
                            equipment={customerEquipment}
                            selectedId={wo.equipment_id ?? ""}
                            disabled={saving}
                            onSelect={attachEquipment}
                            onCreated={(row) =>
                              setCustomerEquipment((prev) =>
                                prev.some((e) => e.id === row.id) ? prev : [...prev, row],
                              )
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <p className="opacity-60">Problem / request</p>
                      <p>{wo.problem_description ?? wo.requested_service ?? "—"}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <PurchaseOrderPanel
                    workOrderId={wo.id}
                    invoiceId={invoices[0]?.id}
                    canEdit={openForField || isBilling || profile?.role === "service_manager" || profile?.role === "administrator" || profile?.role === "technician"}
                  />
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body space-y-3">
                  <h2 className="card-title text-base gap-2">
                    <Clock className="h-4 w-4" /> Field timeline
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-2 text-sm">
                    <p>
                      <span className="opacity-60">Arrival:</span> {formatJobTime(wo.arrival_at)}
                    </p>
                    <p>
                      <span className="opacity-60">Started:</span> {formatJobTime(wo.started_at)}
                    </p>
                    <p>
                      <span className="opacity-60">Paused:</span> {formatJobTime(wo.paused_at)}
                    </p>
                    <p>
                      <span className="opacity-60">Completed:</span> {wo.completion_date ?? "—"}
                    </p>
                  </div>
                  <FormRow label="Work performed">
                    <textarea
                      className="textarea textarea-bordered w-full"
                      rows={3}
                      value={workPerformed}
                      onChange={(e) => setWorkPerformed(e.target.value)}
                      disabled={!canEditField || wo.status === "Canceled"}
                    />
                  </FormRow>
                  <FormRow label="Technician notes">
                    <textarea
                      className="textarea textarea-bordered w-full"
                      rows={2}
                      value={techNotes}
                      onChange={(e) => setTechNotes(e.target.value)}
                      disabled={!canEditField || wo.status === "Canceled"}
                    />
                  </FormRow>
                  <FormRow label="Manager notes">
                    <textarea
                      className="textarea textarea-bordered w-full"
                      rows={2}
                      value={managerNotes}
                      onChange={(e) => setManagerNotes(e.target.value)}
                      disabled={!isManager}
                    />
                  </FormRow>
                  {canEditField ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={saveNotes} disabled={saving}>
                      Save notes
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {tab === "labor" ? (
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title text-base gap-2">
                  <Clock className="h-4 w-4" /> Labor
                </h2>
                {isTech && openForField ? (
                  <form onSubmit={addLabor} className="mb-4 grid gap-3 sm:grid-cols-2">
                    <FormRow label="Regular hrs">
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        className="input input-bordered w-full"
                        value={laborForm.regular_hours}
                        onChange={(e) => setLaborForm({ ...laborForm, regular_hours: e.target.value })}
                      />
                    </FormRow>
                    <FormRow label="OT hrs">
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        className="input input-bordered w-full"
                        value={laborForm.overtime_hours}
                        onChange={(e) => setLaborForm({ ...laborForm, overtime_hours: e.target.value })}
                      />
                    </FormRow>
                    <FormRow label="Notes">
                      <input
                        className="input input-bordered w-full"
                        value={laborForm.notes}
                        onChange={(e) => setLaborForm({ ...laborForm, notes: e.target.value })}
                      />
                    </FormRow>
                    <div className="flex items-end">
                      <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                        Add labor
                      </button>
                    </div>
                  </form>
                ) : null}
                {labor.length === 0 ? (
                  <EmptyState title="No labor logged" description="Technicians add hours from the field or here." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Reg</th>
                          <th>OT</th>
                          <th>Rate</th>
                          <th className="text-right">Billable</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {labor.map((l) => {
                          const amount =
                            Number(l.regular_hours) * Number(l.customer_billing_rate) +
                            Number(l.overtime_hours) * Number(l.customer_billing_rate) * 1.5;
                          return (
                            <tr key={l.id}>
                              <td>{l.work_date}</td>
                              <td>{l.regular_hours}</td>
                              <td>{l.overtime_hours}</td>
                              <td>{formatMoney(l.customer_billing_rate)}</td>
                              <td className="text-right">{formatMoney(amount)}</td>
                              <td className="max-w-[10rem] truncate">{l.notes ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} className="font-medium">
                            Labor total
                          </td>
                          <td className="text-right font-bold">{formatMoney(laborTotal)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "parts" ? (
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title text-base gap-2">
                  <Package className="h-4 w-4" /> Parts & materials
                </h2>
                <Link href="/parts" className="link link-primary text-sm">
                  Open parts inventory
                </Link>
                {isTech && openForField ? (
                  <form onSubmit={addPart} className="mb-4 grid gap-3 sm:grid-cols-2">
                    <FormRow label="Part">
                      <select
                        className="select select-bordered w-full"
                        value={partForm.part_id}
                        onChange={(e) => setPartForm({ ...partForm, part_id: e.target.value })}
                        required
                      >
                        <option value="">Select…</option>
                        {inventory.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.part_number} — {p.name} ({p.quantity_on_hand})
                          </option>
                        ))}
                      </select>
                    </FormRow>
                    <FormRow label="Qty">
                      <input
                        type="number"
                        min="1"
                        className="input input-bordered w-full"
                        value={partForm.quantity_used}
                        onChange={(e) => setPartForm({ ...partForm, quantity_used: e.target.value })}
                      />
                    </FormRow>
                    <div className="flex items-end">
                      <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                        Add part
                      </button>
                    </div>
                  </form>
                ) : null}
                {parts.length === 0 ? (
                  <EmptyState title="No parts used" description="Parts used on this job bill to the customer invoice." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Part</th>
                          <th>Qty</th>
                          <th className="text-right">Billable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parts.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <Link href={`/parts?part=${p.part_id}`} className="link link-hover font-medium">
                                {p.parts?.name ?? p.part_id}
                              </Link>
                            </td>
                            <td>{p.quantity_used}</td>
                            <td className="text-right">{formatMoney(p.billable_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2} className="font-medium">
                            Parts total
                          </td>
                          <td className="text-right font-bold">{formatMoney(partsTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "approvals" ? (
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title text-base gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Additional work
                </h2>
                <p className="text-sm opacity-70">
                  Unapproved extra work is blocked from casual billing until a manager decides.
                </p>
                {additional.length === 0 ? (
                  <EmptyState
                    title="No additional work requests"
                    description="Technicians submit AWR from the field schedule when extra repairs are found."
                  />
                ) : (
                  <ul className="space-y-3">
                    {additional.map((a) => (
                      <li key={a.id} className="rounded-box border border-base-300 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{a.description}</p>
                            <p className="text-sm opacity-70">
                              Est. charge {formatMoney(a.estimated_additional_charge)}
                            </p>
                          </div>
                          <StatusBadge label={a.approval_status} tone={statusTone(a.approval_status)} />
                        </div>
                        {isManager && a.approval_status === "Pending" ? (
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              className="btn btn-success btn-xs"
                              disabled={saving}
                              onClick={() => decideAwr(a.id, "Approved")}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-error btn-outline btn-xs"
                              disabled={saving}
                              onClick={() => decideAwr(a.id, "Rejected")}
                            >
                              Reject
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {tab === "billing" ? (
            <div className="card bg-base-100 shadow">
              <div className="card-body space-y-4">
                <h2 className="card-title text-base gap-2">
                  <FileText className="h-4 w-4" /> Billing
                </h2>
                <div className="grid gap-2 sm:grid-cols-3 text-sm">
                  <div className="rounded-box bg-base-200/60 p-3">
                    <p className="opacity-60">Labor charges</p>
                    <p className="font-semibold">{formatMoney(laborTotal)}</p>
                  </div>
                  <div className="rounded-box bg-base-200/60 p-3">
                    <p className="opacity-60">Parts charges</p>
                    <p className="font-semibold">{formatMoney(partsTotal)}</p>
                  </div>
                  <div className="rounded-box bg-base-200/60 p-3">
                    <p className="opacity-60">Billing status</p>
                    <StatusBadge label={wo.billing_status} tone={statusTone(wo.billing_status)} />
                  </div>
                </div>

                {wo.status === "Completed" && wo.billing_status === "Unbilled" && isBilling ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-outline btn-sm" disabled={saving} onClick={() => createInvoiceFromJob(true)}>
                      Save draft invoice
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => createInvoiceFromJob(false)}>
                      Create & send invoice
                    </button>
                    <Link href={`/billing?wo=${wo.id}`} className="btn btn-ghost btn-sm">
                      Open in Billing
                    </Link>
                  </div>
                ) : null}

                {invoices.length === 0 ? (
                  <EmptyState
                    title="No invoices yet"
                    description={
                      wo.status === "Completed"
                        ? "Create an invoice from this completed job when ready."
                        : "Complete and approve the job before invoicing."
                    }
                  />
                ) : (
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Balance</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td>
                            <Link href={`/billing/${inv.id}`} className="link link-primary font-medium">
                              {inv.invoice_number}
                            </Link>
                          </td>
                          <td>{inv.invoice_date}</td>
                          <td className="text-right">{formatMoney(inv.invoice_total)}</td>
                          <td className="text-right">{formatMoney(inv.remaining_balance)}</td>
                          <td>
                            <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : null}

          <ActivityFeed recordType="work_order" recordId={id} />
        </div>

        <div className="space-y-4">
          <div className="card bg-base-100 shadow">
            <div className="card-body space-y-3">
              <h2 className="card-title text-base gap-2">
                <Calendar className="h-4 w-4" /> Dispatch
              </h2>
              {isManager && openForField ? (
                <>
                  <FormRow label="Technician">
                    <select
                      className="select select-bordered w-full"
                      value={assignTech}
                      onChange={(e) => setAssignTech(e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {technicians.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.full_name ?? t.email}
                        </option>
                      ))}
                    </select>
                  </FormRow>
                  <FormRow label="Schedule date">
                    <input
                      type="date"
                      className="input input-bordered w-full"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                    />
                  </FormRow>
                  <button type="button" className="btn btn-primary btn-sm w-full" onClick={saveAssignment} disabled={saving}>
                    Save assignment
                  </button>
                </>
              ) : (
                <div className="text-sm">
                  <p>
                    <span className="opacity-60">Tech:</span> {techName}
                  </p>
                  <p>
                    <span className="opacity-60">Date:</span> {wo.scheduled_date ?? "—"}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="card bg-base-100 shadow">
            <div className="card-body space-y-2">
              <h2 className="card-title text-base gap-2">
                <Wrench className="h-4 w-4" /> Job actions
              </h2>

              {isTech && openForField ? (
                <>
                  <button type="button" className="btn btn-outline btn-sm w-full" disabled={saving} onClick={() => fieldAction("arrival")}>
                    Record arrival
                  </button>
                  <button type="button" className="btn btn-outline btn-sm w-full" disabled={saving} onClick={() => fieldAction("start")}>
                    Start work
                  </button>
                  <button type="button" className="btn btn-outline btn-sm w-full" disabled={saving} onClick={() => fieldAction("pause")}>
                    Pause
                  </button>
                  <button type="button" className="btn btn-primary btn-sm w-full" disabled={saving} onClick={() => fieldAction("ready")}>
                    Ready for review
                  </button>
                </>
              ) : null}

              {isManager && openForField ? (
                <>
                  {wo.status === "Ready for Review" ? (
                    <button type="button" className="btn btn-success btn-sm w-full" disabled={saving} onClick={approveComplete}>
                      Approve & complete
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-outline btn-sm w-full" disabled={saving} onClick={() => setStatus("Scheduled")}>
                    Mark scheduled
                  </button>
                  <button type="button" className="btn btn-outline btn-sm w-full" disabled={saving} onClick={() => setStatus("In Progress")}>
                    Mark in progress
                  </button>
                  <button type="button" className="btn btn-outline btn-sm w-full" disabled={saving} onClick={() => setStatus("Waiting on Parts")}>
                    Waiting on parts
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm w-full text-error" disabled={saving} onClick={() => setStatus("Canceled")}>
                    Cancel job
                  </button>
                </>
              ) : null}

              {isBilling && wo.status === "Completed" && wo.billing_status === "Unbilled" ? (
                <button type="button" className="btn btn-primary btn-sm w-full" disabled={saving} onClick={() => createInvoiceFromJob(false)}>
                  Invoice job
                </button>
              ) : null}

              {wo.status === "Completed" ? (
                <p className="text-xs opacity-60">
                  Approved {wo.approved_at ? new Date(wo.approved_at).toLocaleDateString() : "—"}
                </p>
              ) : null}

              <Link href="/technician" className="btn btn-ghost btn-sm w-full">
                Open tech schedule
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
