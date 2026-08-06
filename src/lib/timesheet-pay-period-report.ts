/**
 * ServiceTitan-style Technician Timesheet Summary By Pay Period.
 * Pay periods are weekly (Sunday–Saturday), matching app timesheet weeks.
 */

import {
  addDays,
  eachDayOfInterval,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfWeek,
} from "date-fns";
import type { TechnicianLabor, TimeEntry } from "@/lib/types";
import { includesInPayrollTotals } from "@/lib/time-entry-controls";

export type DateRange = { start: string; end: string };

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  try {
    const d = s.includes("T") ? parseISO(s) : parseISO(`${s}T12:00:00`);
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

function inDateRange(dateStr: string | null | undefined, range: DateRange): boolean {
  const d = parseDate(dateStr);
  if (!d) return false;
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  if (!start || !end) return false;
  return d >= start && d <= end;
}

export const PAY_PERIOD_WEEK_STARTS_ON = 0 as const; // Sunday

export type TechProfileForTimesheet = {
  id: string;
  full_name: string | null;
  email?: string | null;
  role?: string;
  hourly_cost_rate?: number | null;
  hourly_billing_rate?: number | null;
};

export function payPeriodContaining(dateStr: string, today = new Date()): DateRange {
  const d = parseDate(dateStr) ?? today;
  const start = startOfWeek(d, { weekStartsOn: PAY_PERIOD_WEEK_STARTS_ON });
  const end = endOfWeek(d, { weekStartsOn: PAY_PERIOD_WEEK_STARTS_ON });
  return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
}

export function shiftPayPeriod(range: DateRange, weeks: number): DateRange {
  const start = parseDate(range.start) ?? new Date();
  const next = addDays(start, weeks * 7);
  return payPeriodContaining(format(next, "yyyy-MM-dd"), next);
}

export function defaultCurrentPayPeriod(today = new Date()): DateRange {
  return payPeriodContaining(format(today, "yyyy-MM-dd"), today);
}

export type TimesheetDayRow = {
  date: string;
  start: string | null;
  firstArrival: string | null;
  end: string | null;
  idle: number;
  driving: number;
  jobHours: number;
  meal: number;
  training: number;
  other: number;
  tempClockOut: number;
  hoursWorked: number;
  regular: number;
  overtime: number;
  doubleOt: number;
  pto: number;
  entryCount: number;
};

export type TimesheetTechSection = {
  technicianId: string;
  name: string;
  hourlyRate: number;
  days: TimesheetDayRow[];
  totals: {
    idle: number;
    driving: number;
    jobHours: number;
    meal: number;
    training: number;
    other: number;
    tempClockOut: number;
    hoursWorked: number;
    regular: number;
    overtime: number;
    doubleOt: number;
    pto: number;
    entryCount: number;
    totalPay: number;
  };
};

export type TimesheetSummaryReport = {
  payPeriod: DateRange;
  payPeriodLabel: string;
  technicians: TimesheetTechSection[];
  grandTotals: TimesheetTechSection["totals"];
  source: "time_entries" | "technician_labor" | "mixed";
  techCount: number;
};

type DayBuild = TimesheetDayRow & {
  _minIn?: number;
  _maxOut?: number;
  _firstArr?: number;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clockLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    if (!isValid(d)) return null;
    return format(d, "h:mm a");
  } catch {
    return null;
  }
}

function formatLaborClockLabel(t: string): string {
  try {
    const [hRaw, mRaw] = t.split(":");
    let h = Number(hRaw);
    const m = Number(mRaw) || 0;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
  } catch {
    return t;
  }
}

function emptyDay(date: string): DayBuild {
  return {
    date,
    start: null,
    firstArrival: null,
    end: null,
    idle: 0,
    driving: 0,
    jobHours: 0,
    meal: 0,
    training: 0,
    other: 0,
    tempClockOut: 0,
    hoursWorked: 0,
    regular: 0,
    overtime: 0,
    doubleOt: 0,
    pto: 0,
    entryCount: 0,
  };
}

function finalizeDay(day: DayBuild): TimesheetDayRow {
  if (day._minIn != null && day._maxOut != null && day._maxOut > day._minIn) {
    const spanHrs = (day._maxOut - day._minIn) / 3_600_000;
    const classified =
      day.jobHours + day.driving + day.meal + day.training + day.other + day.idle + day.pto;
    const residual = spanHrs - classified;
    // ServiceTitan: blocks of idle under 1 hour are typically paid
    if (residual > 0.08 && residual < 1.05) {
      day.idle = round2(day.idle + residual);
      day.hoursWorked = round2(day.hoursWorked + residual);
    }
  }
  if (day.regular + day.overtime <= 0 && day.hoursWorked > 0) {
    day.regular = round2(Math.min(8, day.hoursWorked));
    day.overtime = round2(Math.max(0, day.hoursWorked - 8));
  }
  return {
    date: day.date,
    start: day.start,
    firstArrival: day.firstArrival,
    end: day.end,
    idle: round2(day.idle),
    driving: round2(day.driving),
    jobHours: round2(day.jobHours),
    meal: round2(day.meal),
    training: round2(day.training),
    other: round2(day.other),
    tempClockOut: round2(day.tempClockOut),
    hoursWorked: round2(day.hoursWorked),
    regular: round2(day.regular),
    overtime: round2(day.overtime),
    doubleOt: round2(day.doubleOt),
    pto: round2(day.pto),
    entryCount: day.entryCount,
  };
}

function dayRowsFromTimeEntries(entries: TimeEntry[], range: DateRange): Map<string, TimesheetDayRow> {
  const byDate = new Map<string, DayBuild>();

  for (const e of entries) {
    if (!includesInPayrollTotals(e)) continue;
    const date = e.entry_date;
    if (!inDateRange(date, range)) continue;

    const day = byDate.get(date) ?? emptyDay(date);
    const reg = Number(e.regular_hours) || 0;
    const ot = Number(e.overtime_hours) || 0;
    const hrs =
      reg + ot > 0 ? reg + ot : Number(e.total_minutes) > 0 ? Number(e.total_minutes) / 60 : 0;

    day.entryCount += 1;
    day.regular += reg;
    day.overtime += ot;

    if (e.clock_in_at) {
      const t = parseISO(e.clock_in_at).getTime();
      if (day._minIn == null || t < day._minIn) {
        day._minIn = t;
        day.start = clockLabel(e.clock_in_at);
      }
      if (e.work_order_id && (day._firstArr == null || t < day._firstArr)) {
        day._firstArr = t;
        day.firstArrival = clockLabel(e.clock_in_at);
      }
    }
    if (e.clock_out_at) {
      const t = parseISO(e.clock_out_at).getTime();
      if (day._maxOut == null || t > day._maxOut) {
        day._maxOut = t;
        day.end = clockLabel(e.clock_out_at);
      }
    }

    const notes = (e.notes || "").toLowerCase();
    const isPto =
      notes.includes("pto") || notes.includes("paid time off") || notes.includes("vacation");

    switch (e.activity_type) {
      case "travel":
        day.driving += hrs;
        day.hoursWorked += hrs;
        break;
      case "break":
        day.meal += hrs;
        break;
      case "training":
        day.training += hrs;
        day.hoursWorked += hrs;
        break;
      case "meeting":
      case "shop":
      case "admin_nonbillable":
        day.other += hrs;
        day.hoursWorked += hrs;
        break;
      case "overtime":
      case "regular_work":
      default:
        if (isPto) {
          day.pto += hrs;
        } else if (e.work_order_id) {
          day.jobHours += hrs;
          day.hoursWorked += hrs;
        } else {
          day.idle += hrs;
          day.hoursWorked += hrs;
        }
        break;
    }

    byDate.set(date, day);
  }

  const out = new Map<string, TimesheetDayRow>();
  for (const [k, v] of byDate) out.set(k, finalizeDay(v));
  return out;
}

function dayRowsFromTechnicianLabor(
  labor: TechnicianLabor[],
  range: DateRange,
): Map<string, TimesheetDayRow> {
  const byDate = new Map<string, DayBuild>();
  for (const row of labor) {
    if (!inDateRange(row.work_date, range)) continue;
    const day = byDate.get(row.work_date) ?? emptyDay(row.work_date);
    const reg = Number(row.regular_hours) || 0;
    const ot = Number(row.overtime_hours) || 0;
    const hrs = reg + ot;
    day.entryCount += 1;
    day.regular += reg;
    day.overtime += ot;
    day.jobHours += hrs;
    day.hoursWorked += hrs;
    if (row.start_time) {
      const lbl = formatLaborClockLabel(row.start_time);
      if (!day.start) day.start = lbl;
      if (!day.firstArrival) day.firstArrival = lbl;
    }
    if (row.end_time) day.end = formatLaborClockLabel(row.end_time);
    byDate.set(row.work_date, day);
  }
  const out = new Map<string, TimesheetDayRow>();
  for (const [k, v] of byDate) out.set(k, finalizeDay(v));
  return out;
}

function sumDays(days: TimesheetDayRow[]) {
  return days.reduce(
    (a, d) => {
      a.idle += d.idle;
      a.driving += d.driving;
      a.jobHours += d.jobHours;
      a.meal += d.meal;
      a.training += d.training;
      a.other += d.other;
      a.tempClockOut += d.tempClockOut;
      a.hoursWorked += d.hoursWorked;
      a.regular += d.regular;
      a.overtime += d.overtime;
      a.doubleOt += d.doubleOt;
      a.pto += d.pto;
      a.entryCount += d.entryCount;
      return a;
    },
    {
      idle: 0,
      driving: 0,
      jobHours: 0,
      meal: 0,
      training: 0,
      other: 0,
      tempClockOut: 0,
      hoursWorked: 0,
      regular: 0,
      overtime: 0,
      doubleOt: 0,
      pto: 0,
      entryCount: 0,
    },
  );
}

/**
 * Technician Timesheet Summary By Pay Period (ServiceTitan analogue).
 * Daily rows: Start, First Arrival, End, Idle, Driving, Job Hrs, Meal, Training,
 * Other, Hours Worked, Regular, OT, Double OT, PTO. Period Total Pay at cost rates.
 */
export function technicianTimesheetSummaryByPayPeriod(
  entries: TimeEntry[],
  labor: TechnicianLabor[],
  profiles: TechProfileForTimesheet[],
  range: DateRange,
  options?: { technicianId?: string | null },
): TimesheetSummaryReport {
  const period = range;
  const start = parseDate(period.start) ?? new Date();
  const end = parseDate(period.end) ?? new Date();
  const allDays = eachDayOfInterval({ start, end }).map((d) => format(d, "yyyy-MM-dd"));

  const nameOf = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || id.slice(0, 8);
  };
  const rateOf = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    return Number(p?.hourly_cost_rate ?? 0) || 0;
  };

  const techIds = new Set<string>();
  for (const e of entries) {
    if (options?.technicianId && e.technician_id !== options.technicianId) continue;
    if (inDateRange(e.entry_date, period)) techIds.add(e.technician_id);
  }
  for (const row of labor) {
    if (options?.technicianId && row.technician_id !== options.technicianId) continue;
    if (inDateRange(row.work_date, period)) techIds.add(row.technician_id);
  }

  const technicians: TimesheetTechSection[] = [];
  let usedEntries = false;
  let usedLabor = false;

  for (const techId of Array.from(techIds).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
    const techEntries = entries.filter((e) => e.technician_id === techId);
    const techLabor = labor.filter((l) => l.technician_id === techId);

    let dayMap: Map<string, TimesheetDayRow>;
    if (techEntries.some((e) => inDateRange(e.entry_date, period))) {
      dayMap = dayRowsFromTimeEntries(techEntries, period);
      usedEntries = true;
    } else {
      dayMap = dayRowsFromTechnicianLabor(techLabor, period);
      usedLabor = true;
    }

    const days = allDays
      .map((d) => dayMap.get(d))
      .filter((d): d is TimesheetDayRow => Boolean(d && d.entryCount > 0));

    if (days.length === 0) continue;

    const m = sumDays(days);
    const rate = rateOf(techId);
    // ST Total Pay ≈ (regular × rate) + (OT × 1.5 × rate) + (double OT × 2 × rate) + PTO × rate
    const totalPay = round2(
      m.regular * rate + m.overtime * rate * 1.5 + m.doubleOt * rate * 2 + m.pto * rate,
    );

    technicians.push({
      technicianId: techId,
      name: nameOf(techId),
      hourlyRate: rate,
      days,
      totals: {
        idle: round2(m.idle),
        driving: round2(m.driving),
        jobHours: round2(m.jobHours),
        meal: round2(m.meal),
        training: round2(m.training),
        other: round2(m.other),
        tempClockOut: round2(m.tempClockOut),
        hoursWorked: round2(m.hoursWorked),
        regular: round2(m.regular),
        overtime: round2(m.overtime),
        doubleOt: round2(m.doubleOt),
        pto: round2(m.pto),
        entryCount: m.entryCount,
        totalPay,
      },
    });
  }

  const grand = technicians.reduce(
    (a, t) => {
      a.idle += t.totals.idle;
      a.driving += t.totals.driving;
      a.jobHours += t.totals.jobHours;
      a.meal += t.totals.meal;
      a.training += t.totals.training;
      a.other += t.totals.other;
      a.tempClockOut += t.totals.tempClockOut;
      a.hoursWorked += t.totals.hoursWorked;
      a.regular += t.totals.regular;
      a.overtime += t.totals.overtime;
      a.doubleOt += t.totals.doubleOt;
      a.pto += t.totals.pto;
      a.entryCount += t.totals.entryCount;
      a.totalPay += t.totals.totalPay;
      return a;
    },
    {
      idle: 0,
      driving: 0,
      jobHours: 0,
      meal: 0,
      training: 0,
      other: 0,
      tempClockOut: 0,
      hoursWorked: 0,
      regular: 0,
      overtime: 0,
      doubleOt: 0,
      pto: 0,
      entryCount: 0,
      totalPay: 0,
    },
  );

  for (const k of Object.keys(grand) as (keyof typeof grand)[]) {
    grand[k] = round2(Number(grand[k]));
  }

  return {
    payPeriod: period,
    payPeriodLabel: `${period.start} → ${period.end}`,
    technicians,
    grandTotals: grand,
    source: usedEntries && usedLabor ? "mixed" : usedEntries ? "time_entries" : "technician_labor",
    techCount: technicians.length,
  };
}
