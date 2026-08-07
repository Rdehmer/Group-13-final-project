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
  assigned_vendor_id?: string | null;
  vendor_assignment_status?: string | null;
}): string {
  if (opts.assigned_vendor_id && opts.vendor_assignment_status === "Pending") {
    return "Requested";
  }
  if (opts.scheduled_date) return "Scheduled";
  if (opts.assigned_technician_id || opts.assigned_vendor_id) return "Assigned";
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

/** Customer Active Service progress stages (aligned with technician field checklist). */
export const CUSTOMER_REQUEST_STAGES = [
  { key: "submitted", label: "Submitted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "arrived", label: "Arrived" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
] as const;

export type CustomerRequestStageKey = (typeof CUSTOMER_REQUEST_STAGES)[number]["key"];

/** @deprecated Use CUSTOMER_REQUEST_STAGES */
export const CUSTOMER_REQUEST_STAGE_KEYS = CUSTOMER_REQUEST_STAGES.map((s) => s.key);

type CustomerStageWorkOrder = Pick<
  WorkOrder,
  | "status"
  | "arrival_at"
  | "started_at"
  | "dispatch_status"
  | "scheduled_date"
  | "created_at"
  | "completion_date"
  | "approved_at"
>;

/** Resolve the customer-facing stage from work order fields (matches technician field flow). */
export function resolveCustomerRequestStage(
  wo: CustomerStageWorkOrder,
): CustomerRequestStageKey {
  const s = wo.status;
  if (s === "Completed" || s === "Closed") return "completed";

  const inProgress =
    s === "In Progress" ||
    s === "Waiting on Parts" ||
    s === "Ready for Review" ||
    Boolean(wo.started_at) ||
    wo.dispatch_status === "Working";

  if (inProgress) return "in_progress";

  if (Boolean(wo.arrival_at) || wo.dispatch_status === "Arrived") return "arrived";

  if (
    s === "Scheduled" ||
    s === "Assigned" ||
    s === "Awaiting Approval" ||
    Boolean(wo.scheduled_date)
  ) {
    return "scheduled";
  }

  return "submitted";
}

function customerRequestStageIndexFromStatus(status: string): number {
  if (status === "Completed" || status === "Closed") {
    return CUSTOMER_REQUEST_STAGES.findIndex((s) => s.key === "completed");
  }
  if (status === "Canceled") return -1;
  if (["In Progress", "Waiting on Parts", "Ready for Review"].includes(status)) {
    return CUSTOMER_REQUEST_STAGES.findIndex((s) => s.key === "in_progress");
  }
  if (["Scheduled", "Assigned", "Awaiting Approval"].includes(status)) {
    return CUSTOMER_REQUEST_STAGES.findIndex((s) => s.key === "scheduled");
  }
  if (status === "Requested") {
    return CUSTOMER_REQUEST_STAGES.findIndex((s) => s.key === "submitted");
  }
  return 0;
}

/** Maps internal WO status / fields to the label customers see in Active Service. */
export function customerRequestStageLabel(
  woOrStatus: CustomerStageWorkOrder | string,
): string {
  if (typeof woOrStatus === "string") {
    const status = woOrStatus;
    if (status === "Canceled") return "Canceled";
    const idx = customerRequestStageIndexFromStatus(status);
    return idx >= 0 ? CUSTOMER_REQUEST_STAGES[idx]!.label : status;
  }
  if (woOrStatus.status === "Canceled") return "Canceled";
  const key = resolveCustomerRequestStage(woOrStatus);
  return CUSTOMER_REQUEST_STAGES.find((s) => s.key === key)?.label ?? woOrStatus.status;
}

export type WorkOrderStatusActivity = {
  action: string;
  new_value: string | null;
  created_at: string;
};

type StageDateWorkOrder = CustomerStageWorkOrder;

/** Index of the work order's current stage in the customer progress bar. */
export function customerRequestStageIndex(
  woOrStatus: CustomerStageWorkOrder | string,
): number {
  if (typeof woOrStatus === "string") {
    return customerRequestStageIndexFromStatus(woOrStatus);
  }
  if (woOrStatus.status === "Canceled") return -1;
  const key = resolveCustomerRequestStage(woOrStatus);
  return CUSTOMER_REQUEST_STAGES.findIndex((s) => s.key === key);
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
  const currentIdx = customerRequestStageIndex(wo);
  if (currentIdx < 0) return {};

  const statusLogs = [...activityLogs]
    .filter((row) => row.action === "status_change")
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

  const candidates: Record<CustomerRequestStageKey, string | null> = {
    submitted: wo.created_at,
    scheduled:
      (wo.scheduled_date ? isoTimestamp(wo.scheduled_date) : null) ??
      earliestActivityDate(statusLogs, "Scheduled") ??
      earliestActivityDate(statusLogs, "Assigned") ??
      earliestActivityDate(statusLogs, "Awaiting Approval"),
    arrived: wo.arrival_at,
    in_progress:
      wo.started_at ?? earliestActivityDate(statusLogs, "In Progress"),
    completed:
      (wo.completion_date ? isoTimestamp(wo.completion_date) : null) ??
      wo.approved_at ??
      earliestActivityDate(statusLogs, "Completed") ??
      earliestActivityDate(statusLogs, "Closed"),
  };

  const result: Partial<Record<CustomerRequestStageKey, string>> = {};
  CUSTOMER_REQUEST_STAGES.forEach((stage, idx) => {
    if (idx <= currentIdx && candidates[stage.key]) {
      result[stage.key] = candidates[stage.key]!;
    }
  });
  return result;
}
