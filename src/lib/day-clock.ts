/**
 * Technician day attendance (arrive / leave work).
 * Independent of job labor punches on JobSheet.
 * Falls back to localStorage when the table is missing.
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
  if (storageMode !== "local") {
    try {
      const { data, error } = await supabase
        .from("technician_day_clocks")
        .select("*")
        .eq("technician_id", technicianId)
        .is("clock_out_at", null)
        .order("clock_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (isSchemaMissing(error.message)) {
          storageMode = "local";
        } else {
          throw new Error(error.message);
        }
      } else {
        storageMode = "remote";
        return (data as TechnicianDayClock | null) ?? null;
      }
    } catch (e) {
      if (!isSchemaMissing(errMessage(e))) throw e instanceof Error ? e : new Error(errMessage(e));
      storageMode = "local";
    }
  }

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

  if (storageMode !== "local") {
    try {
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

      if (error) {
        if (isSchemaMissing(error.message)) {
          storageMode = "local";
        } else {
          throw new Error(error.message);
        }
      } else {
        storageMode = "remote";
        return data as TechnicianDayClock;
      }
    } catch (e) {
      if (!isSchemaMissing(errMessage(e))) throw e instanceof Error ? e : new Error(errMessage(e));
      storageMode = "local";
    }
  }

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

  if (storageMode !== "local" && !active.id.startsWith("local-")) {
    try {
      const { data, error } = await supabase
        .from("technician_day_clocks")
        .update({ clock_out_at: now, updated_at: now })
        .eq("id", active.id)
        .eq("technician_id", technicianId)
        .is("clock_out_at", null)
        .select("*")
        .single();

      if (error) {
        if (isSchemaMissing(error.message)) {
          storageMode = "local";
        } else {
          throw new Error(error.message);
        }
      } else {
        storageMode = "remote";
        return data as TechnicianDayClock;
      }
    } catch (e) {
      if (!isSchemaMissing(errMessage(e))) throw e instanceof Error ? e : new Error(errMessage(e));
      storageMode = "local";
    }
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
