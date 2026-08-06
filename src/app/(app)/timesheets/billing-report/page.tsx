"use client";

/**
 * Billing-cycle timesheet report — daily entries + manager overview / consolidated hours.
 * Separate from the field ServiceTitan timesheets at /timesheets.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import type {
  Profile,
  TimesheetCycle,
  TimesheetCycleType,
  TimesheetEntry,
  TimesheetSettings,
  TimesheetSubmission,
} from "@/lib/types";
import {
  buildCycleSummaries,
  canManageTimesheets,
  dateInCycle,
  deleteEntry,
  ensureCycleForDate,
  formatHours,
  getOrCreateSubmission,
  listCycles,
  listEntriesForCycle,
  listSubmissionsForCycle,
  listTechnicians,
  loadTimesheetSettings,
  reviewSubmission,
  saveTimesheetSettings,
  setCycleStatus,
  submitTimesheet,
  sumHours,
  upsertEntry,
} from "@/lib/timesheetReport";

type Tab = "mine" | "overview" | "report" | "settings";

export default function TimesheetsPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<TimesheetSettings | null>(null);
  const [cycles, setCycles] = useState<TimesheetCycle[]>([]);
  const [cycleId, setCycleId] = useState<string>("");
  const [technicians, setTechnicians] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [submissions, setSubmissions] = useState<TimesheetSubmission[]>([]);
  const [mySubmission, setMySubmission] = useState<TimesheetSubmission | null>(null);
  const [tab, setTab] = useState<Tab>("mine");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Tech entry form
  const [form, setForm] = useState({
    id: null as string | null,
    work_date: "",
    hours: "8",
    notes: "",
  });

  // Report filters
  const [filterTech, setFilterTech] = useState<string>("");
  const [sortBy, setSortBy] = useState<"name" | "hours" | "status">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [detailTechId, setDetailTechId] = useState<string | null>(null);

  const isManager = profile ? canManageTimesheets(profile.role) : false;
  const isTech = profile?.role === "technician";
  const cycle = cycles.find((c) => c.id === cycleId) ?? null;

  const boot = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    const me = prof as Profile;
    setProfile(me);

    const settingsRes = await loadTimesheetSettings(supabase);
    if (settingsRes.error || !settingsRes.data) {
      setError(settingsRes.error ?? "Timesheet settings missing. Apply the migration.");
      setLoading(false);
      return;
    }
    setSettings(settingsRes.data);

    const ensured = await ensureCycleForDate(supabase, new Date(), settingsRes.data);
    if (ensured.error) {
      setError(ensured.error);
      setLoading(false);
      return;
    }

    const [cycRes, techRes] = await Promise.all([
      listCycles(supabase),
      canManageTimesheets(me.role) ? listTechnicians(supabase) : Promise.resolve({ data: [], error: null }),
    ]);
    if (cycRes.error) setError(cycRes.error);
    setCycles(cycRes.data);
    setTechnicians(techRes.data);

    const preferred =
      ensured.data?.id ??
      cycRes.data.find((c) => c.status === "Open")?.id ??
      cycRes.data[0]?.id ??
      "";
    setCycleId(preferred);

    if (me.role === "technician") setTab("mine");
    else setTab("overview");

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const loadCycleData = useCallback(async () => {
    if (!cycleId || !profile) return;
    setBusy(true);
    setError(null);
    const techFilter = profile.role === "technician" ? profile.id : undefined;
    const [eRes, sRes] = await Promise.all([
      listEntriesForCycle(supabase, cycleId, techFilter),
      listSubmissionsForCycle(supabase, cycleId),
    ]);
    if (eRes.error || sRes.error) setError(eRes.error ?? sRes.error);
    setEntries(eRes.data);
    setSubmissions(sRes.data);

    if (profile.role === "technician") {
      const sub = await getOrCreateSubmission(supabase, profile.id, cycleId);
      if (sub.error) setError(sub.error);
      setMySubmission(sub.data);
    } else {
      setMySubmission(null);
    }
    setBusy(false);
  }, [cycleId, profile, supabase]);

  useEffect(() => {
    void loadCycleData();
  }, [loadCycleData]);

  const myEntries = useMemo(
    () =>
      profile?.role === "technician"
        ? entries
        : detailTechId
          ? entries.filter((e) => e.technician_id === detailTechId)
          : entries,
    [entries, profile, detailTechId],
  );

  const myTotal = sumHours(
    profile?.role === "technician"
      ? entries
      : detailTechId
        ? entries.filter((e) => e.technician_id === detailTechId)
        : [],
  );

  const summaries = useMemo(
    () => buildCycleSummaries(technicians, entries, submissions),
    [technicians, entries, submissions],
  );

  const filteredSummaries = useMemo(() => {
    let rows = summaries;
    if (filterTech) rows = rows.filter((r) => r.technician.id === filterTech);
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") {
        cmp = (a.technician.full_name ?? a.technician.email).localeCompare(
          b.technician.full_name ?? b.technician.email,
        );
      } else if (sortBy === "hours") {
        cmp = a.totalHours - b.totalHours;
      } else {
        cmp = a.submissionStatus.localeCompare(b.submissionStatus);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [summaries, filterTech, sortBy, sortDir]);

  const overviewStats = useMemo(() => {
    const totalHours = sumHours(entries);
    const submitted = summaries.filter((s) =>
      ["Submitted", "Approved"].includes(s.submissionStatus),
    ).length;
    const missing = summaries.filter((s) => s.hasNoEntries || s.submissionStatus === "Missing").length;
    const pendingReview = summaries.filter((s) => s.submissionStatus === "Submitted").length;
    return { totalHours, submitted, missing, pendingReview, techCount: technicians.length };
  }, [entries, summaries, technicians.length]);

  function resetForm() {
    setForm({ id: null, work_date: "", hours: "8", notes: "" });
  }

  async function saveEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !cycle) return;
    if (!dateInCycle(form.work_date, cycle)) {
      setError(`Date must fall within ${cycle.label}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: err } = await upsertEntry(supabase, {
      id: form.id,
      technician_id: profile.id,
      cycle_id: cycle.id,
      work_date: form.work_date,
      hours: Number(form.hours),
      notes: form.notes,
    });
    if (err) setError(err);
    else {
      setMessage(form.id ? "Entry updated." : "Entry added.");
      resetForm();
      await loadCycleData();
    }
    setBusy(false);
  }

  async function onDeleteEntry(id: string) {
    if (!confirm("Delete this time entry?")) return;
    setBusy(true);
    const { error: err } = await deleteEntry(supabase, id);
    if (err) setError(err);
    else await loadCycleData();
    setBusy(false);
  }

  async function onSubmitSheet() {
    if (!mySubmission) return;
    setBusy(true);
    setError(null);
    const { error: err } = await submitTimesheet(supabase, mySubmission.id);
    if (err) setError(err);
    else {
      setMessage("Timesheet submitted for review.");
      await loadCycleData();
    }
    setBusy(false);
  }

  async function onReview(subId: string, status: "Approved" | "Rejected") {
    if (!profile) return;
    setBusy(true);
    const { error: err } = await reviewSubmission(supabase, subId, status, profile.id);
    if (err) setError(err);
    else {
      setMessage(`Timesheet ${status.toLowerCase()}.`);
      await loadCycleData();
    }
    setBusy(false);
  }

  async function onCloseCycle() {
    if (!cycle) return;
    if (!confirm("Close this billing cycle? Technicians will no longer edit entries.")) return;
    setBusy(true);
    const { error: err } = await setCycleStatus(supabase, cycle.id, "Closed");
    if (err) setError(err);
    else {
      setMessage("Cycle closed.");
      const cycRes = await listCycles(supabase);
      setCycles(cycRes.data);
    }
    setBusy(false);
  }

  async function onSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    const { error: err } = await saveTimesheetSettings(supabase, settings);
    if (err) setError(err);
    else setMessage("Cycle settings saved (applies to newly created cycles).");
    setBusy(false);
  }

  const lockedForTech =
    !cycle ||
    cycle.status === "Closed" ||
    mySubmission?.status === "Submitted" ||
    mySubmission?.status === "Approved";

  if (loading) {
    return <p className="p-8 text-center text-sm opacity-50">Loading timesheets…</p>;
  }

  if (!profile || (!isTech && !isManager)) {
    return (
      <p className="p-8 text-center text-sm opacity-60">
        Timesheets are available to technicians, managers, and billing.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timesheet Report"
        description={
          isTech
            ? "Log daily hours for the current billing cycle and submit for review."
            : "Review labor for the billing cycle, approve submissions, and run the consolidated report."
        }
        actions={
          isManager ? (
            <Link href="/timesheets/billing-report" className="btn btn-outline btn-sm" onClick={() => setTab("report")}>
              Billing report
            </Link>
          ) : null
        }
      />

      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {message ? (
        <div className="alert alert-success text-sm">
          <span>{message}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="form-control">
          <span className="label-text text-xs opacity-60">Billing cycle</span>
          <select
            className="select select-bordered select-sm min-w-[16rem]"
            value={cycleId}
            onChange={(e) => setCycleId(e.target.value)}
          >
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.status})
              </option>
            ))}
          </select>
        </label>
        {settings ? (
          <span className="text-xs opacity-60 pb-2">
            Cycle type: {settings.cycle_type === "biweekly" ? "Bi-weekly" : "Weekly"}
          </span>
        ) : null}
      </div>

      <div role="tablist" className="tabs tabs-boxed w-fit flex-wrap">
        {isTech ? (
          <button
            type="button"
            role="tab"
            className={`tab ${tab === "mine" ? "tab-active" : ""}`}
            onClick={() => setTab("mine")}
          >
            My timesheet
          </button>
        ) : null}
        {isManager ? (
          <>
            <button
              type="button"
              role="tab"
              className={`tab ${tab === "overview" ? "tab-active" : ""}`}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
            <button
              type="button"
              role="tab"
              className={`tab ${tab === "report" ? "tab-active" : ""}`}
              onClick={() => setTab("report")}
            >
              Billing report
            </button>
            <button
              type="button"
              role="tab"
              className={`tab ${tab === "settings" ? "tab-active" : ""}`}
              onClick={() => setTab("settings")}
            >
              Settings
            </button>
          </>
        ) : null}
      </div>

      {/* ── Technician: my sheet ─────────────────────────────────────── */}
      {tab === "mine" && isTech && cycle ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <StatCard label="Cycle total" value={`${formatHours(sumHours(entries))} hrs`} />
            <StatCard
              label="Status"
              value={mySubmission?.status ?? "Draft"}
              hint={cycle.status === "Closed" ? "Cycle closed" : undefined}
            />
          </div>

          {!lockedForTech ? (
            <form onSubmit={saveEntry} className="card bg-base-100 shadow">
              <div className="card-body grid gap-3 md:grid-cols-2">
                <h2 className="card-title text-base md:col-span-2">
                  {form.id ? "Edit entry" : "Add daily entry"}
                </h2>
                <FormRow label="Date" required>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    required
                    min={cycle.start_date}
                    max={cycle.end_date}
                    value={form.work_date}
                    onChange={(e) => setForm((f) => ({ ...f, work_date: e.target.value }))}
                  />
                </FormRow>
                <FormRow label="Hours" required>
                  <input
                    type="number"
                    className="input input-bordered w-full"
                    required
                    min={0.25}
                    max={24}
                    step={0.25}
                    value={form.hours}
                    onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                  />
                </FormRow>
                <FormRow label="Notes">
                  <input
                    className="input input-bordered w-full"
                    placeholder="Jobs / what you worked on"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </FormRow>
                <div className="flex flex-wrap gap-2 items-end">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                    {form.id ? "Update" : "Add entry"}
                  </button>
                  {form.id ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            </form>
          ) : (
            <div className="alert text-sm">
              <span>
                This timesheet is locked
                {mySubmission?.status === "Submitted"
                  ? " (submitted — waiting for approval)."
                  : mySubmission?.status === "Approved"
                    ? " (approved)."
                    : " (cycle closed)."}
              </span>
            </div>
          )}

          <section className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="card-title text-base">Daily entries</h2>
                {!lockedForTech && entries.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    disabled={busy}
                    onClick={() => void onSubmitSheet()}
                  >
                    Submit for review
                  </button>
                ) : null}
              </div>
              {entries.length === 0 ? (
                <EmptyState title="No entries yet" description="Add your first daily hours for this cycle." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Hours</th>
                        <th>Notes</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((row) => (
                        <tr key={row.id}>
                          <td>{row.work_date}</td>
                          <td>{formatHours(Number(row.hours))}</td>
                          <td className="max-w-xs truncate">{row.notes ?? "—"}</td>
                          <td className="text-right">
                            {!lockedForTech ? (
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs"
                                  onClick={() =>
                                    setForm({
                                      id: row.id,
                                      work_date: row.work_date,
                                      hours: String(row.hours),
                                      notes: row.notes ?? "",
                                    })
                                  }
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs text-error"
                                  onClick={() => void onDeleteEntry(row.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th>Total</th>
                        <th>{formatHours(sumHours(entries))}</th>
                        <th colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {/* ── Manager overview ─────────────────────────────────────────── */}
      {tab === "overview" && isManager && cycle ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total hours" value={formatHours(overviewStats.totalHours)} />
            <StatCard
              label="Submitted / approved"
              value={`${overviewStats.submitted} / ${overviewStats.techCount}`}
            />
            <StatCard label="Missing entries" value={String(overviewStats.missing)} hint="No hours logged" />
            <StatCard label="Pending approval" value={String(overviewStats.pendingReview)} />
          </div>

          <div className="flex flex-wrap gap-2">
            {cycle.status === "Open" ? (
              <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void onCloseCycle()}>
                Close cycle
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await setCycleStatus(supabase, cycle.id, "Open");
                  const cycRes = await listCycles(supabase);
                  setCycles(cycRes.data);
                  setBusy(false);
                }}
              >
                Reopen cycle
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setTab("report")}>
              Open billing report
            </button>
          </div>

          <section className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-base">Technicians this cycle</h2>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Technician</th>
                      <th>Hours</th>
                      <th>Entries</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {summaries.map((row) => (
                      <tr key={row.technician.id} className={row.hasNoEntries ? "bg-warning/10" : undefined}>
                        <td>{row.technician.full_name ?? row.technician.email}</td>
                        <td>{formatHours(row.totalHours)}</td>
                        <td>{row.entryCount}</td>
                        <td>
                          <StatusBadge
                            label={row.hasNoEntries && row.submissionStatus === "Missing" ? "No entries" : row.submissionStatus}
                            tone={statusTone(
                              row.hasNoEntries ? "Pending" : row.submissionStatus,
                            )}
                          />
                        </td>
                        <td className="text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => {
                                setDetailTechId(row.technician.id);
                                setTab("report");
                              }}
                            >
                              View
                            </button>
                            {row.submission?.status === "Submitted" ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-success btn-xs"
                                  disabled={busy}
                                  onClick={() => void onReview(row.submission!.id, "Approved")}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-error btn-outline btn-xs"
                                  disabled={busy}
                                  onClick={() => void onReview(row.submission!.id, "Rejected")}
                                >
                                  Reject
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* ── Consolidated billing report ──────────────────────────────── */}
      {tab === "report" && isManager && cycle ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <label className="form-control">
              <span className="label-text text-xs opacity-60">Filter technician</span>
              <select
                className="select select-bordered select-sm"
                value={filterTech}
                onChange={(e) => {
                  setFilterTech(e.target.value);
                  setDetailTechId(e.target.value || null);
                }}
              >
                <option value="">All technicians</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name ?? t.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text text-xs opacity-60">Sort by</span>
              <select
                className="select select-bordered select-sm"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="name">Name</option>
                <option value="hours">Total hours</option>
                <option value="status">Status</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {sortDir === "asc" ? "Asc ↑" : "Desc ↓"}
            </button>
            <p className="text-sm opacity-60 pb-2">
              Cycle dates: {cycle.start_date} → {cycle.end_date}
            </p>
          </div>

          <section className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-base">Consolidated hours by technician</h2>
              <p className="text-sm opacity-60">
                Use this for payroll / client billing. Totals are summed daily hours for the selected cycle.
              </p>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Technician</th>
                      <th>Total hours</th>
                      <th>Days logged</th>
                      <th>Submission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSummaries.map((row) => (
                      <tr
                        key={row.technician.id}
                        className="cursor-pointer hover"
                        onClick={() =>
                          setDetailTechId((id) =>
                            id === row.technician.id ? null : row.technician.id,
                          )
                        }
                      >
                        <td className="font-medium">{row.technician.full_name ?? row.technician.email}</td>
                        <td>{formatHours(row.totalHours)}</td>
                        <td>{row.entryCount}</td>
                        <td>
                          <StatusBadge label={row.submissionStatus} tone={statusTone(row.submissionStatus)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>All shown</th>
                      <th>
                        {formatHours(filteredSummaries.reduce((s, r) => s + r.totalHours, 0))}
                      </th>
                      <th colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </section>

          {detailTechId ? (
            <section className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title text-base">
                  Detail —{" "}
                  {technicians.find((t) => t.id === detailTechId)?.full_name ?? "Technician"}
                  <span className="font-normal text-sm opacity-60 ml-2">
                    Total {formatHours(myTotal)} hrs
                  </span>
                </h2>
                {myEntries.length === 0 ? (
                  <EmptyState title="No entries" description="This technician has not logged time in this cycle." />
                ) : (
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Hours</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myEntries.map((row) => (
                        <tr key={row.id}>
                          <td>{row.work_date}</td>
                          <td>{formatHours(Number(row.hours))}</td>
                          <td>{row.notes ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* ── Settings ─────────────────────────────────────────────────── */}
      {tab === "settings" && isManager && settings ? (
        <form onSubmit={onSaveSettings} className="card bg-base-100 shadow max-w-lg">
          <div className="card-body space-y-3">
            <h2 className="card-title text-base">Billing cycle settings</h2>
            <p className="text-sm opacity-60">
              Default is bi-weekly (14 days, Monday start). Changing this affects newly created cycles.
            </p>
            <FormRow label="Cycle length">
              <select
                className="select select-bordered w-full"
                value={settings.cycle_type}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    cycle_type: e.target.value as TimesheetCycleType,
                  })
                }
              >
                <option value="biweekly">Bi-weekly (14 days)</option>
                <option value="weekly">Weekly (7 days)</option>
              </select>
            </FormRow>
            <FormRow label="Week starts">
              <select
                className="select select-bordered w-full"
                value={settings.week_starts_on}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    week_starts_on: Number(e.target.value),
                  })
                }
              >
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </select>
            </FormRow>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              Save settings
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
