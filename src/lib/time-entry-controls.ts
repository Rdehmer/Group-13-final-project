/**
 * Internal control helpers for field timesheets.
 * Pure validation + exception detection used by UI and write path.
 */

import { differenceInMinutes, parseISO, startOfWeek, endOfWeek, format, addDays } from "date-fns";
import type {
  Profile,
  TimeApprovalStatus,
  TimeBillingControlStatus,
  TimeEntry,
  UserRole,
} from "@/lib/types";

export const CERTIFICATION_TEXT =
  "I confirm that these time entries are complete and accurately represent the time and activities I worked during this period.";

export const APPROVAL_LABELS_CTRL: Record<TimeApprovalStatus, string> = {
  active: "Active",
  missing_clock_out: "Missing Clock-Out",
  pending_correction: "Pending Correction",
  complete: "Complete",
  pending_approval: "Pending Approval",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  locked: "Locked",
};

export const BILLING_STATUS_LABELS: Record<TimeBillingControlStatus, string> = {
  not_ready: "Not Ready",
  ready_to_bill: "Ready to Bill",
  included_on_draft: "Included on Draft Invoice",
  billed: "Billed",
  nonbillable: "Nonbillable",
  disputed: "Disputed",
};

export type ExceptionSeverity = "critical" | "warning" | "review" | "resolved";

export type TimesheetException = {
  id: string;
  entryId: string;
  type: string;
  label: string;
  severity: ExceptionSeverity;
  detail: string;
  technicianId: string;
  workOrderId: string | null;
};

export function isManagerRole(role: UserRole): boolean {
  return role === "administrator" || role === "service_manager";
}

export function isBillingRole(role: UserRole): boolean {
  return role === "billing" || role === "administrator";
}

export function isVoided(entry: TimeEntry): boolean {
  return Boolean(entry.is_void || entry.voided_at || entry.deleted_at);
}

/** Payroll / OT totals — exclude open, missing clock-out, rejected, voided. */
export function includesInPayrollTotals(entry: TimeEntry): boolean {
  if (isVoided(entry)) return false;
  if (
    ["active", "missing_clock_out", "rejected", "pending_correction"].includes(entry.approval_status)
  ) {
    return false;
  }
  return true;
}

/** Only approved/locked billable entries that are not already on an invoice. */
export function includesInBilling(entry: TimeEntry): boolean {
  if (!includesInPayrollTotals(entry)) return false;
  if (!["approved", "locked"].includes(entry.approval_status)) return false;
  if (entry.billable_status !== "billable") return false;
  const bs = entry.billing_status ?? "not_ready";
  if (bs === "billed" || bs === "included_on_draft") return false;
  if (bs === "disputed" || bs === "nonbillable") return false;
  if (!entry.work_order_id || !entry.customer_id) return false;
  return true;
}

export function canApproveTime(profile: Profile, entry: TimeEntry): boolean {
  if (!isManagerRole(profile.role)) return false;
  if (entry.technician_id === profile.id) return false;
  if (isVoided(entry)) return false;
  return ["complete", "pending_approval", "pending_correction", "submitted"].includes(
    entry.approval_status,
  );
}

export function canEditTime(profile: Profile, entry: TimeEntry): boolean {
  if (isVoided(entry)) return false;
  if (entry.billing_status === "billed" || entry.billing_status === "included_on_draft") {
    return false;
  }
  if (entry.locked_at || entry.approval_status === "locked" || entry.approval_status === "approved") {
    return false;
  }
  if (entry.approval_status === "submitted") {
    return isManagerRole(profile.role);
  }
  if (isManagerRole(profile.role)) return true;
  if (profile.role === "billing") return false;
  if (entry.technician_id !== profile.id) return false;
  return [
    "active",
    "missing_clock_out",
    "pending_correction",
    "complete",
    "pending_approval",
    "rejected",
  ].includes(entry.approval_status);
}

export function durationMinutes(clockIn: string | null, clockOut: string | null): number {
  if (!clockIn || !clockOut) return 0;
  const m = differenceInMinutes(parseISO(clockOut), parseISO(clockIn));
  return Number.isFinite(m) ? m : 0;
}

export type DurationValidation = {
  ok: boolean;
  error?: string;
  warn12h?: boolean;
  flag16h?: boolean;
};

export function validateDuration(
  clockIn: string,
  clockOut: string,
  options?: { allowActive?: boolean },
): DurationValidation {
  const mins = durationMinutes(clockIn, clockOut);
  if (mins < 0) return { ok: false, error: "Clock-out cannot be before clock-in." };
  if (mins === 0 && !options?.allowActive) {
    return { ok: false, error: "Zero-duration entries are not allowed." };
  }
  if (mins > 24 * 60) return { ok: false, error: "Entries longer than 24 hours are not allowed." };
  return { ok: true, warn12h: mins > 12 * 60, flag16h: mins > 16 * 60 };
}

export function validateNotFuture(clockIn: string, maxSkewMinutes = 5): string | null {
  const t = parseISO(clockIn).getTime();
  if (t > Date.now() + maxSkewMinutes * 60_000) {
    return "Future clock-in times are not allowed.";
  }
  return null;
}

export function rangesOverlap(
  aIn: string,
  aOut: string,
  bIn: string,
  bOut: string,
): boolean {
  const a0 = parseISO(aIn).getTime();
  const a1 = parseISO(aOut).getTime();
  const b0 = parseISO(bIn).getTime();
  const b1 = parseISO(bOut).getTime();
  return a0 < b1 && b0 < a1;
}

export function findConflicts(
  candidate: { id?: string; technicianId: string; clockIn: string; clockOut: string },
  existing: TimeEntry[],
): TimeEntry[] {
  return existing.filter((e) => {
    if (candidate.id && e.id === candidate.id) return false;
    if (e.technician_id !== candidate.technicianId) return false;
    if (isVoided(e)) return false;
    if (e.approval_status === "rejected") return false;
    if (!e.clock_in_at) return false;
    const out = e.clock_out_at ?? new Date().toISOString();
    return rangesOverlap(candidate.clockIn, candidate.clockOut, e.clock_in_at, out);
  });
}

export function isExactDuplicate(
  candidate: {
    id?: string;
    technicianId: string;
    entryDate: string;
    clockIn: string;
    clockOut: string;
    workOrderId: string | null;
    activityType: string;
  },
  existing: TimeEntry[],
): TimeEntry | null {
  return (
    existing.find((e) => {
      if (candidate.id && e.id === candidate.id) return false;
      if (isVoided(e)) return false;
      if (e.approval_status === "rejected") return false;
      return (
        e.technician_id === candidate.technicianId &&
        e.entry_date === candidate.entryDate &&
        e.clock_in_at === candidate.clockIn &&
        e.clock_out_at === candidate.clockOut &&
        (e.work_order_id ?? null) === (candidate.workOrderId ?? null) &&
        e.activity_type === candidate.activityType
      );
    }) ?? null
  );
}

export function closedWorkOrderBlocked(status: string | null | undefined): boolean {
  return ["Canceled", "Closed", "Invoiced", "Completed"].includes(status ?? "");
}

export function unauthorizedOpenWorkOrder(status: string | null | undefined): boolean {
  return ["Canceled", "Closed"].includes(status ?? "");
}

export function weeklyOtWarnings(totalHours: number): string[] {
  const msgs: string[] = [];
  if (totalHours >= 35 && totalHours < 40) {
    msgs.push(`Technician has reached ${totalHours.toFixed(1)} of 40 weekly hours.`);
  }
  if (totalHours >= 40 && totalHours <= 40.05) {
    msgs.push("Technician has reached 40 weekly hours — further time will be overtime.");
  }
  if (totalHours > 40) {
    msgs.push(`Overtime: ${totalHours.toFixed(1)} weekly hours (threshold 40).`);
  }
  return msgs;
}

export function detectExceptions(entries: TimeEntry[]): TimesheetException[] {
  const out: TimesheetException[] = [];
  const byTech = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    if (isVoided(e)) continue;
    const list = byTech.get(e.technician_id) ?? [];
    list.push(e);
    byTech.set(e.technician_id, list);
  }

  for (const e of entries) {
    if (isVoided(e)) {
      if (e.is_void || e.voided_at) {
        out.push({
          id: `${e.id}-void`,
          entryId: e.id,
          technicianId: e.technician_id,
          workOrderId: e.work_order_id,
          type: "voided",
          label: "Voided entry",
          severity: "resolved",
          detail: e.void_reason ?? "Soft-voided with audit trail.",
        });
      }
      continue;
    }

    const base = {
      entryId: e.id,
      technicianId: e.technician_id,
      workOrderId: e.work_order_id,
    };

    if (
      e.approval_status === "missing_clock_out" ||
      (e.clock_in_at && !e.clock_out_at && e.approval_status === "active")
    ) {
      const ageH = e.clock_in_at
        ? differenceInMinutes(new Date(), parseISO(e.clock_in_at)) / 60
        : 0;
      if (e.approval_status === "missing_clock_out" || ageH >= 12) {
        out.push({
          id: `${e.id}-mco`,
          ...base,
          type: "missing_clock_out",
          label: "Missing clock-out",
          severity: "critical",
          detail: `Open since ${e.clock_in_at ?? "unknown"} (${ageH.toFixed(1)}h). Excluded from billing/payroll until corrected.`,
        });
      }
    }

    const totalH = Number(e.regular_hours) + Number(e.overtime_hours);
    if (e.total_minutes > 16 * 60 || totalH > 16 || e.duration_flag_16h) {
      out.push({
        id: `${e.id}-16h`,
        ...base,
        type: "long_shift_16h",
        label: "Shift > 16 hours",
        severity: "critical",
        detail: "Excessive duration requires manager review before payroll.",
      });
    } else if (e.total_minutes > 12 * 60 || totalH > 12 || e.duration_flag_12h) {
      out.push({
        id: `${e.id}-12h`,
        ...base,
        type: "long_shift_12h",
        label: "Shift > 12 hours",
        severity: "warning",
        detail: "Long shift flagged for verification.",
      });
    }

    if (!e.work_order_id && ["regular_work", "overtime"].includes(e.activity_type)) {
      out.push({
        id: `${e.id}-nowo`,
        ...base,
        type: "no_work_order",
        label: "Job time without work order",
        severity: "critical",
        detail: "Job-related categories require an authorized work order.",
      });
    }

    if (e.unassigned_work_order || e.requires_manager_assignment_override) {
      out.push({
        id: `${e.id}-unassigned`,
        ...base,
        type: "unassigned_technician",
        label: "Unassigned technician on work order",
        severity: "warning",
        detail: "Requires manager approval before acceptance.",
      });
    }

    if (e.is_manual || e.manual_entry_reason) {
      out.push({
        id: `${e.id}-manual`,
        ...base,
        type: "manual_entry",
        label: "Manual entry",
        severity: "review",
        detail: e.manual_entry_reason ?? "Manual punch requires approval.",
      });
    }

    if (e.original_clock_in_at || e.edit_reason || e.original_values) {
      out.push({
        id: `${e.id}-edited`,
        ...base,
        type: "edited_entry",
        label: "Edited entry",
        severity: "review",
        detail: e.edit_reason ?? "Original values preserved for manager review.",
      });
    }

    if (e.approval_status === "rejected") {
      out.push({
        id: `${e.id}-rej`,
        ...base,
        type: "rejected",
        label: "Rejected",
        severity: "warning",
        detail: e.rejection_reason ?? "Rejected — pending correction.",
      });
    }

    if (e.approval_status === "approved" || e.approval_status === "locked") {
      const bs = e.billing_status ?? "not_ready";
      if (
        e.billable_status === "billable" &&
        (bs === "ready_to_bill" || bs === "not_ready")
      ) {
        out.push({
          id: `${e.id}-rtb`,
          ...base,
          type: "ready_to_bill",
          label: "Approved, not yet billed",
          severity: "review",
          detail: "Eligible for invoice preparation after contract checks.",
        });
      }
      if (bs === "billed") {
        out.push({
          id: `${e.id}-billed`,
          ...base,
          type: "already_billed",
          label: "Already billed",
          severity: "resolved",
          detail: "Prevent re-bill — linked or marked billed.",
        });
      }
    }

    if (Number(e.overtime_hours) > 0 && !["approved", "locked"].includes(e.approval_status)) {
      out.push({
        id: `${e.id}-ot`,
        ...base,
        type: "unapproved_overtime",
        label: "Unapproved overtime",
        severity: "warning",
        detail: `${Number(e.overtime_hours).toFixed(2)} OT hours pending control clearance.`,
      });
    }

    if (e.is_duplicate_suspect) {
      out.push({
        id: `${e.id}-dupsuspect`,
        ...base,
        type: "duplicate",
        label: "Potential duplicate",
        severity: "critical",
        detail: "Flagged as possible duplicate for manager review.",
      });
    }
  }

  for (const [, list] of byTech) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!a.clock_in_at || !b.clock_in_at) continue;
        if (a.approval_status === "rejected" || b.approval_status === "rejected") continue;
        const aOut = a.clock_out_at ?? new Date().toISOString();
        const bOut = b.clock_out_at ?? new Date().toISOString();
        if (rangesOverlap(a.clock_in_at, aOut, b.clock_in_at, bOut)) {
          out.push({
            id: `${a.id}-${b.id}-overlap`,
            entryId: a.id,
            technicianId: a.technician_id,
            workOrderId: a.work_order_id,
            type: "overlap",
            label: "Overlapping entries",
            severity: "critical",
            detail: `Conflicts with entry ${b.id.slice(0, 8)}… on ${b.entry_date}.`,
          });
        }
        if (
          a.entry_date === b.entry_date &&
          a.clock_in_at === b.clock_in_at &&
          a.clock_out_at === b.clock_out_at &&
          a.work_order_id === b.work_order_id &&
          a.activity_type === b.activity_type
        ) {
          out.push({
            id: `${a.id}-${b.id}-dup`,
            entryId: a.id,
            technicianId: a.technician_id,
            workOrderId: a.work_order_id,
            type: "duplicate",
            label: "Potential duplicate",
            severity: "critical",
            detail: "Same tech, date, times, WO, and activity.",
          });
        }
      }
    }
  }

  return out;
}

export function weekBounds(date: Date | string = new Date()): {
  start: string;
  end: string;
  label: string;
} {
  const d = typeof date === "string" ? parseISO(date) : date;
  const start = startOfWeek(d, { weekStartsOn: 0 });
  const end = endOfWeek(d, { weekStartsOn: 0 });
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
    label: `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`,
  };
}

export function managerApprovalWarnings(entry: TimeEntry, all: TimeEntry[]): string[] {
  const w: string[] = [];
  const conflicts =
    entry.clock_in_at && entry.clock_out_at
      ? findConflicts(
          {
            id: entry.id,
            technicianId: entry.technician_id,
            clockIn: entry.clock_in_at,
            clockOut: entry.clock_out_at,
          },
          all,
        )
      : [];
  if (conflicts.length) w.push("Overlapping time exists for this technician.");
  if (entry.total_minutes > 12 * 60) w.push("Shift exceeds 12 hours.");
  if (entry.total_minutes > 16 * 60) w.push("Shift exceeds 16 hours.");
  if (!entry.work_order_id && ["regular_work", "overtime"].includes(entry.activity_type)) {
    w.push("Missing work-order information for job-related activity.");
  }
  if (entry.unassigned_work_order) w.push("Technician not assigned to this work order.");
  if (entry.is_manual) w.push("Manual entry — verify explanation.");
  if (entry.original_clock_in_at || entry.edit_reason) w.push("Edited after original submission.");
  if (entry.billing_status === "billed") w.push("Already billed — approve carefully.");
  if (
    entry.activity_type === "travel" &&
    Number(entry.regular_hours) + Number(entry.overtime_hours) > 2
  ) {
    w.push("Unusually high travel time.");
  }
  const woStatus = entry.work_orders?.status;
  if (woStatus && closedWorkOrderBlocked(woStatus)) {
    w.push("Time against a closed/canceled/invoiced work order.");
  }
  return w;
}

export function controlsExplainer(): { risk: string; control: string }[] {
  return [
    {
      risk: "A technician could submit inaccurate or unauthorized time.",
      control:
        "Technicians enter their own time, but managers approve manual, edited, overtime, and exception entries.",
    },
    {
      risk: "The same labor could be billed twice.",
      control:
        "Each approved time entry receives a billing status and invoice link, and billed entries cannot be added to another invoice.",
    },
    {
      risk: "An employee could alter an approved timesheet.",
      control:
        "Approved timesheets are locked, and reopening requires manager authorization and a documented reason.",
    },
    {
      risk: "Hours could be recorded against an unauthorized job.",
      control:
        "Job-related time must be connected to an active work order and assigned technician.",
    },
    {
      risk: "Changes could be made without accountability.",
      control:
        "The app preserves original values and records every important action in a permanent audit trail.",
    },
  ];
}

export function applyMissingClockOutStatus(entry: TimeEntry): TimeEntry {
  if (entry.clock_out_at || !entry.clock_in_at) return entry;
  if (!["active", "missing_clock_out"].includes(entry.approval_status)) return entry;
  const hoursOpen = differenceInMinutes(new Date(), parseISO(entry.clock_in_at)) / 60;
  if (hoursOpen >= 16 || entry.approval_status === "missing_clock_out") {
    return { ...entry, approval_status: "missing_clock_out" };
  }
  return entry;
}

export function nextWeekStart(from: string, delta: number): string {
  return format(addDays(parseISO(from), delta * 7), "yyyy-MM-dd");
}

export function severityTone(severity: ExceptionSeverity): string {
  switch (severity) {
    case "critical":
      return "badge-error";
    case "warning":
      return "badge-warning";
    case "review":
      return "badge-info";
    case "resolved":
      return "badge-success";
    default:
      return "badge-ghost";
  }
}

/** Snapshot of rate-sensitive fields for audit (technicians never write these). */
export function rateFieldsFromEntry(entry: TimeEntry) {
  return {
    hourly_cost_rate: entry.hourly_cost_rate,
    overtime_cost_rate: entry.overtime_cost_rate,
    billing_rate: entry.billing_rate,
  };
}
