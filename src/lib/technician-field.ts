import { format, isSameDay, isBefore, parseISO, startOfDay } from "date-fns";
import type { WorkOrder } from "@/lib/types";
import {
  customerName,
  parseFlexibleTime,
  withDerivedTimes,
  type ScheduleWo,
} from "@/lib/technician-schedule";

export type FieldJob = ScheduleWo & {
  customers?: {
    id?: string;
    name: string;
    phone?: string | null;
    service_address?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
};

export type QueueSection = "now" | "later" | "closeout";

const PRIORITY_RANK: Record<string, number> = {
  Critical: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

export function todayIso(now = new Date()): string {
  return format(now, "yyyy-MM-dd");
}

/** Local `HH:mm` for ServiceTitan-style Add Entry start prefills. */
export function nowTimeInput(now = new Date()): string {
  return format(now, "HH:mm");
}

export const TIMESHEET_ACTIVITIES = ["Working", "Travel", "Meal Break", "Other"] as const;
export type TimesheetActivity = (typeof TIMESHEET_ACTIVITIES)[number];

export function splitRegularOt(totalHours: number): { regular_hours: number; overtime_hours: number } {
  const hours = Math.max(0, totalHours);
  return {
    regular_hours: Math.round(Math.min(hours, 8) * 100) / 100,
    overtime_hours: Math.round(Math.max(0, hours - 8) * 100) / 100,
  };
}

export function formatElapsedLabel(startIso: string, now = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(startIso).getTime());
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function timesheetActivityLabel(notes: string | null | undefined): string {
  const raw = (notes ?? "").trim();
  if (!raw) return "Working";
  const match = TIMESHEET_ACTIVITIES.find((a) => raw === a || raw.startsWith(`${a} —`) || raw.startsWith(`${a}:`));
  return match ?? "Working";
}

export function formatTimesheetNotes(activity: TimesheetActivity, memo: string): string {
  const trimmed = memo.trim();
  if (!trimmed) return activity;
  return `${activity} — ${trimmed}`;
}

export function isOpenJob(wo: Pick<WorkOrder, "status">): boolean {
  return !["Completed", "Closed", "Canceled"].includes(wo.status);
}

export function isCloseoutNeeded(wo: ScheduleWo, now = new Date()): boolean {
  if (!isOpenJob(wo) || !wo.scheduled_date) return false;
  try {
    const day = startOfDay(parseISO(wo.scheduled_date));
    return isBefore(day, startOfDay(now));
  } catch {
    return false;
  }
}

export function isTodayJob(wo: ScheduleWo, now = new Date()): boolean {
  if (!wo.scheduled_date) return false;
  try {
    return isSameDay(parseISO(wo.scheduled_date), now);
  } catch {
    return false;
  }
}

export function sortFieldJobs(jobs: FieldJob[]): FieldJob[] {
  return [...jobs].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 9;
    const pb = PRIORITY_RANK[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    const sa = parseFlexibleTime(a.scheduled_start_time) ?? 24 * 60;
    const sb = parseFlexibleTime(b.scheduled_start_time) ?? 24 * 60;
    if (sa !== sb) return sa - sb;
    return a.work_order_number.localeCompare(b.work_order_number);
  });
}

export function partitionMyDay(jobs: FieldJob[], now = new Date()) {
  const open = jobs.filter(isOpenJob);
  const closeout = sortFieldJobs(open.filter((j) => isCloseoutNeeded(j, now)));
  const today = sortFieldJobs(open.filter((j) => isTodayJob(j, now) && !isCloseoutNeeded(j, now)));
  const upcoming = sortFieldJobs(
    open.filter((j) => !isTodayJob(j, now) && !isCloseoutNeeded(j, now)),
  );
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const nowNext: FieldJob[] = [];
  const later: FieldJob[] = [];

  for (const job of today) {
    const timed = withDerivedTimes(job);
    const inFlight =
      job.status === "In Progress" ||
      job.dispatch_status === "Arrived" ||
      job.dispatch_status === "Working" ||
      job.dispatch_status === "Paused";
    const startingSoon = timed.startMinutes <= nowMinutes + 45;
    if (inFlight || (nowNext.length === 0 && startingSoon) || nowNext.length === 0) {
      if (nowNext.length < 2 || inFlight) nowNext.push(job);
      else later.push(job);
    } else {
      later.push(job);
    }
  }

  // If nothing today, surface the next upcoming job in Now/Next so techs always have a next action.
  if (nowNext.length === 0 && upcoming.length > 0) {
    nowNext.push(upcoming[0]!);
  }

  return {
    nowNext,
    later,
    closeout,
    upcoming: upcoming.filter((j) => !nowNext.some((n) => n.id === j.id)),
  };
}

export function jobAddress(job: FieldJob): string {
  const c = job.customers;
  if (!c) return "";
  const parts = [c.service_address, c.city, c.state].filter(Boolean);
  return parts.join(", ");
}

export function jobPhone(job: FieldJob): string | null {
  const raw = job.customers?.phone?.trim();
  return raw || null;
}

/** tel: link digits (keep leading + for international). */
export function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : `tel:${phone}`;
}

/** Open route in maps app / Google Maps. */
export function mapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

/** Friendlier messages for common field errors (storage, RLS, proof, network). */
export function humanizeFieldError(message: string | null | undefined): string {
  const raw = (message ?? "").trim();
  if (!raw) return "Something went wrong. Try again.";
  const lower = raw.toLowerCase();
  if (lower.includes("does not exist") || lower.includes("schema cache")) {
    return "This feature is not set up in the database yet. Ask a manager to apply the latest migrations.";
  }
  if (lower.includes("photo") || lower.includes("signature") || lower.includes("proof")) {
    return "Completion needs a finished-work photo or customer signature. Capture proof and try again.";
  }
  if (lower.includes("bucket") || lower.includes("storage") || lower.includes("object not found")) {
    return "Could not upload the completion photo. Check camera permissions and try a smaller image.";
  }
  if (lower.includes("permission") || lower.includes("row-level") || lower.includes("policy") || lower.includes("jwt")) {
    return "You do not have permission for that action, or your session expired. Sign out and back in.";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch")) {
    return "Network issue — check signal and tap retry. Changes may not have saved.";
  }
  if (lower.includes("not authenticated") || lower.includes("session")) {
    return "Your session expired. Sign in again, then retry.";
  }
  return raw;
}

export function jobTimeLabel(job: FieldJob): string {
  const timed = withDerivedTimes(job);
  if (!job.scheduled_start_time && !job.estimated_labor_hours) return "Time TBD";
  return `${timed.startLabel} – ${timed.endLabel}`;
}

export function nextChecklistStep(
  job: Pick<WorkOrder, "arrival_at" | "started_at" | "status" | "dispatch_status">,
): "arrived" | "working" | "complete" | "done" {
  if (["Completed", "Closed", "Ready for Review"].includes(job.status)) return "done";
  if (job.started_at || job.dispatch_status === "Working") return "complete";
  if (job.arrival_at || job.dispatch_status === "Arrived") return "working";
  return "arrived";
}

export function priorityBarClass(priority: string): string {
  switch (priority) {
    case "Critical":
      return "bg-error";
    case "High":
      return "bg-warning";
    case "Low":
      return "bg-base-300";
    default:
      return "bg-info";
  }
}

/** True when part/labor may be outside contract coverage. */
export function isOutOfScope(
  job: Pick<WorkOrder, "warranty_coverage" | "contract_id" | "under_expired_contract">,
  kind: "part" | "labor",
): boolean {
  if (job.under_expired_contract) return true;
  if (!job.contract_id) return true;
  const coverage = job.warranty_coverage ?? "";
  if (coverage === "Not Covered") return true;
  if (kind === "labor" && coverage === "Parts Only") return true;
  if (kind === "part" && coverage === "Labor Covered") return true;
  return false;
}

export function hoursBetween(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0.25;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** Hours between local `HH:mm` or `HH:mm:ss` clock values (same calendar day). */
export function hoursFromTimeRange(start: string, end: string): number | null {
  const startMin = parseFlexibleTime(start.length === 5 ? `${start}:00` : start);
  const endMin = parseFlexibleTime(end.length === 5 ? `${end}:00` : end);
  if (startMin == null || endMin == null) return null;
  if (endMin <= startMin) return null;
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

/** Normalize time for display (strip seconds if present). */
export function formatLaborClock(time: string | null | undefined): string {
  if (!time) return "—";
  const raw = String(time).trim();
  if (raw.length >= 5) return raw.slice(0, 5);
  return raw;
}

/** Ensure DB time value includes seconds. */
export function toDbTime(time: string): string {
  const trimmed = time.trim();
  if (/^\d{2}:\d{2}:\d{2}/.test(trimmed)) return trimmed.slice(0, 8);
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  return trimmed;
}

export function formatDiagnosticNotes(parts: {
  symptom: string;
  cause: string;
  action: string;
}): { technician_notes: string | null; work_performed: string | null; equipment_condition: string | null } {
  const symptom = parts.symptom.trim();
  const cause = parts.cause.trim();
  const action = parts.action.trim();
  const technician_notes = [symptom && `Symptom: ${symptom}`, cause && `Cause: ${cause}`]
    .filter(Boolean)
    .join("\n");
  return {
    equipment_condition: symptom || null,
    technician_notes: technician_notes || null,
    work_performed: action || null,
  };
}

export function parseDiagnosticNotes(job: {
  technician_notes?: string | null;
  work_performed?: string | null;
  equipment_condition?: string | null;
}): { symptom: string; cause: string; action: string } {
  const notes = job.technician_notes ?? "";
  const symptomMatch = notes.match(/Symptom:\s*([\s\S]*?)(?=\nCause:|$)/i);
  const causeMatch = notes.match(/Cause:\s*([\s\S]*?)$/i);
  return {
    symptom: (symptomMatch?.[1] ?? job.equipment_condition ?? "").trim(),
    cause: (causeMatch?.[1] ?? "").trim(),
    action: (job.work_performed ?? "").trim(),
  };
}

export { customerName };
