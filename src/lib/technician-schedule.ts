import {
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  addWeeks,
  format,
} from "date-fns";
import type { Profile, WorkOrder } from "@/lib/types";

export type ScheduleWo = WorkOrder & {
  customers?: { id?: string; name: string } | null;
  technician?: { id?: string; full_name: string | null } | null;
  /** Optional explicit end time when column exists; otherwise derived. */
  scheduled_end_time?: string | null;
};

export type ScheduleCategory = "in_progress" | "waiting_parts" | "completed" | "overdue" | "upcoming";

export type TimedWo = ScheduleWo & {
  startMinutes: number;
  endMinutes: number;
  startLabel: string;
  endLabel: string;
  category: ScheduleCategory;
  hasConflict: boolean;
};

export type Meridiem = "AM" | "PM";

export type ClockParts = {
  hour12: string;
  minute: string;
  period: Meridiem;
};

export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 19;
export const HOUR_WIDTH = 96;
export const WO_PAGE_SIZE = 6;

export const STORAGE_KEY = "esm-technician-schedule-prefs";

export type SchedulePrefs = {
  categoryFilter: "all" | ScheduleCategory;
  listExpanded: boolean;
  density: "compact" | "comfortable";
  techView: "all" | "mine" | string; // tech id
  /** Day timeline body height in px (user-draggable expansion). */
  dayViewHeight: number;
};

export const DEFAULT_PREFS: SchedulePrefs = {
  categoryFilter: "all",
  listExpanded: true,
  density: "comfortable",
  techView: "all",
  dayViewHeight: 280,
};

export const DAY_VIEW_HEIGHT_MIN = 160;
export const DAY_VIEW_HEIGHT_MAX = 720;

export const CATEGORY_STYLES: Record<
  ScheduleCategory,
  { chip: string; block: string; ring: string; label: string }
> = {
  in_progress: {
    chip: "bg-amber-300 text-amber-950",
    block: "border-amber-400 bg-amber-300 text-amber-950",
    ring: "ring-amber-400",
    label: "In Progress",
  },
  waiting_parts: {
    chip: "border border-base-300 bg-white text-base-content",
    block: "border-base-300 bg-white text-base-content",
    ring: "ring-base-300",
    label: "Waiting on Parts",
  },
  completed: {
    chip: "bg-success/90 text-success-content",
    block: "border-success bg-success/80 text-success-content",
    ring: "ring-success",
    label: "Completed",
  },
  overdue: {
    chip: "bg-error/90 text-error-content",
    block: "border-error bg-error/80 text-error-content",
    ring: "ring-error",
    label: "Overdue",
  },
  upcoming: {
    chip: "bg-info/90 text-info-content",
    block: "border-info bg-info/80 text-info-content",
    ring: "ring-info",
    label: "Upcoming",
  },
};

export function loadPrefs(): SchedulePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Partial<SchedulePrefs>) {
  if (typeof window === "undefined") return;
  const next = { ...loadPrefs(), ...prefs };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

export function parseFlexibleTime(time: string | null | undefined): number | null {
  if (time == null) return null;
  const raw = String(time).trim().toLowerCase();
  if (!raw) return null;
  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!ampm) return null;
  let hours = Number(ampm[1]);
  const minutes = Number(ampm[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59 || hours > 23) return null;
  const mer = ampm[4]?.replace(/\./g, "") ?? "";
  if (mer.startsWith("p") && hours < 12) hours += 12;
  if (mer.startsWith("a") && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function minutesToLabel(total: number): string {
  const clamped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export function minutesToInputValue(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function minutesToClockParts(total: number): ClockParts {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  const period: Meridiem = h24 >= 12 ? "PM" : "AM";
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return {
    hour12: String(hour12),
    minute: String(m).padStart(2, "0"),
    period,
  };
}

export function clockPartsToMinutes(hour12: string, minute: string, period: Meridiem): number | null {
  let h = Number(hour12);
  const m = Number(minute);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 1 || h > 12 || m < 0 || m > 59) return null;
  if (period === "AM") {
    if (h === 12) h = 0;
  } else if (h !== 12) h += 12;
  return h * 60 + m;
}

export function formatTimeForDb(minutes: number): string {
  return `${minutesToInputValue(minutes)}:00`;
}

export function snapMinuteOption(minute: string): string {
  const m = Number(minute);
  if (!Number.isFinite(m)) return "00";
  const snapped = Math.round(m / 5) * 5;
  return String(snapped === 60 ? 55 : snapped).padStart(2, "0");
}

/**
 * Jobs scheduled before today whose DB status is still open (not completed/closed/canceled).
 * Calendar paints these as overdue (red), not completed (green).
 */
export function isOpenPastJob(wo: ScheduleWo, now = new Date()): boolean {
  if (!wo.scheduled_date) return false;
  const status = (wo.status ?? "").toLowerCase();
  if (status.includes("complete") || status === "closed" || status.includes("cancel")) return false;
  try {
    return isBefore(startOfDay(parseISO(wo.scheduled_date)), startOfDay(now));
  } catch {
    return false;
  }
}

/** Days between scheduled date and today for closeout UI. */
export function daysPastScheduled(wo: ScheduleWo, now = new Date()): number {
  if (!wo.scheduled_date) return 0;
  try {
    const day = startOfDay(parseISO(wo.scheduled_date));
    const today = startOfDay(now);
    return Math.max(0, Math.round((today.getTime() - day.getTime()) / (24 * 60 * 60 * 1000)));
  } catch {
    return 0;
  }
}

/**
 * Calendar category is driven by schedule *date* first:
 * - Completed / closed / canceled → completed
 * - Past schedule date (still open) → overdue (never in_progress / waiting_parts)
 * - Future schedule date → upcoming (or waiting_parts when status says so)
 * - Today only → in_progress, waiting_parts, or overdue after the day's slot ends
 */
export function getScheduleCategory(wo: ScheduleWo, now = new Date()): ScheduleCategory {
  const status = (wo.status ?? "").toLowerCase();
  if (status.includes("complete") || status === "closed") return "completed";
  if (status === "canceled" || status.includes("cancel")) return "completed";

  const waitingParts =
    status.includes("waiting on parts") || status.includes("waiting for parts");

  if (!wo.scheduled_date) {
    return waitingParts ? "waiting_parts" : "upcoming";
  }

  let scheduleDay: Date;
  try {
    scheduleDay = startOfDay(parseISO(wo.scheduled_date));
  } catch {
    return waitingParts ? "waiting_parts" : "upcoming";
  }
  const today = startOfDay(now);

  // Past date, still open → overdue (overrides In Progress / Waiting on Parts labels)
  if (isBefore(scheduleDay, today)) {
    return "overdue";
  }

  // Future: never In Progress; waiting on parts can still show as its own category
  if (!isSameDay(scheduleDay, today)) {
    return waitingParts ? "waiting_parts" : "upcoming";
  }

  // Today only
  if (waitingParts) return "waiting_parts";

  const timed = withDerivedTimesBase(wo);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes > timed.endMinutes) return "overdue";

  return "in_progress";
}

function withDerivedTimesBase(wo: ScheduleWo): Omit<TimedWo, "category" | "hasConflict"> {
  const seed = hashSeed(wo.id);
  const storedStart = parseFlexibleTime(wo.scheduled_start_time);
  const storedEnd = parseFlexibleTime(wo.scheduled_end_time);

  let startMinutes = storedStart;
  if (startMinutes == null) {
    startMinutes = 8 * 60 + (seed % 15) * 30;
  }

  let endMinutes: number;
  if (storedEnd != null && storedEnd > startMinutes) {
    endMinutes = storedEnd;
  } else if (wo.estimated_labor_hours != null && Number(wo.estimated_labor_hours) > 0) {
    endMinutes = startMinutes + Math.round(Number(wo.estimated_labor_hours) * 60);
  } else {
    endMinutes = startMinutes + (1 + (seed % 3)) * 60;
  }
  endMinutes = Math.max(endMinutes, startMinutes + 15);

  return {
    ...wo,
    startMinutes,
    endMinutes,
    startLabel: minutesToLabel(startMinutes),
    endLabel: minutesToLabel(endMinutes),
  };
}

export function withDerivedTimes(wo: ScheduleWo): TimedWo {
  const base = withDerivedTimesBase(wo);
  return {
    ...base,
    category: getScheduleCategory(wo),
    hasConflict: false,
  };
}

export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function markConflicts(orders: TimedWo[]): TimedWo[] {
  return orders.map((wo) => {
    if (!wo.assigned_technician_id || !wo.scheduled_date) {
      return { ...wo, hasConflict: false };
    }
    const conflict = orders.some(
      (other) =>
        other.id !== wo.id &&
        other.assigned_technician_id === wo.assigned_technician_id &&
        other.scheduled_date === wo.scheduled_date &&
        intervalsOverlap(wo.startMinutes, wo.endMinutes, other.startMinutes, other.endMinutes),
    );
    return { ...wo, hasConflict: conflict };
  });
}

export function techName(wo: ScheduleWo): string {
  return wo.technician?.full_name?.trim() || "Unassigned";
}

export function customerName(wo: ScheduleWo): string {
  return wo.customers?.name?.trim() || "Unknown customer";
}

export function densityRowHeight(density: "compact" | "comfortable"): number {
  // Tall enough for WO number, tech, customer, and time on day-timeline bubbles.
  return density === "compact" ? 56 : 96;
}

/** Minimum vertical lanes on the day timeline so empty days do not look cramped. */
export const DAY_TIMELINE_MIN_LANES = 2;

export function exportDayCsv(day: Date, orders: TimedWo[]): string {
  const header = ["Work Order", "Start", "End", "Technician", "Customer", "Status", "Category", "Conflict"];
  const lines = orders.map((wo) =>
    [
      wo.work_order_number,
      wo.startLabel,
      wo.endLabel,
      techName(wo),
      customerName(wo),
      wo.status,
      wo.category,
      wo.hasConflict ? "yes" : "no",
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function nextWeekDate(isoDate: string): string {
  return format(addWeeks(parseISO(isoDate), 1), "yyyy-MM-dd");
}

export function profileLabel(p: Profile): string {
  return p.full_name?.trim() || p.email;
}

export const HOUR_12_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
export const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
export const DURATION_PRESETS_MIN = [30, 60, 120, 240] as const;
