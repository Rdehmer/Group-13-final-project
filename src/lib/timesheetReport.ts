/**
 * Timesheet billing-cycle helpers — daily entries, submissions, consolidated report.
 * Technicians are profiles with role = technician (no separate Technician table).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Profile,
  TimesheetCycle,
  TimesheetCycleType,
  TimesheetEntry,
  TimesheetSettings,
  TimesheetSubmission,
  TimesheetSubmissionStatus,
  UserRole,
} from "@/lib/types";

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

export function buildCycleSummaries(
  technicians: Profile[],
  entries: TimesheetEntry[],
  submissions: TimesheetSubmission[],
): TechCycleSummary[] {
  return technicians.map((tech) => {
    const mine = entries.filter((e) => e.technician_id === tech.id);
    const sub = submissions.find((s) => s.technician_id === tech.id) ?? null;
    return {
      technician: tech,
      totalHours: sumHours(mine),
      entryCount: mine.length,
      submissionStatus: sub?.status ?? "Missing",
      submission: sub,
      hasNoEntries: mine.length === 0,
    };
  });
}

export function dateInCycle(workDate: string, cycle: TimesheetCycle): boolean {
  return workDate >= cycle.start_date && workDate <= cycle.end_date;
}

export { toIsoDate, parseIsoDate };
