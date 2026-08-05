"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge } from "@/components/ui";
import { PurchaseOrderRequest } from "@/components/PurchaseOrderRequest";
import { EmergencyPurchaseLog } from "@/components/EmergencyPurchaseLog";
import { formatMoney } from "@/lib/calculations";
import type { Part, Profile, PurchaseOrder, TruckInventory, WorkOrder } from "@/lib/types";

type PartForm = {
  part_number: string;
  name: string;
  category: string;
  quantity_on_hand: string;
  reorder_level: string;
  unit_cost: string;
  standard_customer_price: string;
};

type SortKey =
  | "part_number"
  | "name"
  | "quantity_on_hand"
  | "reorder_level"
  | "unit_cost"
  | "standard_customer_price"
  | "status";

type SortDirection = "asc" | "desc";

type TruckStockRow = TruckInventory & { parts?: Part };
type PurchaseOrderRow = PurchaseOrder & { parts?: Pick<Part, "part_number" | "name"> };
type JobOption = Pick<WorkOrder, "id" | "work_order_number" | "problem_description">;

const EMPTY_FORM: PartForm = {
  part_number: "",
  name: "",
  category: "",
  quantity_on_hand: "0",
  reorder_level: "5",
  unit_cost: "0",
  standard_customer_price: "0",
};

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function isLowStock(part: Part) {
  return part.quantity_on_hand <= part.reorder_level;
}

export default function PartsPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [truckStock, setTruckStock] = useState<TruckStockRow[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRow[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPurchaseOrder, setShowPurchaseOrder] = useState(false);
  const [showEmergencyPurchase, setShowEmergencyPurchase] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [form, setForm] = useState<PartForm>(EMPTY_FORM);

  async function loadTechnicianData(technicianId: string) {
    const [{ data: stock, error: stockError }, { data: requests }, { data: assignedJobs }] =
      await Promise.all([
        supabase
          .from("truck_inventory")
          .select("*, parts(*)")
          .eq("technician_id", technicianId)
          .gt("quantity_on_hand", 0)
          .order("quantity_on_hand"),
        supabase
          .from("purchase_orders")
          .select("*, parts(part_number, name)")
          .eq("technician_id", technicianId)
          .neq("status", "fulfilled")
          .order("created_at", { ascending: false }),
        supabase
          .from("work_orders")
          .select("id, work_order_number, problem_description")
          .eq("assigned_technician_id", technicianId)
          .neq("status", "Canceled")
          .order("scheduled_date", { ascending: false }),
      ]);

    if (stockError) setError(stockError.message);
    setTruckStock((stock as TruckStockRow[]) ?? []);
    setPurchaseOrders((requests as PurchaseOrderRow[]) ?? []);
    setJobs((assignedJobs as JobOption[]) ?? []);
  }

  async function load() {
    setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const [{ data: currentProfile }, { data }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("parts").select("*").order("name"),
    ]);
    const loadedProfile = currentProfile as Profile | null;
    setProfile(loadedProfile);
    setParts((data as Part[]) ?? []);
    if (loadedProfile?.role === "technician") {
      await loadTechnicianData(loadedProfile.id);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const lowStock = parts.filter((p) => p.is_active && isLowStock(p));

  function openCreateForm() {
    setEditingPart(null);
    setForm(EMPTY_FORM);
    setError(null);
    setSuccess(null);
    setShowForm(true);
  }

  function openEditForm(part: Part) {
    setEditingPart(part);
    setForm({
      part_number: part.part_number,
      name: part.name,
      category: part.category ?? "",
      quantity_on_hand: String(part.quantity_on_hand),
      reorder_level: String(part.reorder_level),
      unit_cost: String(part.unit_cost),
      standard_customer_price: String(part.standard_customer_price),
    });
    setError(null);
    setSuccess(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingPart(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  function validateForm() {
    if (!form.part_number.trim() || !form.name.trim()) {
      return "Part # and Name are required.";
    }

    const numericFields = [
      ["Qty", form.quantity_on_hand],
      ["Reorder", form.reorder_level],
      ["Unit Cost", form.unit_cost],
      ["Price", form.standard_customer_price],
    ] as const;

    for (const [label, value] of numericFields) {
      if (value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0) {
        return `${label} must be zero or greater.`;
      }
    }

    return null;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      part_number: form.part_number.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      quantity_on_hand: Number(form.quantity_on_hand),
      reorder_level: Number(form.reorder_level),
      unit_cost: Number(form.unit_cost),
      standard_customer_price: Number(form.standard_customer_price),
    };

    if (editingPart) {
      const { data, error: updateError } = await supabase
        .from("parts")
        .update(payload)
        .eq("id", editingPart.id)
        .select()
        .single();

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      setParts((current) => current.map((part) => part.id === editingPart.id ? data as Part : part));
      await logActivity(supabase, {
        userId: user?.id ?? null,
        action: "updated",
        recordType: "part",
        recordId: editingPart.id,
        previousValue: editingPart.name,
        newValue: payload.name,
      });
      closeForm();
      setSuccess("Part updated successfully");
      setSaving(false);
      return;
    }

    const { data, error: insertError } = await supabase.from("parts").insert(payload).select().single();
    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    await logActivity(supabase, { userId: user?.id ?? null, action: "created", recordType: "part", recordId: data.id, newValue: form.name });
    setParts((current) => [...current, data as Part]);
    closeForm();
    setSaving(false);
  }

  function changeSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current?.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  const sortedParts = sort ? [...parts].sort((a, b) => {
    let comparison: number;

    if (sort.key === "part_number" || sort.key === "name") {
      comparison = naturalCollator.compare(a[sort.key], b[sort.key]);
    } else if (sort.key === "status") {
      comparison = Number(isLowStock(a)) === Number(isLowStock(b))
        ? 0
        : isLowStock(a) ? -1 : 1;
    } else {
      comparison = Number(a[sort.key]) - Number(b[sort.key]);
    }

    return sort.direction === "asc" ? comparison : -comparison;
  }) : parts;

  const sortableHeaders: { label: string; key: SortKey }[] = [
    { label: "Part #", key: "part_number" },
    { label: "Name", key: "name" },
    { label: "On Hand", key: "quantity_on_hand" },
    { label: "Reorder", key: "reorder_level" },
    { label: "Cost", key: "unit_cost" },
    { label: "Price", key: "standard_customer_price" },
    { label: "Status", key: "status" },
  ];

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading inventory…</div>;
  }

  if (!profile) {
    return <EmptyState title="Inventory unavailable" description="Your user profile could not be loaded." />;
  }

  if (profile?.role === "technician") {
    return (
      <div>
        <PageHeader
          title="My truck inventory"
          description="Parts currently on your truck"
          actions={
            <>
              <button
                type="button"
                className="btn btn-primary min-h-12"
                onClick={() => {
                  setSuccess(null);
                  setShowPurchaseOrder(true);
                }}
              >
                Request purchase order
              </button>
              <button
                type="button"
                className="btn btn-warning min-h-12"
                onClick={() => {
                  setSuccess(null);
                  setShowEmergencyPurchase(true);
                }}
              >
                I bought a part today
              </button>
            </>
          }
        />

        {success ? (
          <div role="status" className="alert alert-success mb-4">
            <span>{success}</span>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="alert alert-error mb-4">
            <span>{error}</span>
          </div>
        ) : null}

        <div className="card bg-base-100 shadow">
          <div className="card-body p-0">
            {truckStock.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No parts currently on your truck"
                  description="Request a purchase order for planned restocking, or log an emergency purchase made today."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Part #</th>
                      <th>Name</th>
                      <th>Qty on truck</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {truckStock.map((stock) => {
                      const quantity = Number(stock.quantity_on_hand);
                      const typical = Number(stock.typical_job_quantity);
                      const status = quantity === 0
                        ? { label: "Out", tone: "error" as const }
                        : quantity <= typical
                          ? { label: "Low", tone: "warning" as const }
                          : { label: "Sufficient", tone: "success" as const };
                      return (
                        <tr key={`${stock.technician_id}-${stock.part_id}`}>
                          <td>{stock.parts?.part_number ?? "—"}</td>
                          <td className="font-medium">{stock.parts?.name ?? "Unknown part"}</td>
                          <td className="text-lg font-semibold">{quantity}</td>
                          <td><StatusBadge label={status.label} tone={status.tone} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card mt-5 bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-lg">Pending requests</h2>
            {purchaseOrders.length === 0 ? (
              <p className="text-sm opacity-60">No open purchase-order requests.</p>
            ) : (
              <ul className="space-y-3">
                {purchaseOrders.map((request) => (
                  <li
                    key={request.id}
                    className="flex flex-col gap-2 rounded-box bg-base-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold">
                        {request.parts?.part_number ?? "Part"} — {request.parts?.name ?? "Catalog item"}
                      </p>
                      <p className="text-sm opacity-70">
                        Qty {request.quantity_requested}
                        {request.note ? ` · ${request.note}` : ""}
                      </p>
                    </div>
                    <StatusBadge
                      label={request.status}
                      tone={request.status === "approved" ? "info" : "warning"}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {showPurchaseOrder ? (
          <PurchaseOrderRequest
            technicianId={profile.id}
            parts={parts.filter((part) => part.is_active)}
            onClose={() => setShowPurchaseOrder(false)}
            onSubmitted={async () => {
              setShowPurchaseOrder(false);
              setSuccess("Purchase-order request submitted");
              await loadTechnicianData(profile.id);
            }}
          />
        ) : null}

        {showEmergencyPurchase ? (
          <EmergencyPurchaseLog
            technicianId={profile.id}
            parts={parts.filter((part) => part.is_active)}
            jobs={jobs}
            onClose={() => setShowEmergencyPurchase(false)}
            onSubmitted={async () => {
              setShowEmergencyPurchase(false);
              setSuccess("Emergency purchase logged and truck inventory updated");
              await loadTechnicianData(profile.id);
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Parts Inventory" description="Track stock levels and pricing" actions={
        <button type="button" className="btn btn-primary btn-sm" onClick={openCreateForm}>Add Part</button>
      } />

      {success ? <div role="status" className="alert alert-success mb-4"><span>{success}</span></div> : null}

      {lowStock.length > 0 ? (
        <div role="alert" className="alert alert-warning mb-4">
          <span>{lowStock.length} part(s) at or below reorder level</span>
        </div>
      ) : null}

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">{editingPart ? "Edit Part" : "New Part"}</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onSave} noValidate className="mt-4 space-y-3">
              <FormRow label="Part #" required><input className="input input-bordered w-full" value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} required /></FormRow>
              <FormRow label="Name" required><input className="input input-bordered w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></FormRow>
              <FormRow label="Category"><input className="input input-bordered w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></FormRow>
              <FormRow label="Qty"><input type="number" className="input input-bordered w-full" value={form.quantity_on_hand} onChange={(e) => setForm({ ...form, quantity_on_hand: e.target.value })} /></FormRow>
              <FormRow label="Reorder"><input type="number" className="input input-bordered w-full" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} /></FormRow>
              <FormRow label="Unit cost"><input type="number" step="0.01" className="input input-bordered w-full" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></FormRow>
              <FormRow label="Price"><input type="number" step="0.01" className="input input-bordered w-full" value={form.standard_customer_price} onChange={(e) => setForm({ ...form, standard_customer_price: e.target.value })} /></FormRow>
              <div className="modal-action">
                <button type="button" className="btn" onClick={closeForm} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{editingPart ? "Save Changes" : "Save"}</button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop"><button type="button" onClick={closeForm}>close</button></form>
        </dialog>
      ) : null}

      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {parts.length === 0 ? (
            <div className="p-6"><EmptyState title="No parts in inventory" description="Add parts to track usage on work orders." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    {sortableHeaders.map((header) => (
                      <th
                        key={header.key}
                        className="cursor-pointer select-none"
                        aria-sort={sort?.key === header.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                        onClick={() => changeSort(header.key)}
                      >
                        <button type="button" className="flex w-full cursor-pointer items-center gap-1 text-left">
                          {header.label}
                          {sort?.key === header.key ? <span aria-hidden="true">{sort.direction === "asc" ? "▲" : "▼"}</span> : null}
                        </button>
                      </th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedParts.map((p) => {
                    const low = isLowStock(p);
                    return (
                      <tr key={p.id} className={low ? "bg-warning/10" : ""}>
                        <td>{p.part_number}</td>
                        <td className="font-medium">{p.name}</td>
                        <td>{p.quantity_on_hand}</td>
                        <td>{p.reorder_level}</td>
                        <td>{formatMoney(p.unit_cost)}</td>
                        <td>{formatMoney(p.standard_customer_price)}</td>
                        <td>{low ? <StatusBadge label="Low Stock" tone="warning" /> : <StatusBadge label="OK" tone="success" />}</td>
                        <td><button type="button" className="btn btn-ghost btn-xs" onClick={() => openEditForm(p)}>Edit</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
