"use client";

/**
 * Field-service timesheets (ServiceTitan-style).
 * Technicians: clock status, today/week totals, manual entries, filters.
 * Managers/Billing: review, approve/reject/lock, risk flags, cost visibility.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  RefreshCw,
  TriangleAlert,
  Unlock,
  XCircle,
} from "lucide-react";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatCard, StatusBadge, statusTone } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type {
  Profile,
  TimeActivityType,
  TimeApprovalStatus,
  TimeEntry,
} from "@/lib/types";
import {
  ACTIVITY_LABELS,
  ACTIVITY_TYPES,
  APPROVAL_LABELS,
  approveEntry,
  canEditEntry,
  clockOut,
  createManualEntry,
  flagEntry,
  formatHours,
  getActiveClock,
  getTimesheetBackend,
  isTimesheetMissingTable,
  loadOtMultiplier,
  loadTimeEntries,
  localDateTimeToIso,
  money,
  rejectEntry,
  reopenEntry,
  shiftWeek,
  softDeleteEntry,
  sumEntries,
  supabaseErrorMessage,
  todayIso,
  weekContaining,
} from "@/lib/timesheets";

function approvalTone(status: TimeApprovalStatus): ReturnType<typeof statusTone> {
  return statusTone(APPROVAL_LABELS[status]);
}

function shortIso(iso: string | null) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, h:mm a");
  } catch {
    return iso;
  }
}

export default function TimesheetsPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [week, setWeek] = useState(() => weekContaining());
  const [otMult, setOtMult] = useState(1.5);

  const [filterStatus, setFilterStatus] = useState<TimeApprovalStatus | "all">("all");
  const [filterWo, setFilterWo] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterTech, setFilterTech] = useState("all");
  const [techs, setTechs] = useState<Profile[]>([]);

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [manual, setManual] = useState({
    date: todayIso(),
    start: "08:00",
    end: "09:00",
    activity: "regular_work" as TimeActivityType,
    workOrderId: "",
    notes: "",
    reason: "",
  });
  const [myJobs, setMyJobs] = useState<
    { id: string; work_order_number: string; customers?: { name: string } | null }[]
  >([]);

  const [storageMode, setStorageMode] = useState<"time_entries" | "fallback" | null>(null);

  const isManager =
    profile?.role === "administrator" ||
    profile?.role === "service_manager" ||
    profile?.role === "billing";
  const isTech = profile?.role === "technician";
  const showCost = isManager;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: me, error: meErr } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (meErr || !me) {
        throw new Error(meErr?.message || "Could not load your profile.");
      }
      const meP = me as Profile;
      setProfile(meP);

      try {
        setOtMult(await loadOtMultiplier(supabase));
      } catch {
        setOtMult(1.5);
      }

      const backend = await getTimesheetBackend(supabase);
      setStorageMode(backend);

      const manager =
        meP.role === "administrator" ||
        meP.role === "service_manager" ||
        meP.role === "billing";

      if (manager) {
        const { data: staff } = await supabase
          .from("profiles")
          .select("*")
          .eq("is_active", true)
          .eq("role", "technician")
          .order("full_name");
        setTechs((staff as Profile[]) ?? []);
      }

      const techFilter =
        !manager ? meP.id : filterTech !== "all" ? filterTech : undefined;

      const rows = await loadTimeEntries(supabase, {
        from: week.start,
        to: week.end,
        technicianId: techFilter,
        workOrderId: filterWo.trim() || undefined,
        customerId: undefined,
        status: filterStatus,
      });

      let filtered = rows;
      if (filterCustomer.trim()) {
        const q = filterCustomer.trim().toLowerCase();
        filtered = rows.filter((e) => {
          const name =
            e.customers?.name ||
            e.work_orders?.customers?.name ||
            "";
          return name.toLowerCase().includes(q);
        });
      }

      setEntries(filtered);

      try {
        if (meP.role === "technician" || !manager) {
          setActive(await getActiveClock(supabase, meP.id));
        } else {
          setActive(null);
        }
      } catch {
        setActive(null);
      }

      const { data: jobs } = await supabase
        .from("work_orders")
        .select("id, work_order_number, customers(name)")
        .order("created_at", { ascending: false })
        .limit(40);
      setMyJobs(
        ((jobs as unknown as typeof myJobs) ?? []).map((j) => ({
          id: j.id,
          work_order_number: j.work_order_number,
          customers: Array.isArray(j.customers)
            ? (j.customers[0] as { name: string } | undefined) ?? null
            : (j.customers as { name: string } | null) ?? null,
        })),
      );
    } catch (e) {
      const msg = supabaseErrorMessage(e) || "Failed to load timesheets.";
      // Last resort: empty board, not a hard dead end
      if (isTimesheetMissingTable(msg)) {
        setStorageMode("fallback");
        setEntries([]);
        setError(null);
      } else {
        setError(msg);
        setEntries([]);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, week, filterStatus, filterWo, filterCustomer, filterTech]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => sumEntries(entries), [entries]);
  const todayRows = useMemo(
    () => entries.filter((e) => e.entry_date === todayIso()),
    [entries],
  );
  const todayTotals = useMemo(() => sumEntries(todayRows), [todayRows]);

  const weekByTech = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.approval_status === "rejected") continue;
      const h =
        e.approval_status === "active" && e.clock_in_at
          ? 0
          : Number(e.regular_hours) + Number(e.overtime_hours);
      map.set(e.technician_id, (map.get(e.technician_id) ?? 0) + h);
    }
    return map;
  }, [entries]);

  async function run<T>(id: string, fn: () => Promise<T>, ok: string) {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
      await load();
    } catch (e) {
      setError(supabaseErrorMessage(e) || "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    const clockIn = localDateTimeToIso(manual.date, manual.start);
    const clockOut = localDateTimeToIso(manual.date, manual.end);
    await run(
      "manual",
      () =>
        createManualEntry(supabase, {
          profile,
          workOrderId: manual.workOrderId || null,
          entryDate: manual.date,
          clockInLocal: clockIn,
          clockOutLocal: clockOut,
          activityType: manual.activity,
          notes: manual.notes,
          reason: manual.reason,
        }),
      "Manual entry submitted for approval.",
    );
    setManual((m) => ({ ...m, notes: "", reason: "" }));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isTech ? "My Timesheet" : "Timesheets"}
        description={
          isTech
            ? "Clock status, daily and weekly hours, and manual adjustments pending manager approval."
            : "Review technician time, approve adjustments, lock payroll, and catch risk flags."
        }
        actions={
          <button
            type="button"
            className="btn btn-outline btn-sm gap-1"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {error ? (
        <div className="alert alert-error text-sm">
          <TriangleAlert className="h-4 w-4" />
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="alert alert-success text-sm">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </div>
      ) : null}
      {storageMode === "fallback" ? (
        <div className="alert alert-info text-sm">
          Running in compatibility mode using job labor records (the optional{" "}
          <code>time_entries</code> table is not on this Supabase project yet). Clock-in/out,
          approvals, and totals still work.
        </div>
      ) : null}

      {/* Period + clock banner */}
      <section className="rounded-2xl border border-base-300 bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 px-4 py-5 text-slate-50 shadow-md sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-sm btn-ghost text-slate-100"
            onClick={() => setWeek((w) => shiftWeek(w, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-200/90">
              Work week (Sun–Sat)
            </p>
            <p className="text-xl font-bold">{week.label}</p>
            <p className="text-xs text-slate-300">OT after 40 hours · mult. {otMult}× cost</p>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost text-slate-100"
            onClick={() => setWeek((w) => shiftWeek(w, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {active ? (
            <div className="ml-auto flex flex-wrap items-center gap-2 rounded-xl border border-teal-400/40 bg-teal-500/20 px-3 py-2">
              <span className="badge badge-success badge-sm gap-1">
                <Clock className="h-3 w-3" /> Currently Clocked In
              </span>
              <span className="text-sm">
                {active.work_orders?.work_order_number ?? "Job"} · since{" "}
                {shortIso(active.clock_in_at)}
              </span>
              {isTech || profile?.id === active.technician_id ? (
                <button
                  type="button"
                  className="btn btn-sm btn-warning"
                  disabled={busyId === "out"}
                  onClick={() =>
                    profile &&
                    void run(
                      "out",
                      () => clockOut(supabase, { profile }),
                      "Clocked out.",
                    )
                  }
                >
                  Clock out
                </button>
              ) : null}
              {active.work_order_id ? (
                <Link
                  href={`/work-orders/${active.work_order_id}`}
                  className="btn btn-sm btn-ghost text-teal-100"
                >
                  Open WO
                </Link>
              ) : null}
            </div>
          ) : isTech ? (
            <p className="ml-auto text-sm text-slate-300">
              Not clocked in. Start from a job on{" "}
              <Link href="/technician" className="link link-hover text-teal-200">
                My Day
              </Link>
              .
            </p>
          ) : null}
        </div>
      </section>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today hours" value={formatHours(todayTotals.totalHours)} />
        <StatCard
          label="Week hours"
          value={formatHours(totals.totalHours)}
          hint={`${formatHours(totals.regularHours)} reg · ${formatHours(totals.overtimeHours)} OT`}
          danger={totals.totalHours > 40}
        />
        <StatCard
          label="Billable / nonbillable"
          value={`${formatHours(totals.billableHours)} / ${formatHours(totals.nonbillableHours)}`}
        />
        <StatCard
          label={showCost ? "Labor cost (int.)" : "Pending / rejected"}
          value={
            showCost
              ? money(totals.laborCost)
              : `${totals.pending} / ${totals.rejected}`
          }
          hint={
            showCost
              ? `Billable $ ${money(totals.billableAmount)} · ${totals.pending} pending`
              : totals.active ? `${totals.active} clocked in` : undefined
          }
          danger={totals.pending + totals.rejected > 0}
        />
      </div>

      {totals.totalHours >= 36 ? (
        <div className={`alert text-sm ${totals.totalHours > 40 ? "alert-warning" : "alert-info"}`}>
          <TriangleAlert className="h-4 w-4" />
          {totals.totalHours > 40
            ? `Weekly total exceeds 40 hours (${formatHours(totals.totalHours)}). Overtime hours are calculated and cost uses OT multiplier; customer OT billing follows work-order/contract terms (not auto-forced).`
            : `Approaching weekly OT threshold (${formatHours(totals.totalHours)} / 40).`}
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
        <label className="form-control">
          <span className="label-text text-xs">Status</span>
          <select
            className="select select-bordered select-sm"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as TimeApprovalStatus | "all")}
          >
            <option value="all">All</option>
            {(Object.keys(APPROVAL_LABELS) as TimeApprovalStatus[]).map((s) => (
              <option key={s} value={s}>
                {APPROVAL_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {isManager ? (
          <label className="form-control">
            <span className="label-text text-xs">Technician</span>
            <select
              className="select select-bordered select-sm"
              value={filterTech}
              onChange={(e) => setFilterTech(e.target.value)}
            >
              <option value="all">All technicians</option>
              {techs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name || t.email}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="form-control">
          <span className="label-text text-xs">Work order # contains</span>
          <input
            className="input input-bordered input-sm"
            placeholder="WO-"
            value={filterWo}
            onChange={(e) => setFilterWo(e.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">Customer</span>
          <input
            className="input input-bordered input-sm"
            placeholder="Name…"
            value={filterCustomer}
            onChange={(e) => setFilterCustomer(e.target.value)}
          />
        </label>
      </div>

      {/* Manual entry */}
      {(isTech || isManager) && (
        <details className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">Add manual / missed time</summary>
          <form className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submitManual}>
            <FormRow label="Date" required>
              <input
                type="date"
                className="input input-bordered input-sm w-full"
                value={manual.date}
                onChange={(e) => setManual((m) => ({ ...m, date: e.target.value }))}
                required
              />
            </FormRow>
            <FormRow label="Start" required>
              <input
                type="time"
                className="input input-bordered input-sm w-full"
                value={manual.start}
                onChange={(e) => setManual((m) => ({ ...m, start: e.target.value }))}
                required
              />
            </FormRow>
            <FormRow label="End" required>
              <input
                type="time"
                className="input input-bordered input-sm w-full"
                value={manual.end}
                onChange={(e) => setManual((m) => ({ ...m, end: e.target.value }))}
                required
              />
            </FormRow>
            <FormRow label="Category" required>
              <select
                className="select select-bordered select-sm w-full"
                value={manual.activity}
                onChange={(e) =>
                  setManual((m) => ({ ...m, activity: e.target.value as TimeActivityType }))
                }
              >
                {ACTIVITY_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Work order">
              <select
                className="select select-bordered select-sm w-full"
                value={manual.workOrderId}
                onChange={(e) => setManual((m) => ({ ...m, workOrderId: e.target.value }))}
              >
                <option value="">None (non-job)</option>
                {myJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.work_order_number} · {j.customers?.name ?? "Customer"}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Notes / explanation" required>
              <input
                className="input input-bordered input-sm w-full"
                value={manual.notes}
                onChange={(e) => setManual((m) => ({ ...m, notes: e.target.value }))}
                placeholder="What was done"
                required
              />
            </FormRow>
            <FormRow label="Reason (manual)" required>
              <input
                className="input input-bordered input-sm w-full"
                value={manual.reason}
                onChange={(e) => setManual((m) => ({ ...m, reason: e.target.value }))}
                placeholder="Why was this entered manually?"
                required
              />
            </FormRow>
            <div className="flex items-end">
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={busyId === "manual"}
              >
                Submit for approval
              </button>
            </div>
          </form>
          <p className="mt-2 text-xs opacity-60">
            Manual entries are Pending Approval. You cannot approve your own adjustments.
          </p>
        </details>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="No time entries this week"
          description="Clock in from a work order on My Day, or add a manual entry above."
          action={
            isTech ? (
              <Link href="/technician" className="btn btn-primary btn-sm">
                Open My Day
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-sm">
          <table className="table table-sm">
            <thead>
              <tr className="bg-base-200/60 text-xs uppercase">
                <th>When</th>
                {isManager ? <th>Tech</th> : null}
                <th>Job / customer</th>
                <th>Activity</th>
                <th className="text-right">Hrs</th>
                {showCost ? <th className="text-right">Cost</th> : null}
                <th>Status</th>
                <th>Flags</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const weekH = weekByTech.get(entry.technician_id) ?? 0;
                const flags = flagEntry(entry, entries, weekH);
                const cust =
                  entry.customers?.name ||
                  entry.work_orders?.customers?.name ||
                  "—";
                const wo = entry.work_orders;
                const hrs = formatHours(
                  entry.approval_status === "active" && entry.clock_in_at
                    ? (Date.now() - parseISO(entry.clock_in_at).getTime()) / 3_600_000
                    : Number(entry.regular_hours) + Number(entry.overtime_hours),
                );
                return (
                  <tr key={entry.id} className="align-top">
                    <td className="whitespace-nowrap text-xs">
                      <div className="font-medium">{entry.entry_date}</div>
                      <div className="opacity-60">
                        {shortIso(entry.clock_in_at)}
                        {entry.clock_out_at ? ` → ${format(parseISO(entry.clock_out_at), "h:mm a")}` : " → …"}
                      </div>
                    </td>
                    {isManager ? (
                      <td className="text-xs">
                        {entry.technician?.full_name || entry.technician?.email || "—"}
                      </td>
                    ) : null}
                    <td className="max-w-[14rem] text-xs">
                      {wo ? (
                        <>
                          <Link
                            href={`/work-orders/${entry.work_order_id}`}
                            className="link link-primary font-medium"
                          >
                            {wo.work_order_number}
                          </Link>
                          <div className="opacity-80">{cust}</div>
                          <div className="opacity-50">
                            {wo.work_order_type ?? "Service"}
                            {wo.equipment?.name ? ` · ${wo.equipment.name}` : ""}
                          </div>
                          <div className="truncate opacity-50">
                            {entry.service_location ||
                              [wo.customers?.service_address, wo.customers?.city]
                                .filter(Boolean)
                                .join(", ")}
                          </div>
                        </>
                      ) : (
                        <span className="opacity-70">Non-job · {cust}</span>
                      )}
                      {entry.notes ? (
                        <div className="mt-0.5 truncate opacity-60" title={entry.notes}>
                          {entry.notes}
                        </div>
                      ) : null}
                      {entry.manual_entry_reason ? (
                        <div className="text-warning">Manual: {entry.manual_entry_reason}</div>
                      ) : null}
                      {entry.rejection_reason ? (
                        <div className="text-error">Reject: {entry.rejection_reason}</div>
                      ) : null}
                    </td>
                    <td>
                      <span className="badge badge-ghost badge-sm">
                        {ACTIVITY_LABELS[entry.activity_type]}
                      </span>
                      <div className="text-[10px] opacity-50">{entry.billable_status}</div>
                    </td>
                    <td className="text-right tabular-nums">
                      {hrs}
                      {Number(entry.overtime_hours) > 0 ? (
                        <div className="text-[10px] text-warning">
                          OT {formatHours(entry.overtime_hours)}
                        </div>
                      ) : null}
                    </td>
                    {showCost ? (
                      <td className="text-right tabular-nums text-xs">
                        {money(entry.labor_cost)}
                        <div className="opacity-50">{money(entry.billable_amount)} bill</div>
                      </td>
                    ) : null}
                    <td>
                      <StatusBadge
                        label={APPROVAL_LABELS[entry.approval_status]}
                        tone={approvalTone(entry.approval_status)}
                      />
                    </td>
                    <td className="text-[10px] leading-tight">
                      {flags.missingClockOut ? (
                        <span className="badge badge-error badge-xs">Missing Clock-Out</span>
                      ) : null}
                      {flags.longShift ? (
                        <span className="badge badge-warning badge-xs">16h+</span>
                      ) : null}
                      {flags.overlap ? (
                        <span className="badge badge-error badge-xs">Overlap</span>
                      ) : null}
                      {flags.noWorkOrder ? (
                        <span className="badge badge-warning badge-xs">No WO</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        {isManager &&
                        (entry.approval_status === "pending_approval" ||
                          entry.approval_status === "complete") ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-xs btn-primary"
                              disabled={busyId === entry.id || entry.technician_id === profile?.id}
                              title={
                                entry.technician_id === profile?.id
                                  ? "Cannot approve own time"
                                  : undefined
                              }
                              onClick={() =>
                                profile &&
                                void run(
                                  entry.id,
                                  () => approveEntry(supabase, profile, entry.id, false),
                                  "Approved.",
                                )
                              }
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-secondary"
                              disabled={busyId === entry.id || entry.technician_id === profile?.id}
                              onClick={() =>
                                profile &&
                                void run(
                                  entry.id,
                                  () => approveEntry(supabase, profile, entry.id, true),
                                  "Approved & locked.",
                                )
                              }
                            >
                              <Lock className="h-3 w-3" />
                              Lock
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-outline btn-error"
                              disabled={busyId === entry.id}
                              onClick={() => {
                                setRejectId(entry.id);
                                setRejectReason("");
                              }}
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                        {isManager &&
                        (entry.approval_status === "approved" ||
                          entry.approval_status === "locked") ? (
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost gap-1"
                            disabled={busyId === entry.id}
                            onClick={() =>
                              profile &&
                              void run(
                                entry.id,
                                () => reopenEntry(supabase, profile, entry.id),
                                "Reopened for edits.",
                              )
                            }
                          >
                            <Unlock className="h-3 w-3" />
                            Reopen
                          </button>
                        ) : null}
                        {profile && canEditEntry(profile, entry) && entry.approval_status !== "active" ? (
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost text-error"
                            disabled={busyId === entry.id}
                            onClick={() =>
                              void run(
                                entry.id,
                                () => softDeleteEntry(supabase, profile, entry.id),
                                "Entry removed (soft delete).",
                              )
                            }
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rejectId ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Reject time entry</h3>
            <p className="py-2 text-sm opacity-70">Technicians need a clear correction note.</p>
            <textarea
              className="textarea textarea-bordered w-full"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why this time is rejected…"
            />
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setRejectId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error gap-1"
                disabled={!profile || busyId === rejectId}
                onClick={() => {
                  if (!profile || !rejectId) return;
                  void run(
                    rejectId,
                    () => rejectEntry(supabase, profile, rejectId, rejectReason),
                    "Rejected.",
                  ).then(() => setRejectId(null));
                }}
              >
                <XCircle className="h-4 w-4" />
                Reject
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close"
            onClick={() => setRejectId(null)}
          />
        </div>
      ) : null}

      <p className="text-xs opacity-55">
        Data lives in Supabase <code>time_entries</code>. Approved/complete job hours mirror to{" "}
        <code>technician_labor</code> for invoice prep without auto-creating invoices. Customers never
        see pay rates or internal labor cost on this page.
      </p>
    </div>
  );
}
