/**
 * Additional / ad-hoc work requests (scope-change gate) on work orders.
 * DB historically defaulted to "Pending Manager Approval"; UI uses "Pending".
 */

export const AWR_PENDING_STATUSES = ["Pending", "Pending Manager Approval"] as const;

export function isAwrPending(status: string | null | undefined): boolean {
  const s = (status ?? "").trim();
  if (!s) return false;
  if (AWR_PENDING_STATUSES.some((x) => x.toLowerCase() === s.toLowerCase())) return true;
  return /^pending\b/i.test(s) && !/approved|rejected/i.test(s);
}

export function isAwrApproved(status: string | null | undefined): boolean {
  return /^approved$/i.test((status ?? "").trim());
}

export function isAwrRejected(status: string | null | undefined): boolean {
  return /^rejected$/i.test((status ?? "").trim());
}

/** Canonical status written on insert / after migrate. */
export const AWR_STATUS_PENDING = "Pending";
export const AWR_STATUS_APPROVED = "Approved";
export const AWR_STATUS_REJECTED = "Rejected";
