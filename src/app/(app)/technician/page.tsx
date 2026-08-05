"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, isBefore, isToday, parseISO } from "date-fns";
import { Package, AlertTriangle, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { EquipmentContextPanel } from "@/components/EquipmentContextPanel";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { PurchaseOrderPanel } from "@/components/PurchaseOrderPanel";
import { formatMoney } from "@/lib/calculations";
import { EQUIPMENT_CONTEXT_SELECT, type EquipmentContextFields } from "@/lib/equipmentCoverage";
import type {
  Part,
  Profile,
  TechnicianLabor,
  WorkOrder,
  WorkOrderPart,
  AdditionalWorkRequest,
} from "@/lib/types";

type TechWorkOrder = WorkOrder & {
  customers?: {
    name: string;
    service_address?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
    phone?: string | null;
  };
  equipment?: EquipmentContextFields | null;
};

/**
 * This business faces field execution gap risk when technicians lack a single workspace.
 * Our app reduces the risk by consolidating schedule, labor, parts, and approvals in one view.
 */
export default function TechnicianPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workOrders, setWorkOrders] = useState<TechWorkOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [labor, setLabor] = useState<TechnicianLabor[]>([]);
  const [parts, setParts] = useState<(WorkOrderPart & { parts?: Part })[]>([]);
  const [additional, setAdditional] = useState<AdditionalWorkRequest[]>([]);
  const [inventory, setInventory] = useState<Part[]>([]);
  const [recentUsage, setRecentUsage] = useState<
    (WorkOrderPart & {
      parts?: { name: string; part_number: string } | null;
      work_orders?: { work_order_number: string; id: string; assigned_technician_id?: string | null } | null;
    })[]
  >([]);
  const [laborForm, setLaborForm] = useState({ regular_hours: "1", overtime_hours: "0", notes: "" });
  const [partForm, setPartForm] = useState({ part_id: "", quantity_used: "1" });
  const [awrForm, setAwrForm] = useState({ description: "", estimated_additional_charge: "0" });
  const [busy, setBusy] = useState(false);
  const [partError, setPartError] = useState<string | null>(null);

  async function loadProfile() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    setProfile(p as Profile);
    return p as Profile;
  }

  async function loadWorkOrders(techId?: string, role?: Profile["role"]) {
    let query = supabase
      .from("work_orders")
      .select(`*, customers(name, service_address, city, state, zip_code, phone), equipment(${EQUIPMENT_CONTEXT_SELECT})`)
      .not("status", "in", '("Completed","Closed","Canceled")')
      .order("scheduled_date");
    if (techId && role === "technician") {
      query = query.eq("assigned_technician_id", techId);
    }
    const { data } = await query;
    setWorkOrders((data as TechWorkOrder[]) ?? []);
  }

  async function loadInventory() {
    const { data: inv } = await supabase.from("parts").select("*").eq("is_active", true).order("name");
    setInventory((inv as Part[]) ?? []);
  }

  async function loadRecentUsage(techId?: string, role?: Profile["role"]) {
    const { data } = await supabase
      .from("work_order_parts")
      .select("*, parts(name, part_number), work_orders(id, work_order_number, assigned_technician_id)")
      .order("created_at", { ascending: false })
      .limit(30);

    let rows =
      (data as (WorkOrderPart & {
        parts?: { name: string; part_number: string } | null;
        work_orders?: {
          work_order_number: string;
          id: string;
          assigned_technician_id?: string | null;
        } | null;
      })[]) ?? [];

    if (techId && role === "technician") {
      rows = rows.filter((r) => r.work_orders?.assigned_technician_id === techId);
    }
    setRecentUsage(rows.slice(0, 8));
  }

  async function loadDetail(woId: string) {
    const [{ data: l }, { data: p }, { data: a }] = await Promise.all([
      supabase.from("technician_labor").select("*").eq("work_order_id", woId).order("work_date", { ascending: false }),
      supabase.from("work_order_parts").select("*, parts(*)").eq("work_order_id", woId),
      supabase.from("additional_work_requests").select("*").eq("work_order_id", woId),
    ]);
    setLabor((l as TechnicianLabor[]) ?? []);
    setParts((p as typeof parts) ?? []);
    setAdditional((a as AdditionalWorkRequest[]) ?? []);
  }

  useEffect(() => {
    (async () => {
      const p = await loadProfile();
      if (p) {
        await loadWorkOrders(p.id, p.role);
        await loadRecentUsage(p.id, p.role);
      }
      await loadInventory();
    })();
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  const today = workOrders.filter((wo) => wo.scheduled_date && isToday(parseISO(wo.scheduled_date)));
  const upcoming = workOrders.filter(
    (wo) =>
      wo.scheduled_date &&
      !isToday(parseISO(wo.scheduled_date)) &&
      !isBefore(parseISO(wo.scheduled_date), new Date()),
  );
  const overdue = workOrders.filter(
    (wo) =>
      wo.scheduled_date &&
      isBefore(parseISO(wo.scheduled_date), new Date()) &&
      !isToday(parseISO(wo.scheduled_date)),
  );
  const selected = workOrders.find((w) => w.id === selectedId);

  const lowStockParts = useMemo(
    () => inventory.filter((p) => p.quantity_on_hand <= p.reorder_level),
    [inventory],
  );

  const selectedPart = inventory.find((p) => p.id === partForm.part_id) ?? null;

  async function woAction(action: "arrival" | "start" | "pause" | "ready") {
    if (!selectedId) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
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
      updates.status = "In Progress";
    }
    if (action === "ready") {
      updates.status = "Ready for Review";
    }
    await supabase.from("work_orders").update(updates).eq("id", selectedId);
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action,
      recordType: "work_order",
      recordId: selectedId,
      newValue: String(updates.status),
    });
    await loadWorkOrders(profile?.id, profile?.role);
    await loadDetail(selectedId);
    setBusy(false);
  }

  async function addLabor(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !profile) return;
    setBusy(true);
    const rate = profile.hourly_cost_rate ?? 45;
    const billing = profile.hourly_billing_rate ?? 95;
    await supabase.from("technician_labor").insert({
      work_order_id: selectedId,
      technician_id: profile.id,
      work_date: format(new Date(), "yyyy-MM-dd"),
      regular_hours: Number(laborForm.regular_hours),
      overtime_hours: Number(laborForm.overtime_hours),
      hourly_cost_rate: rate,
      overtime_cost_rate: rate * 1.5,
      customer_billing_rate: billing,
      notes: laborForm.notes || null,
    });
    setLaborForm({ regular_hours: "1", overtime_hours: "0", notes: "" });
    await loadDetail(selectedId);
    setBusy(false);
  }

  async function addPart(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !partForm.part_id) return;
    setBusy(true);
    setPartError(null);
    const part = inventory.find((p) => p.id === partForm.part_id);
    if (!part) {
      setBusy(false);
      return;
    }
    const qty = Number(partForm.quantity_used);
    if (qty > part.quantity_on_hand) {
      setPartError(
        `Only ${part.quantity_on_hand} on hand for ${part.name}. Adjust qty or receive stock in inventory.`,
      );
      setBusy(false);
      return;
    }
    const billable = part.standard_customer_price * qty;
    await supabase.from("work_order_parts").insert({
      work_order_id: selectedId,
      part_id: part.id,
      quantity_used: qty,
      unit_cost: part.unit_cost,
      customer_price: part.standard_customer_price,
      billable_amount: billable,
      date_used: format(new Date(), "yyyy-MM-dd"),
    });
    await supabase
      .from("parts")
      .update({
        quantity_on_hand: part.quantity_on_hand - qty,
        updated_at: new Date().toISOString(),
      })
      .eq("id", part.id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "part_used",
      recordType: "work_order",
      recordId: selectedId,
      newValue: `${part.part_number} x${qty}`,
    });
    setPartForm({ part_id: "", quantity_used: "1" });
    await loadDetail(selectedId);
    await loadInventory();
    await loadRecentUsage(profile?.id, profile?.role);
    setBusy(false);
  }

  async function addAdditionalWork(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !profile) return;
    setBusy(true);
    await supabase.from("additional_work_requests").insert({
      work_order_id: selectedId,
      description: awrForm.description,
      estimated_additional_charge: Number(awrForm.estimated_additional_charge),
      requested_by: profile.id,
      approval_status: "Pending",
    });
    setAwrForm({ description: "", estimated_additional_charge: "0" });
    await loadDetail(selectedId);
    setBusy(false);
  }

  function WoList({ title, items }: { title: string; items: typeof workOrders }) {
    return (
      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
          <h3 className="font-semibold">
            {title} ({items.length})
          </h3>
          {items.length === 0 ? (
            <p className="text-sm opacity-60">None</p>
          ) : (
            <ul className="menu menu-sm rounded-box bg-base-200 p-1">
              {items.map((wo) => (
                <li key={wo.id}>
                  <button
                    type="button"
                    className={selectedId === wo.id ? "active" : ""}
                    onClick={() => setSelectedId(wo.id)}
                  >
                    <span className="font-medium">{wo.work_order_number}</span>
                    <span className="text-xs opacity-70">{wo.customers?.name}</span>
                    <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                    <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Technician Schedule"
        description="Today's jobs — arrive, labor, parts, and submit for review"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/parts" className="btn btn-outline btn-sm gap-1">
              <Package className="h-4 w-4" /> Parts inventory
            </Link>
            {lowStockParts.length > 0 ? (
              <Link href="/parts?filter=low" className="btn btn-warning btn-sm gap-1">
                <AlertTriangle className="h-4 w-4" /> {lowStockParts.length} low stock
              </Link>
            ) : null}
          </div>
        }
      />

      {lowStockParts.length > 0 ? (
        <div role="alert" className="alert alert-warning mb-4 text-sm">
          <AlertTriangle className="h-4 w-4" />
          <span>
            {lowStockParts.length} inventory item(s) are low.{" "}
            <Link href="/parts?filter=low" className="link font-medium">
              Review in Parts inventory
            </Link>
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <WoList title="Today" items={today} />
          <WoList title="Upcoming" items={upcoming} />
          <WoList title="Overdue" items={overdue} />

          <div className="card bg-base-100 shadow">
            <div className="card-body p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1 font-semibold">
                  <Package className="h-4 w-4" /> My recent parts
                </h3>
                <Link href="/parts" className="btn btn-ghost btn-xs gap-1">
                  Inventory <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              {recentUsage.length === 0 ? (
                <p className="text-sm opacity-60">Parts you log on jobs will show here and in inventory.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {recentUsage.map((u) => (
                    <li key={u.id} className="rounded-box bg-base-200 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <Link href={`/parts?part=${u.part_id}`} className="link link-hover font-medium">
                          {u.parts?.part_number ?? "Part"} · {u.parts?.name ?? "—"}
                        </Link>
                        <span className="font-semibold">×{u.quantity_used}</span>
                      </div>
                      {u.work_orders?.id ? (
                        <p className="text-xs opacity-70">
                          Job{" "}
                          <Link href={`/work-orders/${u.work_orders.id}`} className="link">
                            {u.work_orders.work_order_number}
                          </Link>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          {!selected ? (
            <EmptyState title="Select a job" description="Choose a job from the schedule to log time and parts." />
          ) : (
            <>
              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold">
                        <Link href={`/work-orders/${selected.id}`} className="link link-hover">
                          {selected.work_order_number}
                        </Link>
                      </h2>
                      <p className="text-sm opacity-70">
                        <Link href={`/customers/${selected.customer_id}`} className="link link-hover">
                          {selected.customers?.name}
                        </Link>
                        {" · "}
                        {selected.scheduled_date}
                      </p>
                      {(() => {
                        const c = selected.customers;
                        const address = [
                          c?.service_address,
                          [c?.city, c?.state].filter(Boolean).join(", "),
                          c?.zip_code,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        if (!address && !c?.phone) return null;
                        return (
                          <p className="mt-1 text-sm opacity-70">
                            {address || "No service address on file"}
                            {c?.phone ? ` · ${c.phone}` : ""}
                          </p>
                        );
                      })()}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={selected.status} tone={statusTone(selected.status)} />
                      {selected.priority === "Critical" || selected.work_order_type === "Emergency Repair" ? (
                        <StatusBadge label="URGENT" tone="critical" />
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 text-sm">{selected.problem_description ?? "No description"}</p>
                  <div className="mt-3">
                    <EquipmentContextPanel equipment={selected.equipment} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => woAction("arrival")} disabled={busy}>
                      Record Arrival
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => woAction("start")} disabled={busy}>
                      Start Work
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => woAction("pause")} disabled={busy}>
                      Pause
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => woAction("ready")} disabled={busy}>
                      Ready for Review
                    </button>
                    <Link href={`/work-orders/${selected.id}`} className="btn btn-ghost btn-sm">
                      Open full job
                    </Link>
                    {selected.customers ? (
                      <Link href={`/customers/${selected.customer_id}`} className="btn btn-ghost btn-sm">
                        Customer
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <h3 className="font-semibold">Labor</h3>
                  <form onSubmit={addLabor} className="mt-2 grid gap-3 sm:grid-cols-2">
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
                      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                        Add Labor
                      </button>
                    </div>
                  </form>
                  {labor.length > 0 ? (
                    <table className="table table-sm mt-4">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Regular</th>
                          <th>OT</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {labor.map((l) => (
                          <tr key={l.id}>
                            <td>{l.work_date}</td>
                            <td>{l.regular_hours}</td>
                            <td>{l.overtime_hours}</td>
                            <td>{l.notes ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Package className="h-4 w-4" /> Parts used (from inventory)
                    </h3>
                    <Link href="/parts" className="btn btn-outline btn-xs gap-1">
                      Open inventory
                    </Link>
                  </div>

                  {partError ? <div className="alert alert-error mt-2 text-sm">{partError}</div> : null}

                  <form onSubmit={addPart} className="mt-2 grid gap-3 sm:grid-cols-2">
                    <FormRow label="Part">
                      <select
                        className="select select-bordered w-full"
                        value={partForm.part_id}
                        onChange={(e) => {
                          setPartForm({ ...partForm, part_id: e.target.value });
                          setPartError(null);
                        }}
                        required
                      >
                        <option value="">Select from inventory…</option>
                        {inventory.map((p) => {
                          const low = p.quantity_on_hand <= p.reorder_level;
                          return (
                            <option key={p.id} value={p.id} disabled={p.quantity_on_hand <= 0}>
                              {p.part_number} — {p.name} ({p.quantity_on_hand} on hand)
                              {low ? " · LOW" : ""}
                              {p.quantity_on_hand <= 0 ? " · OUT" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </FormRow>
                    <FormRow label="Qty">
                      <input
                        type="number"
                        min="1"
                        max={selectedPart?.quantity_on_hand || undefined}
                        className="input input-bordered w-full"
                        value={partForm.quantity_used}
                        onChange={(e) => setPartForm({ ...partForm, quantity_used: e.target.value })}
                      />
                    </FormRow>
                    {selectedPart ? (
                      <div className="rounded-box bg-base-200/60 p-3 text-sm sm:col-span-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            Stock: <strong>{selectedPart.quantity_on_hand}</strong> · Reorder at{" "}
                            {selectedPart.reorder_level} · Price{" "}
                            {formatMoney(selectedPart.standard_customer_price)}
                          </span>
                          <Link href={`/parts?part=${selectedPart.id}`} className="link link-primary text-xs">
                            View in inventory
                          </Link>
                        </div>
                        {selectedPart.quantity_on_hand <= selectedPart.reorder_level ? (
                          <p className="mt-1 text-warning">Low stock — use carefully or request restock.</p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex items-end">
                      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                        Add part (deduct stock)
                      </button>
                    </div>
                  </form>

                  {parts.length > 0 ? (
                    <table className="table table-sm mt-4">
                      <thead>
                        <tr>
                          <th>Part</th>
                          <th>Qty</th>
                          <th>Billable</th>
                          <th />
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
                            <td>{formatMoney(p.billable_amount)}</td>
                            <td>
                              <Link href={`/parts?part=${p.part_id}`} className="btn btn-ghost btn-xs">
                                Stock
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="mt-3 text-sm opacity-60">
                      No parts on this job yet. Stock decreases when you add parts.
                    </p>
                  )}
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <PurchaseOrderPanel workOrderId={selected.id} canEdit />
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <h3 className="font-semibold">Additional Work Request</h3>
                  <form onSubmit={addAdditionalWork} className="mt-2 space-y-3">
                    <FormRow label="Description">
                      <textarea
                        className="textarea textarea-bordered w-full"
                        rows={2}
                        value={awrForm.description}
                        onChange={(e) => setAwrForm({ ...awrForm, description: e.target.value })}
                        required
                      />
                    </FormRow>
                    <FormRow label="Est. charge">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input input-bordered w-full"
                        value={awrForm.estimated_additional_charge}
                        onChange={(e) =>
                          setAwrForm({ ...awrForm, estimated_additional_charge: e.target.value })
                        }
                      />
                    </FormRow>
                    <button type="submit" className="btn btn-outline btn-sm" disabled={busy}>
                      Submit Request
                    </button>
                  </form>
                  {additional.length > 0 ? (
                    <ul className="mt-4 space-y-2">
                      {additional.map((a) => (
                        <li key={a.id} className="rounded-box bg-base-200 p-3 text-sm">
                          {a.description} —{" "}
                          <StatusBadge label={a.approval_status} tone={statusTone(a.approval_status)} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
