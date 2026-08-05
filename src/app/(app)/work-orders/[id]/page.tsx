"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusBadge, statusTone } from "@/components/ui";
import { ActivityFeed } from "@/components/ActivityFeed";
import type { Profile, WorkOrder } from "@/lib/types";
import {
  WO_STATUSES,
  scheduleFieldsForStatusChange,
} from "@/lib/work-order-status";

const PRIORITIES: WorkOrder["priority"][] = ["Low", "Normal", "High", "Critical"];

export default function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [wo, setWo] = useState<
    (WorkOrder & { customers?: { id?: string; name: string }; equipment?: { name: string } }) | null
  >(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [managerNotes, setManagerNotes] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [{ data }, { data: { user } }] = await Promise.all([
      supabase
        .from("work_orders")
        .select("*, customers(id, name), equipment(name)")
        .eq("id", id)
        .single(),
      supabase.auth.getUser(),
    ]);
    const w = data as typeof wo;
    setWo(w);
    setManagerNotes(w?.manager_notes ?? "");
    setWorkPerformed(w?.work_performed ?? "");
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  const isServiceManager = profile?.role === "service_manager";
  const isManager = profile?.role === "administrator" || isServiceManager;
  const urgent = wo && (wo.priority === "Critical" || wo.work_order_type === "Emergency Repair");

  async function updateStatus(status: string, extra: Record<string, unknown> = {}) {
    if (!wo || wo.status === status) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const todayIso = new Date().toISOString().slice(0, 10);
    const scheduleExtra = isServiceManager
      ? scheduleFieldsForStatusChange(
          status,
          {
            scheduled_date: wo.scheduled_date,
            scheduled_start_time: wo.scheduled_start_time,
          },
          todayIso,
        )
      : {};
    const { error: updateError } = await supabase
      .from("work_orders")
      .update({ status, ...scheduleExtra, ...extra, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "status_change",
      recordType: "work_order",
      recordId: id,
      previousValue: wo.status,
      newValue: status,
    });
    setMessage(`Status updated to ${status}.`);
    await load();
    setSaving(false);
  }

  async function updatePriority(next: WorkOrder["priority"]) {
    if (!isServiceManager || !wo || wo.priority === next) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("work_orders")
      .update({ priority: next, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "priority_change",
      recordType: "work_order",
      recordId: id,
      previousValue: wo.priority,
      newValue: next,
    });
    setMessage(`Priority updated to ${next}.`);
    await load();
    setSaving(false);
  }

  async function approveComplete() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("work_orders")
      .update({
        status: "Completed",
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
        completion_date: new Date().toISOString().slice(0, 10),
        manager_notes: managerNotes,
        work_performed: workPerformed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "approved_completion",
      recordType: "work_order",
      recordId: id,
      newValue: "Completed",
    });
    setMessage("Work order approved and completed.");
    await load();
    setSaving(false);
  }

  async function saveNotes() {
    setSaving(true);
    setError(null);
    await supabase
      .from("work_orders")
      .update({
        manager_notes: managerNotes,
        work_performed: workPerformed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    setSaving(false);
  }

  if (!wo) return <div className="p-8 text-center opacity-60">Loading…</div>;

  const statusOptions = Array.from(new Set([...WO_STATUSES, wo.status]));

  return (
    <div>
      <PageHeader
        title={wo.work_order_number}
        description={`${wo.customers?.name ?? ""} · ${wo.work_order_type}`}
        actions={
          <Link href="/work-orders" className="btn btn-ghost btn-sm">
            ← Back
          </Link>
        }
      />

      {urgent ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>
            {wo.priority === "Critical" ? "Critical priority" : "Emergency repair"} — requires
            immediate attention
          </span>
        </div>
      ) : null}

      {error ? <div className="alert alert-error mb-4 text-sm">{error}</div> : null}
      {message ? <div className="alert alert-success mb-4 text-sm">{message}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card bg-base-100 shadow lg:col-span-2">
          <div className="card-body space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {isServiceManager ? (
                <div className="dropdown dropdown-hover">
                  <div
                    tabIndex={0}
                    role="button"
                    className="cursor-pointer rounded-btn outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={`Change priority, currently ${wo.priority}`}
                  >
                    <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                  </div>
                  <ul
                    tabIndex={0}
                    className="dropdown-content menu z-20 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow"
                  >
                    {PRIORITIES.map((option) => (
                      <li key={option}>
                        <button
                          type="button"
                          className={option === wo.priority ? "active" : ""}
                          disabled={saving}
                          onClick={() => updatePriority(option)}
                        >
                          <StatusBadge label={option} tone={statusTone(option)} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
              )}

              {isServiceManager ? (
                <div className="dropdown dropdown-hover">
                  <div
                    tabIndex={0}
                    role="button"
                    className="cursor-pointer rounded-btn outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={`Change status, currently ${wo.status}`}
                  >
                    <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                  </div>
                  <ul
                    tabIndex={0}
                    className="dropdown-content menu z-20 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow"
                  >
                    {statusOptions.map((option) => (
                      <li key={option}>
                        <button
                          type="button"
                          className={option === wo.status ? "active" : ""}
                          disabled={saving}
                          onClick={() => updateStatus(option)}
                        >
                          <StatusBadge label={option} tone={statusTone(option)} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
              )}

              <StatusBadge label={wo.billing_status} tone={statusTone(wo.billing_status)} />
            </div>

            {isServiceManager ? (
              <p className="text-xs opacity-60">Hover priority or status to change it.</p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <p>
                <span className="opacity-60">Customer:</span>{" "}
                {isServiceManager && wo.customers?.id ? (
                  <Link href={`/customers/${wo.customers.id}`} className="link link-primary">
                    {wo.customers.name}
                  </Link>
                ) : (
                  (wo.customers?.name ?? "—")
                )}
              </p>
              <p>
                <span className="opacity-60">Equipment:</span> {wo.equipment?.name ?? "—"}
              </p>
              <p>
                <span className="opacity-60">Scheduled:</span> {wo.scheduled_date ?? "—"}
              </p>
              <p>
                <span className="opacity-60">Warranty:</span> {wo.warranty_coverage}
              </p>
              <p>
                <span className="opacity-60">Arrival:</span>{" "}
                {wo.arrival_at ? new Date(wo.arrival_at).toLocaleString() : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium opacity-60">Problem</p>
              <p>{wo.problem_description ?? "—"}</p>
            </div>
            <FormRow label="Work performed">
              <textarea
                className="textarea textarea-bordered w-full"
                rows={3}
                value={workPerformed}
                onChange={(e) => setWorkPerformed(e.target.value)}
                disabled={!isManager && wo.status === "Completed"}
              />
            </FormRow>
            <FormRow label="Manager notes">
              <textarea
                className="textarea textarea-bordered w-full"
                rows={3}
                value={managerNotes}
                onChange={(e) => setManagerNotes(e.target.value)}
                disabled={!isManager}
              />
            </FormRow>
            {isManager ? (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={saveNotes}
                disabled={saving}
              >
                Save Notes
              </button>
            ) : null}
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body space-y-3">
            <h2 className="card-title text-base">Actions</h2>

            {isManager && wo.status === "Ready for Review" ? (
              <button
                type="button"
                className="btn btn-success btn-sm w-full"
                onClick={approveComplete}
                disabled={saving}
              >
                Approve & Complete
              </button>
            ) : null}

            {isManager &&
            !isServiceManager &&
            !["Completed", "Closed", "Canceled"].includes(wo.status) ? (
              <>
                <button
                  type="button"
                  className="btn btn-outline btn-sm w-full"
                  onClick={() => updateStatus("Scheduled")}
                  disabled={saving}
                >
                  Mark Scheduled
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm w-full"
                  onClick={() => updateStatus("Waiting on Parts")}
                  disabled={saving}
                >
                  Waiting on Parts
                </button>
              </>
            ) : null}

            {isServiceManager ? (
              <p className="text-sm opacity-70">
                Change priority and status by hovering the badges above.
              </p>
            ) : null}

            {wo.status === "Completed" ? (
              <p className="text-sm opacity-70">
                Approved {wo.approved_at ? new Date(wo.approved_at).toLocaleDateString() : ""}
              </p>
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
