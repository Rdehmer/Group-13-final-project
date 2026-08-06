"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Profile, TimeOffRequest } from "@/lib/types";
import { formatTimeOffLabel } from "@/lib/time-off";

/**
 * Field technicians request time off; managers approve and the schedule blocks those days.
 */
export default function TimeOffRequestsPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    start_date: format(new Date(), "yyyy-MM-dd"),
    end_date: format(new Date(), "yyyy-MM-dd"),
    reason: "",
  });

  const isManager = profile?.role === "administrator" || profile?.role === "service_manager";
  const isTechnician = profile?.role === "technician";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    setProfile(p as Profile);

    const { data, error: qErr } = await supabase
      .from("time_off_requests")
      .select("*, technician:profiles!time_off_requests_technician_id_fkey(id, full_name, email)")
      .order("start_date", { ascending: false });

    if (qErr) {
      // Fallback without join if FK name differs
      const { data: flat, error: flatErr } = await supabase
        .from("time_off_requests")
        .select("*")
        .order("start_date", { ascending: false });
      if (flatErr) {
        setError(
          flatErr.message.includes("does not exist") || flatErr.message.includes("schema cache")
            ? "Time off table is not set up yet. Run supabase/migrations/20260806210000_time_off_requests.sql in the Supabase SQL editor."
            : flatErr.message,
        );
        setRows([]);
      } else {
        setRows((flat as TimeOffRequest[]) ?? []);
      }
    } else {
      setRows((data as TimeOffRequest[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const myRequests = useMemo(
    () => (profile ? rows.filter((r) => r.technician_id === profile.id) : []),
    [rows, profile],
  );
  const pendingTeam = useMemo(
    () => rows.filter((r) => r.status === "Pending"),
    [rows],
  );

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !isTechnician) return;
    setMessage(null);
    setError(null);
    if (form.end_date < form.start_date) {
      setError("End date must be on or after the start date.");
      return;
    }
    setBusyId("submit");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: insErr } = await supabase
      .from("time_off_requests")
      .insert({
        technician_id: profile.id,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason.trim() || null,
        status: "Pending",
      })
      .select()
      .single();
    if (insErr) {
      setError(insErr.message);
      setBusyId(null);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "time_off_requested",
      recordType: "time_off_request",
      recordId: data.id,
      newValue: formatTimeOffLabel(form.start_date, form.end_date),
    });
    setMessage("Request submitted — status Pending until a manager approves.");
    setForm({
      start_date: format(new Date(), "yyyy-MM-dd"),
      end_date: format(new Date(), "yyyy-MM-dd"),
      reason: "",
    });
    setBusyId(null);
    await load();
  }

  async function cancelOwn(id: string) {
    setBusyId(id);
    setError(null);
    const { error: uErr } = await supabase
      .from("time_off_requests")
      .update({ status: "Canceled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "Pending");
    if (uErr) setError(uErr.message);
    setBusyId(null);
    await load();
  }

  async function review(id: string, status: "Approved" | "Denied") {
    if (!profile || !isManager) return;
    setBusyId(id);
    setError(null);
    const now = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("time_off_requests")
      .update({
        status,
        reviewed_by: profile.id,
        reviewed_at: now,
        updated_at: now,
      })
      .eq("id", id);
    if (uErr) {
      setError(uErr.message);
      setBusyId(null);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: status === "Approved" ? "time_off_approved" : "time_off_denied",
      recordType: "time_off_request",
      recordId: id,
      newValue: status,
    });
    setMessage(status === "Approved" ? "Approved — dates are now blocked on the schedule." : "Request denied.");
    setBusyId(null);
    await load();
  }

  function techLabel(r: TimeOffRequest): string {
    return r.technician?.full_name?.trim() || r.technician?.email || r.technician_id.slice(0, 8);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Time Off Requests"
        description={
          isManager
            ? "Review technician leave requests. Approved time off blocks those days on Technician Schedule."
            : "Request time off. Pending until a service manager approves — then those days are blocked on the schedule."
        }
      />

      {error ? <div className="alert alert-error text-sm">{error}</div> : null}
      {message ? <div className="alert alert-success text-sm">{message}</div> : null}

      {isTechnician ? (
        <section className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Submit a request</h2>
            <form onSubmit={submitRequest} className="mt-2 grid max-w-xl gap-3 sm:grid-cols-2">
              <FormRow label="Start date" required>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="End date" required>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  required
                />
              </FormRow>
              <div className="sm:col-span-2">
                <FormRow label="Reason (optional)">
                  <textarea
                    className="textarea textarea-bordered w-full"
                    rows={2}
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="Vacation, appointment, family…"
                  />
                </FormRow>
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busyId === "submit"}>
                  {busyId === "submit" ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {isManager ? (
        <section className="card border border-warning/30 bg-base-100 shadow">
          <div className="card-body p-0">
            <div className="border-b border-base-300 px-4 py-3">
              <h2 className="font-semibold">
                Pending team requests
                <span className="badge badge-warning ml-2">{pendingTeam.length}</span>
              </h2>
            </div>
            {loading ? (
              <div className="p-6 text-center opacity-60">Loading…</div>
            ) : pendingTeam.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No pending requests" description="Technicians have no leave waiting for approval." />
              </div>
            ) : (
              <DualHorizontalScroll>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Technician</th>
                      <th>Dates</th>
                      <th>Reason</th>
                      <th>Submitted</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pendingTeam.map((r) => (
                      <tr key={r.id}>
                        <td className="font-medium">{techLabel(r)}</td>
                        <td>{formatTimeOffLabel(r.start_date, r.end_date)}</td>
                        <td className="max-w-xs truncate opacity-80">{r.reason || "—"}</td>
                        <td className="text-sm opacity-70">
                          {r.created_at ? format(parseISO(r.created_at), "MMM d, yyyy") : "—"}
                        </td>
                        <td className="text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            <button
                              type="button"
                              className="btn btn-success btn-xs"
                              disabled={busyId === r.id}
                              onClick={() => void review(r.id, "Approved")}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-error btn-xs"
                              disabled={busyId === r.id}
                              onClick={() => void review(r.id, "Denied")}
                            >
                              Deny
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DualHorizontalScroll>
            )}
          </div>
        </section>
      ) : null}

      <section className="card bg-base-100 shadow">
        <div className="card-body p-0">
          <div className="border-b border-base-300 px-4 py-3">
            <h2 className="font-semibold">{isManager ? "All requests" : "My requests"}</h2>
          </div>
          {loading ? (
            <div className="p-6 text-center opacity-60">Loading…</div>
          ) : (isManager ? rows : myRequests).length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No requests yet"
                description={
                  isTechnician
                    ? "Submit a request above when you need time away."
                    : "No time-off records in the system."
                }
              />
            </div>
          ) : (
            <DualHorizontalScroll>
              <table className="table">
                <thead>
                  <tr>
                    {isManager ? <th>Technician</th> : null}
                    <th>Dates</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(isManager ? rows : myRequests).map((r) => (
                    <tr key={r.id}>
                      {isManager ? <td>{techLabel(r)}</td> : null}
                      <td>{formatTimeOffLabel(r.start_date, r.end_date)}</td>
                      <td className="max-w-xs truncate opacity-80">{r.reason || "—"}</td>
                      <td>
                        <StatusBadge label={r.status} tone={statusTone(r.status)} />
                      </td>
                      <td className="text-right">
                        {isTechnician && r.status === "Pending" && r.technician_id === profile?.id ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            disabled={busyId === r.id}
                            onClick={() => void cancelOwn(r.id)}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DualHorizontalScroll>
          )}
        </div>
      </section>
    </div>
  );
}
