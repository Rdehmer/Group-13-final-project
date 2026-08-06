/**
 * Helpers for technician time-off schedule blocks.
 */

import { addDays, format, parseISO } from "date-fns";

export type TimeOffRange = {
  id: string;
  technician_id: string;
  start_date: string;
  end_date: string;
  status: string;
  reason?: string | null;
  /** Optional display name from profiles join. */
  technician_name?: string | null;
};

/** Normalize DB / form dates to `yyyy-MM-dd` for range checks. */
export function normalizeDateIso(value: string | null | undefined): string {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  // Prefer prefix match for Postgres `date` / ISO timestamps.
  const head = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  // MM/DD/YYYY or M/D/YYYY (some form locales)
  const us = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  try {
    const d = parseISO(raw);
    if (!Number.isNaN(d.getTime())) return format(d, "yyyy-MM-dd");
  } catch {
    /* fall through */
  }
  // Last resort: Date parse (local)
  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) return format(fallback, "yyyy-MM-dd");
  return head;
}

export function isDateInRange(dayIso: string, start: string, end: string): boolean {
  const day = normalizeDateIso(dayIso);
  const s = normalizeDateIso(start);
  const e = normalizeDateIso(end);
  if (!day || !s || !e) return false;
  return day >= s && day <= e;
}

export function isApprovedTimeOff(status: string): boolean {
  const s = (status ?? "").trim().toLowerCase();
  // DB constraint uses "Approved"; accept common variants.
  return s === "approved" || s === "approve" || s === "accepted";
}

/** Inclusive calendar days covered by an approved request. */
export function timeOffCoversDay(range: TimeOffRange, dayIso: string): boolean {
  if (!isApprovedTimeOff(range.status)) return false;
  return isDateInRange(dayIso, range.start_date, range.end_date);
}

export function formatTimeOffLabel(start: string, end: string): string {
  const s = normalizeDateIso(start);
  const e = normalizeDateIso(end);
  return s === e ? s : `${s} → ${e}`;
}

/** Expand an approved range into each covered `yyyy-MM-dd` (cap 366 days). */
export function expandTimeOffDayKeys(range: TimeOffRange): string[] {
  if (!isApprovedTimeOff(range.status)) return [];
  const start = normalizeDateIso(range.start_date);
  const end = normalizeDateIso(range.end_date);
  if (!start || !end || end < start) return [];
  const days: string[] = [];
  let cursor = parseISO(start);
  const last = parseISO(end);
  for (let i = 0; i < 366; i += 1) {
    const key = format(cursor, "yyyy-MM-dd");
    days.push(key);
    if (key >= end || cursor >= last) break;
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Map day → approved leave rows covering that day. */
export function timeOffByDayMap(ranges: TimeOffRange[]): Map<string, TimeOffRange[]> {
  const map = new Map<string, TimeOffRange[]>();
  for (const range of ranges) {
    if (!isApprovedTimeOff(range.status)) continue;
    for (const day of expandTimeOffDayKeys(range)) {
      const list = map.get(day) ?? [];
      list.push(range);
      map.set(day, list);
    }
  }
  return map;
}

/** Approved ranges that include this calendar day (any technician or one id). */
export function approvedTimeOffOnDay(
  ranges: TimeOffRange[],
  dayIso: string,
  technicianId?: string,
): TimeOffRange[] {
  const day = normalizeDateIso(dayIso);
  return ranges.filter(
    (r) =>
      isApprovedTimeOff(r.status) &&
      isDateInRange(day, r.start_date, r.end_date) &&
      (!technicianId || r.technician_id === technicianId),
  );
}

export function technicianOnApprovedTimeOff(
  ranges: TimeOffRange[],
  technicianId: string | null | undefined,
  dayIso: string | null | undefined,
): boolean {
  if (!technicianId || !dayIso) return false;
  return approvedTimeOffOnDay(ranges, dayIso, technicianId).length > 0;
}

/** Normalize API rows (trim status, normalize dates). */
export function normalizeTimeOffRows(rows: TimeOffRange[] | null | undefined): TimeOffRange[] {
  if (!rows?.length) return [];
  return rows.map((r) => {
    const raw = r as TimeOffRange & {
      technician?: { full_name?: string | null; email?: string | null } | null;
    };
    const joinedName =
      raw.technician_name?.trim() ||
      raw.technician?.full_name?.trim() ||
      raw.technician?.email?.trim() ||
      null;
    return {
      id: String(raw.id ?? ""),
      technician_id: String(raw.technician_id ?? ""),
      start_date: normalizeDateIso(raw.start_date),
      end_date: normalizeDateIso(raw.end_date),
      status: String(raw.status ?? "").trim(),
      reason: raw.reason ?? null,
      technician_name: joinedName,
    };
  });
}

/** Keep only approved leave for schedule paint/blocks. */
export function filterApprovedTimeOff(rows: TimeOffRange[] | null | undefined): TimeOffRange[] {
  return normalizeTimeOffRows(rows).filter((r) => isApprovedTimeOff(r.status));
}

/**
 * Load time-off rows the same way as the Time Off Requests tab (join tech names).
 * Filters to approved for the schedule; falls back if the join/columns fail.
 */
export async function loadScheduleTimeOff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any },
): Promise<{ rows: TimeOffRange[]; error: string | null }> {
  const withJoin = await supabase
    .from("time_off_requests")
    .select(
      "id, technician_id, start_date, end_date, status, reason, technician:profiles!time_off_requests_technician_id_fkey(id, full_name, email)",
    )
    .order("start_date", { ascending: true });

  if (!withJoin.error) {
    return { rows: filterApprovedTimeOff(withJoin.data as TimeOffRange[]), error: null };
  }

  const plain = await supabase
    .from("time_off_requests")
    .select("id, technician_id, start_date, end_date, status, reason")
    .order("start_date", { ascending: true });

  if (!plain.error) {
    return { rows: filterApprovedTimeOff(plain.data as TimeOffRange[]), error: null };
  }

  const minimal = await supabase
    .from("time_off_requests")
    .select("id, technician_id, start_date, end_date, status")
    .order("start_date", { ascending: true });

  if (!minimal.error) {
    return { rows: filterApprovedTimeOff(minimal.data as TimeOffRange[]), error: null };
  }

  return {
    rows: [],
    error: minimal.error?.message || plain.error?.message || withJoin.error.message,
  };
}
