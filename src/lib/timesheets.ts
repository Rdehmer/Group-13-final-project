/**
 * ServiceTitan-style field timesheets.
 * Prefers Supabase `time_entries` when present; otherwise falls back to
 * `technician_labor` + a browser store so the app never blocks on missing migrations.
 */

import {
  addDays,
  differenceInSeconds,
  endOfWeek,
  format,
  parseISO,
  startOfDay,
  startOfWeek,
} from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { laborCost as laborCostCalc } from "@/lib/calculations";
import type {
  Profile,
  TechnicianLabor,
  TimeActivityType,
  TimeApprovalStatus,
  TimeBillableStatus,
  TimeEntry,
  WeeklyTimesheet,
} from "@/lib/types";
import {
  applyMissingClockOutStatus,
  canApproveTime,
  includesInBilling,
  includesInPayrollTotals,
  isExactDuplicate,
  isManagerRole,
  isVoided,
  unauthorizedOpenWorkOrder,
  validateDuration,
  validateNotFuture,
  CERTIFICATION_TEXT,
} from "@/lib/time-entry-controls";
import { resolveLaborBillableStatus, type CoverageJob } from "@/lib/coverage";

export const ACTIVITY_TYPES: {
  value: TimeActivityType;
  label: string;
  jobRequired: boolean;
  defaultBillable: TimeBillableStatus;
}[] = [
  { value: "regular_work", label: "Regular work", jobRequired: true, defaultBillable: "billable" },
  { value: "overtime", label: "Overtime", jobRequired: true, defaultBillable: "billable" },
  { value: "travel", label: "Travel", jobRequired: false, defaultBillable: "billable" },
  { value: "shop", label: "Shop / warehouse", jobRequired: false, defaultBillable: "nonbillable" },
  { value: "training", label: "Training", jobRequired: false, defaultBillable: "nonbillable" },
  { value: "meeting", label: "Meeting", jobRequired: false, defaultBillable: "nonbillable" },
  { value: "break", label: "Break", jobRequired: false, defaultBillable: "nonbillable" },
  {
    value: "admin_nonbillable",
    label: "Admin (nonbillable)",
    jobRequired: false,
    defaultBillable: "nonbillable",
  },
];

export const APPROVAL_LABELS: Record<TimeApprovalStatus, string> = {
  active: "Active",
  missing_clock_out: "Missing Clock-Out",
  pending_correction: "Pending Correction",
  complete: "Complete",
  pending_approval: "Pending Approval",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  locked: "Locked",
};

export { CERTIFICATION_TEXT };

export const ACTIVITY_LABELS = Object.fromEntries(
  ACTIVITY_TYPES.map((a) => [a.value, a.label]),
) as Record<TimeActivityType, string>;

const ENTRY_SELECT_NESTED = `
  *,
  technician:profiles!time_entries_technician_id_fkey(id, full_name, email),
  work_orders(
    id, work_order_number, work_order_type, problem_description, status, billing_status, dispatch_status,
    customers(id, name, service_address, city, state),
    equipment(id, name, serial_number)
  ),
  customers(id, name)
`;
const ENTRY_SELECT_FLAT = "*";
const FALLBACK_KEY = "equipmentiq_time_entries_fallback_v2";

type BackendMode = "time_entries" | "fallback" | "unknown";
let cachedMode: BackendMode = "unknown";

type FallbackStore = {
  entries: TimeEntry[];
  meta: Record<
    string,
    {
      approval_status?: TimeApprovalStatus;
      rejection_reason?: string | null;
      approved_by?: string | null;
      approved_at?: string | null;
      rejected_at?: string | null;
      rejected_by?: string | null;
      locked_at?: string | null;
      locked_by?: string | null;
      is_manual?: boolean;
      manual_entry_reason?: string | null;
      activity_type?: TimeActivityType;
      deleted?: boolean;
      reopened_at?: string | null;
      reopened_by?: string | null;
      reopen_reason?: string | null;
      edit_reason?: string | null;
      original_clock_in_at?: string | null;
      original_clock_out_at?: string | null;
      original_values?: Record<string, unknown> | null;
      billing_status?: TimeEntry["billing_status"];
      is_void?: boolean;
      voided_at?: string | null;
      voided_by?: string | null;
      void_reason?: string | null;
      unassigned_work_order?: boolean;
      requires_manager_assignment_override?: boolean;
      duration_flag_12h?: boolean;
      duration_flag_16h?: boolean;
      is_duplicate_suspect?: boolean;
      submitted_at?: string | null;
      submitted_by?: string | null;
    }
  >;
  weeks: WeeklyTimesheet[];
  audit: {
    id: string;
    time_entry_id: string;
    action: string;
    actor_id: string | null;
    actor_role?: string | null;
    detail?: string | null;
    reason?: string | null;
    status_before?: string | null;
    status_after?: string | null;
    original_values?: Record<string, unknown> | null;
    revised_values?: Record<string, unknown> | null;
    created_at: string;
  }[];
};

export function supabaseErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

export function isTimesheetMissingTable(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("time_entries") ||
    m.includes("pgrst205") ||
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table") ||
    m.includes("could not find the relation")
  );
}

function num(n: number | null | undefined): number {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/** Hours precision for field punches (2 decimal places — matches DB numeric(10,2)). */
function numHours(n: number | null | undefined): number {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

export function formatHours(n: number): string {
  return num(n).toFixed(2);
}

/** Live / closed span as `Hh MMm SSs` (second precision for field testing). */
export function formatDurationSeconds(
  clockIn: string,
  clockOut?: string | null,
  now = new Date(),
): string {
  const end = clockOut ? parseISO(clockOut) : now;
  const secs = Math.max(0, differenceInSeconds(end, parseISO(clockIn)));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/** Fractional hours from an ISO range — second precision for display math. */
export function hoursFromSecondsRange(clockIn: string, clockOut: string): number {
  const secs = differenceInSeconds(parseISO(clockOut), parseISO(clockIn));
  if (!Number.isFinite(secs) || secs <= 0) return 0;
  const h = secs / 3600;
  // Match time_entries.regular_hours numeric(10,2); keep short punches ≥ 0.01h
  return Math.max(Math.round(h * 100) / 100, 0.01);
}

export function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function todayIso(now = new Date()): string {
  return format(now, "yyyy-MM-dd");
}

export function weekContaining(date: Date | string = new Date()): {
  start: string;
  end: string;
  label: string;
} {
  const d = typeof date === "string" ? parseISO(date) : date;
  const start = startOfWeek(d, { weekStartsOn: 0 });
  const end = endOfWeek(d, { weekStartsOn: 0 });
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
    label: `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`,
  };
}

export function shiftWeek(week: { start: string }, deltaWeeks: number) {
  return weekContaining(addDays(parseISO(week.start), deltaWeeks * 7));
}

export function splitWeeklyOt(
  totalHours: number,
  priorWeekRegular = 0,
  weeklyThreshold = 40,
): { regular_hours: number; overtime_hours: number } {
  const hours = Math.max(0, totalHours);
  const room = Math.max(0, weeklyThreshold - priorWeekRegular);
  const reg = Math.min(hours, room);
  const ot = Math.max(0, hours - reg);
  return { regular_hours: numHours(reg), overtime_hours: numHours(ot) };
}

export function hoursFromRange(clockIn: string, clockOut: string): number {
  return hoursFromSecondsRange(clockIn, clockOut);
}

export function minutesFromRange(clockIn: string, clockOut: string): number {
  const secs = differenceInSeconds(parseISO(clockOut), parseISO(clockIn));
  if (!Number.isFinite(secs) || secs <= 0) return 0;
  return Math.max(1, Math.ceil(secs / 60));
}

export function computeMoney(
  regularHours: number,
  overtimeHours: number,
  costRate: number,
  otCostRate: number,
  billingRate: number,
  billableStatus: TimeBillableStatus,
  _billOtToCustomer = false,
  otBillingMult = 1.5,
): { labor_cost: number; billable_amount: number } {
  const labor_cost = num(laborCostCalc(regularHours, overtimeHours, costRate, otCostRate));
  if (billableStatus === "nonbillable" || billableStatus === "contract_included") {
    return { labor_cost, billable_amount: 0 };
  }
  const billable_amount = num(
    regularHours * billingRate + overtimeHours * billingRate * (otBillingMult || 1),
  );
  return { labor_cost, billable_amount };
}

export function activityDefaultBillable(type: TimeActivityType): TimeBillableStatus {
  return ACTIVITY_TYPES.find((a) => a.value === type)?.defaultBillable ?? "billable";
}

export function jobRequiredForActivity(type: TimeActivityType): boolean {
  return ACTIVITY_TYPES.find((a) => a.value === type)?.jobRequired ?? false;
}

export type RateSnapshot = {
  hourly_cost_rate: number;
  overtime_cost_rate: number;
  billing_rate: number;
  ot_multiplier: number;
};

export async function loadOtMultiplier(supabase: SupabaseClient): Promise<number> {
  try {
    const { data } = await supabase
      .from("company_settings")
      .select("overtime_multiplier")
      .limit(1)
      .maybeSingle();
    const m = Number(data?.overtime_multiplier);
    return m > 0 ? m : 1.5;
  } catch {
    return 1.5;
  }
}

export function ratesFromProfile(profile: Profile, otMult: number): RateSnapshot {
  const cost = num(profile.hourly_cost_rate) || 45;
  const billing = num(profile.hourly_billing_rate) || 95;
  return {
    hourly_cost_rate: cost,
    overtime_cost_rate: num(cost * otMult),
    billing_rate: billing,
    ot_multiplier: otMult,
  };
}

function readStore(): FallbackStore {
  if (typeof window === "undefined") return { entries: [], meta: {}, weeks: [], audit: [] };
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return { entries: [], meta: {}, weeks: [], audit: [] };
    const parsed = JSON.parse(raw) as FallbackStore;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {},
      weeks: Array.isArray(parsed.weeks) ? parsed.weeks : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    };
  } catch {
    return { entries: [], meta: {}, weeks: [], audit: [] };
  }
}

function appendLocalAudit(
  store: FallbackStore,
  row: Omit<FallbackStore["audit"][number], "id" | "created_at">,
) {
  store.audit.push({
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...row,
  });
}

function writeStore(store: FallbackStore) {
  if (typeof window === "undefined") return;
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(store));
}

async function resolveMode(supabase: SupabaseClient): Promise<"time_entries" | "fallback"> {
  if (cachedMode === "time_entries" || cachedMode === "fallback") return cachedMode;
  const { error } = await supabase.from("time_entries").select("id").limit(1);
  if (error && isTimesheetMissingTable(supabaseErrorMessage(error))) {
    cachedMode = "fallback";
    return "fallback";
  }
  if (error) {
    // Other errors still try flat once; treat unresolved as fallback for reliability
    cachedMode = "fallback";
    return "fallback";
  }
  cachedMode = "time_entries";
  return "time_entries";
}

/** Expose mode for UI banner */
export async function getTimesheetBackend(
  supabase: SupabaseClient,
): Promise<"time_entries" | "fallback"> {
  return resolveMode(supabase);
}

export async function writeAudit(
  supabase: SupabaseClient,
  timeEntryId: string,
  action: string,
  actorId: string | null,
  detail?: string,
  extra?: {
    actorRole?: string | null;
    workOrderId?: string | null;
    reason?: string | null;
    originalValues?: Record<string, unknown> | null;
    revisedValues?: Record<string, unknown> | null;
    statusBefore?: string | null;
    statusAfter?: string | null;
  },
) {
  const payload = {
    time_entry_id: timeEntryId,
    action,
    actor_id: actorId,
    detail: detail ?? null,
    actor_role: extra?.actorRole ?? null,
    work_order_id: extra?.workOrderId ?? null,
    reason: extra?.reason ?? null,
    original_values: extra?.originalValues ?? null,
    revised_values: extra?.revisedValues ?? null,
    status_before: extra?.statusBefore ?? null,
    status_after: extra?.statusAfter ?? null,
  };
  if (cachedMode === "fallback") {
    const store = readStore();
    appendLocalAudit(store, {
      time_entry_id: timeEntryId,
      action,
      actor_id: actorId,
      actor_role: extra?.actorRole ?? null,
      detail: detail ?? null,
      reason: extra?.reason ?? null,
      status_before: extra?.statusBefore ?? null,
      status_after: extra?.statusAfter ?? null,
      original_values: extra?.originalValues ?? null,
      revised_values: extra?.revisedValues ?? null,
    });
    writeStore(store);
    return;
  }
  try {
    await supabase.from("time_entry_audit").insert(payload);
  } catch {
    const store = readStore();
    appendLocalAudit(store, {
      time_entry_id: timeEntryId,
      action,
      actor_id: actorId,
      actor_role: extra?.actorRole ?? null,
      detail: detail ?? null,
      reason: extra?.reason ?? null,
      status_before: extra?.statusBefore ?? null,
      status_after: extra?.statusAfter ?? null,
      original_values: extra?.originalValues ?? null,
      revised_values: extra?.revisedValues ?? null,
    });
    writeStore(store);
  }
}

export function loadLocalAudit(entryId?: string) {
  const store = readStore();
  return entryId
    ? store.audit.filter((a) => a.time_entry_id === entryId)
    : store.audit.slice().reverse();
}

export async function sumPriorWeekRegular(
  supabase: SupabaseClient,
  technicianId: string,
  weekStart: string,
  weekEnd: string,
  excludeId?: string,
): Promise<number> {
  const entries = await loadTimeEntries(supabase, {
    from: weekStart,
    to: weekEnd,
    technicianId,
  });
  return num(
    entries
      .filter((e) => e.id !== excludeId && e.approval_status !== "rejected" && e.approval_status !== "active")
      .reduce((s, r) => s + Number(r.regular_hours || 0) + Number(r.overtime_hours || 0), 0),
  );
}

export type EntryFlags = {
  missingClockOut: boolean;
  longShift: boolean;
  overlap: boolean;
  noWorkOrder: boolean;
  approachingOt: boolean;
  overWeeklyOt: boolean;
};

export function entriesOverlap(
  aIn: string,
  aOut: string,
  bIn: string,
  bOut: string,
): boolean {
  const a0 = parseISO(aIn).getTime();
  const a1 = parseISO(aOut).getTime();
  const b0 = parseISO(bIn).getTime();
  const b1 = parseISO(bOut).getTime();
  return a0 < b1 && b0 < a1;
}

export function flagEntry(
  entry: TimeEntry,
  allForTech: TimeEntry[],
  weekTotalHours: number,
): EntryFlags {
  const hours = num(entry.regular_hours + entry.overtime_hours);
  const missingClockOut =
    entry.approval_status === "active" ||
    entry.approval_status === "missing_clock_out" ||
    (!!entry.clock_in_at && !entry.clock_out_at);
  const longShift = hours > 16 || entry.total_minutes > 16 * 60 || Boolean(entry.duration_flag_16h);
  const noWorkOrder =
    !entry.work_order_id &&
    (entry.activity_type === "regular_work" || entry.activity_type === "overtime");

  let overlap = false;
  if (entry.clock_in_at) {
    const a0 = entry.clock_in_at;
    const a1 = entry.clock_out_at ?? new Date().toISOString();
    for (const other of allForTech) {
      if (other.id === entry.id || other.deleted_at || other.is_void) continue;
      if (other.technician_id !== entry.technician_id) continue;
      if (!other.clock_in_at) continue;
      if (other.approval_status === "rejected") continue;
      const b1 = other.clock_out_at ?? new Date().toISOString();
      if (entriesOverlap(a0, a1, other.clock_in_at, b1)) {
        overlap = true;
        break;
      }
    }
  }

  return {
    missingClockOut,
    longShift,
    overlap,
    noWorkOrder,
    approachingOt: weekTotalHours >= 35 && weekTotalHours < 40,
    overWeeklyOt: weekTotalHours > 40,
  };
}

export async function findOverlapping(
  supabase: SupabaseClient,
  technicianId: string,
  clockIn: string,
  clockOut: string,
  excludeId?: string,
): Promise<TimeEntry[]> {
  const day = format(parseISO(clockIn), "yyyy-MM-dd");
  const prev = format(addDays(parseISO(day), -1), "yyyy-MM-dd");
  const next = format(addDays(parseISO(day), 1), "yyyy-MM-dd");
  const all = await loadTimeEntries(supabase, {
    from: prev,
    to: next,
    technicianId,
  });
  return all.filter((row) => {
    if (excludeId && row.id === excludeId) return false;
    if (!row.clock_in_at) return false;
    if (row.approval_status === "rejected") return false;
    const out = row.clock_out_at ?? new Date().toISOString();
    return entriesOverlap(clockIn, clockOut, row.clock_in_at, out);
  });
}

function activityFromNotes(notes: string | null | undefined): TimeActivityType {
  const n = (notes ?? "").toLowerCase();
  if (n.includes("travel")) return "travel";
  if (n.includes("meal") || n.includes("break")) return "break";
  if (n.includes("shop") || n.includes("warehouse")) return "shop";
  if (n.includes("train")) return "training";
  if (n.includes("meeting")) return "meeting";
  if (n.includes("admin") || n.includes("nonbill")) return "admin_nonbillable";
  if (n.includes("overtime") || n.includes(" ot")) return "overtime";
  return "regular_work";
}

function laborToEntry(
  row: TechnicianLabor & {
    work_orders?: TimeEntry["work_orders"];
    profiles?: { id: string; full_name: string | null; email: string } | null;
  },
  meta: FallbackStore["meta"][string] | undefined,
): TimeEntry {
  const activity = meta?.activity_type ?? activityFromNotes(row.notes);
  const billable: TimeBillableStatus =
    row.billable_status === "Non-Billable" || row.billable_status === "non_billable"
      ? "nonbillable"
      : row.billable_status === "Contract Included"
        ? "contract_included"
        : "billable";
  const reg = num(row.regular_hours);
  const ot = num(row.overtime_hours);
  const costRate = num(row.hourly_cost_rate);
  const otCost = num(row.overtime_cost_rate) || costRate * 1.5;
  const billRate = num(row.customer_billing_rate);
  const moneyPart = computeMoney(reg, ot, costRate, otCost, billRate, billable, false, 1.5);
  const day = row.work_date;
  const clockIn =
    row.start_time != null
      ? `${day}T${String(row.start_time).slice(0, 8)}`
      : `${day}T08:00:00`;
  const clockOut =
    row.end_time != null
      ? `${day}T${String(row.end_time).slice(0, 8)}`
      : null;
  const status: TimeApprovalStatus =
    meta?.approval_status ?? (meta?.is_manual ? "pending_approval" : "complete");

  return applyMissingClockOutStatus({
    id: `labor-${row.id}`,
    technician_id: row.technician_id,
    work_order_id: row.work_order_id,
    customer_id: null,
    equipment_id: null,
    service_location: null,
    entry_date: day,
    clock_in_at: clockIn,
    clock_out_at: clockOut,
    total_minutes: Math.round((reg + ot) * 60),
    activity_type: activity,
    billable_status: billable,
    regular_hours: reg,
    overtime_hours: ot,
    hourly_cost_rate: costRate,
    overtime_cost_rate: otCost,
    billing_rate: billRate,
    labor_cost: moneyPart.labor_cost,
    billable_amount: moneyPart.billable_amount,
    notes: row.notes,
    manual_entry_reason: meta?.manual_entry_reason ?? null,
    is_manual: Boolean(meta?.is_manual),
    approval_status: status,
    submitted_at: meta?.submitted_at ?? null,
    submitted_by: meta?.submitted_by ?? null,
    approved_by: meta?.approved_by ?? null,
    approved_at: meta?.approved_at ?? null,
    rejected_at: meta?.rejected_at ?? null,
    rejected_by: meta?.rejected_by ?? null,
    rejection_reason: meta?.rejection_reason ?? null,
    reopened_at: meta?.reopened_at ?? null,
    reopened_by: meta?.reopened_by ?? null,
    reopen_reason: meta?.reopen_reason ?? null,
    edit_reason: meta?.edit_reason ?? null,
    original_clock_in_at: meta?.original_clock_in_at ?? null,
    original_clock_out_at: meta?.original_clock_out_at ?? null,
    original_values: meta?.original_values ?? null,
    billing_status: meta?.billing_status ?? (status === "approved" || status === "locked" ? "ready_to_bill" : "not_ready"),
    is_void: Boolean(meta?.is_void),
    voided_at: meta?.voided_at ?? null,
    voided_by: meta?.voided_by ?? null,
    void_reason: meta?.void_reason ?? null,
    unassigned_work_order: Boolean(meta?.unassigned_work_order),
    requires_manager_assignment_override: Boolean(meta?.requires_manager_assignment_override),
    duration_flag_12h: Boolean(meta?.duration_flag_12h) || reg + ot > 12,
    duration_flag_16h: Boolean(meta?.duration_flag_16h) || reg + ot > 16,
    is_duplicate_suspect: Boolean(meta?.is_duplicate_suspect),
    created_by: row.technician_id,
    updated_by: null,
    locked_at: meta?.locked_at ?? null,
    locked_by: meta?.locked_by ?? null,
    deleted_at: meta?.deleted ? new Date().toISOString() : null,
    deleted_by: null,
    technician_labor_id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    technician: row.profiles ?? null,
    work_orders: row.work_orders ?? null,
    customers: null,
  });
}

function blankEntry(partial: Partial<TimeEntry> & Pick<TimeEntry, "technician_id" | "entry_date">): TimeEntry {
  const now = new Date().toISOString();
  const totalH = num((partial.regular_hours ?? 0) + (partial.overtime_hours ?? 0));
  return {
    id: partial.id ?? crypto.randomUUID(),
    technician_id: partial.technician_id,
    work_order_id: partial.work_order_id ?? null,
    customer_id: partial.customer_id ?? null,
    equipment_id: partial.equipment_id ?? null,
    service_location: partial.service_location ?? null,
    entry_date: partial.entry_date,
    clock_in_at: partial.clock_in_at ?? null,
    clock_out_at: partial.clock_out_at ?? null,
    total_minutes: partial.total_minutes ?? 0,
    activity_type: partial.activity_type ?? "regular_work",
    billable_status: partial.billable_status ?? "billable",
    regular_hours: partial.regular_hours ?? 0,
    overtime_hours: partial.overtime_hours ?? 0,
    hourly_cost_rate: partial.hourly_cost_rate ?? 45,
    overtime_cost_rate: partial.overtime_cost_rate ?? 67.5,
    billing_rate: partial.billing_rate ?? 95,
    labor_cost: partial.labor_cost ?? 0,
    billable_amount: partial.billable_amount ?? 0,
    notes: partial.notes ?? null,
    manual_entry_reason: partial.manual_entry_reason ?? null,
    is_manual: partial.is_manual ?? false,
    approval_status: partial.approval_status ?? "complete",
    submitted_at: partial.submitted_at ?? null,
    submitted_by: partial.submitted_by ?? null,
    approved_by: partial.approved_by ?? null,
    approved_at: partial.approved_at ?? null,
    rejected_at: partial.rejected_at ?? null,
    rejected_by: partial.rejected_by ?? null,
    rejection_reason: partial.rejection_reason ?? null,
    reopened_at: partial.reopened_at ?? null,
    reopened_by: partial.reopened_by ?? null,
    reopen_reason: partial.reopen_reason ?? null,
    correction_reason: partial.correction_reason ?? null,
    edit_reason: partial.edit_reason ?? null,
    original_clock_in_at: partial.original_clock_in_at ?? null,
    original_clock_out_at: partial.original_clock_out_at ?? null,
    original_regular_hours: partial.original_regular_hours ?? null,
    original_overtime_hours: partial.original_overtime_hours ?? null,
    original_activity_type: partial.original_activity_type ?? null,
    original_notes: partial.original_notes ?? null,
    original_values: partial.original_values ?? null,
    revised_values: partial.revised_values ?? null,
    requires_manager_assignment_override: partial.requires_manager_assignment_override ?? false,
    unassigned_work_order: partial.unassigned_work_order ?? false,
    exception_flags: partial.exception_flags ?? null,
    exception_severity: partial.exception_severity ?? null,
    duration_flag_12h: partial.duration_flag_12h ?? totalH > 12,
    duration_flag_16h: partial.duration_flag_16h ?? totalH > 16,
    is_duplicate_suspect: partial.is_duplicate_suspect ?? false,
    billing_status: partial.billing_status ?? "not_ready",
    invoice_id: partial.invoice_id ?? null,
    billed_at: partial.billed_at ?? null,
    billed_by: partial.billed_by ?? null,
    is_void: partial.is_void ?? false,
    voided_at: partial.voided_at ?? null,
    voided_by: partial.voided_by ?? null,
    void_reason: partial.void_reason ?? null,
    weekly_timesheet_id: partial.weekly_timesheet_id ?? null,
    cert_week_start: partial.cert_week_start ?? null,
    created_by: partial.created_by ?? partial.technician_id,
    updated_by: partial.updated_by ?? null,
    locked_at: partial.locked_at ?? null,
    locked_by: partial.locked_by ?? null,
    deleted_at: partial.deleted_at ?? null,
    deleted_by: partial.deleted_by ?? null,
    technician_labor_id: partial.technician_labor_id ?? null,
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
    technician: partial.technician ?? null,
    work_orders: partial.work_orders ?? null,
    customers: partial.customers ?? null,
  };
}

async function loadFallbackEntries(
  supabase: SupabaseClient,
  opts: {
    from: string;
    to: string;
    technicianId?: string;
    workOrderId?: string;
    customerId?: string;
    status?: TimeApprovalStatus | "all";
  },
): Promise<TimeEntry[]> {
  const store = readStore();
  let laborQ = supabase
    .from("technician_labor")
    .select("*, work_orders(id, work_order_number, work_order_type, problem_description, status, billing_status, dispatch_status, customers(id, name, service_address, city, state), equipment(id, name, serial_number))")
    .gte("work_date", opts.from)
    .lte("work_date", opts.to)
    .order("work_date", { ascending: false });

  if (opts.technicianId) laborQ = laborQ.eq("technician_id", opts.technicianId);
  if (opts.workOrderId) laborQ = laborQ.eq("work_order_id", opts.workOrderId);

  let laborRows: TechnicianLabor[] = [];
  const { data, error } = await laborQ;
  if (error) {
    // join may fail — flat
    let flat = supabase
      .from("technician_labor")
      .select("*")
      .gte("work_date", opts.from)
      .lte("work_date", opts.to);
    if (opts.technicianId) flat = flat.eq("technician_id", opts.technicianId);
    if (opts.workOrderId) flat = flat.eq("work_order_id", opts.workOrderId);
    const { data: rows, error: flatErr } = await flat;
    if (flatErr) throw new Error(supabaseErrorMessage(flatErr));
    laborRows = (rows as TechnicianLabor[]) ?? [];
  } else {
    laborRows = (data as TechnicianLabor[]) ?? [];
  }

  const fromLabor = laborRows
    .map((row) => laborToEntry(row as TechnicianLabor & { work_orders?: TimeEntry["work_orders"] }, store.meta[row.id]))
    .filter((e) => !e.deleted_at);

  // Local-only entries (active clocks, manual non-job, seed-like extras)
  const localOnly = store.entries.filter((e) => {
    if (e.deleted_at) return false;
    if (e.technician_labor_id && fromLabor.some((l) => l.technician_labor_id === e.technician_labor_id)) {
      return false;
    }
    if (e.entry_date < opts.from || e.entry_date > opts.to) return false;
    if (opts.technicianId && e.technician_id !== opts.technicianId) return false;
    if (opts.workOrderId && e.work_order_id !== opts.workOrderId) return false;
    return true;
  });

  // Active WO clocks not yet closed
  const { data: openJobs } = await supabase
    .from("work_orders")
    .select(
      "id, work_order_number, work_order_type, problem_description, assigned_technician_id, started_at, customer_id, equipment_id, customers(id, name, service_address, city, state), equipment(id, name, serial_number)",
    )
    .not("started_at", "is", null)
    .in("status", ["In Progress", "Scheduled", "Dispatched", "On Hold", "Open"]);

  const activeFromJobs: TimeEntry[] = [];
  for (const wo of (openJobs as Array<Record<string, unknown>>) ?? []) {
    const techId = String(wo.assigned_technician_id ?? "");
    if (!techId || !wo.started_at) continue;
    if (opts.technicianId && techId !== opts.technicianId) continue;
    if (opts.workOrderId && wo.id !== opts.workOrderId) continue;
    // Skip if we already have active store entry for this WO/tech
    const hasActive =
      localOnly.some(
        (e) =>
          e.approval_status === "active" &&
          e.technician_id === techId &&
          e.work_order_id === wo.id,
      ) ||
      store.entries.some(
        (e) =>
          e.approval_status === "active" &&
          e.technician_id === techId &&
          e.work_order_id === wo.id &&
          !e.deleted_at,
      );
    if (hasActive) continue;
    const startIso = String(wo.started_at);
    const entryDate = format(parseISO(startIso), "yyyy-MM-dd");
    if (entryDate < opts.from || entryDate > opts.to) {
      // still show if currently active this week boundary soft keep
      if (entryDate > opts.to) continue;
    }
    const customers = wo.customers as TimeEntry["customers"];
    activeFromJobs.push(
      blankEntry({
        id: `active-wo-${wo.id}-${techId}`,
        technician_id: techId,
        work_order_id: String(wo.id),
        customer_id: (wo.customer_id as string) ?? null,
        equipment_id: (wo.equipment_id as string) ?? null,
        entry_date: entryDate,
        clock_in_at: startIso,
        approval_status: "active",
        activity_type: "regular_work",
        notes: "Open field clock (work order In Progress)",
        work_orders: {
          id: String(wo.id),
          work_order_number: (wo.work_order_number as string) ?? null,
          work_order_type: (wo.work_order_type as string) ?? null,
          problem_description: (wo.problem_description as string) ?? null,
          customers: customers as TimeEntry["work_orders"] extends { customers?: infer C } ? C : null,
          equipment: (wo.equipment as TimeEntry["work_orders"] extends { equipment?: infer E } ? E : null) ?? null,
        },
      }),
    );
  }

  let all = [...fromLabor, ...localOnly, ...activeFromJobs];

  // Seed a few demo rows into local store once so managers always see data
  if (all.length === 0 && typeof window !== "undefined") {
    const seeded = ensureDemoSeed(store, opts.from, opts.to, opts.technicianId);
    if (seeded.length) {
      writeStore(store);
      all = [...all, ...seeded];
    }
  }

  if (opts.status && opts.status !== "all") {
    all = all.filter((e) => e.approval_status === opts.status);
  }
  if (opts.customerId) {
    all = all.filter(
      (e) =>
        e.customer_id === opts.customerId ||
        e.work_orders?.customers?.id === opts.customerId,
    );
  }

  return all.sort((a, b) => {
    if (a.entry_date !== b.entry_date) return b.entry_date.localeCompare(a.entry_date);
    return (b.clock_in_at ?? "").localeCompare(a.clock_in_at ?? "");
  });
}

function ensureDemoSeed(
  store: FallbackStore,
  from: string,
  to: string,
  technicianId?: string,
): TimeEntry[] {
  if (store.entries.some((e) => e.notes?.startsWith("[CTRL-SEED]") || e.notes?.startsWith("[DEMO]"))) {
    return [];
  }
  const today = todayIso();
  if (today < from || today > to) return [];

  const tech = technicianId ?? "demo-tech";
  const mgr = "demo-manager";
  const week = weekContaining(today);
  const yesterday = format(addDays(parseISO(today), -1), "yyyy-MM-dd");
  const twoDays = format(addDays(parseISO(today), -2), "yyyy-MM-dd");

  // Seeded scenarios for control demos
  const demo: TimeEntry[] = [
    blankEntry({
      technician_id: tech,
      entry_date: yesterday,
      clock_in_at: `${yesterday}T08:00:00.000Z`,
      clock_out_at: `${yesterday}T16:00:00.000Z`,
      total_minutes: 480,
      regular_hours: 8,
      activity_type: "regular_work",
      notes: "[CTRL-SEED] Normal approved job PM",
      approval_status: "approved",
      approved_by: mgr,
      approved_at: `${yesterday}T18:00:00.000Z`,
      billing_status: "ready_to_bill",
      customer_id: "seed-customer",
      work_order_id: "seed-wo-approved",
      labor_cost: 360,
      billable_amount: 760,
    }),
    blankEntry({
      technician_id: tech,
      entry_date: today,
      clock_in_at: `${today}T13:00:00.000Z`,
      clock_out_at: `${today}T14:00:00.000Z`,
      total_minutes: 60,
      regular_hours: 1,
      activity_type: "shop",
      billable_status: "nonbillable",
      notes: "[CTRL-SEED] Manual missed punch",
      is_manual: true,
      manual_entry_reason: "Forgot to clock non-job shop time",
      approval_status: "pending_approval",
      labor_cost: 45,
      billable_amount: 0,
      billing_status: "not_ready",
    }),
    blankEntry({
      technician_id: tech,
      entry_date: yesterday,
      clock_in_at: `${yesterday}T15:30:00.000Z`,
      clock_out_at: `${yesterday}T17:00:00.000Z`,
      total_minutes: 90,
      regular_hours: 1.5,
      activity_type: "travel",
      notes: "[CTRL-SEED] Overlap conflict sample (flagged)",
      approval_status: "pending_approval",
      is_duplicate_suspect: false,
      labor_cost: 67.5,
      billable_amount: 142.5,
      exception_flags: ["overlap"],
      exception_severity: "critical",
    }),
    blankEntry({
      id: "seed-missing-clockout",
      technician_id: tech,
      entry_date: twoDays,
      clock_in_at: `${twoDays}T07:00:00.000Z`,
      clock_out_at: null,
      total_minutes: 0,
      activity_type: "regular_work",
      notes: "[CTRL-SEED] Missing clock-out open >16h",
      approval_status: "missing_clock_out",
      work_order_id: "seed-wo-open",
      billing_status: "not_ready",
    }),
    blankEntry({
      technician_id: tech,
      entry_date: format(addDays(parseISO(today), -3), "yyyy-MM-dd"),
      clock_in_at: `${format(addDays(parseISO(today), -3), "yyyy-MM-dd")}T06:00:00.000Z`,
      clock_out_at: `${format(addDays(parseISO(today), -3), "yyyy-MM-dd")}T23:30:00.000Z`,
      total_minutes: 1050,
      regular_hours: 16,
      overtime_hours: 1.5,
      activity_type: "regular_work",
      notes: "[CTRL-SEED] Unusually long shift (>16h) for review",
      approval_status: "pending_approval",
      duration_flag_12h: true,
      duration_flag_16h: true,
      labor_cost: 787.5,
      billable_amount: 1662.5,
    }),
    blankEntry({
      technician_id: tech,
      entry_date: format(addDays(parseISO(today), -4), "yyyy-MM-dd"),
      clock_in_at: `${format(addDays(parseISO(today), -4), "yyyy-MM-dd")}T09:00:00.000Z`,
      clock_out_at: `${format(addDays(parseISO(today), -4), "yyyy-MM-dd")}T11:00:00.000Z`,
      total_minutes: 120,
      regular_hours: 2,
      activity_type: "meeting",
      billable_status: "nonbillable",
      notes: "[CTRL-SEED] Rejected training claim",
      approval_status: "rejected",
      rejection_reason: "Time conflicts with published schedule — correct and resubmit.",
      rejected_by: mgr,
      rejected_at: `${format(addDays(parseISO(today), -4), "yyyy-MM-dd")}T16:00:00.000Z`,
      labor_cost: 90,
      billable_amount: 0,
    }),
    blankEntry({
      technician_id: tech,
      entry_date: week.start,
      clock_in_at: `${week.start}T08:00:00.000Z`,
      clock_out_at: `${week.start}T16:00:00.000Z`,
      total_minutes: 480,
      regular_hours: 8,
      activity_type: "regular_work",
      notes: "[CTRL-SEED] Locked weekly certified day",
      approval_status: "locked",
      approved_by: mgr,
      approved_at: `${week.start}T20:00:00.000Z`,
      locked_at: `${week.start}T20:05:00.000Z`,
      locked_by: mgr,
      submitted_at: `${week.start}T19:00:00.000Z`,
      submitted_by: tech,
      billing_status: "ready_to_bill",
      customer_id: "seed-customer",
      work_order_id: "seed-wo-locked",
      labor_cost: 360,
      billable_amount: 760,
    }),
    blankEntry({
      technician_id: tech,
      entry_date: format(addDays(parseISO(week.start), 1), "yyyy-MM-dd"),
      clock_in_at: `${format(addDays(parseISO(week.start), 1), "yyyy-MM-dd")}T08:00:00.000Z`,
      clock_out_at: `${format(addDays(parseISO(week.start), 1), "yyyy-MM-dd")}T12:00:00.000Z`,
      total_minutes: 240,
      regular_hours: 4,
      activity_type: "regular_work",
      notes: "[CTRL-SEED] Reopened after lock",
      approval_status: "pending_approval",
      reopened_at: `${today}T10:00:00.000Z`,
      reopened_by: mgr,
      reopen_reason: "Customer disputed hours — manager reopened for correction.",
      original_clock_in_at: `${format(addDays(parseISO(week.start), 1), "yyyy-MM-dd")}T07:30:00.000Z`,
      original_clock_out_at: `${format(addDays(parseISO(week.start), 1), "yyyy-MM-dd")}T12:00:00.000Z`,
      edit_reason: "Adjusted clock-in after review",
      labor_cost: 180,
      billable_amount: 380,
      work_order_id: "seed-wo-reopen",
      customer_id: "seed-customer",
    }),
    blankEntry({
      technician_id: tech,
      entry_date: today,
      clock_in_at: `${today}T10:00:00.000Z`,
      clock_out_at: `${today}T11:00:00.000Z`,
      total_minutes: 60,
      regular_hours: 1,
      activity_type: "regular_work",
      notes: "[CTRL-SEED] Unassigned tech time — manager override needed",
      approval_status: "pending_approval",
      unassigned_work_order: true,
      requires_manager_assignment_override: true,
      work_order_id: "seed-wo-other-tech",
      customer_id: "seed-customer",
      labor_cost: 45,
      billable_amount: 95,
    }),
    blankEntry({
      technician_id: tech,
      entry_date: format(addDays(parseISO(today), -5), "yyyy-MM-dd"),
      clock_in_at: `${format(addDays(parseISO(today), -5), "yyyy-MM-dd")}T09:00:00.000Z`,
      clock_out_at: `${format(addDays(parseISO(today), -5), "yyyy-MM-dd")}T11:00:00.000Z`,
      total_minutes: 120,
      regular_hours: 2,
      activity_type: "regular_work",
      notes: "[CTRL-SEED] Already billed — cannot re-bill",
      approval_status: "locked",
      approved_by: mgr,
      approved_at: `${format(addDays(parseISO(today), -5), "yyyy-MM-dd")}T18:00:00.000Z`,
      locked_at: `${format(addDays(parseISO(today), -5), "yyyy-MM-dd")}T18:05:00.000Z`,
      billing_status: "billed",
      billed_at: `${format(addDays(parseISO(today), -4), "yyyy-MM-dd")}T12:00:00.000Z`,
      billed_by: mgr,
      invoice_id: "seed-invoice-1",
      customer_id: "seed-customer",
      work_order_id: "seed-wo-billed",
      labor_cost: 90,
      billable_amount: 190,
    }),
    blankEntry({
      technician_id: tech,
      entry_date: yesterday,
      clock_in_at: `${yesterday}T08:00:00.000Z`,
      clock_out_at: `${yesterday}T16:00:00.000Z`,
      total_minutes: 480,
      regular_hours: 8,
      activity_type: "regular_work",
      notes: "[CTRL-SEED] Potential duplicate of approved entry",
      approval_status: "pending_approval",
      is_duplicate_suspect: true,
      work_order_id: "seed-wo-approved",
      customer_id: "seed-customer",
      labor_cost: 360,
      billable_amount: 760,
    }),
    blankEntry({
      technician_id: tech,
      entry_date: format(addDays(parseISO(week.start), 2), "yyyy-MM-dd"),
      clock_in_at: `${format(addDays(parseISO(week.start), 2), "yyyy-MM-dd")}T07:00:00.000Z`,
      clock_out_at: `${format(addDays(parseISO(week.start), 2), "yyyy-MM-dd")}T19:00:00.000Z`,
      total_minutes: 720,
      regular_hours: 8,
      overtime_hours: 4,
      activity_type: "regular_work",
      notes: "[CTRL-SEED] Overtime warning sample (12h day)",
      approval_status: "complete",
      duration_flag_12h: true,
      work_order_id: "seed-wo-ot",
      customer_id: "seed-customer",
      labor_cost: 630,
      billable_amount: 1140,
    }),
    blankEntry({
      technician_id: tech,
      entry_date: format(addDays(parseISO(today), -6), "yyyy-MM-dd"),
      clock_in_at: `${format(addDays(parseISO(today), -6), "yyyy-MM-dd")}T10:00:00.000Z`,
      clock_out_at: `${format(addDays(parseISO(today), -6), "yyyy-MM-dd")}T12:00:00.000Z`,
      total_minutes: 120,
      regular_hours: 2,
      activity_type: "admin_nonbillable",
      billable_status: "nonbillable",
      notes: "[CTRL-SEED] Voided entry preserved",
      approval_status: "approved",
      is_void: true,
      voided_at: `${yesterday}T09:00:00.000Z`,
      voided_by: mgr,
      void_reason: "Incorrect charge code — voided after audit.",
      deleted_at: `${yesterday}T09:00:00.000Z`,
      labor_cost: 90,
      billable_amount: 0,
    }),
  ];

  store.entries.push(...demo.filter((e) => !e.is_void && !e.deleted_at));
  // Keep voided in store with soft-delete flags for audit demo
  store.entries.push(...demo.filter((e) => e.is_void));
  store.weeks.push({
    id: crypto.randomUUID(),
    technician_id: tech,
    week_start: week.start,
    week_end: week.end,
    status: "locked",
    certification_text: CERTIFICATION_TEXT,
    certified_at: `${week.start}T19:00:00.000Z`,
    certified_name: "Demo Technician",
    submitted_at: `${week.start}T19:00:00.000Z`,
    submitted_by: tech,
    manager_id: mgr,
    manager_approved_at: `${week.start}T20:00:00.000Z`,
    locked_at: `${week.start}T20:05:00.000Z`,
    locked_by: mgr,
    return_reason: null,
    returned_at: null,
    returned_by: null,
    created_at: `${week.start}T08:00:00.000Z`,
    updated_at: `${week.start}T20:05:00.000Z`,
  });
  for (const e of demo.slice(0, 5)) {
    appendLocalAudit(store, {
      time_entry_id: e.id,
      action: e.approval_status === "missing_clock_out" ? "clock_in" : "seed",
      actor_id: tech,
      actor_role: "technician",
      detail: e.notes,
      status_after: e.approval_status,
    });
  }
  return demo.filter((e) => !e.is_void);
}

export async function getActiveClock(
  supabase: SupabaseClient,
  technicianId: string,
): Promise<TimeEntry | null> {
  const mode = await resolveMode(supabase);
  if (mode === "time_entries") {
    const trySelect = async (select: string) =>
      supabase
        .from("time_entries")
        .select(select)
        .eq("technician_id", technicianId)
        .in("approval_status", ["active", "missing_clock_out"])
        .is("deleted_at", null)
        .order("clock_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    const flat = await trySelect(ENTRY_SELECT_FLAT);
    if (flat.error) {
      cachedMode = "fallback";
      return getActiveClock(supabase, technicianId);
    }
    if (flat.data) {
      const nested = await trySelect(ENTRY_SELECT_NESTED);
      if (!nested.error && nested.data) return nested.data as unknown as TimeEntry;
      return flat.data as unknown as TimeEntry;
    }
    return null;
  }

  const store = readStore();
  const local = store.entries.find(
    (e) =>
      e.technician_id === technicianId &&
      (e.approval_status === "active" || e.approval_status === "missing_clock_out") &&
      !e.deleted_at &&
      !e.is_void,
  );
  if (local) return local;

  const { data: wo } = await supabase
    .from("work_orders")
    .select(
      "id, work_order_number, work_order_type, problem_description, assigned_technician_id, started_at, customer_id, equipment_id, customers(id, name, service_address, city, state)",
    )
    .eq("assigned_technician_id", technicianId)
    .not("started_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (wo && wo.started_at) {
    return blankEntry({
      id: `active-wo-${wo.id}-${technicianId}`,
      technician_id: technicianId,
      work_order_id: wo.id as string,
      customer_id: (wo.customer_id as string) ?? null,
      equipment_id: (wo.equipment_id as string) ?? null,
      entry_date: format(parseISO(String(wo.started_at)), "yyyy-MM-dd"),
      clock_in_at: String(wo.started_at),
      approval_status: "active",
      notes: "Open field clock",
      work_orders: {
        id: wo.id as string,
        work_order_number: (wo.work_order_number as string) ?? null,
        work_order_type: (wo.work_order_type as string) ?? null,
        problem_description: (wo.problem_description as string) ?? null,
        customers: (normalizeJoin(wo.customers) as TimeEntry["work_orders"] extends {
          customers?: infer C;
        }
          ? C
          : null) ?? null,
        equipment: null,
      },
    });
  }
  return null;
}

export async function loadTimeEntries(
  supabase: SupabaseClient,
  opts: {
    from: string;
    to: string;
    technicianId?: string;
    workOrderId?: string;
    customerId?: string;
    status?: TimeApprovalStatus | "all";
  },
): Promise<TimeEntry[]> {
  const mode = await resolveMode(supabase);
  if (mode === "fallback") {
    return loadFallbackEntries(supabase, opts);
  }

  let q = supabase
    .from("time_entries")
    .select(ENTRY_SELECT_FLAT)
    .is("deleted_at", null)
    .gte("entry_date", opts.from)
    .lte("entry_date", opts.to)
    .order("entry_date", { ascending: false })
    .order("clock_in_at", { ascending: false });
  if (opts.technicianId) q = q.eq("technician_id", opts.technicianId);
  if (opts.workOrderId) q = q.eq("work_order_id", opts.workOrderId);
  if (opts.customerId) q = q.eq("customer_id", opts.customerId);
  if (opts.status && opts.status !== "all") q = q.eq("approval_status", opts.status);

  const { data, error } = await q;
  if (error) {
    if (isTimesheetMissingTable(supabaseErrorMessage(error))) {
      cachedMode = "fallback";
      return loadFallbackEntries(supabase, opts);
    }
    // Don't hard-fail — degrade
    cachedMode = "fallback";
    return loadFallbackEntries(supabase, opts);
  }
  const rows = (data as unknown as TimeEntry[]) ?? [];
  if (!rows.length) {
    // try nested not needed for empty
    return rows;
  }
  const nested = await supabase
    .from("time_entries")
    .select(ENTRY_SELECT_NESTED)
    .is("deleted_at", null)
    .gte("entry_date", opts.from)
    .lte("entry_date", opts.to);
  if (!nested.error && nested.data) {
    let list = nested.data as unknown as TimeEntry[];
    if (opts.technicianId) list = list.filter((e) => e.technician_id === opts.technicianId);
    if (opts.workOrderId) list = list.filter((e) => e.work_order_id === opts.workOrderId);
    if (opts.customerId) list = list.filter((e) => e.customer_id === opts.customerId);
    if (opts.status && opts.status !== "all") {
      list = list.filter((e) => e.approval_status === opts.status);
    }
    return list;
  }
  return rows;
}

export type EntryTotals = {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  billableHours: number;
  nonbillableHours: number;
  laborCost: number;
  billableAmount: number;
  pending: number;
  rejected: number;
  active: number;
};

export function sumEntries(entries: TimeEntry[]): EntryTotals {
  const t: EntryTotals = {
    totalHours: 0,
    regularHours: 0,
    overtimeHours: 0,
    billableHours: 0,
    nonbillableHours: 0,
    laborCost: 0,
    billableAmount: 0,
    pending: 0,
    rejected: 0,
    active: 0,
  };
  for (const e of entries) {
    if (isVoided(e)) continue;
    if (e.approval_status === "rejected") {
      t.rejected += 1;
      continue;
    }
    if (e.approval_status === "active" || e.approval_status === "missing_clock_out") {
      t.active += 1;
      // missing clock-out excluded from payroll hours
      if (e.approval_status === "active" && e.clock_in_at) {
        const live = hoursFromRange(e.clock_in_at, new Date().toISOString());
        t.totalHours = num(t.totalHours + live);
        t.regularHours = num(t.regularHours + live);
      }
      continue;
    }
    if (!includesInPayrollTotals(e) && e.approval_status === "pending_correction") {
      t.pending += 1;
      continue;
    }
    const h = num(e.regular_hours + e.overtime_hours);
    t.totalHours = num(t.totalHours + h);
    t.regularHours = num(t.regularHours + e.regular_hours);
    t.overtimeHours = num(t.overtimeHours + e.overtime_hours);
    t.laborCost = num(t.laborCost + e.labor_cost);
    t.billableAmount = num(t.billableAmount + e.billable_amount);
    if (e.billable_status === "billable") t.billableHours = num(t.billableHours + h);
    else t.nonbillableHours = num(t.nonbillableHours + h);
    if (
      e.approval_status === "pending_approval" ||
      e.approval_status === "pending_correction" ||
      e.approval_status === "submitted"
    ) {
      t.pending += 1;
    }
  }
  return t;
}

/** Job field time from En Route → Done (travel + regular/OT on a work order). */
export function isDispatchJobSegment(entry: TimeEntry): boolean {
  if (!entry.work_order_id) return false;
  return (
    entry.activity_type === "travel" ||
    entry.activity_type === "regular_work" ||
    entry.activity_type === "overtime"
  );
}

/** Hours on WO punches (En Route travel + In Progress work), including live open clocks. */
export function sumDispatchJobHours(entries: TimeEntry[], now = new Date()): number {
  let total = 0;
  for (const e of entries) {
    if (isVoided(e) || e.approval_status === "rejected") continue;
    if (!isDispatchJobSegment(e)) continue;
    if (e.approval_status === "active" || e.approval_status === "missing_clock_out") {
      if (e.clock_in_at) total += hoursFromRange(e.clock_in_at, now.toISOString());
      continue;
    }
    total += Number(e.regular_hours) + Number(e.overtime_hours);
  }
  return num(total);
}

/**
 * Face-clock hours for one timesheet row: clock_out − clock_in
 * (live elapsed while still clocked in).
 */
export function hoursFromEntryClock(entry: TimeEntry, now = new Date()): number {
  if (isVoided(entry) || entry.approval_status === "rejected") return 0;
  if (!entry.clock_in_at) return 0;
  if (entry.clock_out_at) {
    return hoursFromRange(entry.clock_in_at, entry.clock_out_at);
  }
  if (entry.approval_status === "active" || entry.approval_status === "missing_clock_out") {
    return hoursFromRange(entry.clock_in_at, now.toISOString());
  }
  return 0;
}

/** Sum clock-in → clock-out spans on the timesheet face. */
export function sumEntryClockHours(entries: TimeEntry[], now = new Date()): number {
  return num(entries.reduce((sum, e) => sum + hoursFromEntryClock(e, now), 0));
}

/**
 * Today = punches on `dayIso`; Week = sum of those same clock spans for every day in the set
 * (typically the selected week’s entries).
 */
export function sumTodayAndWeekClockHours(
  entries: TimeEntry[],
  dayIso: string,
  now = new Date(),
): { todayHours: number; weekHours: number } {
  const todayEntries = entries.filter((e) => e.entry_date === dayIso);
  return {
    todayHours: sumEntryClockHours(todayEntries, now),
    weekHours: sumEntryClockHours(entries, now),
  };
}

function normalizeJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function locationFromJob(job: {
  customers?: {
    service_address?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
}): string | null {
  const c = job.customers;
  if (!c) return null;
  return [c.service_address, c.city, c.state].filter(Boolean).join(", ") || null;
}

export async function clockIn(
  supabase: SupabaseClient,
  input: {
    profile: Profile;
    workOrderId: string;
    activityType?: TimeActivityType;
    notes?: string;
    /** When true, do not stamp WO started_at / Working (dispatch owns WO fields). */
    skipWorkOrderStamp?: boolean;
  },
): Promise<TimeEntry> {
  const existing = await getActiveClock(supabase, input.profile.id);
  if (existing) {
    const woLabel =
      existing.work_orders?.work_order_number ?? existing.work_order_id ?? "unknown job";
    throw new Error(
      `One active clock-in only. You are already clocked in on ${woLabel} since ${existing.clock_in_at ?? "unknown"}. Clock out or open that entry first.`,
    );
  }

  const otMult = await loadOtMultiplier(supabase);
  const rates = ratesFromProfile(input.profile, otMult);
  const activity = input.activityType ?? "regular_work";
  const now = new Date().toISOString();
  const futureErr = validateNotFuture(now, 5);
  if (futureErr) throw new Error(futureErr);

  const { data: wo, error: woErr } = await supabase
    .from("work_orders")
    .select(
      "id, status, customer_id, equipment_id, work_order_number, work_order_type, problem_description, assigned_technician_id, contract_id, warranty_coverage, outside_contract, under_expired_contract, customers(id, name, service_address, city, state)",
    )
    .eq("id", input.workOrderId)
    .single();
  if (woErr || !wo) throw new Error(woErr?.message ?? "Work order not found.");

  const woStatus = String((wo as { status?: string }).status ?? "");
  if (unauthorizedOpenWorkOrder(woStatus)) {
    throw new Error(
      `Cannot clock in on a ${woStatus || "closed"} work order. Job-related time requires an active authorized work order.`,
    );
  }
  if (!(wo as { customer_id?: string }).customer_id) {
    throw new Error("Work order must have a valid customer before time can be recorded.");
  }

  const coverageJob = {
    contract_id: (wo as { contract_id?: string | null }).contract_id ?? null,
    warranty_coverage: (wo as { warranty_coverage?: string | null }).warranty_coverage ?? "Not Covered",
    outside_contract: Boolean((wo as { outside_contract?: boolean }).outside_contract),
    under_expired_contract: Boolean((wo as { under_expired_contract?: boolean }).under_expired_contract),
    work_order_type: (wo as { work_order_type?: string | null }).work_order_type ?? null,
  };
  const billableOnJob = resolveLaborBillableStatus(
    coverageJob,
    activityDefaultBillable(activity),
  );

  const assignedId = (wo as { assigned_technician_id?: string | null }).assigned_technician_id ?? null;
  const unassigned = Boolean(assignedId && assignedId !== input.profile.id);
  // if no assignment, allow but flag manager override
  const needsOverride = !assignedId || unassigned;

  const loc = locationFromJob(
    wo as {
      customers?: {
        service_address?: string | null;
        city?: string | null;
        state?: string | null;
      } | null;
    },
  );

  // Always stamp WO (required for dispatch / fallback active clock) unless dispatch owns the transition
  if (!input.skipWorkOrderStamp) {
    await supabase
      .from("work_orders")
      .update({
        started_at: now,
        dispatch_status: "Working",
        status: "In Progress",
        dispatch_updated_at: now,
        updated_at: now,
        assigned_technician_id: input.profile.id,
      })
      .eq("id", input.workOrderId);
  }

  const mode = await resolveMode(supabase);
  if (mode === "time_entries") {
    const { data, error } = await supabase
      .from("time_entries")
      .insert({
        technician_id: input.profile.id,
        work_order_id: input.workOrderId,
        customer_id: (wo as { customer_id: string }).customer_id,
        equipment_id: (wo as { equipment_id: string | null }).equipment_id,
        service_location: loc,
        entry_date: todayIso(),
        clock_in_at: now,
        clock_out_at: null,
        total_minutes: 0,
        activity_type: activity,
        billable_status: billableOnJob,
        regular_hours: 0,
        overtime_hours: 0,
        hourly_cost_rate: rates.hourly_cost_rate,
        overtime_cost_rate: rates.overtime_cost_rate,
        billing_rate: rates.billing_rate,
        labor_cost: 0,
        billable_amount: 0,
        notes: input.notes ?? null,
        is_manual: false,
        approval_status: "active",
        unassigned_work_order: needsOverride,
        requires_manager_assignment_override: needsOverride,
        billing_status: "not_ready",
        created_by: input.profile.id,
        updated_by: input.profile.id,
      })
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (error) {
      if (isTimesheetMissingTable(supabaseErrorMessage(error))) {
        cachedMode = "fallback";
      } else {
        cachedMode = "fallback";
      }
    } else {
      await writeAudit(supabase, (data as TimeEntry).id, "clock_in", input.profile.id, undefined, {
        actorRole: input.profile.role,
        workOrderId: input.workOrderId,
        statusAfter: "active",
      });
      return data as unknown as TimeEntry;
    }
  }

  const entry = blankEntry({
    technician_id: input.profile.id,
    work_order_id: input.workOrderId,
    customer_id: (wo as { customer_id: string }).customer_id,
    equipment_id: (wo as { equipment_id: string | null }).equipment_id,
    service_location: loc,
    entry_date: todayIso(),
    clock_in_at: now,
    activity_type: activity,
    billable_status: billableOnJob,
    hourly_cost_rate: rates.hourly_cost_rate,
    overtime_cost_rate: rates.overtime_cost_rate,
    billing_rate: rates.billing_rate,
    notes: input.notes ?? "Field clock-in",
    approval_status: "active",
    unassigned_work_order: needsOverride,
    requires_manager_assignment_override: needsOverride,
    billing_status: "not_ready",
    created_by: input.profile.id,
    work_orders: {
      id: input.workOrderId,
      work_order_number: (wo as { work_order_number?: string }).work_order_number ?? null,
      work_order_type: (wo as { work_order_type?: string }).work_order_type ?? null,
      problem_description: (wo as { problem_description?: string }).problem_description ?? null,
      status: woStatus,
      customers: normalizeJoin(
        (wo as { customers?: unknown }).customers,
      ) as TimeEntry["work_orders"] extends { customers?: infer C } ? C | null : null,
      equipment: null,
    },
  });

  const store = readStore();
  store.entries = store.entries.filter(
    (e) => !(e.technician_id === input.profile.id && e.approval_status === "active"),
  );
  store.entries.push(entry);
  appendLocalAudit(store, {
    time_entry_id: entry.id,
    action: "clock_in",
    actor_id: input.profile.id,
    actor_role: input.profile.role,
    status_after: "active",
  });
  writeStore(store);
  return entry;
}

async function insertLaborMirror(
  supabase: SupabaseClient,
  entry: TimeEntry,
): Promise<string | null> {
  if (!entry.work_order_id) return null;
  const h = num(entry.regular_hours + entry.overtime_hours);
  if (h <= 0) return null;
  const start = entry.clock_in_at ? format(parseISO(entry.clock_in_at), "HH:mm:ss") : null;
  const end = entry.clock_out_at ? format(parseISO(entry.clock_out_at), "HH:mm:ss") : null;
  const base = {
    work_order_id: entry.work_order_id,
    technician_id: entry.technician_id,
    work_date: entry.entry_date,
    start_time: start,
    end_time: end,
    regular_hours: entry.regular_hours,
    overtime_hours: entry.overtime_hours,
    hourly_cost_rate: entry.hourly_cost_rate,
    overtime_cost_rate: entry.overtime_cost_rate,
    customer_billing_rate: entry.billing_rate,
    billable_status:
      entry.billable_status === "contract_included"
        ? "Contract Included"
        : entry.billable_status === "nonbillable"
          ? "Non-Billable"
          : "Billable",
    invoiced: entry.billing_status === "billed",
    notes: `${ACTIVITY_LABELS[entry.activity_type]}${entry.notes ? ` — ${entry.notes}` : ""}`,
  };
  const withGate = {
    ...base,
    approval_gated: !["approved", "locked"].includes(entry.approval_status),
  };

  if (entry.technician_labor_id && !entry.technician_labor_id.startsWith("demo")) {
    let { error } = await supabase
      .from("technician_labor")
      .update(withGate)
      .eq("id", entry.technician_labor_id);
    if (error) {
      await supabase.from("technician_labor").update(base).eq("id", entry.technician_labor_id);
    }
    return entry.technician_labor_id;
  }
  let { data, error } = await supabase.from("technician_labor").insert(withGate).select("id").single();
  if (error) {
    const retry = await supabase.from("technician_labor").insert(base).select("id").single();
    data = retry.data;
    error = retry.error;
  }
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function clockOut(
  supabase: SupabaseClient,
  input: {
    profile: Profile;
    entryId?: string;
    notes?: string;
    /** When true, do not set WO dispatch_status to Completed (dispatch owns WO fields). */
    skipWorkOrderDispatchUpdate?: boolean;
  },
): Promise<TimeEntry> {
  let entry =
    input.entryId
      ? (await loadTimeEntries(supabase, {
          from: format(addDays(new Date(), -14), "yyyy-MM-dd"),
          to: todayIso(),
          technicianId: input.profile.id,
        })).find((e) => e.id === input.entryId)
      : await getActiveClock(supabase, input.profile.id);

  if (!entry || entry.approval_status !== "active") {
    throw new Error("No active clock-in found. Clock in before clocking out.");
  }
  if (entry.technician_id !== input.profile.id) {
    if (!["administrator", "service_manager"].includes(input.profile.role)) {
      throw new Error("You can only clock out your own time.");
    }
  }
  if (!entry.clock_in_at) throw new Error("Clock-in timestamp missing.");

  const now = new Date().toISOString();
  const duration = validateDuration(entry.clock_in_at, now);
  if (!duration.ok) throw new Error(duration.error);
  const totalH = hoursFromRange(entry.clock_in_at, now);

  const overlaps = await findOverlapping(
    supabase,
    entry.technician_id,
    entry.clock_in_at,
    now,
    entry.id,
  );
  if (overlaps.length) {
    const c = overlaps[0];
    throw new Error(
      `Overlapping time blocked. Conflicts with entry on ${c.entry_date} (${c.clock_in_at}–${c.clock_out_at ?? "open"}). Correct one of the entries first.`,
    );
  }

  const week = weekContaining(entry.entry_date);
  const prior = await sumPriorWeekRegular(
    supabase,
    entry.technician_id,
    week.start,
    week.end,
    entry.id,
  );
  const split = splitWeeklyOt(totalH, prior);
  const moneyPart = computeMoney(
    split.regular_hours,
    split.overtime_hours,
    entry.hourly_cost_rate,
    entry.overtime_cost_rate,
    entry.billing_rate,
    entry.billable_status,
    false,
    1.5,
  );

  const patch: Partial<TimeEntry> = {
    clock_out_at: now,
    total_minutes: minutesFromRange(entry.clock_in_at, now),
    regular_hours: split.regular_hours,
    overtime_hours: split.overtime_hours,
    labor_cost: moneyPart.labor_cost,
    billable_amount: moneyPart.billable_amount,
    notes: input.notes?.trim() || entry.notes,
    approval_status: duration.flag16h ? "pending_approval" : "complete",
    duration_flag_12h: Boolean(duration.warn12h),
    duration_flag_16h: Boolean(duration.flag16h),
    billing_status: "not_ready",
    updated_by: input.profile.id,
    updated_at: now,
  };

  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entry.id.startsWith("active-wo-") && !entry.id.startsWith("labor-")) {
    const { data, error } = await supabase
      .from("time_entries")
      .update(patch)
      .eq("id", entry.id)
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (!error && data) {
      let next = data as unknown as TimeEntry;
      const laborId = await insertLaborMirror(supabase, { ...next, ...patch } as TimeEntry);
      if (laborId) {
        await supabase.from("time_entries").update({ technician_labor_id: laborId }).eq("id", next.id);
        next = { ...next, technician_labor_id: laborId };
      }
      await writeAudit(supabase, next.id, "clock_out", input.profile.id, `${formatHours(totalH)}h`);
      return next;
    }
    cachedMode = "fallback";
  }

  const completed = blankEntry({
    ...entry,
    ...patch,
    id: entry.id.startsWith("active-wo-") ? crypto.randomUUID() : entry.id,
  });
  const laborId = await insertLaborMirror(supabase, completed);
  if (laborId) completed.technician_labor_id = laborId;

  // Clear WO open clock (unless dispatch transition owns WO fields)
  if (entry.work_order_id && !input.skipWorkOrderDispatchUpdate) {
    await supabase
      .from("work_orders")
      .update({
        // keep started_at history but clear “open labor” by using dispatch Completed labor flag
        dispatch_status: "Completed",
        dispatch_updated_at: now,
        updated_at: now,
      })
      .eq("id", entry.work_order_id);
  }

  const store = readStore();
  store.entries = store.entries.filter((e) => e.id !== entry!.id && e.id !== completed.id);
  store.entries.push(completed);
  if (laborId) {
    store.meta[laborId] = {
      approval_status: "complete",
      activity_type: completed.activity_type,
    };
  }
  writeStore(store);
  return completed;
}

/** Clock out the tech's active entry if any; no-op when already clocked out. */
export async function clockOutIfActive(
  supabase: SupabaseClient,
  input: {
    profile: Profile;
    notes?: string;
    skipWorkOrderDispatchUpdate?: boolean;
  },
): Promise<TimeEntry | null> {
  const active = await getActiveClock(supabase, input.profile.id);
  if (!active || active.approval_status !== "active") return null;
  return clockOut(supabase, {
    profile: input.profile,
    entryId: active.id,
    notes: input.notes,
    skipWorkOrderDispatchUpdate: input.skipWorkOrderDispatchUpdate ?? true,
  });
}

export type DispatchFlowStatus =
  | "Not Started"
  | "En Route"
  | "In Progress"
  | "Ready for Review"
  | "Done"
  | "Paused";

function activityForDispatchStatus(status: DispatchFlowStatus): TimeActivityType | null {
  if (status === "En Route") return "travel";
  if (status === "In Progress") return "regular_work";
  return null;
}

function dbDispatchStatus(status: DispatchFlowStatus): string {
  if (status === "In Progress") return "Working";
  return status;
}

/**
 * Advance/back a dispatch step: close any open timesheet segment, update WO,
 * and open a new segment for En Route (travel) or In Progress (regular_work).
 * Done → Completed + Unbilled so billing can invoice.
 */
export async function applyDispatchStatusTransition(
  supabase: SupabaseClient,
  input: {
    profile: Profile;
    workOrderId: string;
    workOrderNumber?: string;
    nextStatus: DispatchFlowStatus;
  },
): Promise<{ dispatchStatus: string; message: string | null }> {
  // Close any open punch first (best-effort — never block status advance).
  try {
    await clockOutIfActive(supabase, {
      profile: input.profile,
      notes: `Dispatch → ${input.nextStatus}`,
      skipWorkOrderDispatchUpdate: true,
    });
  } catch (err) {
    // Force-close stuck DB active clocks so En Route can proceed.
    const active = await getActiveClock(supabase, input.profile.id);
    if (active && !active.id.startsWith("active-wo-") && !active.id.startsWith("labor-")) {
      const nowIso = new Date().toISOString();
      await supabase
        .from("time_entries")
        .update({
          clock_out_at: nowIso,
          approval_status: "complete",
          notes: active.notes ?? `Force-closed for dispatch → ${input.nextStatus}`,
          updated_at: nowIso,
          updated_by: input.profile.id,
        })
        .eq("id", active.id)
        .eq("approval_status", "active");
    } else {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  const now = new Date().toISOString();
  const dbStatus = dbDispatchStatus(input.nextStatus);
  const updates: Record<string, unknown> = {
    dispatch_status: dbStatus,
    dispatch_updated_at: now,
    updated_at: now,
  };

  if (input.nextStatus === "In Progress" || input.nextStatus === "Paused") {
    updates.status = "In Progress";
    if (input.nextStatus === "In Progress") {
      updates.started_at = now;
      updates.paused_at = null;
      updates.dispatch_status = "Working";
    } else {
      updates.paused_at = now;
    }
  } else if (input.nextStatus === "Ready for Review") {
    updates.status = "Ready for Review";
  } else if (input.nextStatus === "Done") {
    updates.status = "Completed";
    const { data: woBilling } = await supabase
      .from("work_orders")
      .select("billing_status")
      .eq("id", input.workOrderId)
      .maybeSingle();
    const billed = (woBilling as { billing_status?: string } | null)?.billing_status === "Billed";
    if (!billed) updates.billing_status = "Unbilled";
  }

  const { error: updateError } = await supabase
    .from("work_orders")
    .update(updates)
    .eq("id", input.workOrderId);
  if (updateError) throw new Error(updateError.message);

  const activity = activityForDispatchStatus(input.nextStatus);
  let timeWarning: string | null = null;
  if (activity) {
    try {
      await clockIn(supabase, {
        profile: input.profile,
        workOrderId: input.workOrderId,
        activityType: activity,
        notes: `Dispatch: ${input.nextStatus}`,
        skipWorkOrderStamp: true,
      });
    } catch (err) {
      timeWarning = err instanceof Error ? err.message : String(err);
    }
  }

  const label = input.workOrderNumber ?? "Job";
  const baseMessage =
    input.nextStatus === "Done"
      ? `${label} marked complete — available for billing.`
      : `${label} → ${input.nextStatus === "In Progress" ? "In Progress" : dbStatus}`;

  return {
    dispatchStatus: dbStatus,
    message: timeWarning ? `${baseMessage} (time punch issue: ${timeWarning})` : baseMessage,
  };
}

/**
 * After a job is Completed/Unbilled, promote its billable time punches out of Not Ready
 * so the timesheet Billing column can show Create Invoice.
 */
export async function markWorkOrderTimeReadyToBill(
  supabase: SupabaseClient,
  workOrderId: string,
  actorId?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const mode = await resolveMode(supabase);
  if (mode !== "time_entries") return;
  await supabase
    .from("time_entries")
    .update({
      billing_status: "ready_to_bill",
      updated_at: now,
      ...(actorId ? { updated_by: actorId } : {}),
    })
    .eq("work_order_id", workOrderId)
    .eq("billing_status", "not_ready")
    .eq("billable_status", "billable")
    .is("deleted_at", null);
}

export async function createManualEntry(
  supabase: SupabaseClient,
  input: {
    profile: Profile;
    technicianId?: string;
    workOrderId: string | null;
    customerId?: string | null;
    entryDate: string;
    clockInLocal: string;
    clockOutLocal: string;
    activityType: TimeActivityType;
    notes: string;
    reason: string;
    billableStatus?: TimeBillableStatus;
  },
): Promise<TimeEntry> {
  const techId = input.technicianId ?? input.profile.id;
  if (
    techId !== input.profile.id &&
    !["administrator", "service_manager"].includes(input.profile.role)
  ) {
    throw new Error("Not allowed to enter time for another technician.");
  }
  if (!input.reason.trim() || input.reason.trim().length < 3) {
    throw new Error("Manual entries require a short reason.");
  }
  if (jobRequiredForActivity(input.activityType) && !input.workOrderId) {
    throw new Error("Job-related categories require a work order.");
  }
  if (!jobRequiredForActivity(input.activityType) && !input.notes.trim()) {
    throw new Error("Non-job time requires a short explanation in notes.");
  }

  const futureErr = validateNotFuture(input.clockInLocal, 5);
  if (futureErr) throw new Error(futureErr);
  if (parseISO(input.clockInLocal).getTime() > Date.now() + 60_000) {
    throw new Error("Future time entries are not allowed.");
  }
  if (parseISO(input.clockOutLocal).getTime() > Date.now() + 60_000) {
    throw new Error("Future clock-out times are not allowed.");
  }

  const duration = validateDuration(input.clockInLocal, input.clockOutLocal);
  if (!duration.ok) throw new Error(duration.error);

  const totalH = hoursFromRange(input.clockInLocal, input.clockOutLocal);

  const overlaps = await findOverlapping(supabase, techId, input.clockInLocal, input.clockOutLocal);
  if (overlaps.length) {
    const c = overlaps[0];
    throw new Error(
      `Overlapping time blocked. Conflicts with entry on ${c.entry_date} starting ${c.clock_in_at ? format(parseISO(c.clock_in_at), "MMM d h:mm a") : "?"}. Correct one of the entries.`,
    );
  }

  // Duplicate + prior entries for tech on same date
  const dayEntries = await loadTimeEntries(supabase, {
    from: input.entryDate,
    to: input.entryDate,
    technicianId: techId,
  });
  const exact = isExactDuplicate(
    {
      technicianId: techId,
      entryDate: input.entryDate,
      clockIn: input.clockInLocal,
      clockOut: input.clockOutLocal,
      workOrderId: input.workOrderId,
      activityType: input.activityType,
    },
    dayEntries,
  );
  if (exact) {
    throw new Error(
      `Exact duplicate blocked (same technician, date, start, end, work order, and activity as ${exact.id.slice(0, 8)}…).`,
    );
  }

  let customerId = input.customerId ?? null;
  let equipmentId: string | null = null;
  let serviceLocation: string | null = null;
  let woJoin: TimeEntry["work_orders"] = null;
  let unassigned = false;
  let coverageJob: CoverageJob | null = null;
  if (input.workOrderId) {
    const { data: wo } = await supabase
      .from("work_orders")
      .select(
        "id, status, customer_id, equipment_id, assigned_technician_id, work_order_number, work_order_type, problem_description, contract_id, warranty_coverage, outside_contract, under_expired_contract, customers(id, name, service_address, city, state), equipment(id, name, serial_number)",
      )
      .eq("id", input.workOrderId)
      .single();
    if (!wo) throw new Error("Work order not found.");
    const st = String((wo as { status?: string }).status ?? "");
    if (unauthorizedOpenWorkOrder(st)) {
      throw new Error(`Cannot record time against a ${st} work order.`);
    }
    customerId = (wo as { customer_id: string }).customer_id;
    if (!customerId) throw new Error("Work order must have a valid customer.");
    equipmentId = (wo as { equipment_id: string | null }).equipment_id;
    serviceLocation = locationFromJob(
      wo as {
        customers?: {
          service_address?: string | null;
          city?: string | null;
          state?: string | null;
        } | null;
      },
    );
    woJoin = wo as unknown as TimeEntry["work_orders"];
    const assigned = (wo as { assigned_technician_id?: string | null }).assigned_technician_id;
    unassigned = !assigned || assigned !== techId;
    coverageJob = {
      contract_id: (wo as { contract_id?: string | null }).contract_id ?? null,
      warranty_coverage:
        (wo as { warranty_coverage?: string | null }).warranty_coverage ?? "Not Covered",
      outside_contract: Boolean((wo as { outside_contract?: boolean }).outside_contract),
      under_expired_contract: Boolean(
        (wo as { under_expired_contract?: boolean }).under_expired_contract,
      ),
      work_order_type: (wo as { work_order_type?: string | null }).work_order_type ?? null,
    };
  }

  const otMult = await loadOtMultiplier(supabase);
  let rates = ratesFromProfile(input.profile, otMult);
  if (techId !== input.profile.id) {
    const { data: tp } = await supabase.from("profiles").select("*").eq("id", techId).single();
    if (tp) rates = ratesFromProfile(tp as Profile, otMult);
  }

  const week = weekContaining(input.entryDate);
  const prior = await sumPriorWeekRegular(supabase, techId, week.start, week.end);
  const split = splitWeeklyOt(totalH, prior);
  const billable =
    input.billableStatus ??
    resolveLaborBillableStatus(coverageJob, activityDefaultBillable(input.activityType));
  const moneyPart = computeMoney(
    split.regular_hours,
    split.overtime_hours,
    rates.hourly_cost_rate,
    rates.overtime_cost_rate,
    rates.billing_rate,
    billable,
    false,
    otMult,
  );

  const entry = blankEntry({
    technician_id: techId,
    work_order_id: input.workOrderId,
    customer_id: customerId,
    equipment_id: equipmentId,
    service_location: serviceLocation,
    entry_date: input.entryDate,
    clock_in_at: input.clockInLocal,
    clock_out_at: input.clockOutLocal,
    total_minutes: minutesFromRange(input.clockInLocal, input.clockOutLocal),
    activity_type: input.activityType,
    billable_status: billable,
    regular_hours: split.regular_hours,
    overtime_hours: split.overtime_hours,
    hourly_cost_rate: rates.hourly_cost_rate,
    overtime_cost_rate: rates.overtime_cost_rate,
    billing_rate: rates.billing_rate,
    labor_cost: moneyPart.labor_cost,
    billable_amount: moneyPart.billable_amount,
    notes: input.notes.trim() || null,
    manual_entry_reason: input.reason.trim(),
    is_manual: true,
    approval_status: "pending_approval",
    duration_flag_12h: Boolean(duration.warn12h),
    duration_flag_16h: Boolean(duration.flag16h),
    unassigned_work_order: unassigned,
    requires_manager_assignment_override: unassigned,
    billing_status: billable === "nonbillable" ? "nonbillable" : "not_ready",
    original_clock_in_at: input.clockInLocal,
    original_clock_out_at: input.clockOutLocal,
    original_values: {
      clock_in_at: input.clockInLocal,
      clock_out_at: input.clockOutLocal,
      activity_type: input.activityType,
      notes: input.notes.trim() || null,
      regular_hours: split.regular_hours,
      overtime_hours: split.overtime_hours,
    },
    created_by: input.profile.id,
    work_orders: woJoin,
  });

  const mode = await resolveMode(supabase);
  if (mode === "time_entries") {
    const { data, error } = await supabase
      .from("time_entries")
      .insert({
        technician_id: entry.technician_id,
        work_order_id: entry.work_order_id,
        customer_id: entry.customer_id,
        equipment_id: entry.equipment_id,
        service_location: entry.service_location,
        entry_date: entry.entry_date,
        clock_in_at: entry.clock_in_at,
        clock_out_at: entry.clock_out_at,
        total_minutes: entry.total_minutes,
        activity_type: entry.activity_type,
        billable_status: entry.billable_status,
        regular_hours: entry.regular_hours,
        overtime_hours: entry.overtime_hours,
        hourly_cost_rate: entry.hourly_cost_rate,
        overtime_cost_rate: entry.overtime_cost_rate,
        billing_rate: entry.billing_rate,
        labor_cost: entry.labor_cost,
        billable_amount: entry.billable_amount,
        notes: entry.notes,
        manual_entry_reason: entry.manual_entry_reason,
        is_manual: true,
        approval_status: "pending_approval",
        created_by: input.profile.id,
        updated_by: input.profile.id,
      })
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (!error && data) {
      await writeAudit(supabase, (data as TimeEntry).id, "manual_create", input.profile.id, input.reason);
      return data as unknown as TimeEntry;
    }
    cachedMode = "fallback";
  }

  // Fallback: write job time to technician_labor + pending meta; non-job local only
  if (entry.work_order_id) {
    const laborId = await insertLaborMirror(supabase, { ...entry, approval_status: "complete" });
    if (laborId) {
      entry.technician_labor_id = laborId;
      entry.id = `labor-${laborId}`;
      const store = readStore();
      store.meta[laborId] = {
        approval_status: "pending_approval",
        is_manual: true,
        manual_entry_reason: input.reason.trim(),
        activity_type: input.activityType,
      };
      writeStore(store);
      return entry;
    }
  }

  const store = readStore();
  store.entries.push(entry);
  writeStore(store);
  return entry;
}

function updateFallbackEntry(
  entryId: string,
  mutator: (e: TimeEntry) => TimeEntry,
): TimeEntry {
  const store = readStore();
  const idx = store.entries.findIndex((e) => e.id === entryId);
  if (idx >= 0) {
    const before = store.entries[idx];
    const next = mutator(store.entries[idx]);
    store.entries[idx] = next;
    appendLocalAudit(store, {
      time_entry_id: entryId,
      action: "update",
      actor_id: next.updated_by,
      status_before: before.approval_status,
      status_after: next.approval_status,
      reason: next.rejection_reason || next.reopen_reason || next.edit_reason || null,
      original_values: next.original_values ?? null,
      revised_values: next.revised_values ?? null,
    });
    writeStore(store);
    return next;
  }
  if (entryId.startsWith("labor-")) {
    const laborId = entryId.replace(/^labor-/, "");
    const meta = store.meta[laborId] ?? {};
    const nextMeta = { ...meta };
    const dummy = blankEntry({
      id: entryId,
      technician_id: "unknown",
      entry_date: todayIso(),
      technician_labor_id: laborId,
      approval_status: (meta.approval_status as TimeApprovalStatus) ?? "complete",
      rejection_reason: meta.rejection_reason ?? null,
      approved_by: meta.approved_by ?? null,
      approved_at: meta.approved_at ?? null,
      locked_at: meta.locked_at ?? null,
      locked_by: meta.locked_by ?? null,
      is_manual: meta.is_manual,
      manual_entry_reason: meta.manual_entry_reason ?? null,
      billing_status: meta.billing_status,
      original_clock_in_at: meta.original_clock_in_at,
      original_clock_out_at: meta.original_clock_out_at,
    });
    const updated = mutator(dummy);
    nextMeta.approval_status = updated.approval_status;
    nextMeta.rejection_reason = updated.rejection_reason;
    nextMeta.approved_by = updated.approved_by;
    nextMeta.approved_at = updated.approved_at;
    nextMeta.rejected_at = updated.rejected_at;
    nextMeta.rejected_by = updated.rejected_by;
    nextMeta.locked_at = updated.locked_at;
    nextMeta.locked_by = updated.locked_by;
    nextMeta.is_manual = updated.is_manual;
    nextMeta.manual_entry_reason = updated.manual_entry_reason;
    nextMeta.reopened_at = updated.reopened_at;
    nextMeta.reopened_by = updated.reopened_by;
    nextMeta.reopen_reason = updated.reopen_reason;
    nextMeta.edit_reason = updated.edit_reason;
    nextMeta.original_clock_in_at = updated.original_clock_in_at;
    nextMeta.original_clock_out_at = updated.original_clock_out_at;
    nextMeta.billing_status = updated.billing_status;
    nextMeta.submitted_at = updated.submitted_at;
    nextMeta.submitted_by = updated.submitted_by;
    nextMeta.is_void = updated.is_void;
    nextMeta.voided_at = updated.voided_at;
    nextMeta.voided_by = updated.voided_by;
    nextMeta.void_reason = updated.void_reason;
    store.meta[laborId] = nextMeta;
    writeStore(store);
    return updated;
  }
  throw new Error("Entry not found in local timesheet store.");
}

export async function approveEntry(
  supabase: SupabaseClient,
  manager: Profile,
  entryId: string,
  lock = false,
): Promise<TimeEntry> {
  if (!isManagerRole(manager.role)) {
    throw new Error("Only managers can approve time. Billing may prepare invoices from approved entries only.");
  }

  const week = weekContaining();
  const found = (
    await loadTimeEntries(supabase, {
      from: format(addDays(parseISO(week.start), -30), "yyyy-MM-dd"),
      to: week.end,
    })
  ).find((e) => e.id === entryId);

  if (found) {
    if (!canApproveTime(manager, found)) {
      if (found.technician_id === manager.id) {
        throw new Error("Segregation of duties: you cannot approve your own time.");
      }
      throw new Error("This entry is not eligible for manager approval in its current status.");
    }
    if (found.billing_status === "billed") {
      throw new Error("Billed time cannot be re-approved — create a billing adjustment if needed.");
    }
  }

  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const { data: cur } = await supabase.from("time_entries").select("*").eq("id", entryId).single();
    if (cur) {
      const entry = cur as TimeEntry;
      if (entry.technician_id === manager.id) {
        throw new Error("Segregation of duties: you cannot approve your own time.");
      }
      if (entry.approval_status === "active" || entry.approval_status === "missing_clock_out") {
        throw new Error("Clock out and correct missing clock-out before approving.");
      }
      const now = new Date().toISOString();
      const billableReady =
        entry.billable_status === "billable" && entry.work_order_id && entry.customer_id;
      const { data, error } = await supabase
        .from("time_entries")
        .update({
          approval_status: lock ? "locked" : "approved",
          approved_by: manager.id,
          approved_at: now,
          rejection_reason: null,
          locked_at: lock ? now : entry.locked_at,
          locked_by: lock ? manager.id : entry.locked_by,
          billing_status:
            entry.billable_status === "nonbillable"
              ? "nonbillable"
              : billableReady
                ? "ready_to_bill"
                : "not_ready",
          updated_by: manager.id,
          updated_at: now,
        })
        .eq("id", entryId)
        .select(ENTRY_SELECT_FLAT)
        .single();
      if (!error && data) {
        const next = data as unknown as TimeEntry;
        // Mirror only approved time for billing consumption
        await insertLaborMirror(supabase, next);
        await writeAudit(supabase, next.id, lock ? "lock" : "approve", manager.id, undefined, {
          actorRole: manager.role,
          statusBefore: entry.approval_status,
          statusAfter: next.approval_status,
        });
        return next;
      }
    }
    cachedMode = "fallback";
  }

  if (found?.approval_status === "active" || found?.approval_status === "missing_clock_out") {
    throw new Error("Clock out and correct missing clock-out before approving.");
  }

  const now = new Date().toISOString();
  return updateFallbackEntry(entryId, (e) => {
    if (e.technician_id === manager.id) {
      throw new Error("Segregation of duties: you cannot approve your own time.");
    }
    const billableReady = e.billable_status === "billable" && e.work_order_id && e.customer_id;
    return {
      ...e,
      approval_status: lock ? "locked" : "approved",
      approved_by: manager.id,
      approved_at: now,
      rejection_reason: null,
      locked_at: lock ? now : e.locked_at,
      locked_by: lock ? manager.id : e.locked_by,
      billing_status:
        e.billable_status === "nonbillable"
          ? "nonbillable"
          : billableReady
            ? "ready_to_bill"
            : "not_ready",
      updated_by: manager.id,
      updated_at: now,
    };
  });
}

export async function rejectEntry(
  supabase: SupabaseClient,
  manager: Profile,
  entryId: string,
  reason: string,
): Promise<TimeEntry> {
  if (!isManagerRole(manager.role)) {
    throw new Error("Only managers can reject time.");
  }
  if (!reason.trim() || reason.trim().length < 3) {
    throw new Error("Rejection requires a reason.");
  }
  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const now = new Date().toISOString();
    const { data: before } = await supabase.from("time_entries").select("approval_status, technician_id").eq("id", entryId).single();
    if (before && (before as TimeEntry).technician_id === manager.id) {
      throw new Error("Segregation of duties: you cannot reject/action your own time as approver.");
    }
    const { data, error } = await supabase
      .from("time_entries")
      .update({
        approval_status: "rejected",
        rejection_reason: reason.trim(),
        rejected_at: now,
        rejected_by: manager.id,
        approved_by: null,
        approved_at: null,
        locked_at: null,
        locked_by: null,
        billing_status: "not_ready",
        updated_by: manager.id,
        updated_at: now,
      })
      .eq("id", entryId)
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (!error && data) {
      await writeAudit(supabase, (data as TimeEntry).id, "reject", manager.id, reason, {
        actorRole: manager.role,
        reason,
        statusBefore: (before as TimeEntry | null)?.approval_status ?? null,
        statusAfter: "rejected",
      });
      return data as unknown as TimeEntry;
    }
    cachedMode = "fallback";
  }
  const now = new Date().toISOString();
  return updateFallbackEntry(entryId, (e) => {
    if (e.technician_id === manager.id) {
      throw new Error("Segregation of duties: you cannot approve or reject your own time.");
    }
    return {
      ...e,
      approval_status: "rejected",
      rejection_reason: reason.trim(),
      rejected_at: now,
      rejected_by: manager.id,
      approved_by: null,
      approved_at: null,
      locked_at: null,
      locked_by: null,
      billing_status: "not_ready",
      updated_by: manager.id,
      updated_at: now,
    };
  });
}

export async function requestCorrection(
  supabase: SupabaseClient,
  manager: Profile,
  entryId: string,
  reason: string,
): Promise<TimeEntry> {
  if (!isManagerRole(manager.role)) throw new Error("Only managers can request correction.");
  if (!reason.trim() || reason.trim().length < 3) {
    throw new Error("Correction requests require a reason.");
  }
  const now = new Date().toISOString();
  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const { data, error } = await supabase
      .from("time_entries")
      .update({
        approval_status: "pending_correction",
        correction_reason: reason.trim(),
        rejection_reason: reason.trim(),
        updated_by: manager.id,
        updated_at: now,
      })
      .eq("id", entryId)
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (!error && data) {
      await writeAudit(supabase, entryId, "request_correction", manager.id, reason, {
        actorRole: manager.role,
        reason,
        statusAfter: "pending_correction",
      });
      return data as unknown as TimeEntry;
    }
    cachedMode = "fallback";
  }
  return updateFallbackEntry(entryId, (e) => ({
    ...e,
    approval_status: "pending_correction",
    correction_reason: reason.trim(),
    rejection_reason: reason.trim(),
    updated_by: manager.id,
    updated_at: now,
  }));
}

export async function reopenEntry(
  supabase: SupabaseClient,
  manager: Profile,
  entryId: string,
  reason?: string,
): Promise<TimeEntry> {
  if (!isManagerRole(manager.role)) {
    throw new Error("Only managers can reopen time.");
  }
  if (!reason?.trim() || reason.trim().length < 3) {
    throw new Error("Reopening requires a documented reason.");
  }
  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const { data: before } = await supabase.from("time_entries").select("*").eq("id", entryId).single();
    if (before && (before as TimeEntry).billing_status === "billed") {
      throw new Error(
        "Billed entries cannot be silently reopened. Create a billing adjustment instead.",
      );
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("time_entries")
      .update({
        approval_status: "pending_approval",
        locked_at: null,
        locked_by: null,
        approved_at: null,
        approved_by: null,
        reopened_at: now,
        reopened_by: manager.id,
        reopen_reason: reason.trim(),
        billing_status: "not_ready",
        updated_by: manager.id,
        updated_at: now,
      })
      .eq("id", entryId)
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (!error && data) {
      await writeAudit(supabase, (data as TimeEntry).id, "reopen", manager.id, reason, {
        actorRole: manager.role,
        reason,
        statusBefore: (before as TimeEntry | null)?.approval_status ?? null,
        statusAfter: "pending_approval",
      });
      return data as unknown as TimeEntry;
    }
    cachedMode = "fallback";
  }
  return updateFallbackEntry(entryId, (e) => {
    if (e.billing_status === "billed") {
      throw new Error(
        "Billed entries cannot be silently reopened. Create a billing adjustment instead.",
      );
    }
    return {
      ...e,
      approval_status: "pending_approval",
      locked_at: null,
      locked_by: null,
      approved_at: null,
      approved_by: null,
      reopened_at: new Date().toISOString(),
      reopened_by: manager.id,
      reopen_reason: reason.trim(),
      billing_status: "not_ready",
      updated_by: manager.id,
      updated_at: new Date().toISOString(),
    };
  });
}

export async function editTimeEntry(
  supabase: SupabaseClient,
  actor: Profile,
  entryId: string,
  patch: {
    clockInLocal?: string;
    clockOutLocal?: string;
    activityType?: TimeActivityType;
    notes?: string;
    editReason: string;
  },
): Promise<TimeEntry> {
  if (!patch.editReason.trim() || patch.editReason.trim().length < 3) {
    throw new Error("Edits require an explanation.");
  }

  const week = weekContaining();
  const found = (
    await loadTimeEntries(supabase, {
      from: format(addDays(parseISO(week.start), -60), "yyyy-MM-dd"),
      to: format(addDays(parseISO(week.end), 14), "yyyy-MM-dd"),
    })
  ).find((e) => e.id === entryId);
  if (!found) throw new Error("Entry not found.");
  if (!canEditEntry(actor, found)) {
    throw new Error("Approved or locked time cannot be changed unless a manager reopens it.");
  }

  const clockIn = patch.clockInLocal ?? found.clock_in_at;
  const clockOut = patch.clockOutLocal ?? found.clock_out_at;
  if (!clockIn || !clockOut) throw new Error("Both start and end times are required for edits.");

  const duration = validateDuration(clockIn, clockOut);
  if (!duration.ok) throw new Error(duration.error);
  const futureErr = validateNotFuture(clockIn, 5);
  if (futureErr) throw new Error(futureErr);

  const overlaps = await findOverlapping(supabase, found.technician_id, clockIn, clockOut, entryId);
  if (overlaps.length) {
    throw new Error(
      `Overlapping time blocked against entry ${overlaps[0].id.slice(0, 8)}…. Correct one of the entries.`,
    );
  }

  const totalH = hoursFromRange(clockIn, clockOut);
  const weekB = weekContaining(found.entry_date);
  const prior = await sumPriorWeekRegular(
    supabase,
    found.technician_id,
    weekB.start,
    weekB.end,
    entryId,
  );
  const split = splitWeeklyOt(totalH, prior);
  const moneyPart = computeMoney(
    split.regular_hours,
    split.overtime_hours,
    found.hourly_cost_rate,
    found.overtime_cost_rate,
    found.billing_rate,
    found.billable_status,
    false,
    1.5,
  );

  const originals = {
    clock_in_at: found.original_clock_in_at ?? found.clock_in_at,
    clock_out_at: found.original_clock_out_at ?? found.clock_out_at,
    regular_hours: found.original_regular_hours ?? found.regular_hours,
    overtime_hours: found.original_overtime_hours ?? found.overtime_hours,
    activity_type: found.original_activity_type ?? found.activity_type,
    notes: found.original_notes ?? found.notes,
  };
  const revised = {
    clock_in_at: clockIn,
    clock_out_at: clockOut,
    activity_type: patch.activityType ?? found.activity_type,
    notes: patch.notes ?? found.notes,
    regular_hours: split.regular_hours,
    overtime_hours: split.overtime_hours,
  };
  const now = new Date().toISOString();

  const nextPatch: Partial<TimeEntry> = {
    clock_in_at: clockIn,
    clock_out_at: clockOut,
    total_minutes: minutesFromRange(clockIn, clockOut),
    activity_type: patch.activityType ?? found.activity_type,
    notes: patch.notes ?? found.notes,
    regular_hours: split.regular_hours,
    overtime_hours: split.overtime_hours,
    labor_cost: moneyPart.labor_cost,
    billable_amount: moneyPart.billable_amount,
    approval_status: "pending_approval",
    edit_reason: patch.editReason.trim(),
    original_clock_in_at: originals.clock_in_at,
    original_clock_out_at: originals.clock_out_at,
    original_regular_hours: Number(originals.regular_hours),
    original_overtime_hours: Number(originals.overtime_hours),
    original_activity_type: String(originals.activity_type),
    original_notes: originals.notes as string | null,
    original_values: originals as Record<string, unknown>,
    revised_values: revised,
    duration_flag_12h: Boolean(duration.warn12h),
    duration_flag_16h: Boolean(duration.flag16h),
    updated_by: actor.id,
    updated_at: now,
  };

  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const { data, error } = await supabase
      .from("time_entries")
      .update(nextPatch)
      .eq("id", entryId)
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (!error && data) {
      await writeAudit(supabase, entryId, "edit", actor.id, patch.editReason, {
        actorRole: actor.role,
        reason: patch.editReason,
        originalValues: originals as Record<string, unknown>,
        revisedValues: revised,
        statusBefore: found.approval_status,
        statusAfter: "pending_approval",
      });
      return data as unknown as TimeEntry;
    }
    cachedMode = "fallback";
  }

  return updateFallbackEntry(entryId, (e) => ({ ...e, ...nextPatch }));
}

export async function submitWeeklyTimesheet(
  supabase: SupabaseClient,
  profile: Profile,
  weekStart: string,
  certified: boolean,
): Promise<WeeklyTimesheet> {
  if (!certified) {
    throw new Error("You must certify accuracy before submitting the weekly timesheet.");
  }
  const week = weekContaining(weekStart);
  const entries = await loadTimeEntries(supabase, {
    from: week.start,
    to: week.end,
    technicianId: profile.id,
  });
  const open = entries.filter(
    (e) =>
      !isVoided(e) &&
      (e.approval_status === "active" || e.approval_status === "missing_clock_out"),
  );
  if (open.length) {
    throw new Error("Close all active or missing clock-outs before weekly submission.");
  }

  const now = new Date().toISOString();
  const sheet: WeeklyTimesheet = {
    id: crypto.randomUUID(),
    technician_id: profile.id,
    week_start: week.start,
    week_end: week.end,
    status: "submitted",
    certification_text: CERTIFICATION_TEXT,
    certified_at: now,
    certified_name: profile.full_name || profile.email,
    submitted_at: now,
    submitted_by: profile.id,
    manager_id: null,
    manager_approved_at: null,
    locked_at: null,
    locked_by: null,
    return_reason: null,
    returned_at: null,
    returned_by: null,
    created_at: now,
    updated_at: now,
  };

  const mode = await resolveMode(supabase);
  if (mode === "time_entries") {
    const { data, error } = await supabase
      .from("weekly_timesheets")
      .upsert(
        {
          technician_id: profile.id,
          week_start: week.start,
          week_end: week.end,
          status: "submitted",
          certification_text: CERTIFICATION_TEXT,
          certified_at: now,
          certified_name: profile.full_name || profile.email,
          submitted_at: now,
          submitted_by: profile.id,
        },
        { onConflict: "technician_id,week_start" },
      )
      .select("*")
      .single();
    if (!error && data) {
      // Freeze editable status on non-locked entries for the week
      await supabase
        .from("time_entries")
        .update({
          approval_status: "submitted",
          submitted_at: now,
          submitted_by: profile.id,
          cert_week_start: week.start,
          updated_at: now,
        })
        .eq("technician_id", profile.id)
        .gte("entry_date", week.start)
        .lte("entry_date", week.end)
        .in("approval_status", ["complete", "pending_approval", "approved"]);
      return data as WeeklyTimesheet;
    }
  }

  const store = readStore();
  const existingIdx = store.weeks.findIndex(
    (w) => w.technician_id === profile.id && w.week_start === week.start,
  );
  if (existingIdx >= 0) {
    if (store.weeks[existingIdx].status === "locked" || store.weeks[existingIdx].status === "submitted") {
      if (store.weeks[existingIdx].status === "locked") {
        throw new Error("This week is locked. Ask a manager to return or reopen it.");
      }
    }
    store.weeks[existingIdx] = { ...store.weeks[existingIdx], ...sheet, id: store.weeks[existingIdx].id };
  } else {
    store.weeks.push(sheet);
  }
  store.entries = store.entries.map((e) =>
    e.technician_id === profile.id &&
    e.entry_date >= week.start &&
    e.entry_date <= week.end &&
    !isVoided(e) &&
    ["complete", "pending_approval", "approved"].includes(e.approval_status)
      ? {
          ...e,
          approval_status: e.approval_status === "approved" ? "approved" : "submitted",
          submitted_at: now,
          submitted_by: profile.id,
          cert_week_start: week.start,
        }
      : e,
  );
  appendLocalAudit(store, {
    time_entry_id: sheet.id,
    action: "submit_week",
    actor_id: profile.id,
    actor_role: profile.role,
    detail: week.label,
    status_after: "submitted",
  });
  writeStore(store);
  return sheet;
}

export async function loadWeeklyTimesheet(
  supabase: SupabaseClient,
  technicianId: string,
  weekStart: string,
): Promise<WeeklyTimesheet | null> {
  const mode = await resolveMode(supabase);
  if (mode === "time_entries") {
    const { data } = await supabase
      .from("weekly_timesheets")
      .select("*")
      .eq("technician_id", technicianId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (data) return data as WeeklyTimesheet;
  }
  const store = readStore();
  return store.weeks.find((w) => w.technician_id === technicianId && w.week_start === weekStart) ?? null;
}

export async function markTimeBilled(
  supabase: SupabaseClient,
  billingUser: Profile,
  entryId: string,
  invoiceId: string,
): Promise<TimeEntry> {
  if (!["billing", "administrator"].includes(billingUser.role)) {
    throw new Error("Only billing personnel can mark time billed.");
  }
  const week = weekContaining();
  const entry = (
    await loadTimeEntries(supabase, {
      from: format(addDays(parseISO(week.start), -120), "yyyy-MM-dd"),
      to: format(addDays(parseISO(week.end), 30), "yyyy-MM-dd"),
    })
  ).find((e) => e.id === entryId);
  if (!entry) throw new Error("Entry not found.");
  if (!includesInBilling(entry) && entry.billing_status !== "ready_to_bill") {
    if (entry.billing_status === "billed") {
      throw new Error("Already billed — duplicate invoice lines are blocked.");
    }
    throw new Error(
      "Only manager-approved, unlocked, billable time with a work order and customer may be added to an invoice.",
    );
  }
  if (!["approved", "locked"].includes(entry.approval_status)) {
    throw new Error("Entry must be approved or locked before billing.");
  }
  const now = new Date().toISOString();
  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-")) {
    const { data, error } = await supabase
      .from("time_entries")
      .update({
        billing_status: "billed",
        invoice_id: invoiceId,
        billed_at: now,
        billed_by: billingUser.id,
        updated_by: billingUser.id,
        updated_at: now,
      })
      .eq("id", entryId)
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (!error && data) {
      await writeAudit(supabase, entryId, "add_to_invoice", billingUser.id, invoiceId, {
        actorRole: billingUser.role,
        statusAfter: "billed",
      });
      return data as unknown as TimeEntry;
    }
  }
  return updateFallbackEntry(entryId, (e) => {
    if (e.billing_status === "billed") {
      throw new Error("Already billed — duplicate invoice lines are blocked.");
    }
    if (billingUser.role === "billing") {
      // Billing cannot alter original clocks
      return {
        ...e,
        billing_status: "billed",
        invoice_id: invoiceId,
        billed_at: now,
        billed_by: billingUser.id,
        updated_by: billingUser.id,
        updated_at: now,
      };
    }
    return {
      ...e,
      billing_status: "billed",
      invoice_id: invoiceId,
      billed_at: now,
      billed_by: billingUser.id,
      updated_by: billingUser.id,
      updated_at: now,
    };
  });
}

export async function softDeleteEntry(
  supabase: SupabaseClient,
  actor: Profile,
  entryId: string,
  reason?: string,
): Promise<void> {
  if (!isManagerRole(actor.role) && actor.role !== "administrator") {
    throw new Error("Only managers or administrators may void time entries.");
  }
  if (!reason?.trim() || reason.trim().length < 3) {
    throw new Error("Voiding requires a reason. Entries are soft-voided, not permanently deleted.");
  }
  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("time_entries")
      .update({
        deleted_at: now,
        deleted_by: actor.id,
        is_void: true,
        voided_at: now,
        voided_by: actor.id,
        void_reason: reason.trim(),
        updated_by: actor.id,
        updated_at: now,
      })
      .eq("id", entryId);
    if (!error) {
      await writeAudit(supabase, entryId, "void", actor.id, reason, {
        actorRole: actor.role,
        reason,
        statusAfter: "voided",
      });
      return;
    }
    cachedMode = "fallback";
  }
  const store = readStore();
  const now = new Date().toISOString();
  if (entryId.startsWith("labor-")) {
    const laborId = entryId.replace(/^labor-/, "");
    store.meta[laborId] = {
      ...(store.meta[laborId] ?? {}),
      deleted: true,
      is_void: true,
      voided_at: now,
      voided_by: actor.id,
      void_reason: reason.trim(),
    };
    appendLocalAudit(store, {
      time_entry_id: entryId,
      action: "void",
      actor_id: actor.id,
      actor_role: actor.role,
      reason: reason.trim(),
      status_after: "voided",
    });
    writeStore(store);
    return;
  }
  store.entries = store.entries.map((e) =>
    e.id === entryId
      ? {
          ...e,
          deleted_at: now,
          deleted_by: actor.id,
          is_void: true,
          voided_at: now,
          voided_by: actor.id,
          void_reason: reason.trim(),
        }
      : e,
  );
  appendLocalAudit(store, {
    time_entry_id: entryId,
    action: "void",
    actor_id: actor.id,
    actor_role: actor.role,
    reason: reason.trim(),
    status_after: "voided",
  });
  writeStore(store);
}

export async function workOrderLaborHours(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<{ hours: number; laborCost: number; billableAmount: number }> {
  try {
    const week = weekContaining();
    // pull a broad range so totals aren't week-scoped
    const from = format(addDays(parseISO(week.start), -120), "yyyy-MM-dd");
    const to = format(addDays(parseISO(week.end), 30), "yyyy-MM-dd");
    const entries = await loadTimeEntries(supabase, {
      from,
      to,
      workOrderId,
    });
    let hours = 0;
    let laborCost = 0;
    let billableAmount = 0;
    for (const e of entries) {
      if (e.approval_status === "rejected" || e.approval_status === "active") continue;
      hours += Number(e.regular_hours || 0) + Number(e.overtime_hours || 0);
      laborCost += Number(e.labor_cost || 0);
      billableAmount += Number(e.billable_amount || 0);
    }
    return { hours: num(hours), laborCost: num(laborCost), billableAmount: num(billableAmount) };
  } catch {
    return { hours: 0, laborCost: 0, billableAmount: 0 };
  }
}

export function billableApprovedLabor(entries: TimeEntry[]): number {
  return num(
    entries
      .filter((e) => includesInBilling(e) || (e.approval_status === "approved" || e.approval_status === "locked") && e.billable_status === "billable" && e.billing_status !== "billed")
      .reduce((s, e) => s + e.billable_amount, 0),
  );
}

export function canEditEntry(profile: Profile, entry: TimeEntry): boolean {
  if (isVoided(entry)) return false;
  if (entry.billing_status === "billed" || entry.billing_status === "included_on_draft") return false;
  if (entry.locked_at || entry.approval_status === "locked" || entry.approval_status === "approved") {
    return false;
  }
  if (entry.approval_status === "submitted" && !isManagerRole(profile.role)) return false;
  if (isManagerRole(profile.role)) return true;
  if (profile.role === "billing") return false;
  if (entry.technician_id !== profile.id) return false;
  return [
    "active",
    "missing_clock_out",
    "pending_correction",
    "complete",
    "pending_approval",
    "rejected",
  ].includes(entry.approval_status);
}

/** ServiceTitan-style deep link into Timesheets (tech × job × entry × week). */
export type TimesheetDeepLink = {
  /** Filter to this technician profile id */
  tech?: string | null;
  /** Filter to this work order UUID */
  wo?: string | null;
  /** Highlight and scroll to this time entry id */
  entry?: string | null;
  /** Any date within the pay/work week (YYYY-MM-DD) */
  week?: string | null;
  /** Approval status filter */
  status?: TimeApprovalStatus | "all" | null;
  /** Free-text work order number contains */
  job?: string | null;
  /** Customer name contains */
  customer?: string | null;
};

export function timesheetHref(query: TimesheetDeepLink = {}): string {
  const params = new URLSearchParams();
  if (query.tech) params.set("tech", query.tech);
  if (query.wo) params.set("wo", query.wo);
  if (query.entry) params.set("entry", query.entry);
  if (query.week) params.set("week", query.week);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.job) params.set("job", query.job);
  if (query.customer) params.set("customer", query.customer);
  const qs = params.toString();
  return qs ? `/timesheets?${qs}` : "/timesheets";
}

export function parseTimesheetDeepLink(
  searchParams: URLSearchParams | { get: (key: string) => string | null },
): TimesheetDeepLink {
  const statusRaw = searchParams.get("status");
  const status =
    statusRaw && statusRaw !== "all"
      ? (statusRaw as TimeApprovalStatus)
      : statusRaw === "all"
        ? "all"
        : null;
  return {
    tech: searchParams.get("tech"),
    wo: searchParams.get("wo"),
    entry: searchParams.get("entry"),
    week: searchParams.get("week"),
    status,
    job: searchParams.get("job"),
    customer: searchParams.get("customer"),
  };
}

export function localDateTimeToIso(date: string, time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  const d = startOfDay(parseISO(date));
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d.toISOString();
}

/** Customer-safe view — never expose pay/cost rates or internal notes. */
export function customerSafeEntry(entry: TimeEntry): Partial<TimeEntry> {
  if (entry.approval_status !== "approved" && entry.approval_status !== "locked") {
    return { id: entry.id, approval_status: entry.approval_status };
  }
  return {
    id: entry.id,
    entry_date: entry.entry_date,
    activity_type: entry.activity_type,
    regular_hours: entry.regular_hours,
    overtime_hours: entry.overtime_hours,
    billable_status: entry.billable_status,
    approval_status: entry.approval_status,
    service_location: entry.service_location,
    work_order_id: entry.work_order_id,
  };
}

export function scrubRatesForRole(profile: Profile, entry: TimeEntry): TimeEntry {
  if (isManagerRole(profile.role) || profile.role === "billing") return entry;
  if (profile.role === "customer") {
    return {
      ...entry,
      ...customerSafeEntry(entry),
      hourly_cost_rate: 0,
      overtime_cost_rate: 0,
      billing_rate: 0,
      labor_cost: 0,
      billable_amount: 0,
      notes: null,
      manual_entry_reason: null,
      edit_reason: null,
    } as TimeEntry;
  }
  // Technician: own cost rates may display for their awareness in some products; hide others' cost
  if (entry.technician_id !== profile.id) {
    return {
      ...entry,
      hourly_cost_rate: 0,
      overtime_cost_rate: 0,
      labor_cost: 0,
      billing_rate: profile.role === "technician" ? 0 : entry.billing_rate,
    };
  }
  // Technicians should not edit rates — strip customer billing rate from peer view; keep own internal for transparency optional hidden:
  return {
    ...entry,
    // never allow UI to treat rates as editable — values from profile snapshot only
  };
}
