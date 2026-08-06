/**
 * Technician day attendance (arrive / leave work).
 * Independent of job labor punches on JobSheet.
 * Prefers Supabase `technician_day_clocks`; falls back to localStorage if the table is missing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";
import type { TechnicianDayClock } from "@/lib/types";

const KEY = "ridley_tech_day_clocks_v1";

type StorageMode = "remote" | "local" | "unknown";
let storageMode: StorageMode = "unknown";

function isSchemaMissing(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find") ||
    m.includes("technician_day_clocks")
  );
}

function todayIso(d = new Date()) {
  return format(d, "yyyy-MM-dd");
}

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readStore(): TechnicianDayClock[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TechnicianDayClock[];
  } catch {
    return [];
  }
}

function writeStore(rows: TechnicianDayClock[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(rows));
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e ?? "Unknown error");
}

/** Always prefer remote when the table exists (recover after a prior missing-table fallback). */
async function tryRemote<T>(fn: () => Promise<T>): Promise<T | "schema_missing"> {
  try {
    const result = await fn();
    storageMode = "remote";
    return result;
  } catch (e) {
    if (isSchemaMissing(errMessage(e))) {
      storageMode = "local";
      return "schema_missing";
    }
    throw e instanceof Error ? e : new Error(errMessage(e));
  }
}

export function formatDayClockSince(iso: string): string {
  try {
    return format(new Date(iso), "h:mm a");
  } catch {
    return iso;
  }
}

export async function getActiveDayClock(
  supabase: SupabaseClient,
  technicianId: string,
): Promise<TechnicianDayClock | null> {
  const remote = await tryRemote(async () => {
    const { data, error } = await supabase
      .from("technician_day_clocks")
      .select("*")
      .eq("technician_id", technicianId)
      .is("clock_out_at", null)
      .order("clock_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (isSchemaMissing(error.message)) throw new Error(error.message);
      throw new Error(error.message);
    }
    return (data as TechnicianDayClock | null) ?? null;
  });
  if (remote !== "schema_missing") return remote;

  const open = readStore().find(
    (r) => r.technician_id === technicianId && !r.clock_out_at,
  );
  return open ?? null;
}

export async function clockInDay(
  supabase: SupabaseClient,
  technicianId: string,
): Promise<TechnicianDayClock> {
  const existing = await getActiveDayClock(supabase, technicianId);
  if (existing) {
    throw new Error(
      `Already clocked in since ${formatDayClockSince(existing.clock_in_at)}. Clock out first.`,
    );
  }

  const now = new Date();
  const row: TechnicianDayClock = {
    id: newId(),
    technician_id: technicianId,
    work_date: todayIso(now),
    clock_in_at: now.toISOString(),
    clock_out_at: null,
    notes: "My Day shift clock-in",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const remote = await tryRemote(async () => {
    const { data, error } = await supabase
      .from("technician_day_clocks")
      .insert({
        technician_id: row.technician_id,
        work_date: row.work_date,
        clock_in_at: row.clock_in_at,
        notes: row.notes,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as TechnicianDayClock;
  });
  if (remote !== "schema_missing") return remote;

  const store = readStore().filter(
    (r) => !(r.technician_id === technicianId && !r.clock_out_at),
  );
  store.push(row);
  writeStore(store);
  return row;
}

export async function clockOutDay(
  supabase: SupabaseClient,
  technicianId: string,
): Promise<TechnicianDayClock> {
  const active = await getActiveDayClock(supabase, technicianId);
  if (!active) {
    throw new Error("Not clocked in. Clock in when you start your day.");
  }

  const now = new Date().toISOString();

  if (!active.id.startsWith("local-")) {
    const remote = await tryRemote(async () => {
      const { data, error } = await supabase
        .from("technician_day_clocks")
        .update({ clock_out_at: now, updated_at: now })
        .eq("id", active.id)
        .eq("technician_id", technicianId)
        .is("clock_out_at", null)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data as TechnicianDayClock;
    });
    if (remote !== "schema_missing") return remote;
  }

  const store = readStore();
  const idx = store.findIndex((r) => r.id === active.id);
  const closed: TechnicianDayClock = {
    ...active,
    clock_out_at: now,
    updated_at: now,
  };
  if (idx >= 0) store[idx] = closed;
  else store.push(closed);
  writeStore(store);
  return closed;
}

/** Hours for one day-clock row (live elapsed if still open). */
export function hoursFromDayClock(row: TechnicianDayClock, now = new Date()): number {
  const end = row.clock_out_at ? new Date(row.clock_out_at) : now;
  const ms = end.getTime() - new Date(row.clock_in_at).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** Load all day clocks for a tech on a given work_date (yyyy-MM-dd). */
export async function loadDayClocksForDate(
  supabase: SupabaseClient,
  technicianId: string,
  workDate: string,
): Promise<TechnicianDayClock[]> {
  return loadDayClocksForRange(supabase, technicianId, workDate, workDate);
}

/** Load day clocks for a tech between two work_dates (inclusive). */
export async function loadDayClocksForRange(
  supabase: SupabaseClient,
  technicianId: string,
  fromDate: string,
  toDate: string,
): Promise<TechnicianDayClock[]> {
  return loadDayClocksForTechnicians(supabase, [technicianId], fromDate, toDate);
}

/**
 * Load My Day clocks for one or more technicians in a date range.
 * Empty technicianIds → all techs in range (managers / billing rollup).
 */
export async function loadDayClocksForTechnicians(
  supabase: SupabaseClient,
  technicianIds: string[] | "all",
  fromDate: string,
  toDate: string,
): Promise<TechnicianDayClock[]> {
  const remote = await tryRemote(async () => {
    let q = supabase
      .from("technician_day_clocks")
      .select("*")
      .gte("work_date", fromDate)
      .lte("work_date", toDate)
      .order("clock_in_at", { ascending: true });
    if (technicianIds !== "all" && technicianIds.length > 0) {
      q = q.in("technician_id", technicianIds);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as TechnicianDayClock[]) ?? [];
  });
  if (remote !== "schema_missing") return remote;

  return readStore()
    .filter((r) => {
      if (r.work_date < fromDate || r.work_date > toDate) return false;
      if (technicianIds === "all") return true;
      return technicianIds.includes(r.technician_id);
    })
    .sort((a, b) => a.clock_in_at.localeCompare(b.clock_in_at));
}

/**
 * Today hours = clock_out − clock_in for that work_date.
 * Week hours = sum of those day totals across the loaded range.
 */
export function sumDayClockHours(rows: TechnicianDayClock[], now = new Date()): number {
  return Math.round(rows.reduce((sum, row) => sum + hoursFromDayClock(row, now), 0) * 100) / 100;
}

export function sumTodayAndWeekDayClockHours(
  weekRows: TechnicianDayClock[],
  dayIso: string,
  now = new Date(),
): { todayHours: number; weekHours: number } {
  const todayRows = weekRows.filter((r) => r.work_date === dayIso);
  return {
    todayHours: sumDayClockHours(todayRows, now),
    weekHours: sumDayClockHours(weekRows, now),
  };
}

function dayKey(technicianId: string, workDate: string) {
  return `${technicianId}|${workDate}`;
}

/** Upload browser-local My Day clocks to Supabase once the table exists. */
export async function syncLocalDayClocksToRemote(supabase: SupabaseClient): Promise<number> {
  const local = readStore();
  if (!local.length) return 0;

  let uploaded = 0;
  const keep: TechnicianDayClock[] = [];

  for (const row of local) {
    // Skip open locals if remote already has an open punch for this tech
    if (!row.clock_out_at) {
      const active = await getActiveDayClock(supabase, row.technician_id);
      if (active && !active.id.startsWith("local-")) {
        continue;
      }
    }

    const remote = await tryRemote(async () => {
      const { data, error } = await supabase
        .from("technician_day_clocks")
        .insert({
          technician_id: row.technician_id,
          work_date: row.work_date,
          clock_in_at: row.clock_in_at,
          clock_out_at: row.clock_out_at,
          notes: row.notes ?? "Synced from local My Day clock",
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data as TechnicianDayClock;
    });

    if (remote === "schema_missing") {
      keep.push(row);
      continue;
    }
    uploaded += 1;
  }

  writeStore(keep);
  return uploaded;
}

type PunchLike = {
  id?: string;
  technician_id: string;
  entry_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  approval_status?: string | null;
  is_void?: boolean | null;
  deleted_at?: string | null;
};

/**
 * Build My Day–style day clocks from timesheet face punches
 * (earliest clock-in → latest clock-out per tech per day).
 */
export function dayClocksFromTimeEntries(entries: PunchLike[], now = new Date()): TechnicianDayClock[] {
  type Acc = {
    technician_id: string;
    work_date: string;
    clock_in_at: string;
    clock_out_at: string | null;
    open: boolean;
  };
  const map = new Map<string, Acc>();

  for (const e of entries) {
    if (e.is_void || e.deleted_at) continue;
    if (e.approval_status === "rejected") continue;
    if (!e.clock_in_at) continue;
    const key = dayKey(e.technician_id, e.entry_date);
    const open =
      !e.clock_out_at &&
      (e.approval_status === "active" || e.approval_status === "missing_clock_out" || !e.clock_out_at);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        technician_id: e.technician_id,
        work_date: e.entry_date,
        clock_in_at: e.clock_in_at,
        clock_out_at: e.clock_out_at,
        open: open || !e.clock_out_at,
      });
      continue;
    }
    if (e.clock_in_at < existing.clock_in_at) existing.clock_in_at = e.clock_in_at;
    if (!e.clock_out_at) {
      existing.open = true;
      existing.clock_out_at = null;
    } else if (!existing.open) {
      if (!existing.clock_out_at || e.clock_out_at > existing.clock_out_at) {
        existing.clock_out_at = e.clock_out_at;
      }
    }
  }

  const nowIso = now.toISOString();
  return [...map.values()].map((row) => ({
    id: `derived-${row.technician_id}-${row.work_date}`,
    technician_id: row.technician_id,
    work_date: row.work_date,
    clock_in_at: row.clock_in_at,
    clock_out_at: row.open ? null : row.clock_out_at,
    notes: "Derived from timesheet punches",
    created_at: nowIso,
    updated_at: nowIso,
  }));
}

/** Prefer real My Day rows; fill gaps from timesheet-derived day clocks. */
export function mergeDayClocksWithDerived(
  remoteOrLocal: TechnicianDayClock[],
  derived: TechnicianDayClock[],
): TechnicianDayClock[] {
  const covered = new Set(remoteOrLocal.map((r) => dayKey(r.technician_id, r.work_date)));
  const extras = derived.filter((d) => !covered.has(dayKey(d.technician_id, d.work_date)));
  return [...remoteOrLocal, ...extras].sort((a, b) => a.clock_in_at.localeCompare(b.clock_in_at));
}

/**
 * Persist derived closed day clocks so billing/timesheet rollups stay on technician_day_clocks.
 * Skips open punches (unique open index) and days that already exist.
 */
export async function persistMissingDayClocks(
  supabase: SupabaseClient,
  rows: TechnicianDayClock[],
): Promise<number> {
  const closed = rows.filter((r) => r.clock_out_at && r.id.startsWith("derived-"));
  if (!closed.length) return 0;

  let saved = 0;
  for (const row of closed) {
    const remote = await tryRemote(async () => {
      const { data: existing, error: existingError } = await supabase
        .from("technician_day_clocks")
        .select("id")
        .eq("technician_id", row.technician_id)
        .eq("work_date", row.work_date)
        .limit(1);
      if (existingError) throw new Error(existingError.message);
      if (existing && existing.length > 0) return null;

      const { data, error } = await supabase
        .from("technician_day_clocks")
        .insert({
          technician_id: row.technician_id,
          work_date: row.work_date,
          clock_in_at: row.clock_in_at,
          clock_out_at: row.clock_out_at,
          notes: "Backfilled from timesheet punches",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data;
    });
    if (remote && remote !== "schema_missing") saved += 1;
  }
  return saved;
}
