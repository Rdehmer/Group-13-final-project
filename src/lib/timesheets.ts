/**
 * ServiceTitan-style field timesheets.
 * Prefers Supabase `time_entries` when present; otherwise falls back to
 * `technician_labor` + a browser store so the app never blocks on missing migrations.
 */

import {
  addDays,
  differenceInMinutes,
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
} from "@/lib/types";

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
  active: "Clocked In",
  complete: "Complete",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  locked: "Locked",
};

export const ACTIVITY_LABELS = Object.fromEntries(
  ACTIVITY_TYPES.map((a) => [a.value, a.label]),
) as Record<TimeActivityType, string>;

const ENTRY_SELECT_NESTED = `
  *,
  technician:profiles!time_entries_technician_id_fkey(id, full_name, email),
  work_orders(
    id, work_order_number, work_order_type, problem_description,
    customers(id, name, service_address, city, state),
    equipment(id, name, serial_number)
  ),
  customers(id, name)
`;
const ENTRY_SELECT_FLAT = "*";
const FALLBACK_KEY = "ridley_time_entries_fallback_v2";

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
      locked_at?: string | null;
      locked_by?: string | null;
      is_manual?: boolean;
      manual_entry_reason?: string | null;
      activity_type?: TimeActivityType;
      deleted?: boolean;
    }
  >;
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

export function formatHours(n: number): string {
  return num(n).toFixed(2);
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
  return { regular_hours: num(reg), overtime_hours: num(ot) };
}

export function hoursFromRange(clockIn: string, clockOut: string): number {
  const mins = differenceInMinutes(parseISO(clockOut), parseISO(clockIn));
  if (!Number.isFinite(mins) || mins <= 0) return 0;
  return num(mins / 60);
}

export function minutesFromRange(clockIn: string, clockOut: string): number {
  const mins = differenceInMinutes(parseISO(clockOut), parseISO(clockIn));
  return Math.max(0, mins);
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
  if (typeof window === "undefined") return { entries: [], meta: {} };
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return { entries: [], meta: {} };
    const parsed = JSON.parse(raw) as FallbackStore;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {},
    };
  } catch {
    return { entries: [], meta: {} };
  }
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
) {
  if (cachedMode === "fallback") return;
  try {
    await supabase.from("time_entry_audit").insert({
      time_entry_id: timeEntryId,
      action,
      actor_id: actorId,
      detail: detail ?? null,
    });
  } catch {
    /* optional table */
  }
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
    entry.approval_status === "active" || (!!entry.clock_in_at && !entry.clock_out_at);
  const longShift = hours > 16 || entry.total_minutes > 16 * 60;
  const noWorkOrder =
    !entry.work_order_id &&
    (entry.activity_type === "regular_work" || entry.activity_type === "overtime");

  let overlap = false;
  if (entry.clock_in_at && entry.clock_out_at) {
    const a0 = entry.clock_in_at;
    const a1 = entry.clock_out_at;
    for (const other of allForTech) {
      if (other.id === entry.id || other.deleted_at) continue;
      if (other.technician_id !== entry.technician_id) continue;
      if (!other.clock_in_at || !other.clock_out_at) continue;
      if (other.approval_status === "rejected") continue;
      if (entriesOverlap(a0, a1, other.clock_in_at, other.clock_out_at)) {
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
    approachingOt: weekTotalHours >= 36 && weekTotalHours < 40,
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

  return {
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
    approved_by: meta?.approved_by ?? null,
    approved_at: meta?.approved_at ?? null,
    rejection_reason: meta?.rejection_reason ?? null,
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
  };
}

function blankEntry(partial: Partial<TimeEntry> & Pick<TimeEntry, "technician_id" | "entry_date">): TimeEntry {
  const now = new Date().toISOString();
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
    approved_by: partial.approved_by ?? null,
    approved_at: partial.approved_at ?? null,
    rejection_reason: partial.rejection_reason ?? null,
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
    .select("*, work_orders(id, work_order_number, work_order_type, problem_description, customers(id, name, service_address, city, state), equipment(id, name, serial_number))")
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
  if (store.entries.some((e) => e.notes?.startsWith("[DEMO]"))) return [];
  // Only auto-seed when viewing a week that includes “today”
  const today = todayIso();
  if (today < from || today > to) return [];

  const tech = technicianId ?? "demo-tech";
  const demo: TimeEntry[] = [
    blankEntry({
      technician_id: tech,
      entry_date: today,
      clock_in_at: `${today}T08:00:00.000Z`,
      clock_out_at: `${today}T12:00:00.000Z`,
      total_minutes: 240,
      regular_hours: 4,
      activity_type: "regular_work",
      notes: "[DEMO] Morning equipment PM",
      approval_status: "complete",
      labor_cost: 180,
      billable_amount: 380,
    }),
    blankEntry({
      technician_id: tech,
      entry_date: today,
      clock_in_at: `${today}T07:15:00.000Z`,
      clock_out_at: `${today}T08:00:00.000Z`,
      total_minutes: 45,
      regular_hours: 0.75,
      activity_type: "travel",
      notes: "[DEMO] Drive to site",
      approval_status: "approved",
      labor_cost: 33.75,
      billable_amount: 71.25,
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
      notes: "[DEMO] Shop rebuild",
      is_manual: true,
      manual_entry_reason: "Forgot to clock non-job time",
      approval_status: "pending_approval",
      labor_cost: 45,
      billable_amount: 0,
    }),
  ];
  store.entries.push(...demo);
  return demo;
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
        .eq("approval_status", "active")
        .is("deleted_at", null)
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
    (e) => e.technician_id === technicianId && e.approval_status === "active" && !e.deleted_at,
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
    if (e.approval_status === "rejected") {
      t.rejected += 1;
      continue;
    }
    if (e.approval_status === "active") {
      t.active += 1;
      if (e.clock_in_at) {
        const live = hoursFromRange(e.clock_in_at, new Date().toISOString());
        t.totalHours = num(t.totalHours + live);
        t.regularHours = num(t.regularHours + live);
      }
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
    if (e.approval_status === "pending_approval") t.pending += 1;
  }
  return t;
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
  },
): Promise<TimeEntry> {
  const existing = await getActiveClock(supabase, input.profile.id);
  if (existing) {
    throw new Error("Already clocked in. Clock out first.");
  }

  const otMult = await loadOtMultiplier(supabase);
  const rates = ratesFromProfile(input.profile, otMult);
  const activity = input.activityType ?? "regular_work";
  const now = new Date().toISOString();

  const { data: wo, error: woErr } = await supabase
    .from("work_orders")
    .select(
      "id, customer_id, equipment_id, work_order_number, work_order_type, problem_description, customers(id, name, service_address, city, state)",
    )
    .eq("id", input.workOrderId)
    .single();
  if (woErr || !wo) throw new Error(woErr?.message ?? "Work order not found.");

  const loc = locationFromJob(
    wo as {
      customers?: {
        service_address?: string | null;
        city?: string | null;
        state?: string | null;
      } | null;
    },
  );

  // Always stamp WO (required for dispatch / fallback active clock)
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
        billable_status: activityDefaultBillable(activity),
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
        created_by: input.profile.id,
        updated_by: input.profile.id,
      })
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (error) {
      if (isTimesheetMissingTable(supabaseErrorMessage(error))) {
        cachedMode = "fallback";
      } else {
        // continue with fallback entry
        cachedMode = "fallback";
      }
    } else {
      await writeAudit(supabase, (data as TimeEntry).id, "clock_in", input.profile.id);
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
    billable_status: activityDefaultBillable(activity),
    hourly_cost_rate: rates.hourly_cost_rate,
    overtime_cost_rate: rates.overtime_cost_rate,
    billing_rate: rates.billing_rate,
    notes: input.notes ?? "Field clock-in",
    approval_status: "active",
    created_by: input.profile.id,
    work_orders: {
      id: input.workOrderId,
      work_order_number: (wo as { work_order_number?: string }).work_order_number ?? null,
      work_order_type: (wo as { work_order_type?: string }).work_order_type ?? null,
      problem_description: (wo as { problem_description?: string }).problem_description ?? null,
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
  const payload = {
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
    invoiced: false,
    notes: `${ACTIVITY_LABELS[entry.activity_type]}${entry.notes ? ` — ${entry.notes}` : ""}`,
  };
  if (entry.technician_labor_id && !entry.technician_labor_id.startsWith("demo")) {
    await supabase.from("technician_labor").update(payload).eq("id", entry.technician_labor_id);
    return entry.technician_labor_id;
  }
  const { data, error } = await supabase.from("technician_labor").insert(payload).select("id").single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function clockOut(
  supabase: SupabaseClient,
  input: { profile: Profile; entryId?: string; notes?: string },
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
  const totalH = hoursFromRange(entry.clock_in_at, now);
  if (totalH <= 0) throw new Error("Duration must be greater than zero.");

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
    approval_status: "complete",
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

  // Clear WO open clock
  if (entry.work_order_id) {
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

  const totalH = hoursFromRange(input.clockInLocal, input.clockOutLocal);
  if (totalH <= 0) throw new Error("End must be after start; duration cannot be zero.");

  const overlaps = await findOverlapping(supabase, techId, input.clockInLocal, input.clockOutLocal);
  if (overlaps.length) {
    throw new Error(
      `Overlaps existing entry starting ${format(parseISO(overlaps[0].clock_in_at!), "MMM d h:mm a")}.`,
    );
  }

  let customerId = input.customerId ?? null;
  let equipmentId: string | null = null;
  let serviceLocation: string | null = null;
  let woJoin: TimeEntry["work_orders"] = null;
  if (input.workOrderId) {
    const { data: wo } = await supabase
      .from("work_orders")
      .select(
        "id, customer_id, equipment_id, work_order_number, work_order_type, problem_description, customers(id, name, service_address, city, state), equipment(id, name, serial_number)",
      )
      .eq("id", input.workOrderId)
      .single();
    if (wo) {
      customerId = (wo as { customer_id: string }).customer_id;
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
    }
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
  const billable = input.billableStatus ?? activityDefaultBillable(input.activityType);
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
    const next = mutator(store.entries[idx]);
    store.entries[idx] = next;
    writeStore(store);
    return next;
  }
  if (entryId.startsWith("labor-")) {
    const laborId = entryId.replace(/^labor-/, "");
    const meta = store.meta[laborId] ?? {};
    const nextMeta = { ...meta };
    // mutate via dummy and mirror fields to meta
    const dummy = blankEntry({
      id: entryId,
      technician_id: "unknown",
      entry_date: todayIso(),
      technician_labor_id: laborId,
      approval_status: (meta.approval_status as TimeApprovalStatus) ?? "complete",
    });
    const updated = mutator(dummy);
    nextMeta.approval_status = updated.approval_status;
    nextMeta.rejection_reason = updated.rejection_reason;
    nextMeta.approved_by = updated.approved_by;
    nextMeta.approved_at = updated.approved_at;
    nextMeta.locked_at = updated.locked_at;
    nextMeta.locked_by = updated.locked_by;
    nextMeta.is_manual = updated.is_manual;
    nextMeta.manual_entry_reason = updated.manual_entry_reason;
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
  if (!["administrator", "service_manager", "billing"].includes(manager.role)) {
    throw new Error("Only managers or billing can approve time.");
  }
  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const { data: cur } = await supabase.from("time_entries").select("*").eq("id", entryId).single();
    if (cur) {
      const entry = cur as TimeEntry;
      if (entry.is_manual && entry.technician_id === manager.id) {
        throw new Error("Technicians cannot approve their own adjustments.");
      }
      if (entry.approval_status === "active") throw new Error("Clock out before approving.");
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("time_entries")
        .update({
          approval_status: lock ? "locked" : "approved",
          approved_by: manager.id,
          approved_at: now,
          rejection_reason: null,
          locked_at: lock ? now : null,
          locked_by: lock ? manager.id : null,
          updated_by: manager.id,
          updated_at: now,
        })
        .eq("id", entryId)
        .select(ENTRY_SELECT_FLAT)
        .single();
      if (!error && data) {
        const next = data as unknown as TimeEntry;
        await insertLaborMirror(supabase, next);
        await writeAudit(supabase, next.id, lock ? "approve_lock" : "approve", manager.id);
        return next;
      }
    }
    cachedMode = "fallback";
  }

  // Resolve entry first for self-approve check
  const week = weekContaining();
  const found = (await loadTimeEntries(supabase, { from: week.start, to: week.end })).find(
    (e) => e.id === entryId,
  );
  if (found?.is_manual && found.technician_id === manager.id) {
    throw new Error("You cannot approve your own adjustments.");
  }
  if (found?.approval_status === "active") throw new Error("Clock out before approving.");

  const now = new Date().toISOString();
  return updateFallbackEntry(entryId, (e) => ({
    ...e,
    approval_status: lock ? "locked" : "approved",
    approved_by: manager.id,
    approved_at: now,
    rejection_reason: null,
    locked_at: lock ? now : null,
    locked_by: lock ? manager.id : null,
    updated_by: manager.id,
    updated_at: now,
  }));
}

export async function rejectEntry(
  supabase: SupabaseClient,
  manager: Profile,
  entryId: string,
  reason: string,
): Promise<TimeEntry> {
  if (!["administrator", "service_manager"].includes(manager.role)) {
    throw new Error("Only managers can reject time.");
  }
  if (!reason.trim() || reason.trim().length < 3) {
    throw new Error("Rejection requires a reason.");
  }
  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("time_entries")
      .update({
        approval_status: "rejected",
        rejection_reason: reason.trim(),
        approved_by: manager.id,
        approved_at: now,
        locked_at: null,
        locked_by: null,
        updated_by: manager.id,
        updated_at: now,
      })
      .eq("id", entryId)
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (!error && data) {
      await writeAudit(supabase, (data as TimeEntry).id, "reject", manager.id, reason);
      return data as unknown as TimeEntry;
    }
    cachedMode = "fallback";
  }
  const now = new Date().toISOString();
  return updateFallbackEntry(entryId, (e) => ({
    ...e,
    approval_status: "rejected",
    rejection_reason: reason.trim(),
    approved_by: manager.id,
    approved_at: now,
    locked_at: null,
    locked_by: null,
    updated_by: manager.id,
    updated_at: now,
  }));
}

export async function reopenEntry(
  supabase: SupabaseClient,
  manager: Profile,
  entryId: string,
): Promise<TimeEntry> {
  if (!["administrator", "service_manager"].includes(manager.role)) {
    throw new Error("Only managers can reopen time.");
  }
  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("time_entries")
      .update({
        approval_status: "pending_approval",
        locked_at: null,
        locked_by: null,
        approved_at: null,
        approved_by: null,
        updated_by: manager.id,
        updated_at: now,
      })
      .eq("id", entryId)
      .select(ENTRY_SELECT_FLAT)
      .single();
    if (!error && data) {
      await writeAudit(supabase, (data as TimeEntry).id, "reopen", manager.id);
      return data as unknown as TimeEntry;
    }
    cachedMode = "fallback";
  }
  return updateFallbackEntry(entryId, (e) => ({
    ...e,
    approval_status: "pending_approval",
    locked_at: null,
    locked_by: null,
    approved_at: null,
    approved_by: null,
    updated_by: manager.id,
    updated_at: new Date().toISOString(),
  }));
}

export async function softDeleteEntry(
  supabase: SupabaseClient,
  actor: Profile,
  entryId: string,
): Promise<void> {
  const mode = await resolveMode(supabase);
  if (mode === "time_entries" && !entryId.startsWith("labor-") && !entryId.startsWith("active-")) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("time_entries")
      .update({
        deleted_at: now,
        deleted_by: actor.id,
        updated_by: actor.id,
        updated_at: now,
      })
      .eq("id", entryId);
    if (!error) {
      await writeAudit(supabase, entryId, "soft_delete", actor.id);
      return;
    }
    cachedMode = "fallback";
  }
  const store = readStore();
  if (entryId.startsWith("labor-")) {
    const laborId = entryId.replace(/^labor-/, "");
    store.meta[laborId] = { ...(store.meta[laborId] ?? {}), deleted: true };
    // soft-hide only; do not hard-delete invoicing rows
    writeStore(store);
    return;
  }
  store.entries = store.entries.map((e) =>
    e.id === entryId
      ? { ...e, deleted_at: new Date().toISOString(), deleted_by: actor.id }
      : e,
  );
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
      .filter(
        (e) =>
          (e.approval_status === "approved" ||
            e.approval_status === "locked" ||
            e.approval_status === "complete") &&
          e.billable_status === "billable",
      )
      .reduce((s, e) => s + e.billable_amount, 0),
  );
}

export function canEditEntry(profile: Profile, entry: TimeEntry): boolean {
  if (entry.locked_at || entry.approval_status === "locked" || entry.approval_status === "approved") {
    return false;
  }
  if (["administrator", "service_manager"].includes(profile.role)) return true;
  if (entry.technician_id !== profile.id) return false;
  return ["active", "complete", "pending_approval", "rejected"].includes(entry.approval_status);
}

export function localDateTimeToIso(date: string, time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  const d = startOfDay(parseISO(date));
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d.toISOString();
}

export function customerSafeEntry(entry: TimeEntry): Partial<TimeEntry> {
  return {
    id: entry.id,
    entry_date: entry.entry_date,
    activity_type: entry.activity_type,
    regular_hours: entry.regular_hours,
    overtime_hours: entry.overtime_hours,
    billable_status: entry.billable_status,
    notes: entry.notes,
    approval_status: entry.approval_status,
  };
}
