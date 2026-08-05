"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatCard } from "@/components/ui";
import type { Equipment, Profile, WorkOrder } from "@/lib/types";

/**
 * This business faces customer communication gap risk when service status is opaque.
 * Our app reduces the risk by giving customers a focused place to request service,
 * with other portal details one click away.
 */
export default function CustomerPortalPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [contractCount, setContractCount] = useState(0);
  const [activeContractCount, setActiveContractCount] = useState(0);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [form, setForm] = useState({ equipment_id: "", problem_description: "", priority: "Normal" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async (customerId: string) => {
    const [{ data: eq }, { data: wo }, { data: sc }] = await Promise.all([
      supabase.from("equipment").select("*").eq("customer_id", customerId).order("name"),
      supabase.from("work_orders").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }),
      supabase.from("service_contracts").select("id, status").eq("customer_id", customerId),
    ]);
    setEquipment((eq as Equipment[]) ?? []);
    setWorkOrders((wo as WorkOrder[]) ?? []);
    const contracts = sc ?? [];
    setContractCount(contracts.length);
    setActiveContractCount(contracts.filter((c) => c.status === "Active").length);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) return;
      await loadData(p.customer_id);
    })();
  }, [loadData, supabase]);

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
    await loadData(profile.customer_id);
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
      <PageHeader
        title="My Portal"
        description={`Welcome, ${profile.full_name ?? profile.email}. Submit a service request below, or open a section for more detail.`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/customer/contracts" className="block transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-box">
          <StatCard label="My Contracts" value={contractCount} hint={`${activeContractCount} active · View →`} />
        </Link>
        <Link href="/customer/equipment" className="block transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-box">
          <StatCard label="Equipment" value={equipment.length} hint="View & register →" />
        </Link>
        <Link href="/customer/open-request" className="block transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-box">
          <StatCard label="Open Request" value={openRequests} hint="View status & stage →" />
        </Link>
        <Link href="/customer/order-history" className="block transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-box">
          <StatCard label="Order History" value={workOrders.length} hint="View history →" />
        </Link>
      </div>

      <div className="mx-auto max-w-2xl">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Request Service</h2>
            <p className="text-sm opacity-70">Need a one-off repair or follow-up visit? Submit a service request below.</p>
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
              <button type="submit" className="btn btn-primary" disabled={busy}>Submit Request</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
