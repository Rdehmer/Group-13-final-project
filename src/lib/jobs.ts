import type { WorkOrder } from "@/lib/types";

/** ServiceTitan-style job stages mapped to work_order.status values */
export const JOB_STAGES = [
  { key: "booked", label: "Booked", statuses: ["Requested"] },
  { key: "assigned", label: "Assigned", statuses: ["Assigned"] },
  { key: "scheduled", label: "Scheduled", statuses: ["Scheduled", "Dispatched"] },
  { key: "in_progress", label: "In Progress", statuses: ["In Progress"] },
  { key: "hold", label: "On Hold", statuses: ["Waiting on Parts", "On Hold"] },
  { key: "review", label: "Done / Review", statuses: ["Ready for Review"] },
  { key: "completed", label: "Completed", statuses: ["Completed", "Closed"] },
] as const;

export type JobStageKey = (typeof JOB_STAGES)[number]["key"];

export type JobBoardFilter =
  | "all"
  | "open"
  | "today"
  | "unassigned"
  | "critical"
  | "review"
  | "unbilled"
  | "completed";

export function jobStageIndex(status: string): number {
  const i = JOB_STAGES.findIndex((s) =>
    s.statuses.some((x) => x.toLowerCase() === status.toLowerCase()),
  );
  return i >= 0 ? i : -1;
}

export function isJobOpen(status: string): boolean {
  return !["Completed", "Closed", "Canceled"].includes(status);
}

export function isJobUrgent(wo: Pick<WorkOrder, "priority" | "work_order_type">): boolean {
  return wo.priority === "Critical" || wo.work_order_type === "Emergency Repair";
}

export function jobBoardMatch(
  wo: WorkOrder,
  filter: JobBoardFilter,
  todayIso: string,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return isJobOpen(wo.status);
    case "today":
      return wo.scheduled_date === todayIso && isJobOpen(wo.status);
    case "unassigned":
      return !wo.assigned_technician_id && isJobOpen(wo.status);
    case "critical":
      return isJobUrgent(wo) && isJobOpen(wo.status);
    case "review":
      return wo.status === "Ready for Review";
    case "unbilled":
      return wo.status === "Completed" && wo.billing_status === "Unbilled";
    case "completed":
      return wo.status === "Completed" || wo.status === "Closed";
    default:
      return true;
  }
}

/** Next recommended manager/dispatch actions for a job (ServiceTitan-style workflow). */
export function nextJobActions(wo: WorkOrder): { action: string; label: string; status?: string }[] {
  const actions: { action: string; label: string; status?: string }[] = [];
  if (wo.status === "Canceled") return actions;

  if (wo.status === "Requested") {
    actions.push({ action: "assign", label: "Assign technician" });
  }
  if (["Requested", "Assigned"].includes(wo.status)) {
    actions.push({ action: "schedule", label: "Schedule job", status: "Scheduled" });
  }
  if (["Assigned", "Scheduled"].includes(wo.status)) {
    actions.push({ action: "dispatch", label: "Dispatch", status: "Scheduled" });
  }
  if (["Scheduled", "Assigned"].includes(wo.status)) {
    actions.push({ action: "start", label: "Start job", status: "In Progress" });
  }
  if (wo.status === "In Progress") {
    actions.push({ action: "hold", label: "Hold — waiting on parts", status: "Waiting on Parts" });
    actions.push({ action: "ready", label: "Mark ready for review", status: "Ready for Review" });
  }
  if (wo.status === "Waiting on Parts") {
    actions.push({ action: "resume", label: "Resume work", status: "In Progress" });
  }
  if (wo.status === "Ready for Review") {
    actions.push({ action: "complete", label: "Approve & complete" });
  }
  if (wo.status === "Completed" && wo.billing_status === "Unbilled") {
    actions.push({ action: "invoice", label: "Create invoice" });
  }
  if (isJobOpen(wo.status)) {
    actions.push({ action: "cancel", label: "Cancel job", status: "Canceled" });
  }
  return actions;
}

export function formatJobTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
