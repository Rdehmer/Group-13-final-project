"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, isBefore, isToday, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { EquipmentContextPanel } from "@/components/EquipmentContextPanel";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { ProofOfCompletion } from "@/components/ProofOfCompletion";
import { EQUIPMENT_CONTEXT_SELECT, type EquipmentContextFields } from "@/lib/equipmentCoverage";
import type { Part, Profile, TechnicianLabor, WorkOrder, WorkOrderPart, AdditionalWorkRequest } from "@/lib/types";

const FIXED_BILLING_RATE = 75;
const OVERTIME_MULTIPLIER = 1.5;

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
  const [laborForm, setLaborForm] = useState({ regular_hours: "1", overtime_hours: "0", notes: "" });
  const [partForm, setPartForm] = useState({ part_id: "", quantity_used: "1" });
  const [editingPartUsage, setEditingPartUsage] = useState<(WorkOrderPart & { parts?: Part }) | null>(null);
  const [partEditForm, setPartEditForm] = useState({ part_id: "", quantity_used: "1" });
  const [partEditError, setPartEditError] = useState<string | null>(null);
  const [partMessage, setPartMessage] = useState<string | null>(null);
  const [awrForm, setAwrForm] = useState({ description: "" });
  const [showCompletionProof, setShowCompletionProof] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
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
      if (p) await loadWorkOrders(p.id, p.role);
      const { data: inv } = await supabase.from("parts").select("*").eq("is_active", true).order("name");
      setInventory((inv as Part[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  const today = workOrders.filter((wo) => wo.scheduled_date && isToday(parseISO(wo.scheduled_date)));
  const upcoming = workOrders.filter((wo) => wo.scheduled_date && !isToday(parseISO(wo.scheduled_date)) && !isBefore(parseISO(wo.scheduled_date), new Date()));
  const overdue = workOrders.filter((wo) => wo.scheduled_date && isBefore(parseISO(wo.scheduled_date), new Date()) && !isToday(parseISO(wo.scheduled_date)));
  const selected = workOrders.find((w) => w.id === selectedId);

  async function woAction(action: "arrival" | "start" | "pause" | "ready") {
    if (!selectedId) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const dispatchStatus = {
      arrival: "Arrived",
      start: "Working",
      pause: "Paused",
      ready: "Ready for Review",
    }[action];
    const updates: Record<string, unknown> = {
      updated_at: now,
      dispatch_status: dispatchStatus,
      dispatch_updated_at: now,
    };
    if (action === "arrival") { updates.arrival_at = now; updates.status = "In Progress"; }
    if (action === "start") { updates.started_at = now; updates.paused_at = null; updates.status = "In Progress"; }
    if (action === "pause") { updates.paused_at = now; updates.status = "In Progress"; }
    if (action === "ready") { updates.status = "Ready for Review"; }
    await supabase.from("work_orders").update(updates).eq("id", selectedId);
    await logActivity(supabase, { userId: user?.id ?? null, action, recordType: "work_order", recordId: selectedId, newValue: String(updates.status) });
    await loadWorkOrders(profile?.id, profile?.role);
    await loadDetail(selectedId);
    setBusy(false);
  }

  async function addLabor(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !profile) return;
    setBusy(true);
    const rate = profile.hourly_cost_rate ?? 45;
    await supabase.from("technician_labor").insert({
      work_order_id: selectedId,
      technician_id: profile.id,
      work_date: format(new Date(), "yyyy-MM-dd"),
      regular_hours: Number(laborForm.regular_hours),
      overtime_hours: Number(laborForm.overtime_hours),
      hourly_cost_rate: rate,
      overtime_cost_rate: rate * OVERTIME_MULTIPLIER,
      customer_billing_rate: FIXED_BILLING_RATE,
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
    const part = inventory.find((p) => p.id === partForm.part_id);
    if (!part) return;
    const qty = Number(partForm.quantity_used);
    const billable = part.standard_customer_price * qty;
    await supabase.from("work_order_parts").insert({
      work_order_id: selectedId,
      part_id: part.id,
      quantity_used: qty,
      unit_cost: part.unit_cost,
      customer_price: part.standard_customer_price,
      billable_amount: billable,
    });
    await supabase.from("parts").update({ quantity_on_hand: part.quantity_on_hand - qty }).eq("id", part.id);
    setPartForm({ part_id: "", quantity_used: "1" });
    await loadDetail(selectedId);
    const { data: inv } = await supabase.from("parts").select("*").eq("is_active", true).order("name");
    setInventory((inv as Part[]) ?? []);
    setBusy(false);
  }

  function openPartEditor(usage: WorkOrderPart & { parts?: Part }) {
    setEditingPartUsage(usage);
    setPartEditForm({
      part_id: usage.part_id,
      quantity_used: String(usage.quantity_used),
    });
    setPartEditError(null);
    setPartMessage(null);
  }

  function closePartEditor() {
    setEditingPartUsage(null);
    setPartEditError(null);
  }

  async function savePartEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPartUsage || !selectedId) return;

    const quantity = Number(partEditForm.quantity_used);
    if (!partEditForm.part_id || !Number.isInteger(quantity) || quantity < 1) {
      setPartEditError("Select a part and enter a whole-number quantity of at least 1.");
      return;
    }

    setBusy(true);
    setPartEditError(null);
    const { error: updateError } = await supabase.rpc("update_technician_work_order_part", {
      p_usage_id: editingPartUsage.id,
      p_part_id: partEditForm.part_id,
      p_quantity: quantity,
    });

    if (updateError) {
      setPartEditError(updateError.message);
      setBusy(false);
      return;
    }

    const selectedPart = inventory.find((part) => part.id === partEditForm.part_id);
    await logActivity(supabase, {
      userId: profile?.id ?? null,
      action: "updated_part_usage",
      recordType: "work_order_part",
      recordId: editingPartUsage.id,
      previousValue: `${editingPartUsage.parts?.name ?? editingPartUsage.part_id} × ${editingPartUsage.quantity_used}`,
      newValue: `${selectedPart?.name ?? partEditForm.part_id} × ${quantity}`,
    });

    setEditingPartUsage(null);
    setPartMessage("Part usage updated successfully");
    await loadDetail(selectedId);
    const { data: inv } = await supabase.from("parts").select("*").eq("is_active", true).order("name");
    setInventory((inv as Part[]) ?? []);
    setBusy(false);
  }

  async function addAdditionalWork(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !profile) return;
    setBusy(true);
    await supabase.from("additional_work_requests").insert({
      work_order_id: selectedId,
      description: awrForm.description,
      estimated_additional_charge: 0,
      requested_by: profile.id,
    });
    setAwrForm({ description: "" });
    await loadDetail(selectedId);
    setBusy(false);
  }

  async function handleCompleted() {
    if (!selectedId) return;
    const { data: { user } } = await supabase.auth.getUser();
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "completed_with_proof",
      recordType: "work_order",
      recordId: selectedId,
      newValue: "Completed",
    });
    setShowCompletionProof(false);
    setSelectedId(null);
    await loadWorkOrders(profile?.id, profile?.role);
  }

  function selectWorkOrder(workOrderId: string) {
    setEditingPartUsage(null);
    setPartEditError(null);
    setPartMessage(null);
    setShowCompletionProof(false);
    setSelectedId(workOrderId);
  }

  function WoList({ title, items }: { title: string; items: typeof workOrders }) {
    return (
      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
          <h3 className="font-semibold">{title} ({items.length})</h3>
          {items.length === 0 ? (
            <p className="text-sm opacity-60">None</p>
          ) : (
            <ul className="menu menu-sm rounded-box bg-base-200 p-1">
              {items.map((wo) => (
                <li key={wo.id}>
                  <button type="button" className={selectedId === wo.id ? "active" : ""} onClick={() => selectWorkOrder(wo.id)}>
                    <span>{wo.work_order_number}</span>
                    <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
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
      <PageHeader title="Technician Schedule" description="Today's jobs, labor entry, and parts" />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <WoList title="Today" items={today} />
          <WoList title="Upcoming" items={upcoming} />
          <WoList title="Overdue" items={overdue} />
        </div>

        <div className="lg:col-span-2 space-y-4">
          {!selected ? (
            <EmptyState title="Select a work order" description="Choose a job from the schedule to log time and parts." />
          ) : (
            <>
              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold">{selected.work_order_number}</h2>
                      <p className="text-sm opacity-70">{selected.customers?.name} · {selected.scheduled_date}</p>
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
                      {(selected.priority === "Critical" || selected.work_order_type === "Emergency Repair") ? (
                        <StatusBadge label="URGENT" tone="critical" />
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 text-sm">{selected.problem_description ?? "No description"}</p>
                  <div className="mt-3">
                    <EquipmentContextPanel equipment={selected.equipment} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => woAction("arrival")} disabled={busy}>Record Arrival</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => woAction("start")} disabled={busy}>Start Work</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => woAction("pause")} disabled={busy}>Pause</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => woAction("ready")} disabled={busy}>Ready for Review</button>
                    {profile?.role === "technician" && selected.assigned_technician_id === profile.id ? (
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        onClick={() => setShowCompletionProof(true)}
                        disabled={busy}
                      >
                        Mark as Completed
                      </button>
                    ) : null}
                    <Link href={`/work-orders/${selected.id}`} className="btn btn-ghost btn-sm">Full Detail</Link>
                  </div>
                </div>
              </div>

              <div className="tabs tabs-boxed">
                <a className="tab tab-active">Labor</a>
              </div>
              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <form onSubmit={addLabor} className="grid gap-3 sm:grid-cols-2">
                    <FormRow label="Regular hrs"><input type="number" min="0" step="0.25" className="input input-bordered w-full" value={laborForm.regular_hours} onChange={(e) => setLaborForm({ ...laborForm, regular_hours: e.target.value })} /></FormRow>
                    <FormRow label="OT hrs"><input type="number" min="0" step="0.25" className="input input-bordered w-full" value={laborForm.overtime_hours} onChange={(e) => setLaborForm({ ...laborForm, overtime_hours: e.target.value })} /></FormRow>
                    <FormRow label="Billing rate ($/hr)">
                      <input type="text" className="input input-bordered w-full" value={`$${FIXED_BILLING_RATE.toFixed(2)}/hr · OT ${OVERTIME_MULTIPLIER}×`} readOnly disabled />
                    </FormRow>
                    <FormRow label="Notes"><input className="input input-bordered w-full" value={laborForm.notes} onChange={(e) => setLaborForm({ ...laborForm, notes: e.target.value })} /></FormRow>
                    <div className="flex items-end"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Add Labor</button></div>
                  </form>
                  {labor.length > 0 ? (
                    <table className="table table-sm mt-4">
                      <thead><tr><th>Date</th><th>Regular</th><th>OT</th><th>Rate</th><th>Charge</th><th>Notes</th></tr></thead>
                      <tbody>{labor.map((l) => <tr key={l.id}><td>{l.work_date}</td><td>{l.regular_hours}</td><td>{l.overtime_hours}</td><td>${Number(l.customer_billing_rate).toFixed(2)}/hr</td><td>${(Number(l.regular_hours) * Number(l.customer_billing_rate) + Number(l.overtime_hours) * Number(l.customer_billing_rate) * OVERTIME_MULTIPLIER).toFixed(2)}</td><td>{l.notes ?? "—"}</td></tr>)}</tbody>
                    </table>
                  ) : null}
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <h3 className="font-semibold">Parts Used</h3>
                  {partMessage ? <div role="status" className="alert alert-success mt-2 text-sm"><span>{partMessage}</span></div> : null}
                  <form onSubmit={addPart} className="mt-2 grid gap-3 sm:grid-cols-2">
                    <FormRow label="Part">
                      <select className="select select-bordered w-full" value={partForm.part_id} onChange={(e) => setPartForm({ ...partForm, part_id: e.target.value })} required>
                        <option value="">Select…</option>
                        {inventory.map((p) => <option key={p.id} value={p.id}>{p.part_number} — {p.name} ({p.quantity_on_hand})</option>)}
                      </select>
                    </FormRow>
                    <FormRow label="Qty"><input type="number" min="1" className="input input-bordered w-full" value={partForm.quantity_used} onChange={(e) => setPartForm({ ...partForm, quantity_used: e.target.value })} /></FormRow>
                    <div className="flex items-end"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Add Part</button></div>
                  </form>
                  {parts.length > 0 ? (
                    <table className="table table-sm mt-4">
                      <thead><tr><th>Part</th><th>Qty</th><th>Billable</th><th>Actions</th></tr></thead>
                      <tbody>{parts.map((p) => (
                        <tr key={p.id}>
                          <td>{p.parts?.name ?? p.part_id}</td>
                          <td>{p.quantity_used}</td>
                          <td>${Number(p.billable_amount).toFixed(2)}</td>
                          <td><button type="button" className="btn btn-ghost btn-xs" onClick={() => openPartEditor(p)}>Edit</button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  ) : null}

                  {editingPartUsage ? (
                    <dialog className="modal modal-open">
                      <div className="modal-box max-w-lg">
                        <h3 className="text-lg font-bold">Edit Part Used</h3>
                        <p className="mt-1 text-sm opacity-70">Correct the selected part or quantity. Inventory will be adjusted automatically.</p>
                        {partEditError ? <div role="alert" className="alert alert-error mt-3 text-sm"><span>{partEditError}</span></div> : null}
                        <form onSubmit={savePartEdit} className="mt-4 space-y-3">
                          <FormRow label="Part" required>
                            <select
                              className="select select-bordered w-full"
                              value={partEditForm.part_id}
                              onChange={(e) => setPartEditForm({ ...partEditForm, part_id: e.target.value })}
                              required
                            >
                              {inventory.map((part) => (
                                <option key={part.id} value={part.id}>
                                  {part.part_number} — {part.name} ({part.quantity_on_hand} available)
                                </option>
                              ))}
                            </select>
                          </FormRow>
                          <FormRow label="Qty" required>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              className="input input-bordered w-full"
                              value={partEditForm.quantity_used}
                              onChange={(e) => setPartEditForm({ ...partEditForm, quantity_used: e.target.value })}
                              required
                            />
                          </FormRow>
                          <div className="modal-action">
                            <button type="button" className="btn" onClick={closePartEditor} disabled={busy}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>Save Changes</button>
                          </div>
                        </form>
                      </div>
                      <form method="dialog" className="modal-backdrop"><button type="button" onClick={closePartEditor}>close</button></form>
                    </dialog>
                  ) : null}
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body">
                  <h3 className="font-semibold">Additional Work Request</h3>
                  <form onSubmit={addAdditionalWork} className="mt-2 space-y-3">
                    <FormRow label="Description"><textarea className="textarea textarea-bordered w-full" rows={2} value={awrForm.description} onChange={(e) => setAwrForm({ ...awrForm, description: e.target.value })} required /></FormRow>
                    <button type="submit" className="btn btn-outline btn-sm" disabled={busy}>Submit Request</button>
                  </form>
                  {additional.length > 0 ? (
                    <ul className="mt-4 space-y-2">{additional.map((a) => (
                      <li key={a.id} className="rounded-box bg-base-200 p-3 text-sm">
                        {a.description} — <StatusBadge label={a.approval_status} tone={statusTone(a.approval_status)} />
                      </li>
                    ))}</ul>
                  ) : null}
                </div>
              </div>

              {showCompletionProof && profile ? (
                <ProofOfCompletion
                  jobId={selected.id}
                  technicianId={profile.id}
                  requirement={selected.completion_proof_requirement ?? "photo_or_signature"}
                  onCancel={() => setShowCompletionProof(false)}
                  onCompleted={handleCompleted}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
