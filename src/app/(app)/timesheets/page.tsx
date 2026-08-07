"use client";

/**
 * Field-service timesheets (ServiceTitan-style) with internal controls:
 * SOD, one active clock, WO authorization, overlap/duration, approval,
 * weekly certification, exceptions, audit, soft-void, billing readiness.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format, parseISO, addDays } from "date-fns";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Unlock,
  XCircle,
} from "lucide-react";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatCard, StatusBadge, statusTone } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type {
  Profile,
  TechnicianDayClock,
  TimeActivityType,
  TimeApprovalStatus,
  TimeEntry,
  WeeklyTimesheet,
} from "@/lib/types";
import {
  ACTIVITY_LABELS,
  ACTIVITY_TYPES,
  APPROVAL_LABELS,
  approveEntry,
  CERTIFICATION_TEXT,
  clockOut,
  createManualEntry,
  flagEntry,
  formatDurationSeconds,
  formatHours,
  getActiveClock,
  getTimesheetBackend,
  isTimesheetMissingTable,
  loadOtMultiplier,
  loadTimeEntries,
  loadWeeklyTimesheet,
  localDateTimeToIso,
  money,
  rejectEntry,
  reopenEntry,
  requestCorrection,
  shiftWeek,
  softDeleteEntry,
  submitWeeklyTimesheet,
  sumDispatchJobHours,
  sumEntries,
  supabaseErrorMessage,
  timesheetHref,
  todayIso,
  weekContaining,
  parseTimesheetDeepLink,
} from "@/lib/timesheets";
import {
  loadDayClocksForRange,
  loadDayClocksForTechnicians,
  sumTodayAndWeekDayClockHours,
  syncLocalDayClocksToRemote,
} from "@/lib/day-clock";
import {
  BILLING_STATUS_LABELS,
  controlsExplainer,
  detectExceptions,
  managerApprovalWarnings,
  severityTone,
  weeklyOtWarnings,
  workOrderReadyToInvoice,
  type TimesheetException,
} from "@/lib/time-entry-controls";

function approvalTone(status: TimeApprovalStatus): ReturnType<typeof statusTone> {
  return statusTone(APPROVAL_LABELS[status] ?? status);
}

function shortIso(iso: string | null) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, h:mm:ss a");
  } catch {
    return iso;
  }
}

export default function TimesheetsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const deep = useMemo(() => parseTimesheetDeepLink(searchParams), [searchParams]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [week, setWeek] = useState(() =>
    deep.week ? weekContaining(deep.week) : weekContaining(),
  );
  const [otMult, setOtMult] = useState(1.5);

  const [filterStatus, setFilterStatus] = useState<TimeApprovalStatus | "all">(
    deep.status ?? "all",
  );
  const [filterWoId, setFilterWoId] = useState(deep.wo ?? "");
  const [filterWoNumber, setFilterWoNumber] = useState(deep.job ?? "");
  const [filterCustomer, setFilterCustomer] = useState(deep.customer ?? "");
  const [filterTech, setFilterTech] = useState(deep.tech ?? "all");
  const [techs, setTechs] = useState<Profile[]>([]);
  const [linkedJobLabel, setLinkedJobLabel] = useState<string | null>(null);
  const scrollDoneForEntry = useRef<string | null>(null);
  const [dayClocksWeek, setDayClocksWeek] = useState<TechnicianDayClock[]>([]);
  const [dayClockTick, setDayClockTick] = useState(() => new Date());

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectMode, setRejectMode] = useState<"reject" | "correction">("reject");

  const [reopenId, setReopenId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const [certifyOk, setCertifyOk] = useState(false);
  const [weeklySheet, setWeeklySheet] = useState<WeeklyTimesheet | null>(null);
  const [manualWarn12, setManualWarn12] = useState(false);

  const [manual, setManual] = useState({
    date: todayIso(),
    start: "08:00",
    end: "09:00",
    activity: "regular_work" as TimeActivityType,
    workOrderId: deep.wo ?? "",
    notes: "",
    reason: "",
  });
  const [myJobs, setMyJobs] = useState<
    { id: string; work_order_number: string; customers?: { name: string } | null }[]
  >([]);

  const [storageMode, setStorageMode] = useState<"time_entries" | "fallback" | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(deep.entry ?? null);

  useEffect(() => {
    if (deep.tech) setFilterTech(deep.tech);
    if (deep.wo) {
      setFilterWoId(deep.wo);
      setManual((m) => ({ ...m, workOrderId: deep.wo || m.workOrderId }));
    }
    if (deep.job) setFilterWoNumber(deep.job);
    if (deep.customer) setFilterCustomer(deep.customer);
    if (deep.status) setFilterStatus(deep.status);
    if (deep.week) setWeek(weekContaining(deep.week));
    if (deep.entry) {
      setHighlightId(deep.entry);
      scrollDoneForEntry.current = null;
    }
  }, [deep.tech, deep.wo, deep.job, deep.customer, deep.status, deep.week, deep.entry]);

  const isApprover =
    profile?.role === "administrator" || profile?.role === "service_manager";
  const isManager = isApprover || profile?.role === "billing";
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

      const techFilter = !manager ? meP.id : filterTech !== "all" ? filterTech : undefined;

      const from = filterWoId
        ? format(addDays(parseISO(week.start), -90), "yyyy-MM-dd")
        : week.start;
      const to = filterWoId
        ? format(addDays(parseISO(week.end), 90), "yyyy-MM-dd")
        : week.end;

      const rows = await loadTimeEntries(supabase, {
        from,
        to,
        technicianId: techFilter,
        workOrderId: filterWoId.trim() || undefined,
        customerId: undefined,
        status: filterStatus,
      });

      let filtered = rows;
      if (filterCustomer.trim()) {
        const q = filterCustomer.trim().toLowerCase();
        filtered = filtered.filter((e) => {
          const name = e.customers?.name || e.work_orders?.customers?.name || "";
          return name.toLowerCase().includes(q);
        });
      }
      if (filterWoNumber.trim()) {
        const q = filterWoNumber.trim().toLowerCase();
        filtered = filtered.filter((e) =>
          (e.work_orders?.work_order_number || "").toLowerCase().includes(q),
        );
      }
      setEntries(filtered);

      if (filterWoId) {
        const { data: jobRow } = await supabase
          .from("work_orders")
          .select("work_order_number")
          .eq("id", filterWoId)
          .maybeSingle();
        setLinkedJobLabel(
          (jobRow as { work_order_number?: string } | null)?.work_order_number ??
            filterWoId.slice(0, 8),
        );
      } else {
        setLinkedJobLabel(null);
      }

      try {
        if (meP.role === "technician" || !manager) {
          setActive(await getActiveClock(supabase, meP.id));
        } else {
          setActive(null);
        }
      } catch {
        setActive(null);
      }

      // My Day shift clocks only (Clock in / Clock out buttons) → Today / Week hours
      try {
        await syncLocalDayClocksToRemote(supabase);

        if (!manager) {
          setDayClocksWeek(
            await loadDayClocksForRange(supabase, meP.id, week.start, week.end),
          );
        } else if (filterTech !== "all") {
          setDayClocksWeek(
            await loadDayClocksForRange(supabase, filterTech, week.start, week.end),
          );
        } else {
          setDayClocksWeek(
            await loadDayClocksForTechnicians(supabase, "all", week.start, week.end),
          );
        }
      } catch {
        setDayClocksWeek([]);
      }

      try {
        setWeeklySheet(await loadWeeklyTimesheet(supabase, meP.id, week.start));
      } catch {
        setWeeklySheet(null);
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
  }, [supabase, week, filterStatus, filterWoId, filterWoNumber, filterCustomer, filterTech]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!highlightId || loading) return;
    if (scrollDoneForEntry.current === highlightId) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`te-${highlightId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        scrollDoneForEntry.current = highlightId;
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [highlightId, loading, entries]);

  const totals = useMemo(() => sumEntries(entries), [entries]);
  const jobBillableHours = useMemo(() => sumDispatchJobHours(entries), [entries]);
  const otherHours = useMemo(() => {
    const job = jobBillableHours;
    const rest = Math.max(0, totals.totalHours - job);
    return Math.round(rest * 100) / 100;
  }, [totals.totalHours, jobBillableHours]);

  const { todayHours: todayShiftHours, weekHours: weekShiftHours } = useMemo(
    () => sumTodayAndWeekDayClockHours(dayClocksWeek, todayIso(), dayClockTick),
    [dayClocksWeek, dayClockTick],
  );

  useEffect(() => {
    const open = dayClocksWeek.some((r) => !r.clock_out_at);
    if (!open) return;
    const id = window.setInterval(() => setDayClockTick(new Date()), 1_000);
    return () => window.clearInterval(id);
  }, [dayClocksWeek]);

  const weekByTech = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.approval_status === "rejected" || e.is_void || e.deleted_at) continue;
      if (e.approval_status === "missing_clock_out") continue;
      const h =
        e.approval_status === "active" && e.clock_in_at
          ? 0
          : Number(e.regular_hours) + Number(e.overtime_hours);
      map.set(e.technician_id, (map.get(e.technician_id) ?? 0) + h);
    }
    return map;
  }, [entries]);

  const exceptions = useMemo(() => detectExceptions(entries), [entries]);
  const otMsgs = useMemo(
    () => (isManager && filterTech === "all" ? [] : weeklyOtWarnings(weekShiftHours)),
    [weekShiftHours, isManager, filterTech],
  );
  const controlCards = useMemo(() => controlsExplainer(), []);

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
    const clockOutT = localDateTimeToIso(manual.date, manual.end);
    const mins = (parseISO(clockOutT).getTime() - parseISO(clockIn).getTime()) / 60_000;
    if (mins > 12 * 60 && !manualWarn12) {
      setManualWarn12(true);
      setError(
        "Warning: this entry is longer than 12 hours. Confirm and submit again if intentional (shifts over 16 hours require manager review).",
      );
      return;
    }
    setManualWarn12(false);
    await run(
      "manual",
      () =>
        createManualEntry(supabase, {
          profile,
          workOrderId: manual.workOrderId || null,
          entryDate: manual.date,
          clockInLocal: clockIn,
          clockOutLocal: clockOutT,
          activityType: manual.activity,
          notes: manual.notes,
          reason: manual.reason,
        }),
      "Manual entry submitted for approval. Original values preserved.",
    );
    setManual((m) => ({ ...m, notes: "", reason: "" }));
  }

  function jumpToException(ex: TimesheetException) {
    setHighlightId(ex.entryId);
    const el = document.getElementById(`te-${ex.entryId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isTech ? "My Timesheet" : "Timesheets"}
        description={
          isTech
            ? "Enter and submit your time. Manual and edited entries require manager approval. You cannot approve your own time."
            : "Approve, reject, reopen, and lock timesheets. Billing uses only approved, ready-to-bill hours."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {isTech ? (
              <Link href="/technician" className="btn btn-outline btn-sm">
                My Day
              </Link>
            ) : null}
            {filterWoId ? (
              <Link href={`/work-orders/${filterWoId}`} className="btn btn-outline btn-sm">
                Open job{linkedJobLabel ? ` ${linkedJobLabel}` : ""}
              </Link>
            ) : null}
            {filterWoId || filterTech !== "all" || filterWoNumber || filterCustomer || highlightId ? (
              <Link href="/timesheets" className="btn btn-ghost btn-sm">
                Clear filters
              </Link>
            ) : null}
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
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
          <code>time_entries</code> table is not on this Supabase project yet). Controls still
          enforce rules in app logic (and DB triggers when the migration is applied).
        </div>
      ) : null}

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
            <p className="text-xs text-slate-300">
              OT after 40 hours (system-calculated) · mult. {otMult}× cost
            </p>
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
                <Clock className="h-3 w-3" />{" "}
                {active.approval_status === "missing_clock_out"
                  ? "Missing Clock-Out"
                  : "Currently Clocked In"}
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
                    void run("out", () => clockOut(supabase, { profile }), "Clocked out.")
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
                  Return to active job
                </Link>
              ) : null}
              {active.id ? (
                <button
                  type="button"
                  className="btn btn-sm btn-accent"
                  onClick={() => {
                    setHighlightId(active.id);
                    scrollDoneForEntry.current = null;
                    document
                      .getElementById(`te-${active.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  Jump to entry
                </button>
              ) : null}
            </div>
          ) : isTech ? (
            <p className="ml-auto text-sm text-slate-300">
              Not clocked in. Start from a job on{" "}
              <Link href="/technician" className="link link-hover text-teal-200">
                My Day
              </Link>
              . Only one active clock-in is allowed.
            </p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today hours"
          value={formatHours(todayShiftHours)}
          hint={
            isManager && filterTech === "all"
              ? "All technicians · My Day Clock in / out only"
              : dayClocksWeek.filter((r) => r.work_date === todayIso()).length === 0
                ? "My Day Clock in / out only"
                : dayClocksWeek.some((r) => r.work_date === todayIso() && !r.clock_out_at)
                  ? "My Day shift (live)"
                  : "My Day clock out − clock in"
          }
          scrollTarget="timesheet-entries"
          onClick={() => setFilterStatus("all")}
        />
        <StatCard
          label="Week hours"
          value={formatHours(weekShiftHours)}
          hint={
            isManager && filterTech === "all"
              ? "Sum of all technicians’ My Day Clock in → out this week"
              : "Sum of My Day Clock in → out for each day this week"
          }
          danger={!(isManager && filterTech === "all") && weekShiftHours > 40}
          scrollTarget="timesheet-entries"
        />
        <StatCard
          label="Billable / other"
          value={`${formatHours(jobBillableHours)} / ${formatHours(otherHours)}`}
          hint="Billable = En Route → Done job time"
          scrollTarget="timesheet-entries"
        />
        <StatCard
          label={showCost ? "Labor cost (int.)" : "Pending / rejected"}
          value={showCost ? money(totals.laborCost) : `${totals.pending} / ${totals.rejected}`}
          hint={
            showCost
              ? `Billable $ ${money(totals.billableAmount)} · ${totals.pending} pending`
              : totals.active
                ? `${totals.active} open / missing out`
                : undefined
          }
          danger={totals.pending + totals.rejected > 0}
          scrollTarget={isApprover ? "timesheet-exceptions" : "timesheet-entries"}
          onClick={() => {
            if (!showCost) setFilterStatus("pending_approval");
          }}
        />
      </div>

      {otMsgs.map((m) => (
        <div
          key={m}
          className={`alert text-sm ${weekShiftHours > 40 ? "alert-warning" : "alert-info"}`}
        >
          <TriangleAlert className="h-4 w-4" />
          {m} Overtime hours are calculated from weekly totals — users cannot manually reclassify OT.
        </div>
      ))}

      {(isTech || (profile && filterTech === profile.id)) && (
        <section className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
          <h2 className="font-semibold">Weekly certification</h2>
          <p className="mt-1 text-sm opacity-70">
            Submit this week after all clock-outs are complete. After submission, you cannot edit
            unless a manager returns or reopens the week.
          </p>
          {weeklySheet?.status === "submitted" || weeklySheet?.status === "locked" ? (
            <div className="mt-2 alert alert-success text-sm">
              Week status: <strong className="ml-1">{weeklySheet.status}</strong>
              {weeklySheet.certified_at
                ? ` · certified ${shortIso(weeklySheet.certified_at)}`
                : null}
            </div>
          ) : (
            <>
              <label className="label cursor-pointer justify-start gap-3 mt-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={certifyOk}
                  onChange={(e) => setCertifyOk(e.target.checked)}
                />
                <span className="label-text text-sm">{CERTIFICATION_TEXT}</span>
              </label>
              <button
                type="button"
                className="btn btn-primary btn-sm mt-2"
                disabled={!profile || !certifyOk || busyId === "week"}
                onClick={() =>
                  profile &&
                  void run(
                    "week",
                    () => submitWeeklyTimesheet(supabase, profile, week.start, certifyOk),
                    "Weekly timesheet submitted for manager approval.",
                  )
                }
              >
                Submit week for approval
              </button>
            </>
          )}
        </section>
      )}

      {isApprover ? (
        <>
          <details className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
            <summary className="cursor-pointer font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Controls — Why this matters
            </summary>
            <ul className="mt-3 space-y-3 text-sm">
              {controlCards.map((c) => (
                <li key={c.risk} className="border-l-2 border-teal-600 pl-3">
                  <p>
                    <span className="font-semibold">Risk:</span> {c.risk}
                  </p>
                  <p className="opacity-80">
                    <span className="font-semibold">Control:</span> {c.control}
                  </p>
                </li>
              ))}
            </ul>
          </details>

          <section
            id="timesheet-exceptions"
            className="scroll-mt-4 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm"
          >
            <h2 className="font-semibold">Timesheet exceptions</h2>
            <p className="text-xs opacity-60 mb-2">
              Critical / Warning / Review / Resolved — click Open to jump to the entry.
            </p>
            {exceptions.length === 0 ? (
              <p className="text-sm opacity-60">No exceptions detected for this week.</p>
            ) : (
              <DualHorizontalScroll contentClassName="max-h-72 overflow-y-auto">
                <table className="table table-xs">
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Type</th>
                      <th>Detail</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {exceptions.map((ex) => (
                      <tr key={ex.id} className="hover">
                        <td>
                          <span className={`badge badge-sm ${severityTone(ex.severity)}`}>
                            {ex.severity}
                          </span>
                        </td>
                        <td className="font-medium">{ex.label}</td>
                        <td className="text-xs opacity-80 max-w-md">{ex.detail}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => jumpToException(ex)}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DualHorizontalScroll>
            )}
          </section>
        </>
      ) : null}

      {isTech &&
      entries.some(
        (e) =>
          e.approval_status === "missing_clock_out" ||
          (e.approval_status === "active" && e.clock_in_at),
      ) ? (
        <div className="alert alert-warning text-sm">
          <TriangleAlert className="h-4 w-4" />
          You have an open or missing clock-out. It is excluded from billing and payroll until
          corrected and approved.{" "}
          {active?.work_order_id ? (
            <Link href={`/work-orders/${active.work_order_id}`} className="link font-medium">
              Return to active entry
            </Link>
          ) : null}
        </div>
      ) : null}

      <div
        id="timesheet-entries"
        className="scroll-mt-4 flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-end"
      >
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
        <label className="form-control min-w-[10rem]">
          <span className="label-text text-xs">Job (WO #)</span>
          <input
            className="input input-bordered input-sm"
            placeholder="WO-"
            value={filterWoNumber}
            onChange={(e) => setFilterWoNumber(e.target.value)}
          />
        </label>
        {filterWoId ? (
          <div className="form-control">
            <span className="label-text text-xs">Linked job</span>
            <div className="flex items-center gap-2">
              <Link
                href={`/work-orders/${filterWoId}`}
                className="btn btn-outline btn-sm"
              >
                {linkedJobLabel ?? "Open"}
              </Link>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setFilterWoId("")}
              >
                Clear job
              </button>
            </div>
          </div>
        ) : null}
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

      {(isTech || isApprover) && (
        <details className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">Add manual / missed time</summary>
          <form className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submitManual}>
            <FormRow label="Date work occurred" required>
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
            <FormRow label="Activity type" required>
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
            <FormRow label="Work order (required for job time)">
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
            <FormRow label="Reason for manual entry" required>
              <input
                className="input input-bordered input-sm w-full"
                value={manual.reason}
                onChange={(e) => setManual((m) => ({ ...m, reason: e.target.value }))}
                placeholder="Why was this entered manually?"
                required
              />
            </FormRow>
            <div className="flex items-end">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busyId === "manual"}>
                {manualWarn12 ? "Confirm long shift & submit" : "Submit for approval"}
              </button>
            </div>
          </form>
          <p className="mt-2 text-xs opacity-60">
            Manual entries auto-mark Pending Approval. Original values are stored. Technicians cannot
            approve their own entries. Rates come from authorized profile/contract records.
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
          description="Clock in from a work order on My Day, or add a manual entry above. Seed control demos load in compatibility mode when empty."
          action={
            isTech ? (
              <Link href="/technician" className="btn btn-primary btn-sm">
                Open My Day
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DualHorizontalScroll className="rounded-box border border-base-300 bg-base-100 shadow-sm">
          <table className="table table-sm">
            <thead>
              <tr className="bg-base-200/60 text-xs uppercase">
                <th>When</th>
                {isManager ? <th>Tech</th> : null}
                <th>Job / customer</th>
                <th>Activity</th>
                <th className="text-right">Duration</th>
                {showCost ? <th className="text-right">Cost</th> : null}
                <th>Status</th>
                <th>Billing</th>
                <th>Flags</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const weekH = weekByTech.get(entry.technician_id) ?? 0;
                const flags = flagEntry(entry, entries, weekH);
                const warn = isApprover ? managerApprovalWarnings(entry, entries) : [];
                const cust =
                  entry.customers?.name || entry.work_orders?.customers?.name || "—";
                const wo = entry.work_orders;
                const hrsLabel =
                  (entry.approval_status === "active" ||
                    entry.approval_status === "missing_clock_out") &&
                  entry.clock_in_at
                    ? formatDurationSeconds(entry.clock_in_at)
                    : entry.clock_in_at && entry.clock_out_at
                      ? formatDurationSeconds(entry.clock_in_at, entry.clock_out_at)
                      : formatHours(Number(entry.regular_hours) + Number(entry.overtime_hours));
                return (
                  <tr
                    key={entry.id}
                    id={`te-${entry.id}`}
                    className={`align-top ${highlightId === entry.id ? "bg-warning/10" : ""} ${entry.is_void || entry.deleted_at ? "opacity-50" : ""}`}
                  >
                    <td className="whitespace-nowrap text-xs">
                      <div className="font-medium">{entry.entry_date}</div>
                      <div className="opacity-60">
                        {shortIso(entry.clock_in_at)}
                        {entry.clock_out_at
                          ? ` → ${format(parseISO(entry.clock_out_at), "h:mm:ss a")}`
                          : " → …"}
                      </div>
                      {entry.original_clock_in_at || entry.edit_reason ? (
                        <div className="mt-1 rounded border border-base-300 bg-base-200/50 p-1 text-[10px]">
                          <div className="font-semibold">Original vs revised</div>
                          <div>
                            Orig: {shortIso(entry.original_clock_in_at ?? null)} →{" "}
                            {shortIso(entry.original_clock_out_at ?? null)}
                          </div>
                          <div>
                            Rev: {shortIso(entry.clock_in_at)} → {shortIso(entry.clock_out_at)}
                          </div>
                          {entry.edit_reason ? <div>Edit: {entry.edit_reason}</div> : null}
                          {entry.reopen_reason ? <div>Reopen: {entry.reopen_reason}</div> : null}
                        </div>
                      ) : null}
                    </td>
                    {isManager ? (
                      <td className="text-xs">
                        <Link
                          href={timesheetHref({
                            tech: entry.technician_id,
                            week: entry.entry_date,
                          })}
                          className="link link-hover font-medium"
                          onClick={() => setFilterTech(entry.technician_id)}
                        >
                          {entry.technician?.full_name || entry.technician?.email || "—"}
                        </Link>
                      </td>
                    ) : null}
                    <td className="max-w-[14rem] text-xs">
                      {wo ? (
                        <>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <Link
                              href={`/work-orders/${entry.work_order_id}`}
                              className="link link-primary font-medium"
                            >
                              {wo.work_order_number}
                            </Link>
                            <Link
                              href={timesheetHref({
                                wo: entry.work_order_id,
                                tech: isManager ? entry.technician_id : null,
                                week: entry.entry_date,
                                entry: entry.id,
                              })}
                              className="link link-hover text-[10px] opacity-70"
                              onClick={() => {
                                if (entry.work_order_id) setFilterWoId(entry.work_order_id);
                                setHighlightId(entry.id);
                                scrollDoneForEntry.current = null;
                              }}
                            >
                              Filter timesheet
                            </Link>
                          </div>
                          <div className="opacity-80">{cust}</div>
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
                      {entry.void_reason ? (
                        <div className="text-error">Voided: {entry.void_reason}</div>
                      ) : null}
                      {warn.length ? (
                        <ul className="mt-1 list-disc pl-3 text-warning">
                          {warn.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td>
                      <span className="badge badge-ghost badge-sm">
                        {ACTIVITY_LABELS[entry.activity_type]}
                      </span>
                      <div className="text-[10px] opacity-50">{entry.billable_status}</div>
                    </td>
                    <td className="text-right tabular-nums">
                      <span className="font-mono text-xs">{hrsLabel}</span>
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
                        label={APPROVAL_LABELS[entry.approval_status] ?? entry.approval_status}
                        tone={approvalTone(entry.approval_status)}
                      />
                    </td>
                    <td className="text-[10px]">
                      {entry.billing_status === "billed" ||
                      entry.billing_status === "included_on_draft" ? (
                        BILLING_STATUS_LABELS[entry.billing_status] ?? entry.billing_status
                      ) : workOrderReadyToInvoice(wo) && entry.work_order_id ? (
                        <Link
                          href={`/billing?wo=${entry.work_order_id}`}
                          className="link link-primary font-semibold text-xs"
                        >
                          Create Invoice
                        </Link>
                      ) : (
                        BILLING_STATUS_LABELS[entry.billing_status ?? "not_ready"] ??
                        entry.billing_status ??
                        "—"
                      )}
                    </td>
                    <td className="text-[10px] leading-tight space-y-0.5">
                      {flags.missingClockOut || entry.approval_status === "missing_clock_out" ? (
                        <span className="badge badge-error badge-xs">Missing Clock-Out</span>
                      ) : null}
                      {flags.longShift || entry.duration_flag_16h ? (
                        <span className="badge badge-warning badge-xs">16h+</span>
                      ) : null}
                      {entry.duration_flag_12h && !entry.duration_flag_16h ? (
                        <span className="badge badge-warning badge-xs">12h+</span>
                      ) : null}
                      {flags.overlap ? (
                        <span className="badge badge-error badge-xs">Overlap</span>
                      ) : null}
                      {flags.noWorkOrder ? (
                        <span className="badge badge-warning badge-xs">No WO</span>
                      ) : null}
                      {entry.unassigned_work_order ? (
                        <span className="badge badge-warning badge-xs">Unassigned</span>
                      ) : null}
                      {entry.is_manual ? (
                        <span className="badge badge-info badge-xs">Manual</span>
                      ) : null}
                      {entry.is_duplicate_suspect ? (
                        <span className="badge badge-error badge-xs">Dup?</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        {isApprover &&
                        ["pending_approval", "complete", "submitted", "pending_correction"].includes(
                          entry.approval_status,
                        ) ? (
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
                                setRejectMode("reject");
                                setRejectReason("");
                              }}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-outline"
                              disabled={busyId === entry.id}
                              onClick={() => {
                                setRejectId(entry.id);
                                setRejectMode("correction");
                                setRejectReason("");
                              }}
                            >
                              Request correction
                            </button>
                          </>
                        ) : null}
                        {isApprover &&
                        (entry.approval_status === "approved" ||
                          entry.approval_status === "locked") &&
                        entry.billing_status !== "billed" ? (
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost gap-1"
                            disabled={busyId === entry.id}
                            onClick={() => {
                              setReopenId(entry.id);
                              setReopenReason("");
                            }}
                          >
                            <Unlock className="h-3 w-3" />
                            Reopen
                          </button>
                        ) : null}
                        {isApprover &&
                        profile &&
                        !entry.is_void &&
                        entry.billing_status !== "billed" ? (
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost text-error"
                            disabled={busyId === entry.id}
                            onClick={() => {
                              setVoidId(entry.id);
                              setVoidReason("");
                            }}
                          >
                            Void
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DualHorizontalScroll>
      )}

      {rejectId ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">
              {rejectMode === "reject" ? "Reject time entry" : "Request correction"}
            </h3>
            <p className="py-2 text-sm opacity-70">A reason is required for the audit trail.</p>
            <textarea
              className="textarea textarea-bordered w-full"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason…"
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
                    () =>
                      rejectMode === "reject"
                        ? rejectEntry(supabase, profile, rejectId, rejectReason)
                        : requestCorrection(supabase, profile, rejectId, rejectReason),
                    rejectMode === "reject" ? "Rejected." : "Correction requested.",
                  ).then(() => setRejectId(null));
                }}
              >
                <XCircle className="h-4 w-4" />
                Confirm
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

      {reopenId ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Reopen approved / locked time</h3>
            <p className="py-2 text-sm opacity-70">
              Reopening requires manager authorization and a documented reason.
            </p>
            <textarea
              className="textarea textarea-bordered w-full"
              rows={3}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Reopen reason…"
            />
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setReopenId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-warning"
                disabled={!profile || busyId === reopenId}
                onClick={() => {
                  if (!profile || !reopenId) return;
                  void run(
                    reopenId,
                    () => reopenEntry(supabase, profile, reopenId, reopenReason),
                    "Reopened — status pending approval.",
                  ).then(() => setReopenId(null));
                }}
              >
                Reopen with reason
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close"
            onClick={() => setReopenId(null)}
          />
        </div>
      ) : null}

      {voidId ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Void time entry (soft delete)</h3>
            <p className="py-2 text-sm opacity-70">
              Entries are never permanently deleted. Void reason and actor are recorded.
            </p>
            <textarea
              className="textarea textarea-bordered w-full"
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Void reason…"
            />
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setVoidId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error"
                disabled={!profile || busyId === voidId}
                onClick={() => {
                  if (!profile || !voidId) return;
                  void run(
                    voidId,
                    () => softDeleteEntry(supabase, profile, voidId, voidReason),
                    "Entry voided.",
                  ).then(() => setVoidId(null));
                }}
              >
                Void entry
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close"
            onClick={() => setVoidId(null)}
          />
        </div>
      ) : null}

      <p className="text-xs opacity-55">
        Controls enforce segregation of duties, one active clock-in, overlap/duration rules, weekly
        certification, billing status, and audit. Apply{" "}
        <code>supabase/migrations/20260808_time_entry_internal_controls.sql</code> for DB triggers and
        RLS.
      </p>
    </div>
  );
}
