/**
 * Work order workflow statuses must match the database CHECK constraint.
 * Schedule placement and Work Orders status edits stay in sync via these helpers.
 */

export const WO_STATUSES = [
  "Requested",
  "Awaiting Approval",
  "Assigned",
  "Scheduled",
  "In Progress",
  "Waiting on Parts",
  "Ready for Review",
  "Completed",
  "Closed",
  "Canceled",
] as const;

export type WoStatus = (typeof WO_STATUSES)[number];

/** Statuses that mean the job is not yet on the calendar / in progress. */
const EARLY_STATUSES = new Set<string>(["Requested", "Assigned", "Awaiting Approval"]);

const TERMINAL_STATUSES = new Set<string>(["Completed", "Closed", "Canceled"]);

/**
 * When a work order is placed or moved on Technician Schedule,
 * bump early statuses to Scheduled so Work Orders reflects the calendar.
 */
export function statusAfterPlacingOnSchedule(
  current: string | null | undefined,
): "Scheduled" | null {
  if (!current || EARLY_STATUSES.has(current)) return "Scheduled";
  return null;
}

/**
 * Initial status when creating a work order from the Work Orders form.
 */
export function statusForNewWorkOrder(opts: {
  scheduled_date?: string | null;
  assigned_technician_id?: string | null;
}): string {
  if (opts.scheduled_date) return "Scheduled";
  if (opts.assigned_technician_id) return "Assigned";
  return "Requested";
}

/**
 * Extra schedule fields to apply when the workflow status changes on Work Orders,
 * so Technician Schedule stays consistent (service_manager status edits).
 */
export function scheduleFieldsForStatusChange(
  nextStatus: string,
  current: {
    scheduled_date?: string | null;
    scheduled_start_time?: string | null;
  },
  todayIso: string,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};

  const needsCalendarSlot =
    nextStatus === "Scheduled" ||
    nextStatus === "In Progress" ||
    nextStatus === "Waiting on Parts" ||
    nextStatus === "Ready for Review";

  if (needsCalendarSlot) {
    if (!current.scheduled_date) {
      extra.scheduled_date = todayIso;
    }
    if (!current.scheduled_start_time) {
      extra.scheduled_start_time = "09:00:00";
    }
  }

  // Back to Requested = not on the calendar yet
  if (nextStatus === "Requested") {
    extra.scheduled_date = null;
    extra.scheduled_start_time = null;
  }

  if (nextStatus === "Canceled") {
    extra.scheduled_date = null;
    extra.scheduled_start_time = null;
  }

  return extra;
}

export function isTerminalWoStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}
