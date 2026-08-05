"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isBefore, parseISO, startOfDay } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Customer, Equipment, Profile, WorkOrder } from "@/lib/types";

function nextWoNumber() {
  return `WO-${Date.now().toString().slice(-8)}`;
}

const CLOSED = new Set(["Completed", "Closed", "Canceled"]);

/**
 * This business faces missed emergency response risk.
 * Our app reduces the risk by highlighting Critical and Emergency work orders.
 */
export default function WorkOrdersPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [workOrders, setWorkOrders] = useState<(WorkOrder & { customers?: { name: string } })[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [technicians, setTechnicians] = useState<Profile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: "",
    equipment_id: "",
    work_order_type: "Preventive Maintenance",
    priority: "Normal" as WorkOrder["priority"],
    assigned_technician_id: "",
    scheduled_date: "",
    problem_description: "",
    status: "Requested",
  });

  const filter = searchParams.get("filter");
  const typeFilter = searchParams.get("type");
  const statusFilter = searchParams.get("status");

  async function load() {
    const [{ data: wo }, { data: cust }, { data: tech }] = await Promise.all([
      supabase.from("work_orders").select("*, customers(name)").order("created_at", { ascending: false }),
      supabase.from("customers").select("*").eq("status", "Active").order("name"),
      supabase.from("profiles").select("*").eq("role", "technician").eq("is_active", true),
    ]);
    setWorkOrders((wo as typeof workOrders) ?? []);
    setCustomers((cust as Customer[]) ?? []);
    setTechnicians((tech as Profile[]) ?? []);
  }

  useEffect(() => { load(); }, []);

  const today = startOfDay(new Date());

  const filteredWorkOrders = useMemo(() => {
    return workOrders.filter((wo) => {
      if (filter === "open" && CLOSED.has(wo.status)) return false;
      if (filter === "urgent") {
        if (CLOSED.has(wo.status)) return false;
        if (!["Critical", "High"].includes(wo.priority)) return false;
      }
      if (filter === "overdue") {
        if (CLOSED.has(wo.status)) return false;
        if (!wo.scheduled_date) return false;
        if (!isBefore(parseISO(wo.scheduled_date), today)) return false;
      }
      if (typeFilter && wo.work_order_type !== typeFilter) return false;
      if (statusFilter && wo.status !== statusFilter) return false;
      return true;
    });
  }, [workOrders, filter, typeFilter, statusFilter, today]);

  const activeFilterLabel = [
    filter === "open" ? "Open" : null,
    filter === "urgent" ? "High / Critical" : null,
    filter === "overdue" ? "Overdue" : null,
    typeFilter ? `Type: ${typeFilter}` : null,
    statusFilter ? `Status: ${statusFilter}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function clearFilters() {
    router.push(pathname);
  }

  useEffect(() => {
    if (!form.customer_id) { setEquipment([]); return; }
    supabase.from("equipment").select("*").eq("customer_id", form.customer_id).then(({ data }) => {
      setEquipment((data as Equipment[]) ?? []);
    });
  }, [form.customer_id]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      work_order_number: nextWoNumber(),
      customer_id: form.customer_id,
      equipment_id: form.equipment_id || null,
      work_order_type: form.work_order_type,
      priority: form.priority,
      assigned_technician_id: form.assigned_technician_id || null,
      scheduled_date: form.scheduled_date || null,
      problem_description: form.problem_description || null,
      status: form.assigned_technician_id ? "Assigned" : "Requested",
    };
    const { data, error: insertError } = await supabase.from("work_orders").insert(payload).select().single();
    if (insertError) { setError(insertError.message); return; }
    await logActivity(supabase, { userId: user?.id ?? null, action: "created", recordType: "work_order", recordId: data.id, newValue: payload.work_order_number });
    setShowForm(false);
    load();
  }

  function rowClass(wo: WorkOrder) {
    if (wo.priority === "Critical" || wo.work_order_type === "Emergency Repair") return "bg-error/10";
    if (wo.priority === "High") return "bg-warning/10";
    return "";
  }

  return (
    <div>
      <PageHeader title="Work Orders" description="Schedule and track service work" actions={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>Create Work Order</button>
      } />

      {activeFilterLabel ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-box bg-base-200/60 px-3 py-2 text-sm">
          <span className="opacity-70">Showing:</span>
          <span className="badge badge-primary badge-outline">{activeFilterLabel}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={clearFilters}>
            Clear filter
          </button>
        </div>
      ) : null}

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">New Work Order</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <FormRow label="Customer" required>
                <select className="select select-bordered w-full" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value, equipment_id: "" })} required>
                  <option value="">Select…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormRow>
              <FormRow label="Equipment">
                <select className="select select-bordered w-full" value={form.equipment_id} onChange={(e) => setForm({ ...form, equipment_id: e.target.value })}>
                  <option value="">Optional</option>
                  {equipment.map((eq) => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
                </select>
              </FormRow>
              <FormRow label="Type">
                <select className="select select-bordered w-full" value={form.work_order_type} onChange={(e) => setForm({ ...form, work_order_type: e.target.value })}>
                  <option>Preventive Maintenance</option>
                  <option>Emergency Repair</option>
                  <option>Inspection</option>
                  <option>Warranty Repair</option>
                  <option>Installation</option>
                  <option>Follow-Up Service</option>
                </select>
              </FormRow>
              <FormRow label="Priority">
                <select className="select select-bordered w-full" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as WorkOrder["priority"] })}>
                  <option value="Low">Low</option>
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </FormRow>
              <FormRow label="Technician">
                <select className="select select-bordered w-full" value={form.assigned_technician_id} onChange={(e) => setForm({ ...form, assigned_technician_id: e.target.value })}>
                  <option value="">Unassigned</option>
                  {technicians.map((t) => <option key={t.id} value={t.id}>{t.full_name ?? t.email}</option>)}
                </select>
              </FormRow>
              <FormRow label="Scheduled">
                <input type="date" className="input input-bordered w-full" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} />
              </FormRow>
              <FormRow label="Problem">
                <textarea className="textarea textarea-bordered w-full" rows={3} value={form.problem_description} onChange={(e) => setForm({ ...form, problem_description: e.target.value })} />
              </FormRow>
              <div className="modal-action">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop"><button type="button" onClick={() => setShowForm(false)}>close</button></form>
        </dialog>
      ) : null}

      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {filteredWorkOrders.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={workOrders.length === 0 ? "No work orders" : "No matching work orders"}
                description={
                  workOrders.length === 0
                    ? "Create a work order to schedule service."
                    : "Try clearing the filter to see all work orders."
                }
                action={
                  activeFilterLabel ? (
                    <button type="button" className="btn btn-sm" onClick={clearFilters}>
                      Clear filter
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>WO #</th><th>Customer</th><th>Type</th><th>Priority</th><th>Scheduled</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {filteredWorkOrders.map((wo) => (
                    <tr key={wo.id} className={rowClass(wo)}>
                      <td className="font-medium">{wo.work_order_number}</td>
                      <td>{wo.customers?.name ?? "—"}</td>
                      <td>{wo.work_order_type}</td>
                      <td><StatusBadge label={wo.priority} tone={statusTone(wo.priority)} /></td>
                      <td>{wo.scheduled_date ?? "—"}</td>
                      <td><StatusBadge label={wo.status} tone={statusTone(wo.status)} /></td>
                      <td><Link href={`/work-orders/${wo.id}`} className="btn btn-ghost btn-xs">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
