"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, RefreshCw, Truck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import type { Profile } from "@/lib/types";

/** Main path — tech only sees the next step after completing the current one. */
const DISPATCH_FLOW = ["En Route", "In Progress", "Ready for Review", "Done"] as const;

type DispatchStatus = (typeof DISPATCH_FLOW)[number] | "Paused";

type DispatchWorkOrder = {
  id: string;
  work_order_number: string;
  assigned_technician_id: string | null;
  scheduled_date: string | null;
  scheduled_start_time: string | null;
  priority: string;
  problem_description: string | null;
  dispatch_status: string;
  dispatch_note: string | null;
  dispatch_updated_at: string | null;
  customers?: { name: string }[];
};

type DispatchTechnician = Pick<Profile, "id" | "full_name" | "email" | "is_active">;

function normalizeStatus(status: string): string {
  if (status === "Working") return "In Progress";
  return status;
}

function flowIndex(status: string): number {
  const normalized = normalizeStatus(status);
  if (normalized === "Paused") return DISPATCH_FLOW.indexOf("In Progress");
  return DISPATCH_FLOW.indexOf(normalized as (typeof DISPATCH_FLOW)[number]);
}

/** Next action on the main path (or resume from Paused). */
function getNextStatus(status: string): DispatchStatus | null {
  const normalized = normalizeStatus(status);
  if (normalized === "Paused") return "In Progress";
  const index = flowIndex(normalized);
  if (index < 0) return "En Route";
  if (index >= DISPATCH_FLOW.length - 1) return null;
  return DISPATCH_FLOW[index + 1];
}

/** Previous step for mis-clicks. */
function getPreviousStatus(status: string): DispatchStatus | null {
  const normalized = normalizeStatus(status);
  if (normalized === "Paused") return "In Progress";
  const index = flowIndex(normalized);
  if (index <= 0) return null;
  return DISPATCH_FLOW[index - 1];
}

function canPause(status: string): boolean {
  return normalizeStatus(status) === "In Progress";
}

function dispatchTone(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  const normalized = normalizeStatus(status);
  if (normalized === "Done" || normalized === "In Progress") return "success";
  if (normalized === "Paused") return "warning";
  if (normalized === "En Route" || normalized === "Ready for Review") return "info";
  return "neutral";
}

function WorkOrderCard({
  workOrder,
  note,
  canUpdate,
  saving,
  onNoteChange,
  onStatusChange,
  onSaveNote,
}: {
  workOrder: DispatchWorkOrder;
  note: string;
  canUpdate: boolean;
  saving: boolean;
  onNoteChange: (value: string) => void;
  onStatusChange: (status: DispatchStatus) => void;
  onSaveNote: () => void;
}) {
  const current = normalizeStatus(workOrder.dispatch_status);
  const nextStatus = getNextStatus(workOrder.dispatch_status);
  const previousStatus = getPreviousStatus(workOrder.dispatch_status);
  const showPause = canPause(workOrder.dispatch_status);

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{workOrder.work_order_number}</p>
          <p className="text-sm opacity-70">
            {workOrder.customers?.[0]?.name ?? "Unknown customer"}
            {workOrder.scheduled_date ? ` · ${workOrder.scheduled_date}` : ""}
            {workOrder.scheduled_start_time ? ` at ${workOrder.scheduled_start_time.slice(0, 5)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge label={workOrder.priority} tone={workOrder.priority === "Critical" ? "error" : "neutral"} />
          <StatusBadge label={current} tone={dispatchTone(current)} />
        </div>
      </div>

      <p className="mt-3 text-sm">{workOrder.problem_description ?? "No problem description"}</p>

      {canUpdate ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-sm font-semibold">
              {nextStatus ? "Next step" : "Job complete"}
            </p>
            <div className="flex flex-col gap-2">
              {nextStatus ? (
                <button
                  type="button"
                  className="btn btn-primary min-h-14 text-base"
                  disabled={saving}
                  onClick={() => onStatusChange(nextStatus)}
                >
                  {current === "Paused" ? `Resume — ${nextStatus}` : nextStatus}
                </button>
              ) : (
                <p className="rounded-box bg-success/10 px-3 py-2 text-sm font-medium text-success">
                  Marked Done. Use Go back if that was a mistake.
                </p>
              )}

              {showPause ? (
                <button
                  type="button"
                  className="btn btn-outline min-h-12"
                  disabled={saving}
                  onClick={() => onStatusChange("Paused")}
                >
                  Paused
                </button>
              ) : null}

              {previousStatus ? (
                <button
                  type="button"
                  className="btn btn-ghost min-h-12 gap-2"
                  disabled={saving}
                  onClick={() => onStatusChange(previousStatus)}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Go back to {previousStatus}
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="form-control min-w-0 flex-1">
              <span className="label-text font-medium">Optional note</span>
              <input
                className="input input-bordered mt-1 w-full"
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Add a quick note"
                disabled={saving}
              />
            </label>
            <button
              type="button"
              className="btn btn-outline min-h-12 sm:min-h-10"
              onClick={onSaveNote}
              disabled={saving}
            >
              Save note
            </button>
          </div>
        </div>
      ) : workOrder.dispatch_note ? (
        <p className="mt-3 rounded-box bg-base-200 p-3 text-sm">
          <span className="font-medium">Note:</span> {workOrder.dispatch_note}
        </p>
      ) : null}
    </div>
  );
}

export default function DispatchPage() {
  const supabase = createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [technicians, setTechnicians] = useState<DispatchTechnician[]>([]);
  const [workOrders, setWorkOrders] = useState<DispatchWorkOrder[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isDispatcher = profile?.role === "administrator" || profile?.role === "service_manager";

  async function loadBoard() {
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    const currentProfile = profileData as Profile;
    const dispatcher = currentProfile.role === "administrator" || currentProfile.role === "service_manager";
    setProfile(currentProfile);

    let techniciansQuery = supabase
      .from("profiles")
      .select("id, full_name, email, is_active")
      .eq("role", "technician")
      .eq("is_active", true)
      .order("full_name");

    let workOrdersQuery = supabase
      .from("work_orders")
      .select("id, work_order_number, assigned_technician_id, scheduled_date, scheduled_start_time, priority, problem_description, dispatch_status, dispatch_note, dispatch_updated_at, customers(name)")
      .or(`scheduled_date.eq.${today},dispatch_updated_at.gte.${startOfToday.toISOString()}`)
      .not("assigned_technician_id", "is", null)
      .not("status", "in", '("Closed","Canceled")')
      .order("scheduled_start_time");

    if (!dispatcher) {
      techniciansQuery = techniciansQuery.eq("id", currentProfile.id);
      workOrdersQuery = workOrdersQuery.eq("assigned_technician_id", currentProfile.id);
    }

    const [
      { data: technicianData, error: technicianError },
      { data: workOrderData, error: workOrderError },
    ] = await Promise.all([techniciansQuery, workOrdersQuery]);

    const loadError = technicianError ?? workOrderError;
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const loadedOrders = (workOrderData as DispatchWorkOrder[]) ?? [];
    setTechnicians((technicianData as DispatchTechnician[]) ?? []);
    setWorkOrders(loadedOrders);
    setNotes(Object.fromEntries(loadedOrders.map((order) => [order.id, order.dispatch_note ?? ""])));
    setLoading(false);
  }

  useEffect(() => {
    void loadBoard();
  }, []);

  async function updateDispatchStatus(workOrder: DispatchWorkOrder, status: DispatchStatus) {
    if (!profile || isDispatcher) return;
    setSavingId(workOrder.id);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from("work_orders")
      .update({
        dispatch_status: status,
        dispatch_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", workOrder.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setWorkOrders((current) => current.map((order) => order.id === workOrder.id ? { ...order, dispatch_status: status } : order));
      await logActivity(supabase, {
        userId: profile.id,
        action: "dispatch_status_change",
        recordType: "work_order",
        recordId: workOrder.id,
        previousValue: workOrder.dispatch_status,
        newValue: status,
      });
      setMessage(`${workOrder.work_order_number} status updated`);
    }
    setSavingId(null);
  }

  async function saveDispatchNote(workOrder: DispatchWorkOrder) {
    if (!profile || isDispatcher) return;
    setSavingId(workOrder.id);
    setError(null);
    setMessage(null);
    const note = notes[workOrder.id]?.trim() ?? "";

    const { error: updateError } = await supabase
      .from("work_orders")
      .update({ dispatch_note: note || null, updated_at: new Date().toISOString() })
      .eq("id", workOrder.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setWorkOrders((current) => current.map((order) => order.id === workOrder.id ? { ...order, dispatch_note: note || null } : order));
      await logActivity(supabase, {
        userId: profile.id,
        action: "dispatch_note_update",
        recordType: "work_order",
        recordId: workOrder.id,
        previousValue: workOrder.dispatch_note,
        newValue: note || null,
      });
      setMessage("Dispatch note saved");
    }
    setSavingId(null);
  }

  return (
    <div>
      <PageHeader
        title="Dispatch"
        description={isDispatcher ? `All technician activity for ${today}` : `Your assigned work orders for ${today}`}
        actions={
          <button type="button" className="btn btn-outline btn-sm gap-2" onClick={() => void loadBoard()} disabled={loading}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      {error ? <div role="alert" className="alert alert-error mb-4"><span>{error}</span></div> : null}
      {message ? <div role="status" className="alert alert-success mb-4"><span>{message}</span></div> : null}

      {loading ? (
        <div className="p-8 text-center opacity-60">Loading dispatch board…</div>
      ) : isDispatcher ? (
        technicians.length === 0 ? (
          <EmptyState title="No active technicians" description="Active technicians will appear here." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {technicians.map((technician) => {
              const assignments = workOrders.filter((order) => order.assigned_technician_id === technician.id);
              return (
                <section key={technician.id} className="card bg-base-100 shadow">
                  <div className="card-body">
                    <h2 className="card-title text-base">{technician.full_name || technician.email}</h2>
                    <div className="mt-2 space-y-3">
                      {assignments.length === 0 ? (
                        <p className="rounded-box bg-base-200 p-4 text-sm opacity-70">No work orders scheduled today.</p>
                      ) : assignments.map((workOrder) => (
                        <WorkOrderCard
                          key={workOrder.id}
                          workOrder={workOrder}
                          note={notes[workOrder.id] ?? ""}
                          canUpdate={false}
                          saving={false}
                          onNoteChange={() => undefined}
                          onStatusChange={() => undefined}
                          onSaveNote={() => undefined}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )
      ) : (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Today&apos;s Work Orders ({workOrders.length})</h2>
          </div>
          {workOrders.length === 0 ? (
            <EmptyState title="No work orders today" description="You have no assigned work orders scheduled for today." />
          ) : (
            <div className="space-y-3">
              {workOrders.map((workOrder) => (
                <WorkOrderCard
                  key={workOrder.id}
                  workOrder={workOrder}
                  note={notes[workOrder.id] ?? ""}
                  canUpdate
                  saving={savingId === workOrder.id}
                  onNoteChange={(value) => setNotes((current) => ({ ...current, [workOrder.id]: value }))}
                  onStatusChange={(status) => void updateDispatchStatus(workOrder, status)}
                  onSaveNote={() => void saveDispatchNote(workOrder)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
