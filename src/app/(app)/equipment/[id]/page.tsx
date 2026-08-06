"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { formatMoney, formatPct } from "@/lib/calculations";
import {
  emptyCostRollup,
  equipmentAgeYears,
  finalizeCostRollup,
  serviceCompliance,
  serviceComplianceTone,
  warrantyAging,
  warrantyAgingTone,
  type EquipmentCostRollup,
} from "@/lib/equipmentAccounting";
import {
  buildCoverageMap,
  coverageFor,
  EQUIPMENT_COVERAGE_SELECT,
  type ContractEquipmentLink,
  type EquipmentCoverage,
} from "@/lib/equipmentCoverage";
import type {
  Customer,
  Equipment,
  Invoice,
  Profile,
  ServiceContract,
  TechnicianLabor,
  WorkOrder,
  WorkOrderPart,
} from "@/lib/types";

type EquipmentDetail = Equipment & { customers?: { id: string; name: string } | null };

const NAMEPLATE_BUCKET = "equipment-nameplates";

function yearStartIso() {
  return `${new Date().getFullYear()}-01-01`;
}

function isMissingColumnError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("column") ||
    m.includes("replacement_cost") ||
    m.includes("estimated_residual") ||
    m.includes("retirement_note") ||
    m.includes("nameplate_path") ||
    m.includes("schema cache")
  );
}

function invoiceBillable(inv: Invoice) {
  const fromCharges =
    Number(inv.labor_charges || 0) +
    Number(inv.parts_charges || 0) +
    Number(inv.recurring_service_charge || 0) +
    Number(inv.additional_charges || 0) -
    Number(inv.discounts || 0);
  if (Number.isFinite(fromCharges)) return fromCharges;
  return Number(inv.invoice_total || 0) - Number(inv.warranty_deductions || 0);
}

/**
 * This business faces stale equipment master-data and cost-to-serve visibility risk.
 * Our app reduces the risk by letting managers edit equipment, attach contracts, and see YTD costs.
 */
export default function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<EquipmentDetail | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [coverage, setCoverage] = useState<EquipmentCoverage>({ covered: false });
  const [attachContracts, setAttachContracts] = useState<ServiceContract[]>([]);
  const [attachContractId, setAttachContractId] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [recentWorkOrders, setRecentWorkOrders] = useState<WorkOrder[]>([]);
  const [relatedInvoices, setRelatedInvoices] = useState<Invoice[]>([]);
  const [costRollup, setCostRollup] = useState<EquipmentCostRollup>(emptyCostRollup());
  const [nameplateUrl, setNameplateUrl] = useState<string | null>(null);
  const [uploadingNameplate, setUploadingNameplate] = useState(false);
  const [softWarning, setSoftWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: "",
    name: "",
    category: "",
    manufacturer: "",
    model: "",
    serial_number: "",
    location: "",
    operating_status: "Operational" as Equipment["operating_status"],
    warranty_status: "Unknown" as Equipment["warranty_status"],
    installation_date: "",
    last_service_date: "",
    next_scheduled_service_date: "",
    warranty_expiration_date: "",
    notes: "",
    replacement_cost: "",
    estimated_residual: "",
    retirement_note: "",
  });

  const isManager =
    profile?.role === "administrator" || profile?.role === "service_manager";

  async function loadNameplatePreview(path: string | null | undefined) {
    if (!path) {
      setNameplateUrl(null);
      return;
    }
    const { data } = await supabase.storage.from(NAMEPLATE_BUCKET).createSignedUrl(path, 3600);
    setNameplateUrl(data?.signedUrl ?? null);
  }

  async function loadManagerExtras(eq: EquipmentDetail) {
    const yStart = yearStartIso();

    const [
      { data: links },
      { data: contracts },
      { data: wosRecent },
      { data: wosYtd },
      { data: invoices },
    ] = await Promise.all([
      supabase
        .from("contract_equipment")
        .select(EQUIPMENT_COVERAGE_SELECT)
        .eq("equipment_id", id),
      supabase
        .from("service_contracts")
        .select("*")
        .eq("customer_id", eq.customer_id)
        .eq("status", "Active")
        .order("name"),
      supabase
        .from("work_orders")
        .select("*")
        .eq("equipment_id", id)
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("work_orders")
        .select("id")
        .eq("equipment_id", id)
        .gte("created_at", yStart),
      supabase
        .from("invoices")
        .select("*")
        .eq("equipment_id", id)
        .gte("invoice_date", yStart)
        .order("invoice_date", { ascending: false }),
    ]);

    const coverageMap = buildCoverageMap(links as ContractEquipmentLink[] | null);
    setCoverage(coverageFor(coverageMap, id));
    setAttachContracts((contracts as ServiceContract[]) ?? []);
    setRecentWorkOrders((wosRecent as WorkOrder[]) ?? []);

    const invoiceRows = (invoices as Invoice[]) ?? [];
    setRelatedInvoices(invoiceRows);

    const ytdIds = ((wosYtd as { id: string }[]) ?? []).map((w) => w.id);
    let laborCost = 0;
    let partsCost = 0;
    let partsWarranty = 0;

    if (ytdIds.length > 0) {
      const [{ data: labor }, { data: parts }] = await Promise.all([
        supabase.from("technician_labor").select("*").in("work_order_id", ytdIds),
        supabase.from("work_order_parts").select("*").in("work_order_id", ytdIds),
      ]);
      for (const row of (labor as TechnicianLabor[]) ?? []) {
        laborCost +=
          Number(row.regular_hours || 0) * Number(row.hourly_cost_rate || 0) +
          Number(row.overtime_hours || 0) * Number(row.overtime_cost_rate || 0);
      }
      for (const row of (parts as WorkOrderPart[]) ?? []) {
        partsCost += Number(row.quantity_used || 0) * Number(row.unit_cost || 0);
        partsWarranty += Number(row.warranty_covered_amount || 0);
      }
    }

    let billable = 0;
    let warranty = partsWarranty;
    for (const inv of invoiceRows) {
      billable += invoiceBillable(inv);
      warranty += Number(inv.warranty_deductions || 0);
    }

    setCostRollup(finalizeCostRollup({ laborCost, partsCost, billable, warranty }));
    await loadNameplatePreview(eq.nameplate_path);
  }

  async function load() {
    setLoading(true);
    setSoftWarning(null);
    const [{ data }, { data: cust }, { data: { user } }] = await Promise.all([
      supabase.from("equipment").select("*, customers(id, name)").eq("id", id).single(),
      supabase.from("customers").select("*").order("name"),
      supabase.auth.getUser(),
    ]);
    const eq = data as EquipmentDetail | null;
    setEquipment(eq);
    setCustomers((cust as Customer[]) ?? []);

    let nextProfile: Profile | null = null;
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      nextProfile = p as Profile;
      setProfile(nextProfile);
    }

    if (eq) {
      setForm({
        customer_id: eq.customer_id,
        name: eq.name,
        category: eq.category ?? "",
        manufacturer: eq.manufacturer ?? "",
        model: eq.model ?? "",
        serial_number: eq.serial_number ?? "",
        location: eq.location ?? "",
        operating_status: eq.operating_status,
        warranty_status: eq.warranty_status,
        installation_date: eq.installation_date ?? "",
        last_service_date: eq.last_service_date ?? "",
        next_scheduled_service_date: eq.next_scheduled_service_date ?? "",
        warranty_expiration_date: eq.warranty_expiration_date ?? "",
        notes: eq.notes ?? "",
        replacement_cost:
          eq.replacement_cost != null && eq.replacement_cost !== undefined
            ? String(eq.replacement_cost)
            : "",
        estimated_residual:
          eq.estimated_residual != null && eq.estimated_residual !== undefined
            ? String(eq.estimated_residual)
            : "",
        retirement_note: eq.retirement_note ?? "",
      });

      if (
        nextProfile?.role === "administrator" ||
        nextProfile?.role === "service_manager"
      ) {
        await loadManagerExtras(eq);
      } else {
        setCoverage({ covered: false });
        setAttachContracts([]);
        setRecentWorkOrders([]);
        setRelatedInvoices([]);
        setCostRollup(emptyCostRollup());
        setNameplateUrl(null);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager || !equipment) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    setSoftWarning(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const softFields = {
      replacement_cost: form.replacement_cost.trim() === "" ? null : Number(form.replacement_cost),
      estimated_residual:
        form.estimated_residual.trim() === "" ? null : Number(form.estimated_residual),
      retirement_note: form.retirement_note.trim() || null,
    };

    const basePayload = {
      customer_id: form.customer_id,
      name: form.name.trim(),
      category: form.category.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      location: form.location.trim() || null,
      operating_status: form.operating_status,
      warranty_status: form.warranty_status,
      installation_date: form.installation_date || null,
      last_service_date: form.last_service_date || null,
      next_scheduled_service_date: form.next_scheduled_service_date || null,
      warranty_expiration_date: form.warranty_expiration_date || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const fullPayload = { ...basePayload, ...softFields };
    let { error: updateError } = await supabase.from("equipment").update(fullPayload).eq("id", id);

    if (updateError && isMissingColumnError(updateError.message)) {
      const retry = await supabase.from("equipment").update(basePayload).eq("id", id);
      updateError = retry.error;
      if (!retry.error) {
        setSoftWarning(
          "Core details saved. Soft accounting fields (replacement cost, residual, retirement note) are not available in the database yet.",
        );
      }
    }

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "updated",
      recordType: "equipment",
      recordId: id,
      newValue: fullPayload.name,
    });
    setMessage("Equipment details saved.");
    setSaving(false);
    load();
  }

  async function onUploadNameplate(file: File | null) {
    if (!file || !isManager || !equipment) return;
    setUploadingNameplate(true);
    setSoftWarning(null);
    setError(null);

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(NAMEPLATE_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type || undefined });

    if (uploadError) {
      setSoftWarning(`Nameplate upload unavailable: ${uploadError.message}`);
      setUploadingNameplate(false);
      return;
    }

    const { error: pathError } = await supabase
      .from("equipment")
      .update({ nameplate_path: path, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (pathError) {
      if (isMissingColumnError(pathError.message)) {
        setSoftWarning(
          "Photo uploaded to storage, but nameplate_path column is not available yet. Path was not saved.",
        );
      } else {
        setSoftWarning(`Photo uploaded, but saving path failed: ${pathError.message}`);
      }
      const { data } = await supabase.storage.from(NAMEPLATE_BUCKET).createSignedUrl(path, 3600);
      setNameplateUrl(data?.signedUrl ?? null);
      setUploadingNameplate(false);
      return;
    }

    setEquipment({ ...equipment, nameplate_path: path });
    await loadNameplatePreview(path);
    setMessage("Nameplate photo saved.");
    setUploadingNameplate(false);
  }

  async function onAttachContract() {
    if (!isManager || !attachContractId || !equipment) return;
    setAttaching(true);
    setError(null);
    setMessage(null);

    const { data: existing } = await supabase
      .from("contract_equipment")
      .select("contract_id")
      .eq("contract_id", attachContractId)
      .eq("equipment_id", id)
      .maybeSingle();

    if (existing) {
      setMessage("Equipment is already linked to that contract.");
      setAttaching(false);
      await loadManagerExtras(equipment);
      return;
    }

    const { error: insertError } = await supabase.from("contract_equipment").insert({
      contract_id: attachContractId,
      equipment_id: id,
    });

    if (insertError) {
      setError(insertError.message);
      setAttaching(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "updated",
      recordType: "equipment",
      recordId: id,
      newValue: `attached contract ${attachContractId}`,
    });

    setMessage("Equipment attached to contract.");
    setAttachContractId("");
    setAttaching(false);
    await loadManagerExtras(equipment);
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  if (!equipment) {
    return (
      <div className="p-6">
        <EmptyState
          title="Equipment not found"
          description="This equipment record may have been removed."
          action={
            <Link href="/equipment" className="btn btn-sm">
              Back to Equipment
            </Link>
          }
        />
      </div>
    );
  }

  const aging = warrantyAging(equipment);
  const compliance = serviceCompliance(equipment.next_scheduled_service_date);
  const ageYears = equipmentAgeYears(equipment.installation_date);
  const showRetirementNote =
    form.operating_status === "Retired" || form.operating_status === "Out of Service";
  const customerId = form.customer_id || equipment.customer_id;

  return (
    <div>
      <PageHeader
        title={equipment.name}
        description={isManager ? "View and edit equipment details" : "Equipment details"}
        actions={
          <div className="flex flex-wrap gap-2">
            {isManager ? (
              <Link
                href={`/work-orders?new=1&customer_id=${customerId}&equipment_id=${id}`}
                className="btn btn-primary btn-sm"
              >
                Create work order
              </Link>
            ) : null}
            <Link href="/equipment" className="btn btn-ghost btn-sm">
              ← Back
            </Link>
          </div>
        }
      />

      <form onSubmit={onSave} className="card bg-base-100 shadow max-w-2xl">
        <div className="card-body space-y-3">
          {error ? <div className="alert alert-error text-sm">{error}</div> : null}
          {softWarning ? <div className="alert alert-warning text-sm">{softWarning}</div> : null}
          {message ? <div className="alert alert-success text-sm">{message}</div> : null}

          {isManager ? (
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label={equipment.operating_status}
                tone={statusTone(equipment.operating_status)}
                className="max-w-[10rem]"
              />
              <StatusBadge label={aging} tone={warrantyAgingTone(aging)} className="max-w-[12rem]" />
              <StatusBadge
                label={`Service: ${compliance}`}
                tone={serviceComplianceTone(compliance)}
                className="max-w-[12rem]"
              />
              <StatusBadge
                label={ageYears != null ? `Install age: ${ageYears} yr` : "Install age: —"}
                tone="neutral"
                className="max-w-[12rem]"
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label={equipment.operating_status}
                tone={statusTone(equipment.operating_status)}
                className="max-w-[10rem]"
              />
              <StatusBadge
                label={equipment.warranty_status}
                tone={statusTone(equipment.warranty_status)}
                className="max-w-[10rem]"
              />
            </div>
          )}

          {isManager && coverage.covered ? (
            <div className="rounded-box border border-base-300 bg-base-200/40 px-3 py-2 text-sm">
              <p className="font-medium">
                Covered by{" "}
                {coverage.contractId ? (
                  <Link href={`/contracts/${coverage.contractId}`} className="link link-primary">
                    {coverage.contractName ?? "contract"}
                  </Link>
                ) : (
                  (coverage.contractName ?? "contract")
                )}
              </p>
              <p className="text-xs opacity-70">
                {[coverage.contractType, formatMoney(coverage.contractPrice ?? 0)]
                  .filter(Boolean)
                  .join(" · ")}
                {coverage.endDate ? ` · ends ${coverage.endDate}` : ""}
              </p>
            </div>
          ) : isManager ? (
            <div className="rounded-box border border-dashed border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              Not covered by an active service contract.
            </div>
          ) : null}

          <FormRow label="Name" required>
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            ) : (
              <span className="font-medium">{equipment.name}</span>
            )}
          </FormRow>

          <FormRow label="Customer">
            {isManager ? (
              <select
                className="select select-bordered w-full"
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                required
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : equipment.customers?.id ? (
              <Link href={`/customers/${equipment.customers.id}`} className="link link-primary">
                {equipment.customers.name}
              </Link>
            ) : (
              <span>—</span>
            )}
          </FormRow>

          <FormRow label="Operating status">
            {isManager ? (
              <select
                className="select select-bordered w-full"
                value={form.operating_status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    operating_status: e.target.value as Equipment["operating_status"],
                  })
                }
              >
                <option value="Operational">Operational</option>
                <option value="Needs Service">Needs Service</option>
                <option value="Out of Service">Out of Service</option>
                <option value="Retired">Retired</option>
              </select>
            ) : (
              <StatusBadge
                label={equipment.operating_status}
                tone={statusTone(equipment.operating_status)}
                className="max-w-[10rem]"
              />
            )}
          </FormRow>

          <FormRow label="Warranty status">
            {isManager ? (
              <select
                className="select select-bordered w-full"
                value={form.warranty_status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    warranty_status: e.target.value as Equipment["warranty_status"],
                  })
                }
              >
                <option value="Under Warranty">Under Warranty</option>
                <option value="Warranty Expired">Warranty Expired</option>
                <option value="Not Covered">Not Covered</option>
                <option value="Unknown">Unknown</option>
              </select>
            ) : (
              <StatusBadge
                label={equipment.warranty_status}
                tone={statusTone(equipment.warranty_status)}
                className="max-w-[10rem]"
              />
            )}
          </FormRow>

          <FormRow label="Category">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            ) : (
              <span>{equipment.category ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Manufacturer">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
              />
            ) : (
              <span>{equipment.manufacturer ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Model">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            ) : (
              <span>{equipment.model ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Serial #">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.serial_number}
                onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
              />
            ) : (
              <span className="break-all">{equipment.serial_number ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Location">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            ) : (
              <span className="break-words">{equipment.location ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Installation date">
            {isManager ? (
              <input
                type="date"
                className="input input-bordered w-full"
                value={form.installation_date}
                onChange={(e) => setForm({ ...form, installation_date: e.target.value })}
              />
            ) : (
              <span>{equipment.installation_date ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Warranty expiration">
            {isManager ? (
              <input
                type="date"
                className="input input-bordered w-full"
                value={form.warranty_expiration_date}
                onChange={(e) => setForm({ ...form, warranty_expiration_date: e.target.value })}
              />
            ) : (
              <span>{equipment.warranty_expiration_date ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Last service">
            {isManager ? (
              <input
                type="date"
                className="input input-bordered w-full"
                value={form.last_service_date}
                onChange={(e) => setForm({ ...form, last_service_date: e.target.value })}
              />
            ) : (
              <span>{equipment.last_service_date ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Next scheduled service">
            {isManager ? (
              <input
                type="date"
                className="input input-bordered w-full"
                value={form.next_scheduled_service_date}
                onChange={(e) => setForm({ ...form, next_scheduled_service_date: e.target.value })}
              />
            ) : (
              <span>{equipment.next_scheduled_service_date ?? "—"}</span>
            )}
          </FormRow>

          {isManager ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormRow label="Replacement cost (soft)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input input-bordered w-full"
                    value={form.replacement_cost}
                    onChange={(e) => setForm({ ...form, replacement_cost: e.target.value })}
                    placeholder="Estimate"
                  />
                </FormRow>
                <FormRow label="Estimated residual (soft)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input input-bordered w-full"
                    value={form.estimated_residual}
                    onChange={(e) => setForm({ ...form, estimated_residual: e.target.value })}
                    placeholder="Estimate"
                  />
                </FormRow>
              </div>

              {showRetirementNote ? (
                <FormRow label="Retirement / OOS note">
                  <textarea
                    className="textarea textarea-bordered w-full"
                    rows={3}
                    value={form.retirement_note}
                    onChange={(e) => setForm({ ...form, retirement_note: e.target.value })}
                    placeholder="Why retired or out of service"
                  />
                </FormRow>
              ) : null}

              <FormRow label="Nameplate photo">
                <div className="space-y-2">
                  {nameplateUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={nameplateUrl}
                      alt="Equipment nameplate"
                      className="max-h-48 rounded-box border border-base-300 object-contain"
                    />
                  ) : (
                    <p className="text-sm opacity-60">No nameplate on file.</p>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="file-input file-input-bordered file-input-sm w-full"
                    disabled={uploadingNameplate}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      void onUploadNameplate(file);
                    }}
                  />
                  {uploadingNameplate ? (
                    <p className="text-xs opacity-60">Uploading…</p>
                  ) : null}
                </div>
              </FormRow>
            </>
          ) : null}

          <FormRow label="Notes">
            {isManager ? (
              <textarea
                className="textarea textarea-bordered w-full"
                rows={4}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            ) : (
              <span className="break-words whitespace-pre-wrap">{equipment.notes ?? "—"}</span>
            )}
          </FormRow>

          {isManager ? (
            <div className="pt-2">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : null}
        </div>
      </form>

      {isManager ? (
        <>
          <section className="card mt-4 max-w-2xl bg-base-100 shadow">
            <div className="card-body space-y-2">
              <h2 className="card-title text-base">Cost-to-serve YTD</h2>
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <p>
                  Labor cost: <span className="font-medium">{formatMoney(costRollup.laborCost)}</span>
                </p>
                <p>
                  Parts cost: <span className="font-medium">{formatMoney(costRollup.partsCost)}</span>
                </p>
                <p>
                  Total cost: <span className="font-medium">{formatMoney(costRollup.totalCost)}</span>
                </p>
                <p>
                  Billable: <span className="font-medium">{formatMoney(costRollup.billable)}</span>
                  {costRollup.billablePct != null ? ` (${formatPct(costRollup.billablePct)})` : ""}
                </p>
                <p>
                  Warranty: <span className="font-medium">{formatMoney(costRollup.warranty)}</span>
                  {costRollup.warrantyPct != null ? ` (${formatPct(costRollup.warrantyPct)})` : ""}
                </p>
              </div>
            </div>
          </section>

          <section className="card mt-4 max-w-2xl bg-base-100 shadow">
            <div className="card-body space-y-3">
              <h2 className="card-title text-base">Quick attach to contract</h2>
              {attachContracts.length === 0 ? (
                <p className="text-sm opacity-60">No active contracts for this customer.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <select
                    className="select select-bordered flex-1 min-w-[12rem]"
                    value={attachContractId}
                    onChange={(e) => setAttachContractId(e.target.value)}
                  >
                    <option value="">Select contract…</option>
                    {attachContracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.contract_type})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!attachContractId || attaching}
                    onClick={() => void onAttachContract()}
                  >
                    {attaching ? "Attaching…" : "Attach"}
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="card mt-4 max-w-2xl bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-base">Recent work orders</h2>
              {recentWorkOrders.length === 0 ? (
                <p className="text-sm opacity-60">No work orders for this equipment yet.</p>
              ) : (
                <ul className="space-y-2">
                  {recentWorkOrders.map((wo) => (
                    <li
                      key={wo.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 px-3 py-2 text-sm"
                    >
                      <div>
                        <Link
                          href={`/work-orders/${wo.id}`}
                          className="link link-primary font-medium"
                        >
                          {wo.work_order_number}
                        </Link>
                        <p className="text-xs opacity-60">
                          {wo.work_order_type}
                          {wo.scheduled_date ? ` · ${wo.scheduled_date}` : ""}
                        </p>
                      </div>
                      <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card mt-4 max-w-2xl bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-base">Related invoices (YTD)</h2>
              {relatedInvoices.length === 0 ? (
                <p className="text-sm opacity-60">No invoices linked to this equipment this year.</p>
              ) : (
                <ul className="space-y-2">
                  {relatedInvoices.map((inv) => (
                    <li
                      key={inv.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 px-3 py-2 text-sm"
                    >
                      <div>
                        <Link href={`/billing/${inv.id}`} className="link link-primary font-medium">
                          {inv.invoice_number}
                        </Link>
                        <p className="text-xs opacity-60">
                          {inv.invoice_date}
                          {inv.status ? ` · ${inv.status}` : ""}
                        </p>
                      </div>
                      <span>{formatMoney(inv.invoice_total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
