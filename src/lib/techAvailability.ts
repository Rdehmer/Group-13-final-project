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
  const hhmm = raw.length >= 5 ? raw.slice(0, 5) : raw;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return raw;
  const hours = Number(match[1]);
  const minutes = match[2];
  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return hhmm;
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${period}`;
}

export function formatShiftClock(start: string, end: string): string {
  return `${displayTime(start)} – ${displayTime(end)}`;
}

function timeToMinutes(t: string): number | null {
  const raw = String(t).trim();
  const hhmm = raw.length >= 5 ? raw.slice(0, 5) : raw;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** All preferred windows for a weekday, earliest start first. */
export function availabilityWindowsForDay(
  rows: TechnicianAvailability[],
  technicianId: string,
  dayOfWeek: number,
): TechnicianAvailability[] {
  return rows
    .filter((r) => r.technician_id === technicianId && r.day_of_week === dayOfWeek)
    .slice()
    .sort((a, b) => {
      const am = timeToMinutes(a.start_time) ?? 0;
      const bm = timeToMinutes(b.start_time) ?? 0;
      return am - bm;
    });
}

/** First window for a day (legacy helpers / shift prefills). */
export function availabilityForDay(
  rows: TechnicianAvailability[],
  technicianId: string,
  dayOfWeek: number,
): TechnicianAvailability | null {
  return availabilityWindowsForDay(rows, technicianId, dayOfWeek)[0] ?? null;
}

/** Display one or two preferred windows, e.g. "8:00 AM – 12:00 PM · 3:00 PM – 7:00 PM". */
export function formatAvailabilityClocks(windows: TechnicianAvailability[]): string {
  const usable = windows.filter((w) => w.is_available);
  if (usable.length === 0) return "";
  return usable.map((w) => formatShiftClock(w.start_time, w.end_time)).join(" · ");
}

export type AvailabilityWindowInput = { start_time: string; end_time: string };

export function validateAvailabilityWindows(
  windows: AvailabilityWindowInput[],
): string | null {
  if (windows.length < 1 || windows.length > 2) {
    return "Add one or two time windows.";
  }
  for (let i = 0; i < windows.length; i++) {
    const start = timeToMinutes(windows[i]!.start_time);
    const end = timeToMinutes(windows[i]!.end_time);
    if (start == null || end == null) return "Enter valid start and end times.";
    if (end <= start) return `Window ${i + 1}: end time must be after start time.`;
  }
  if (windows.length === 2) {
    const firstEnd = timeToMinutes(windows[0]!.end_time)!;
    const secondStart = timeToMinutes(windows[1]!.start_time)!;
    if (secondStart < firstEnd) {
      return "Second window must start at or after the first window ends.";
    }
  }
  return null;
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

  let q = supabase
    .from("technician_availability")
    .select("*")
    .order("day_of_week")
    .order("start_time");
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
    is_available: boolean;
    note?: string | null;
    /** One or two preferred windows when available. Ignored shape when unavailable (placeholder kept). */
    windows?: AvailabilityWindowInput[];
    /** @deprecated Prefer `windows`. Single-window convenience for templates. */
    start_time?: string;
    end_time?: string;
  },
): Promise<{ data: TechnicianAvailability[]; error: string | null }> {
  const now = new Date().toISOString();
  const mode = await detectScheduleStorage(supabase);

  let windows: AvailabilityWindowInput[];
  if (!input.is_available) {
    windows = [
      {
        start_time: input.start_time ?? input.windows?.[0]?.start_time ?? "08:00",
        end_time: input.end_time ?? input.windows?.[0]?.end_time ?? "17:00",
      },
    ];
  } else if (input.windows?.length) {
    windows = input.windows;
  } else if (input.start_time && input.end_time) {
    windows = [{ start_time: input.start_time, end_time: input.end_time }];
  } else {
    return { data: [], error: "Add at least one time window." };
  }

  if (input.is_available) {
    const invalid = validateAvailabilityWindows(windows);
    if (invalid) return { data: [], error: invalid };
  }

  const normalized = windows.map((w) => ({
    start_time: normalizeTime(w.start_time),
    end_time: normalizeTime(w.end_time),
  }));

  if (mode === "local") {
    const all = readJson<TechnicianAvailability[]>(KEY_AVAIL, []);
    const withoutDay = all.filter(
      (r) =>
        !(r.technician_id === input.technician_id && r.day_of_week === input.day_of_week),
    );
    const rows: TechnicianAvailability[] = normalized.map((w) => ({
      id: newId(),
      technician_id: input.technician_id,
      day_of_week: input.day_of_week,
      start_time: w.start_time,
      end_time: w.end_time,
      is_available: input.is_available,
      note: input.note ?? null,
      created_at: now,
      updated_at: now,
    }));
    writeJson(KEY_AVAIL, [...withoutDay, ...rows]);
    return { data: rows, error: null };
  }

  // Replace all windows for this weekday (supports split shifts via multiple rows).
  const { error: deleteError } = await supabase
    .from("technician_availability")
    .delete()
    .eq("technician_id", input.technician_id)
    .eq("day_of_week", input.day_of_week);

  if (deleteError) {
    if (isSchemaMissing(deleteError.message)) {
      storageMode = "local";
      return saveDayAvailability(supabase, input);
    }
    return { data: [], error: deleteError.message };
  }

  const { data, error } = await supabase
    .from("technician_availability")
    .insert(
      normalized.map((w) => ({
        technician_id: input.technician_id,
        day_of_week: input.day_of_week,
        start_time: w.start_time,
        end_time: w.end_time,
        is_available: input.is_available,
        note: input.note ?? null,
      })),
    )
    .select();

  if (error) {
    if (isSchemaMissing(error.message)) {
      storageMode = "local";
      return saveDayAvailability(supabase, input);
    }
    return { data: [], error: error.message };
  }
  return { data: (data as TechnicianAvailability[]) ?? [], error: null };
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
