import { format, isSameDay, isBefore, parseISO, startOfDay } from "date-fns";
import type { WorkOrder } from "@/lib/types";
import { isActiveDispatchJob } from "@/lib/dispatch-flow";
import {
  customerName,
  parseFlexibleTime,
  withDerivedTimes,
  type ScheduleWo,
} from "@/lib/technician-schedule";
import { isOutOfScope as coverageIsOutOfScope } from "@/lib/coverage";

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

/** Local `HH:mm:ss` for Add Entry start prefills. */
export function nowTimeInput(now = new Date()): string {
  return format(now, "HH:mm:ss");
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
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

/** Job currently in the field pipeline (not Done/Completed). */
export function findActiveFieldJob(jobs: FieldJob[]): FieldJob | null {
  const active = sortFieldJobs(jobs.filter((j) => isOpenJob(j) && isActiveDispatchJob(j)));
  return active[0] ?? null;
}

/**
 * Which job cards can be opened on My Day.
 * - If any job is active: only that job.
 * - Else: only the highest-priority open job (Not Started / Scheduled).
 */
export function canOpenFieldJob(job: FieldJob, jobs: FieldJob[]): boolean {
  if (!isOpenJob(job)) return false;
  const active = findActiveFieldJob(jobs);
  if (active) return active.id === job.id;
  const unlocked = sortFieldJobs(jobs.filter(isOpenJob))[0];
  return unlocked?.id === job.id;
}

export function fieldJobLockReason(job: FieldJob, jobs: FieldJob[]): string | null {
  if (canOpenFieldJob(job, jobs)) return null;
  const active = findActiveFieldJob(jobs);
  if (active) {
    return `Finish ${active.work_order_number} first`;
  }
  const top = sortFieldJobs(jobs.filter(isOpenJob))[0];
  if (top && top.id !== job.id) {
    return `Complete higher-priority ${top.work_order_number} first`;
  }
  return "Job locked";
}

export function partitionMyDay(jobs: FieldJob[], now = new Date()) {
  const open = jobs.filter(isOpenJob);
  const closeout = sortFieldJobs(open.filter((j) => isCloseoutNeeded(j, now)));
  const today = sortFieldJobs(open.filter((j) => isTodayJob(j, now) && !isCloseoutNeeded(j, now)));
  const upcoming = sortFieldJobs(
    open.filter((j) => !isTodayJob(j, now) && !isCloseoutNeeded(j, now)),
  );
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let nowNext: FieldJob[] = [];
  const later: FieldJob[] = [];

  for (const job of today) {
    const timed = withDerivedTimes(job);
    const inFlight = isActiveDispatchJob(job);
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

  // Active (or highest-priority) job always leads Now/Next.
  const active = findActiveFieldJob(open);
  if (active) {
    nowNext = [active, ...nowNext.filter((j) => j.id !== active.id)];
  } else {
    nowNext = sortFieldJobs(nowNext);
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

/** Digits only (strip formatting). Keeps a leading + for international. */
export function phoneDigits(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }
  return trimmed.replace(/\D/g, "");
}

/**
 * Show the full customer number clearly, including area code.
 * US 10-digit (or 11 with leading 1) → (XXX) XXX-XXXX. Otherwise keep original.
 */
export function formatCustomerPhone(phone: string): string {
  const digits = phoneDigits(phone).replace(/^\+/, "");
  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return phone.trim();
}

/** tel: link digits (keep leading + for international). */
export function telHref(phone: string): string {
  const cleaned = phoneDigits(phone);
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
  if (lower.includes("labor_time_order") || (lower.includes("start") && lower.includes("end") && lower.includes("check"))) {
    return "Timesheet end time must be after the start time. Try Complete again — the clock window will be adjusted automatically.";
  }
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

/** Time-of-day greeting for field tech home. */
export function greetForTime(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function firstNameFromProfile(fullName: string | null | undefined, email?: string | null): string {
  const name = fullName?.trim();
  if (name) return name.split(/\s+/)[0] ?? name;
  const local = email?.split("@")[0]?.trim();
  return local || "Tech";
}

export function isActivelyWorking(
  job: Pick<WorkOrder, "status" | "dispatch_status" | "started_at" | "arrival_at">,
): boolean {
  if (!isOpenJob(job)) return false;
  return (
    job.dispatch_status === "Working" ||
    (Boolean(job.started_at) && nextChecklistStep(job) === "complete")
  );
}

/** Short label for schedule cards, e.g. "Starts in 20m" or "Started 9:00". */
export function relativeScheduleHint(job: FieldJob, now = new Date()): string | null {
  if (!isTodayJob(job, now)) return null;
  const step = nextChecklistStep(job);
  if (step === "complete" || step === "working" || isActivelyWorking(job)) {
    if (job.dispatch_status === "Working" || job.started_at) return "In progress";
    if (job.arrival_at || job.dispatch_status === "Arrived") return "On site";
  }
  const timed = withDerivedTimes(job);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const start = timed.startMinutes;
  if (start == null || !Number.isFinite(start)) return null;
  const delta = start - nowMin;
  if (delta <= 0 && delta > -120) return "Window open";
  if (delta > 0 && delta <= 60) return `Starts in ${delta}m`;
  if (delta > 60 && delta <= 180) return `Starts in ${Math.round(delta / 60)}h`;
  return null;
}

/** Checklist primary CTA for sticky footers / buttons. */
export function nextStepLabel(
  step: ReturnType<typeof nextChecklistStep>,
): { label: string; action: "arrived" | "working" | "complete" | null } {
  if (step === "arrived") return { label: "Mark Arrived", action: "arrived" };
  if (step === "working") return { label: "Start Working", action: "working" };
  if (step === "complete") return { label: "Complete (customer sign-off)", action: "complete" };
  return { label: "Job closed", action: null };
}

/** True when part/labor may be outside contract coverage. */
export function isOutOfScope(
  job: Pick<
    WorkOrder,
    "warranty_coverage" | "contract_id" | "under_expired_contract" | "outside_contract"
  >,
  kind: "part" | "labor",
): boolean {
  return coverageIsOutOfScope(job, kind);
}

export function hoursBetween(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0.25;
  // Short field visits round to 0.00 at 2 decimals — bill a 15-minute minimum.
  const rounded = Math.round((ms / 3_600_000) * 100) / 100;
  return Math.max(0.25, rounded);
}

/**
 * Build work_date / start_time / end_time for technician_labor so
 * labor_time_order (start_time < end_time) is always satisfied.
 * Handles same-second completes and overnight Working windows.
 */
export function laborClockRange(
  startedAtIso: string,
  endedAtIso: string = new Date().toISOString(),
): {
  work_date: string;
  start_time: string;
  end_time: string;
  hours: number;
} {
  const start = new Date(startedAtIso);
  let end = new Date(endedAtIso);
  if (!Number.isFinite(start.getTime())) {
    const now = new Date();
    return {
      work_date: format(now, "yyyy-MM-dd"),
      start_time: format(new Date(now.getTime() - 60_000), "HH:mm:ss"),
      end_time: format(now, "HH:mm:ss"),
      hours: 0.25,
    };
  }
  if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60_000);
  }

  const hours = hoursBetween(start.toISOString(), end.toISOString());
  const work_date = format(start, "yyyy-MM-dd");
  const start_time = format(start, "HH:mm:ss");
  let end_time = format(end, "HH:mm:ss");

  // Keep end_time consistent with billed hours when the live clock was shorter
  // than the 15-minute minimum (avoids 5s spans storing 0.00 hr after rounding).
  if (hours >= 0.25) {
    const minEnd = new Date(start.getTime() + Math.round(hours * 3_600_000));
    if (minEnd.getTime() > end.getTime() && format(minEnd, "yyyy-MM-dd") === work_date) {
      end_time = format(minEnd, "HH:mm:ss");
    }
  }

  const sameLocalDay = format(end, "yyyy-MM-dd") === work_date;
  if (!sameLocalDay || end_time <= start_time) {
    // Overnight or equal clocks: keep hours, put a valid same-day time order.
    end_time = "23:59:59";
    if (end_time <= start_time) {
      return {
        work_date,
        start_time: "23:58:00",
        end_time: "23:59:00",
        hours: Math.max(hours, 0.25),
      };
    }
  }

  return { work_date, start_time, end_time, hours };
}

/** Hours between local `HH:mm` or `HH:mm:ss` clock values (same calendar day). */
export function hoursFromTimeRange(start: string, end: string): number | null {
  const startMin = parseFlexibleTime(start.length === 5 ? `${start}:00` : start);
  const endMin = parseFlexibleTime(end.length === 5 ? `${end}:00` : end);
  if (startMin == null || endMin == null) return null;
  if (endMin <= startMin) return null;
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

/** Normalize time for display as `HH:mm:ss`. */
export function formatLaborClock(time: string | null | undefined): string {
  if (!time) return "—";
  const raw = String(time).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return raw.length >= 8 ? raw.slice(0, 8) : raw;
  const hh = match[1]!.padStart(2, "0");
  const mm = match[2]!;
  const ss = match[3] ?? "00";
  return `${hh}:${mm}:${ss}`;
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
