"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { EquipmentContextPanel } from "@/components/EquipmentContextPanel";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusBadge, statusTone } from "@/components/ui";
import { ActivityFeed } from "@/components/ActivityFeed";
import { EQUIPMENT_CONTEXT_SELECT, type EquipmentContextFields } from "@/lib/equipmentCoverage";
import type { Profile, WorkOrder } from "@/lib/types";

type WoDetail = WorkOrder & {
  customers?: { name: string };
  equipment?: EquipmentContextFields | null;
};

export default function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [wo, setWo] = useState<WoDetail | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [managerNotes, setManagerNotes] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [{ data }, { data: { user } }] = await Promise.all([
      supabase
        .from("work_orders")
        .select(`*, customers(name), equipment(${EQUIPMENT_CONTEXT_SELECT})`)
        .eq("id", id)
        .single(),
      supabase.auth.getUser(),
    ]);
    const w = data as WoDetail | null;
    setWo(w);
    setManagerNotes(w?.manager_notes ?? "");
    setWorkPerformed(w?.work_performed ?? "");
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
    }
  }

  useEffect(() => { load(); }, [id]);

  const isManager = profile?.role === "administrator" || profile?.role === "service_manager";
  const urgent = wo && (wo.priority === "Critical" || wo.work_order_type === "Emergency Repair");

  async function updateStatus(status: string, extra: Record<string, unknown> = {}) {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("work_orders").update({ status, ...extra, updated_at: new Date().toISOString() }).eq("id", id);
    await logActivity(supabase, { userId: user?.id ?? null, action: "status_change", recordType: "work_order", recordId: id, newValue: status });
    await load();
    setSaving(false);
  }

  async function approveComplete() {
    if (!profile) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("work_orders").update({
      status: "Completed",
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
      completion_date: new Date().toISOString().slice(0, 10),
      manager_notes: managerNotes,
      work_performed: workPerformed,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    await logActivity(supabase, { userId: user?.id ?? null, action: "approved_completion", recordType: "work_order", recordId: id, newValue: "Completed" });
    await load();
    setSaving(false);
  }

  async function saveNotes() {
    setSaving(true);
    await supabase.from("work_orders").update({
      manager_notes: managerNotes,
      work_performed: workPerformed,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    setSaving(false);
  }

  if (!wo) return <div className="p-8 text-center opacity-60">Loading…</div>;

  const equipmentCatalogHref =
    isManager && wo.equipment?.id ? `/equipment?highlight=${wo.equipment.id}` : null;

  return (
    <div>
      <PageHeader
        title={wo.work_order_number}
        description={`${wo.customers?.name ?? ""} · ${wo.work_order_type}`}
        actions={<Link href="/work-orders" className="btn btn-ghost btn-sm">← Back</Link>}
      />

      {urgent ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{wo.priority === "Critical" ? "Critical priority" : "Emergency repair"} — requires immediate attention</span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card bg-base-100 shadow lg:col-span-2">
          <div className="card-body space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
              <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
              <StatusBadge label={wo.billing_status} tone={statusTone(wo.billing_status)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <p><span className="opacity-60">Scheduled:</span> {wo.scheduled_date ?? "—"}</p>
              <p><span className="opacity-60">Warranty:</span> {wo.warranty_coverage}</p>
              <p><span className="opacity-60">Arrival:</span> {wo.arrival_at ? new Date(wo.arrival_at).toLocaleString() : "—"}</p>
            </div>
            <EquipmentContextPanel equipment={wo.equipment} catalogHref={equipmentCatalogHref} />
            <div>
              <p className="text-sm font-medium opacity-60">Problem</p>
              <p>{wo.problem_description ?? "—"}</p>
            </div>
            <FormRow label="Work performed">
              <textarea className="textarea textarea-bordered w-full" rows={3} value={workPerformed} onChange={(e) => setWorkPerformed(e.target.value)} disabled={!isManager && wo.status === "Completed"} />
            </FormRow>
            <FormRow label="Manager notes">
              <textarea className="textarea textarea-bordered w-full" rows={3} value={managerNotes} onChange={(e) => setManagerNotes(e.target.value)} disabled={!isManager} />
            </FormRow>
            {isManager ? (
              <button type="button" className="btn btn-outline btn-sm" onClick={saveNotes} disabled={saving}>Save Notes</button>
            ) : null}
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body space-y-2">
            <h2 className="card-title text-base">Actions</h2>
            {isManager && wo.status === "Ready for Review" ? (
              <button type="button" className="btn btn-success btn-sm w-full" onClick={approveComplete} disabled={saving}>
                Approve & Complete
              </button>
            ) : null}
            {isManager && !["Completed", "Closed", "Canceled"].includes(wo.status) ? (
              <>
                <button type="button" className="btn btn-outline btn-sm w-full" onClick={() => updateStatus("Scheduled")} disabled={saving}>Mark Scheduled</button>
                <button type="button" className="btn btn-outline btn-sm w-full" onClick={() => updateStatus("Waiting on Parts")} disabled={saving}>Waiting on Parts</button>
              </>
            ) : null}
            {wo.status === "Completed" ? (
              <p className="text-sm opacity-70">Approved {wo.approved_at ? new Date(wo.approved_at).toLocaleDateString() : ""}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <ActivityFeed recordType="work_order" recordId={id} />
      </div>
    </div>
  );
}
