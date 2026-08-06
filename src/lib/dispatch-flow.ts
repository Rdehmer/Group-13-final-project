/**
 * Shared Dispatch status flow helpers (My Day job sheet + /dispatch board).
 * DB stores Working; UI shows In Progress. Arrived maps to En Route for display.
 */

export const DISPATCH_FLOW = [
  "Not Started",
  "En Route",
  "In Progress",
  "Ready for Review",
  "Done",
] as const;

export type DispatchFlowUiStatus = (typeof DISPATCH_FLOW)[number];
export type DispatchStatus = DispatchFlowUiStatus | "Paused";

/** Active field jobs — started but not finished. */
export const ACTIVE_DISPATCH_STATUSES = [
  "En Route",
  "Arrived",
  "Working",
  "Paused",
  "Ready for Review",
] as const;

/** DB uses Working; UI shows In Progress. Arrived counts as En Route step done. */
export function normalizeDispatchStatus(status: string | null | undefined): string {
  if (!status) return "Not Started";
  if (status === "Working") return "In Progress";
  if (status === "Arrived") return "En Route";
  return status;
}

/** Values allowed by work_orders_dispatch_status_check. */
export function toDbDispatchStatus(status: DispatchStatus): string {
  if (status === "In Progress") return "Working";
  return status;
}

export function dispatchFlowIndex(status: string): number {
  const normalized = normalizeDispatchStatus(status);
  if (normalized === "Paused") return DISPATCH_FLOW.indexOf("In Progress");
  return DISPATCH_FLOW.indexOf(normalized as DispatchFlowUiStatus);
}

/** Next action on the main path (or resume from Paused). */
export function getNextDispatchStatus(status: string): DispatchStatus | null {
  const normalized = normalizeDispatchStatus(status);
  if (normalized === "Paused") return "In Progress";
  const index = dispatchFlowIndex(normalized);
  if (index < 0) return "En Route";
  if (index >= DISPATCH_FLOW.length - 1) return null;
  return DISPATCH_FLOW[index + 1];
}

/** Previous step for mis-clicks (can undo back to Not Started). */
export function getPreviousDispatchStatus(status: string): DispatchStatus | null {
  const normalized = normalizeDispatchStatus(status);
  if (normalized === "Paused") return "In Progress";
  const index = dispatchFlowIndex(normalized);
  if (index <= 0) return null;
  return DISPATCH_FLOW[index - 1];
}

export function canPauseDispatch(status: string): boolean {
  return normalizeDispatchStatus(status) === "In Progress";
}

export function isDispatchInProgress(status: string | null | undefined): boolean {
  return normalizeDispatchStatus(status) === "In Progress";
}

export function isActiveDispatchJob(
  job: { status?: string | null; dispatch_status?: string | null },
): boolean {
  if (job.status && ["Completed", "Closed", "Canceled"].includes(job.status)) return false;
  const raw = job.dispatch_status ?? "";
  if (raw === "Done") return false;
  return (ACTIVE_DISPATCH_STATUSES as readonly string[]).includes(raw);
}

export function dispatchStatusTone(
  status: string,
): "success" | "warning" | "error" | "info" | "neutral" {
  const normalized = normalizeDispatchStatus(status);
  if (normalized === "Done" || normalized === "In Progress") return "success";
  if (normalized === "Paused") return "warning";
  if (normalized === "En Route" || normalized === "Ready for Review") return "info";
  return "neutral";
}
