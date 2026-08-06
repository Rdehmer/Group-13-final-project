/**
 * Work order workflow statuses must match the database CHECK constraint.
 * Schedule placement and Work Orders status edits stay in sync via these helpers.
 */

import type { WorkOrder } from "@/lib/types";

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
 * so Technician Schedule stays consistent.
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

  if (nextStatus === "Scheduled") {
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

/** Customer Active Service progress stages (matches open-request UI order). */
export const CUSTOMER_REQUEST_STAGE_KEYS = [
  "Requested",
  "Awaiting Approval",
  "Scheduled",
  "Assigned",
  "In Progress",
  "Waiting on Parts",
  "Completed",
] as const;

export type CustomerRequestStageKey = (typeof CUSTOMER_REQUEST_STAGE_KEYS)[number];

/** Customer-facing labels for progress bar and inbox drafts (matches open-request UI). */
const CUSTOMER_REQUEST_STAGE_LABELS: Record<CustomerRequestStageKey, string> = {
  Requested: "Submitted",
  "Awaiting Approval": "Under Review",
  Scheduled: "Scheduled",
  Assigned: "Technician Assigned",
  "In Progress": "In Progress",
  "Waiting on Parts": "Waiting on Parts",
  Completed: "Completed",
};

/** Maps internal WO status to the label customers see in Active Service. */
export function customerRequestStageLabel(status: string): string {
  if (status === "Canceled") return "Canceled";
  if (status === "Closed") return "Completed";
  if (status === "Ready for Review") return "In Progress";
  return CUSTOMER_REQUEST_STAGE_LABELS[status as CustomerRequestStageKey] ?? status;
}

export type WorkOrderStatusActivity = {
  action: string;
  new_value: string | null;
  created_at: string;
};

type StageDateWorkOrder = Pick<
  WorkOrder,
  "created_at" | "scheduled_date" | "started_at" | "completion_date" | "approved_at" | "status"
>;

/** Index of the work order's current stage in the customer progress bar. */
export function customerRequestStageIndex(status: string): number {
  if (status === "Closed") return CUSTOMER_REQUEST_STAGE_KEYS.length - 1;
  if (status === "Canceled") return -1;
  // Staff-only stage — customer stays on In Progress until Completed.
  if (status === "Ready for Review") {
    return CUSTOMER_REQUEST_STAGE_KEYS.indexOf("In Progress");
  }
  const idx = CUSTOMER_REQUEST_STAGE_KEYS.indexOf(status as CustomerRequestStageKey);
  return idx >= 0 ? idx : 0;
}

function isoTimestamp(value: string): string {
  return value.includes("T") ? value : `${value}T12:00:00`;
}

function earliestActivityDate(
  logs: WorkOrderStatusActivity[],
  status: string,
): string | null {
  const match = logs.find(
    (row) => row.action === "status_change" && row.new_value === status,
  );
  return match?.created_at ?? null;
}

/**
 * Best-effort stage dates for the customer progress bar.
 * Status transitions are not fully audited; missing stages omit dates.
 */
export function buildWorkOrderStageDates(
  wo: StageDateWorkOrder,
  activityLogs: WorkOrderStatusActivity[] = [],
): Partial<Record<CustomerRequestStageKey, string>> {
  const currentIdx = customerRequestStageIndex(wo.status);
  if (currentIdx < 0) return {};

  const statusLogs = [...activityLogs]
    .filter((row) => row.action === "status_change")
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

  const candidates: Record<CustomerRequestStageKey, string | null> = {
    Requested: wo.created_at,
    "Awaiting Approval": earliestActivityDate(statusLogs, "Awaiting Approval"),
    Scheduled: wo.scheduled_date
      ? isoTimestamp(wo.scheduled_date)
      : earliestActivityDate(statusLogs, "Scheduled"),
    Assigned: earliestActivityDate(statusLogs, "Assigned"),
    "In Progress":
      wo.started_at ?? earliestActivityDate(statusLogs, "In Progress"),
    "Waiting on Parts": earliestActivityDate(statusLogs, "Waiting on Parts"),
    Completed:
      (wo.completion_date ? isoTimestamp(wo.completion_date) : null) ??
      wo.approved_at ??
      earliestActivityDate(statusLogs, "Completed") ??
      earliestActivityDate(statusLogs, "Closed"),
  };

  const result: Partial<Record<CustomerRequestStageKey, string>> = {};
  CUSTOMER_REQUEST_STAGE_KEYS.forEach((key, idx) => {
    if (idx <= currentIdx && candidates[key]) {
      result[key] = candidates[key]!;
    }
  });
  return result;
}
