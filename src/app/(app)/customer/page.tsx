"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatCard, StatusBadge, statusTone } from "@/components/ui";
import type { Equipment, Profile, WorkOrder } from "@/lib/types";

/**
 * This business faces customer communication gap risk when service status is opaque.
 * Our app reduces the risk by giving customers a portal to view equipment and request service.
 */
export default function CustomerPortalPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [form, setForm] = useState({ equipment_id: "", problem_description: "", priority: "Normal" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) return;
      const [{ data: eq }, { data: wo }] = await Promise.all([
        supabase.from("equipment").select("*").eq("customer_id", p.customer_id).order("name"),
        supabase.from("work_orders").select("*").eq("customer_id", p.customer_id).order("created_at", { ascending: false }).limit(10),
      ]);
      setEquipment((eq as Equipment[]) ?? []);
      setWorkOrders((wo as WorkOrder[]) ?? []);
    })();
  }, []);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.customer_id) return;
    setBusy(true);
    setMessage(null);
    const { data: { user } } = await supabase.auth.getUser();
    const woNumber = `WO-${Date.now().toString().slice(-8)}`;
    const { data, error } = await supabase.from("work_orders").insert({
      work_order_number: woNumber,
      customer_id: profile.customer_id,
      equipment_id: form.equipment_id || null,
      work_order_type: "Follow-Up Service",
      priority: form.priority,
      problem_description: form.problem_description,
      requested_service: form.problem_description,
      status: "Requested",
      customer_approval_required: true,
    }).select().single();
    if (error) { setMessage(error.message); setBusy(false); return; }
    await logActivity(supabase, { userId: user?.id ?? null, action: "service_request", recordType: "work_order", recordId: data.id, newValue: woNumber });
    setForm({ equipment_id: "", problem_description: "", priority: "Normal" });
    setMessage("Service request submitted. A manager will review and schedule.");
    const { data: wo } = await supabase.from("work_orders").select("*").eq("customer_id", profile.customer_id).order("created_at", { ascending: false }).limit(10);
    setWorkOrders((wo as WorkOrder[]) ?? []);
    setBusy(false);
  }

  if (!profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState title="No customer account linked" description="Contact Ridley Equipment Services to link your portal account." />
    );
  }

  const openRequests = workOrders.filter((w) => !["Completed", "Closed", "Canceled"].includes(w.status)).length;

  return (
    <div>
      <PageHeader title="My Portal" description={`Welcome, ${profile.full_name ?? profile.email}`} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Equipment" value={equipment.length} />
        <StatCard label="Open Requests" value={openRequests} />
        <StatCard label="Recent Orders" value={workOrders.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Request Service</h2>
            {message ? <div role="alert" className="alert alert-success text-sm"><span>{message}</span></div> : null}
            <form onSubmit={submitRequest} className="space-y-3">
              <FormRow label="Equipment">
                <select className="select select-bordered w-full" value={form.equipment_id} onChange={(e) => setForm({ ...form, equipment_id: e.target.value })}>
                  <option value="">General / Unspecified</option>
                  {equipment.map((eq) => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
                </select>
              </FormRow>
              <FormRow label="Priority">
                <select className="select select-bordered w-full" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="Low">Low</option><option value="Normal">Normal</option><option value="High">High</option><option value="Critical">Critical</option>
                </select>
              </FormRow>
              <FormRow label="Description" required>
                <textarea className="textarea textarea-bordered w-full" rows={4} value={form.problem_description} onChange={(e) => setForm({ ...form, problem_description: e.target.value })} required />
              </FormRow>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Submit Request</button>
            </form>
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Your Equipment</h2>
            {equipment.length === 0 ? (
              <EmptyState title="No equipment on file" description="Contact us to register your equipment." />
            ) : (
              <ul className="space-y-2">
                {equipment.map((eq) => (
                  <li key={eq.id} className="flex items-center justify-between rounded-box bg-base-200 p-3 text-sm">
                    <span>{eq.name}</span>
                    <StatusBadge label={eq.operating_status} tone={statusTone(eq.operating_status)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">Service History</h2>
          {workOrders.length === 0 ? (
            <EmptyState title="No service history" description="Your work orders will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead><tr><th>WO #</th><th>Type</th><th>Status</th><th>Scheduled</th></tr></thead>
                <tbody>
                  {workOrders.map((wo) => (
                    <tr key={wo.id}>
                      <td>{wo.work_order_number}</td>
                      <td>{wo.work_order_type}</td>
                      <td><StatusBadge label={wo.status} tone={statusTone(wo.status)} /></td>
                      <td>{wo.scheduled_date ?? "Pending"}</td>
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
