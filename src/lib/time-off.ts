/**
 * Helpers for technician time-off schedule blocks.
 */

export type TimeOffRange = {
  id: string;
  technician_id: string;
  start_date: string;
  end_date: string;
  status: string;
};

export function isDateInRange(dayIso: string, start: string, end: string): boolean {
  return dayIso >= start.slice(0, 10) && dayIso <= end.slice(0, 10);
}

export function isApprovedTimeOff(status: string): boolean {
  return (status ?? "").toLowerCase() === "approved";
}

/** Inclusive calendar days covered by an approved request. */
export function timeOffCoversDay(range: TimeOffRange, dayIso: string): boolean {
  if (!isApprovedTimeOff(range.status)) return false;
  return isDateInRange(dayIso, range.start_date, range.end_date);
}

export function formatTimeOffLabel(start: string, end: string): string {
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  return s === e ? s : `${s} → ${e}`;
}
