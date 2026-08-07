/**
 * Timesheet billing-cycle helpers — daily entries, submissions, consolidated report.
 * Technicians are profiles with role = technician (no separate Technician table).
 *
 * Manager reports roll up hours from the field Timesheets module (time entries,
 * approved labor, and closed My Day clocks) for the selected cycle date range.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Profile,
  TechnicianLabor,
  TimeEntry,
  TimesheetCycle,
  TimesheetCycleType,
  TimesheetEntry,
  TimesheetSettings,
  TimesheetSubmission,
  TimesheetSubmissionStatus,
  UserRole,
} from "@/lib/types";
import { loadDayClocksForTechnicians, hoursFromDayClock } from "@/lib/day-clock";
import { includesInPayrollTotals } from "@/lib/time-entry-controls";
import { loadTimeEntries, weekContaining } from "@/lib/timesheets";

export function canManageTimesheets(role: UserRole): boolean {
  return role === "administrator" || role === "service_manager" || role === "billing";
}

export function sumHours(entries: Pick<TimesheetEntry, "hours">[]): number {
  return entries.reduce((sum, e) => sum + Number(e.hours || 0), 0);
}

export function formatHours(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfWeek(date: Date, weekStartsOn: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

/** Compute cycle start/end containing `forDate` given settings. */
export function cycleBoundsForDate(
  forDate: Date,
  cycleType: TimesheetCycleType,
  weekStartsOn = 1,
): { start: Date; end: Date } {
  const weekStart = startOfWeek(forDate, weekStartsOn);
  if (cycleType === "weekly") {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    return { start: weekStart, end };
  }
  // biweekly: align to even offset from a fixed epoch Monday
  const epoch = startOfWeek(new Date(2024, 0, 1), weekStartsOn);
  const days = Math.floor((weekStart.getTime() - epoch.getTime()) / 86_400_000);
  const weeks = Math.floor(days / 7);
  const offset = weeks % 2 === 0 ? 0 : 7;
  const start = new Date(weekStart);
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return { start, end };
}

export function cycleLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export async function loadTimesheetSettings(
  supabase: SupabaseClient,
): Promise<{ data: TimesheetSettings | null; error: string | null }> {
  const { data, error } = await supabase
    .from("timesheet_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: (data as TimesheetSettings) ?? null, error: null };
}

export async function saveTimesheetSettings(
  supabase: SupabaseClient,
  settings: Pick<TimesheetSettings, "id" | "cycle_type" | "week_starts_on">,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("timesheet_settings")
    .update({
      cycle_type: settings.cycle_type,
      week_starts_on: settings.week_starts_on,
      updated_at: new Date().toISOString(),
    })
    .eq("id", settings.id);
  return { error: error?.message ?? null };
}

export async function listCycles(
  supabase: SupabaseClient,
): Promise<{ data: TimesheetCycle[]; error: string | null }> {
  const { data, error } = await supabase
    .from("timesheet_cycles")
    .select("*")
    .order("start_date", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data as TimesheetCycle[]) ?? [], error: null };
}

/** Ensure a cycle exists for the given date; create if missing. */
export async function ensureCycleForDate(
  supabase: SupabaseClient,
  forDate: Date,
  settings: TimesheetSettings,
): Promise<{ data: TimesheetCycle | null; error: string | null }> {
  const { start, end } = cycleBoundsForDate(
    forDate,
    settings.cycle_type,
    settings.week_starts_on,
  );
  const startIso = toIsoDate(start);
  const endIso = toIsoDate(end);

  const existing = await supabase
    .from("timesheet_cycles")
    .select("*")
    .eq("start_date", startIso)
    .eq("end_date", endIso)
    .maybeSingle();
  if (existing.error) return { data: null, error: existing.error.message };
  if (existing.data) return { data: existing.data as TimesheetCycle, error: null };

  const { data, error } = await supabase
    .from("timesheet_cycles")
    .insert({
      start_date: startIso,
      end_date: endIso,
      label: cycleLabel(start, end),
      status: "Open",
    })
    .select()
    .single();
  if (error) {
    // Race: another client created it
    const again = await supabase
      .from("timesheet_cycles")
      .select("*")
      .eq("start_date", startIso)
      .eq("end_date", endIso)
      .maybeSingle();
    if (again.data) return { data: again.data as TimesheetCycle, error: null };
    return { data: null, error: error.message };
  }
  return { data: data as TimesheetCycle, error: null };
}

export async function listTechnicians(
  supabase: SupabaseClient,
): Promise<{ data: Profile[]; error: string | null }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "technician")
    .eq("is_active", true)
    .order("full_name");
  if (error) return { data: [], error: error.message };
  return { data: (data as Profile[]) ?? [], error: null };
}

export async function listEntriesForCycle(
  supabase: SupabaseClient,
  cycleId: string,
  technicianId?: string,
): Promise<{ data: TimesheetEntry[]; error: string | null }> {
  let q = supabase
    .from("timesheet_entries")
    .select("*")
    .eq("cycle_id", cycleId)
    .order("work_date", { ascending: true });
  if (technicianId) q = q.eq("technician_id", technicianId);
  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: (data as TimesheetEntry[]) ?? [], error: null };
}

export async function listSubmissionsForCycle(
  supabase: SupabaseClient,
  cycleId: string,
): Promise<{ data: TimesheetSubmission[]; error: string | null }> {
  const { data, error } = await supabase
    .from("timesheet_submissions")
    .select("*")
    .eq("cycle_id", cycleId);
  if (error) return { data: [], error: error.message };
  return { data: (data as TimesheetSubmission[]) ?? [], error: null };
}

export async function upsertEntry(
  supabase: SupabaseClient,
  input: {
    id?: string | null;
    technician_id: string;
    cycle_id: string;
    work_date: string;
    hours: number;
    notes?: string | null;
  },
): Promise<{ data: TimesheetEntry | null; error: string | null }> {
  const hours = Math.round(Number(input.hours) * 100) / 100;
  if (!(hours > 0 && hours <= 24)) {
    return { data: null, error: "Hours must be between 0.01 and 24." };
  }
  const now = new Date().toISOString();
  if (input.id) {
    const { data, error } = await supabase
      .from("timesheet_entries")
      .update({
        work_date: input.work_date,
        hours,
        notes: input.notes?.trim() || null,
        updated_at: now,
      })
      .eq("id", input.id)
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    return { data: data as TimesheetEntry, error: null };
  }
  const { data, error } = await supabase
    .from("timesheet_entries")
    .insert({
      technician_id: input.technician_id,
      cycle_id: input.cycle_id,
      work_date: input.work_date,
      hours,
      notes: input.notes?.trim() || null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as TimesheetEntry, error: null };
}

export async function deleteEntry(
  supabase: SupabaseClient,
  id: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("timesheet_entries").delete().eq("id", id);
  return { error: error?.message ?? null };
}

export async function getOrCreateSubmission(
  supabase: SupabaseClient,
  technicianId: string,
  cycleId: string,
): Promise<{ data: TimesheetSubmission | null; error: string | null }> {
  const existing = await supabase
    .from("timesheet_submissions")
    .select("*")
    .eq("technician_id", technicianId)
    .eq("cycle_id", cycleId)
    .maybeSingle();
  if (existing.error) return { data: null, error: existing.error.message };
  if (existing.data) return { data: existing.data as TimesheetSubmission, error: null };

  const { data, error } = await supabase
    .from("timesheet_submissions")
    .insert({
      technician_id: technicianId,
      cycle_id: cycleId,
      status: "Draft",
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as TimesheetSubmission, error: null };
}

export async function submitTimesheet(
  supabase: SupabaseClient,
  submissionId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("timesheet_submissions")
    .update({
      status: "Submitted" satisfies TimesheetSubmissionStatus,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);
  return { error: error?.message ?? null };
}

export async function reviewSubmission(
  supabase: SupabaseClient,
  submissionId: string,
  status: "Approved" | "Rejected",
  reviewerId: string,
  reviewNotes?: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("timesheet_submissions")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
      review_notes: reviewNotes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);
  return { error: error?.message ?? null };
}

export async function setCycleStatus(
  supabase: SupabaseClient,
  cycleId: string,
  status: "Open" | "Closed",
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("timesheet_cycles")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", cycleId);
  return { error: error?.message ?? null };
}

export type TechCycleSummary = {
  technician: Profile;
  totalHours: number;
  entryCount: number;
  submissionStatus: TimesheetSubmissionStatus | "Missing";
  submission: TimesheetSubmission | null;
  /** True when tech has no entries for a working day in the cycle (simple flag). */
  hasNoEntries: boolean;
};

/** Hours count for one field clock / labor punch. */
function hoursFromFieldEntry(e: TimeEntry): number {
  const reg = Number(e.regular_hours) || 0;
  const ot = Number(e.overtime_hours) || 0;
  if (reg + ot > 0) return Math.round((reg + ot) * 100) / 100;
  const mins = Number(e.total_minutes) || 0;
  if (mins > 0) return Math.round((mins / 60) * 100) / 100;
  return 0;
}

/** Expand cycle bounds to full Sun–Sat weeks so they match the Timesheets work week. */
function fieldReportDateWindow(cycle: Pick<TimesheetCycle, "start_date" | "end_date">): {
  from: string;
  to: string;
} {
  const a = weekContaining(cycle.start_date);
  const b = weekContaining(cycle.end_date);
  return { from: a.start, to: b.end };
}

function emptyByDay(): Map<string, TimesheetEntry> {
  return new Map();
}

function bumpHours(
  byDay: Map<string, TimesheetEntry>,
  input: {
    technicianId: string;
    workDate: string;
    hours: number;
    cycleId: string;
    notes: string | null;
    sourcePrefix: string;
    mode: "sum" | "max";
  },
) {
  const hours = Math.round(Number(input.hours) * 100) / 100;
  if (!(hours > 0) || !input.workDate || !input.technicianId) return;

  const key = `${input.technicianId}|${input.workDate}`;
  const existing = byDay.get(key);
  if (existing) {
    existing.hours =
      input.mode === "sum"
        ? Math.round((Number(existing.hours) + hours) * 100) / 100
        : Math.max(Number(existing.hours), hours);
    if (input.notes) {
      existing.notes = existing.notes ? `${existing.notes}; ${input.notes}` : input.notes;
    }
    return;
  }

  byDay.set(key, {
    id: `${input.sourcePrefix}-${input.technicianId}-${input.workDate}`,
    technician_id: input.technicianId,
    cycle_id: input.cycleId,
    work_date: input.workDate,
    hours,
    notes: input.notes,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

function mergeDayMaps(maps: Map<string, TimesheetEntry>[]): TimesheetEntry[] {
  const out = emptyByDay();
  for (const m of maps) {
    for (const [key, row] of m) {
      const existing = out.get(key);
      if (!existing || Number(row.hours) > Number(existing.hours)) {
        out.set(key, { ...row });
      }
    }
  }
  return Array.from(out.values()).sort((a, b) =>
    a.work_date === b.work_date
      ? a.technician_id.localeCompare(b.technician_id)
      : a.work_date.localeCompare(b.work_date),
  );
}

/**
 * Manager report hours from the field Timesheets module for a billing cycle:
 * - approved / locked / ready payroll time_entries
 * - technician_labor rows that are not approval-gated
 * - closed My Day clock-in/out shifts (same source as Timesheets "Week hours")
 */
export async function listApprovedFieldHoursForCycle(
  supabase: SupabaseClient,
  cycle: Pick<TimesheetCycle, "id" | "start_date" | "end_date">,
  technicianId?: string,
): Promise<{ data: TimesheetEntry[]; error: string | null }> {
  try {
    const window = fieldReportDateWindow(cycle);
    const displayFrom = cycle.start_date;
    const displayTo = cycle.end_date;
    const inDisplay = (d: string) => d >= displayFrom && d <= displayTo;

    const fromPunches = emptyByDay();
    const fromLabor = emptyByDay();
    const fromClocks = emptyByDay();

    // 1) Field time entries (same loader as /timesheets)
    const field = await loadTimeEntries(supabase, {
      from: window.from,
      to: window.to,
      technicianId,
    }).catch(() => [] as TimeEntry[]);

    for (const e of field) {
      if (e.deleted_at || e.is_void || e.voided_at) continue;
      const workDate = e.entry_date;
      if (!workDate || !inDisplay(workDate)) continue;

      const status = e.approval_status;
      const explicitlyApproved =
        status === "approved" || status === "locked" || Boolean(e.approved_at);

      // Skip open / rejected / voids
      if (!includesInPayrollTotals(e) && !explicitlyApproved) continue;
      // Skip still waiting manager approval unless already approved
      if (
        (status === "pending_approval" || status === "submitted") &&
        !explicitlyApproved
      ) {
        continue;
      }

      const hours = hoursFromFieldEntry(e);
      if (hours <= 0) continue;

      const noteBits = [
        e.work_orders?.work_order_number ? `WO ${e.work_orders.work_order_number}` : null,
        e.notes?.trim() || null,
      ].filter(Boolean) as string[];

      bumpHours(fromPunches, {
        technicianId: e.technician_id,
        workDate,
        hours,
        cycleId: cycle.id,
        notes: noteBits.length
          ? noteBits.join(" · ")
          : explicitlyApproved
            ? "Approved timesheet hours"
            : "Timesheet hours",
        sourcePrefix: explicitlyApproved ? "field" : "field-complete",
        mode: "sum",
      });
    }

    // 2) technician_labor (job hours) — include rows not pending manager gate
    let laborQ = supabase
      .from("technician_labor")
      .select("id, technician_id, work_date, regular_hours, overtime_hours, notes, approval_gated")
      .gte("work_date", displayFrom)
      .lte("work_date", displayTo);
    if (technicianId) laborQ = laborQ.eq("technician_id", technicianId);
    const { data: laborRows } = await laborQ;
    for (const row of (laborRows as (TechnicianLabor & { approval_gated?: boolean })[]) ?? []) {
      if (row.approval_gated === true) continue;
      const hours =
        Math.round(((Number(row.regular_hours) || 0) + (Number(row.overtime_hours) || 0)) * 100) /
        100;
      if (hours <= 0) continue;
      bumpHours(fromLabor, {
        technicianId: row.technician_id,
        workDate: row.work_date,
        hours,
        cycleId: cycle.id,
        notes: row.notes?.trim() || "Job labor hours",
        sourcePrefix: "labor",
        mode: "sum",
      });
    }

    // 3) Closed My Day clocks — same rollup as Timesheets "Week hours"
    const clocks = await loadDayClocksForTechnicians(
      supabase,
      technicianId ? [technicianId] : "all",
      displayFrom,
      displayTo,
    ).catch(() => []);

    for (const row of clocks) {
      if (!row.clock_out_at) continue;
      if (!inDisplay(row.work_date)) continue;
      const hours = hoursFromDayClock(row);
      if (hours <= 0) continue;
      bumpHours(fromClocks, {
        technicianId: row.technician_id,
        workDate: row.work_date,
        hours,
        cycleId: cycle.id,
        notes: "My Day shift (clock in → out)",
        sourcePrefix: "dayclock",
        mode: "sum",
      });
    }

    // Merge sources per tech/day using max (same shift often mirrored across sources)
    let data = mergeDayMaps([fromPunches, fromLabor, fromClocks]);

    // Last resort: any payroll-countable punches if still empty
    if (data.length === 0 && field.length > 0) {
      const fallback = emptyByDay();
      for (const e of field) {
        if (!includesInPayrollTotals(e)) continue;
        const workDate = e.entry_date;
        if (!workDate || !inDisplay(workDate)) continue;
        const hours = hoursFromFieldEntry(e);
        if (hours <= 0) continue;
        bumpHours(fallback, {
          technicianId: e.technician_id,
          workDate,
          hours,
          cycleId: cycle.id,
          notes: `Timesheet (${e.approval_status})`,
          sourcePrefix: "field-payroll",
          mode: "sum",
        });
      }
      data = mergeDayMaps([fallback]);
    }

    return { data, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not load approved timesheet hours.";
    return { data: [], error: msg };
  }
}

/** Combine cycle logbook entries with field hours (field wins when larger same day). */
export function mergeCycleAndFieldEntries(
  cycleEntries: TimesheetEntry[],
  fieldEntries: TimesheetEntry[],
): TimesheetEntry[] {
  const map = new Map<string, TimesheetEntry>();

  for (const e of cycleEntries) {
    map.set(`${e.technician_id}|${e.work_date}`, { ...e, hours: Number(e.hours) || 0 });
  }

  for (const e of fieldEntries) {
    const key = `${e.technician_id}|${e.work_date}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...e, hours: Number(e.hours) || 0 });
      continue;
    }
    const fieldHrs = Number(e.hours) || 0;
    const cycleHrs = Number(existing.hours) || 0;
    if (fieldHrs >= cycleHrs) {
      map.set(key, {
        ...e,
        hours: fieldHrs,
        notes: e.notes || existing.notes,
      });
    } else if (!existing.notes && e.notes) {
      existing.notes = e.notes;
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.work_date === b.work_date
      ? a.technician_id.localeCompare(b.technician_id)
      : a.work_date.localeCompare(b.work_date),
  );
}

export function buildCycleSummaries(
  technicians: Profile[],
  entries: TimesheetEntry[],
  submissions: TimesheetSubmission[],
): TechCycleSummary[] {
  return technicians.map((tech) => {
    const mine = entries.filter((e) => e.technician_id === tech.id);
    const sub = submissions.find((s) => s.technician_id === tech.id) ?? null;
    const hasFieldHours = mine.some(
      (e) =>
        e.id.startsWith("field") ||
        e.id.startsWith("labor") ||
        e.id.startsWith("dayclock"),
    );
    const submissionStatus: TimesheetSubmissionStatus | "Missing" =
      sub?.status ?? (hasFieldHours ? "Approved" : "Missing");
    return {
      technician: tech,
      totalHours: sumHours(mine),
      entryCount: mine.length,
      submissionStatus,
      submission: sub,
      hasNoEntries: mine.length === 0,
    };
  });
}

export function dateInCycle(workDate: string, cycle: TimesheetCycle): boolean {
  return workDate >= cycle.start_date && workDate <= cycle.end_date;
}

export { toIsoDate, parseIsoDate };
