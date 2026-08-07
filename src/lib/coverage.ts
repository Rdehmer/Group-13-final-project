/**
 * Coverage rules for labor/parts: in-contract (PM/warranty) vs out-of-scope billable.
 * Used by field tools, work-order pages, timesheets, and invoice generation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimeBillableStatus } from "@/lib/types";

export type CoverageJob = {
  contract_id?: string | null;
  warranty_coverage?: string | null;
  under_expired_contract?: boolean | null;
  outside_contract?: boolean | null;
  work_order_type?: string | null;
};

/** True when this labor/part kind is outside agreement coverage. */
export function isOutOfScope(
  job: CoverageJob | null | undefined,
  kind: "part" | "labor",
): boolean {
  if (!job) return true;
  if (job.outside_contract) return true;
  if (job.under_expired_contract) return true;
  if (!job.contract_id) return true;
  const coverage = job.warranty_coverage ?? "";
  if (coverage === "Not Covered") return true;
  if (kind === "labor" && coverage === "Parts Only") return true;
  if (kind === "part" && coverage === "Labor Covered") return true;
  return false;
}

/**
 * Default billable status for time on a job.
 * Meal/travel stay nonbillable; in-coverage contract work → contract_included.
 */
export function resolveLaborBillableStatus(
  job: CoverageJob | null | undefined,
  activityDefault: TimeBillableStatus = "billable",
): TimeBillableStatus {
  if (activityDefault === "nonbillable") return "nonbillable";
  if (!job || isOutOfScope(job, "labor")) return "billable";
  if (job.contract_id && !job.under_expired_contract && !job.outside_contract) {
    return "contract_included";
  }
  return "billable";
}

/** technician_labor.billable_status stored labels historically used freeform text. */
export function laborBillableLabelForDb(status: TimeBillableStatus): string {
  if (status === "contract_included") return "Contract Included";
  if (status === "nonbillable") return "Non-Billable";
  return "Billable";
}

/** Split list price into covered vs customer-charged portions. */
export function splitPartCharges(input: {
  quantity: number;
  unitPrice: number;
  job: CoverageJob | null | undefined;
  /** After out-of-scope confirmation, always charge customer. */
  forceBillable?: boolean;
}): { warranty_covered_amount: number; billable_amount: number; list_total: number } {
  const qty = Math.max(0, Number(input.quantity) || 0);
  const price = Math.max(0, Number(input.unitPrice) || 0);
  const list = Math.round(qty * price * 100) / 100;
  if (list <= 0) {
    return { warranty_covered_amount: 0, billable_amount: 0, list_total: 0 };
  }
  const outside =
    Boolean(input.forceBillable) || isOutOfScope(input.job, "part");
  if (outside) {
    return {
      warranty_covered_amount: 0,
      billable_amount: list,
      list_total: list,
    };
  }
  // In coverage: full list under warranty/agreement, nothing to charge
  return {
    warranty_covered_amount: list,
    billable_amount: 0,
    list_total: list,
  };
}

/**
 * Mark the work order as outside contract (T&M / out of scope).
 * Idempotent; safe if column is missing (swallows known migration errors).
 */
export async function markWorkOrderOutsideContract(
  supabase: SupabaseClient,
  workOrderId: string,
  opts?: { reason?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const updated_at = new Date().toISOString();
  const { error } = await supabase
    .from("work_orders")
    .update({
      outside_contract: true,
      updated_at,
    })
    .eq("id", workOrderId);
  if (error) {
    // Column may not exist in older DBs — do not block the field flow hard
    const msg = error.message || "Could not set outside_contract";
    if (msg.toLowerCase().includes("outside_contract")) {
      return { ok: false, error: msg };
    }
    return { ok: false, error: msg };
  }
  void opts;
  return { ok: true };
}
