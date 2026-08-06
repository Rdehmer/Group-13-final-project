/**
 * Technician availability + published shifts (Walmart-style matrix).
 * Falls back to browser localStorage when Supabase tables are missing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays,
  format,
  getDay,
  parseISO,
  startOfWeek,
} from "date-fns";
import type {
  TechnicianAvailability,
  TechnicianShift,
  TechnicianShiftStatus,
} from "@/lib/types";

const KEY_AVAIL = "ridley_tech_availability_v1";
const KEY_SHIFTS = "ridley_tech_shifts_v1";

export type StorageMode = "remote" | "local" | "unknown";
let storageMode: StorageMode = "unknown";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type WeekDay = {
  date: string;
  dayOfWeek: number;
  label: string;
  shortLabel: string;
};

function isSchemaMissing(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find") ||
    m.includes("technician_availability") ||
    m.includes("technician_shifts")
  );
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTime(t: string): string {
  const raw = t.trim();
  if (/^\d{2}:\d{2}:\d{2}/.test(raw)) return raw.slice(0, 8);
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  return raw;
}

function displayTime(t: string): string {
  const raw = String(t).trim();
  if (raw.length >= 5) return raw.slice(0, 5);
  return raw;
}

export function formatShiftClock(start: string, end: string): string {
  return `${displayTime(start)}–${displayTime(end)}`;
}

/** Week starting Sunday (retail-style). */
export function getWeekDays(anchor: Date | string): WeekDay[] {
  const base = typeof anchor === "string" ? parseISO(anchor) : anchor;
  const sun = startOfWeek(base, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(sun, i);
    const date = format(d, "yyyy-MM-dd");
    const dayOfWeek = getDay(d);
    return {
      date,
      dayOfWeek,
      label: format(d, "EEE M/d"),
      shortLabel: WEEKDAY_LABELS[dayOfWeek] ?? "Day",
    };
  });
}

export function weekRangeLabel(days: WeekDay[]): string {
  if (days.length === 0) return "";
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;
  return `${format(parseISO(first), "MMM d")} – ${format(parseISO(last), "MMM d, yyyy")}`;
}

export function isUsingLocalScheduleStore(): boolean {
  return storageMode === "local";
}

export async function detectScheduleStorage(supabase: SupabaseClient): Promise<"remote" | "local"> {
  if (storageMode === "remote" || storageMode === "local") return storageMode;
  const { error } = await supabase.from("technician_availability").select("id").limit(1);
  if (error && isSchemaMissing(error.message)) {
    storageMode = "local";
    return "local";
  }
  storageMode = "remote";
  return "remote";
}

/** Default Mon–Fri 8–5, Sat 8–12 preferred; Sun off. */
export function defaultWeeklyAvailability(technicianId: string): Omit<
  TechnicianAvailability,
  "id" | "created_at" | "updated_at"
>[] {
  const now = new Date().toISOString();
  void now;
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => {
    if (dow === 0) {
      return {
        technician_id: technicianId,
        day_of_week: dow,
        start_time: "08:00:00",
        end_time: "17:00:00",
        is_available: false,
        note: null,
      };
    }
    if (dow === 6) {
      return {
        technician_id: technicianId,
        day_of_week: dow,
        start_time: "08:00:00",
        end_time: "12:00:00",
        is_available: true,
        note: null,
      };
    }
    return {
      technician_id: technicianId,
      day_of_week: dow,
      start_time: "08:00:00",
      end_time: "17:00:00",
      is_available: true,
      note: null,
    };
  });
}

export async function listAvailability(
  supabase: SupabaseClient,
  technicianIds?: string[],
): Promise<{ data: TechnicianAvailability[]; error: string | null; local: boolean }> {
  const mode = await detectScheduleStorage(supabase);
  if (mode === "local") {
    let all = readJson<TechnicianAvailability[]>(KEY_AVAIL, []);
    if (technicianIds?.length) {
      all = all.filter((r) => technicianIds.includes(r.technician_id));
    }
    return { data: all, error: null, local: true };
  }

  let q = supabase.from("technician_availability").select("*").order("day_of_week");
  if (technicianIds?.length) q = q.in("technician_id", technicianIds);
  const { data, error } = await q;
  if (error) {
    if (isSchemaMissing(error.message)) {
      storageMode = "local";
      return listAvailability(supabase, technicianIds);
    }
    return { data: [], error: error.message, local: false };
  }
  return { data: (data as TechnicianAvailability[]) ?? [], error: null, local: false };
}

export async function saveDayAvailability(
  supabase: SupabaseClient,
  input: {
    technician_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_available: boolean;
    note?: string | null;
    id?: string | null;
  },
): Promise<{ data: TechnicianAvailability | null; error: string | null }> {
  const now = new Date().toISOString();
  const start_time = normalizeTime(input.start_time);
  const end_time = normalizeTime(input.end_time);
  const mode = await detectScheduleStorage(supabase);

  if (mode === "local") {
    const all = readJson<TechnicianAvailability[]>(KEY_AVAIL, []);
    const idx = all.findIndex(
      (r) =>
        r.technician_id === input.technician_id &&
        r.day_of_week === input.day_of_week &&
        (input.id ? r.id === input.id : true),
    );
    // replace all windows for that day for simplicity when no id
    const withoutDay = all.filter(
      (r) =>
        !(r.technician_id === input.technician_id && r.day_of_week === input.day_of_week),
    );
    const row: TechnicianAvailability = {
      id: input.id && idx >= 0 ? all[idx]!.id : newId(),
      technician_id: input.technician_id,
      day_of_week: input.day_of_week,
      start_time,
      end_time,
      is_available: input.is_available,
      note: input.note ?? null,
      created_at: idx >= 0 ? all[idx]!.created_at : now,
      updated_at: now,
    };
    writeJson(KEY_AVAIL, [...withoutDay, row]);
    return { data: row, error: null };
  }

  // One primary window per day: update existing or insert
  const { data: existing } = await supabase
    .from("technician_availability")
    .select("id")
    .eq("technician_id", input.technician_id)
    .eq("day_of_week", input.day_of_week)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("technician_availability")
      .update({
        start_time,
        end_time,
        is_available: input.is_available,
        note: input.note ?? null,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      if (isSchemaMissing(error.message)) {
        storageMode = "local";
        return saveDayAvailability(supabase, input);
      }
      return { data: null, error: error.message };
    }
    return { data: data as TechnicianAvailability, error: null };
  }

  const { data, error } = await supabase
    .from("technician_availability")
    .insert({
      technician_id: input.technician_id,
      day_of_week: input.day_of_week,
      start_time,
      end_time,
      is_available: input.is_available,
      note: input.note ?? null,
    })
    .select()
    .single();
  if (error) {
    if (isSchemaMissing(error.message)) {
      storageMode = "local";
      return saveDayAvailability(supabase, input);
    }
    return { data: null, error: error.message };
  }
  return { data: data as TechnicianAvailability, error: null };
}

export async function seedDefaultAvailabilityIfEmpty(
  supabase: SupabaseClient,
  technicianId: string,
): Promise<void> {
  const { data } = await listAvailability(supabase, [technicianId]);
  if (data.length > 0) return;
  for (const row of defaultWeeklyAvailability(technicianId)) {
    await saveDayAvailability(supabase, {
      technician_id: row.technician_id,
      day_of_week: row.day_of_week,
      start_time: row.start_time,
      end_time: row.end_time,
      is_available: row.is_available,
      note: row.note,
    });
  }
}

export async function listShifts(
  supabase: SupabaseClient,
  opts: { from: string; to: string; technicianIds?: string[] },
): Promise<{ data: TechnicianShift[]; error: string | null; local: boolean }> {
  const mode = await detectScheduleStorage(supabase);
  if (mode === "local") {
    let all = readJson<TechnicianShift[]>(KEY_SHIFTS, []);
    all = all.filter(
      (s) =>
        s.work_date >= opts.from &&
        s.work_date <= opts.to &&
        s.status !== "canceled" &&
        (!opts.technicianIds?.length || opts.technicianIds.includes(s.technician_id)),
    );
    return { data: all, error: null, local: true };
  }

  let q = supabase
    .from("technician_shifts")
    .select("*")
    .gte("work_date", opts.from)
    .lte("work_date", opts.to)
    .neq("status", "canceled")
    .order("work_date")
    .order("start_time");
  if (opts.technicianIds?.length) q = q.in("technician_id", opts.technicianIds);
  const { data, error } = await q;
  if (error) {
    if (isSchemaMissing(error.message)) {
      storageMode = "local";
      return listShifts(supabase, opts);
    }
    return { data: [], error: error.message, local: false };
  }
  return { data: (data as TechnicianShift[]) ?? [], error: null, local: false };
}

export async function upsertShift(
  supabase: SupabaseClient,
  input: {
    id?: string | null;
    technician_id: string;
    work_date: string;
    start_time: string;
    end_time: string;
    status?: TechnicianShiftStatus;
    note?: string | null;
    created_by?: string | null;
  },
): Promise<{ data: TechnicianShift | null; error: string | null }> {
  const now = new Date().toISOString();
  const payload = {
    technician_id: input.technician_id,
    work_date: input.work_date.slice(0, 10),
    start_time: normalizeTime(input.start_time),
    end_time: normalizeTime(input.end_time),
    status: input.status ?? "published",
    note: input.note ?? null,
    updated_at: now,
  };
  const mode = await detectScheduleStorage(supabase);

  if (mode === "local") {
    const all = readJson<TechnicianShift[]>(KEY_SHIFTS, []);
    if (input.id) {
      const idx = all.findIndex((s) => s.id === input.id);
      if (idx < 0) return { data: null, error: "Shift not found." };
      all[idx] = { ...all[idx]!, ...payload };
      writeJson(KEY_SHIFTS, all);
      return { data: all[idx]!, error: null };
    }
    const row: TechnicianShift = {
      id: newId(),
      ...payload,
      created_by: input.created_by ?? null,
      created_at: now,
    };
    writeJson(KEY_SHIFTS, [...all, row]);
    return { data: row, error: null };
  }

  if (input.id) {
    const { data, error } = await supabase
      .from("technician_shifts")
      .update(payload)
      .eq("id", input.id)
      .select()
      .single();
    if (error) {
      if (isSchemaMissing(error.message)) {
        storageMode = "local";
        return upsertShift(supabase, input);
      }
      return { data: null, error: error.message };
    }
    return { data: data as TechnicianShift, error: null };
  }

  const { data, error } = await supabase
    .from("technician_shifts")
    .insert({ ...payload, created_by: input.created_by ?? null })
    .select()
    .single();
  if (error) {
    if (isSchemaMissing(error.message)) {
      storageMode = "local";
      return upsertShift(supabase, input);
    }
    return { data: null, error: error.message };
  }
  return { data: data as TechnicianShift, error: null };
}

export async function cancelShift(
  supabase: SupabaseClient,
  id: string,
): Promise<{ error: string | null }> {
  const mode = await detectScheduleStorage(supabase);
  if (mode === "local") {
    const all = readJson<TechnicianShift[]>(KEY_SHIFTS, []);
    writeJson(
      KEY_SHIFTS,
      all.map((s) =>
        s.id === id
          ? { ...s, status: "canceled" as const, updated_at: new Date().toISOString() }
          : s,
      ),
    );
    return { error: null };
  }
  const { error } = await supabase
    .from("technician_shifts")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error && isSchemaMissing(error.message)) {
    storageMode = "local";
    return cancelShift(supabase, id);
  }
  return { error: error?.message ?? null };
}

export function availabilityForDay(
  rows: TechnicianAvailability[],
  technicianId: string,
  dayOfWeek: number,
): TechnicianAvailability | null {
  return (
    rows.find((r) => r.technician_id === technicianId && r.day_of_week === dayOfWeek) ?? null
  );
}

export function shiftsForCell(
  shifts: TechnicianShift[],
  technicianId: string,
  date: string,
): TechnicianShift[] {
  return shifts.filter(
    (s) =>
      s.technician_id === technicianId &&
      s.work_date.slice(0, 10) === date.slice(0, 10) &&
      s.status === "published",
  );
}

/** Visual status for a day cell (priority: PTO > shift > available > off). */
export type CellKind = "pto" | "scheduled" | "available" | "unavailable" | "empty";

export function cellKind(opts: {
  onPto: boolean;
  hasShift: boolean;
  availability: TechnicianAvailability | null;
}): CellKind {
  if (opts.onPto) return "pto";
  if (opts.hasShift) return "scheduled";
  if (!opts.availability) return "empty";
  if (!opts.availability.is_available) return "unavailable";
  return "available";
}

export function cellClass(kind: CellKind): string {
  switch (kind) {
    case "pto":
      return "border-warning/50 bg-warning/20";
    case "scheduled":
      return "border-primary/50 bg-primary/15";
    case "available":
      return "border-success/40 bg-success/10";
    case "unavailable":
      return "border-base-300 bg-base-200/80 opacity-70";
    default:
      return "border-dashed border-base-300 bg-base-100";
  }
}

export function cellCaption(kind: CellKind): string {
  switch (kind) {
    case "pto":
      return "Time off";
    case "scheduled":
      return "Scheduled";
    case "available":
      return "Available";
    case "unavailable":
      return "Not available";
    default:
      return "No pref.";
  }
}
