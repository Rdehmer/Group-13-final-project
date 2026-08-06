/**
 * ASC 606 earned revenue helpers shared by Reports + Invoice & Cash.
 * Earn on performance (completed work). Prepaid recognition lives in reports/close.
 */

import type { Invoice, WorkOrder } from "@/lib/types";
import type { DateRange } from "@/lib/reports";

const COMPLETED = new Set(["Completed", "Closed"]);

export function isCompletedWorkOrder(status: string | null | undefined): boolean {
  return COMPLETED.has(status || "");
}

export function isBillableInvoice(inv: Pick<Invoice, "status">): boolean {
  const s = (inv.status || "").trim().toLowerCase();
  if (!s) return false;
  if (
    ["draft", "needs review", "reviewed", "on hold", "canceled", "cancelled", "void", "credit"].some((x) =>
      s.includes(x),
    )
  ) {
    return false;
  }
  return true;
}

export function estimatedJobRevenue(job: WorkOrder): number {
  if (job.estimated_total_cost != null && Number(job.estimated_total_cost) > 0) {
    return Number(job.estimated_total_cost);
  }
  const parts = Number(job.estimated_parts_cost) || 0;
  const labor = (Number(job.estimated_labor_hours) || 0) * 95;
  return parts + labor;
}

export type EarnedJobRow = {
  workOrderId: string;
  workOrderNumber: string;
  customerId: string;
  completionDate: string;
  source: "Invoice" | "Estimate on completion";
  amount: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  billed: boolean;
};

export function earnedRevenueFromCompletions(
  jobs: WorkOrder[],
  invoices: Invoice[],
  range?: DateRange | null,
): EarnedJobRow[] {
  const byWo = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    if (!inv.work_order_id || !isBillableInvoice(inv)) continue;
    const list = byWo.get(inv.work_order_id) ?? [];
    list.push(inv);
    byWo.set(inv.work_order_id, list);
  }

  const rows: EarnedJobRow[] = [];
  for (const job of jobs) {
    if (!isCompletedWorkOrder(job.status)) continue;
    const completionDate = (job.completion_date || job.updated_at || "").slice(0, 10);
    if (!completionDate) continue;
    if (range && (completionDate < range.start || completionDate > range.end)) continue;

    const linked = byWo.get(job.id) ?? [];
    const invTotal = linked.reduce((s, i) => s + Number(i.invoice_total), 0);
    const primary = linked[0] ?? null;
    const amount = invTotal > 0.005 ? invTotal : estimatedJobRevenue(job);
    rows.push({
      workOrderId: job.id,
      workOrderNumber: job.work_order_number,
      customerId: job.customer_id,
      completionDate,
      source: invTotal > 0.005 ? "Invoice" : "Estimate on completion",
      amount: Math.round(amount * 100) / 100,
      invoiceId: primary?.id ?? null,
      invoiceNumber: primary?.invoice_number ?? null,
      billed: invTotal > 0.005,
    });
  }
  return rows.sort((a, b) => b.completionDate.localeCompare(a.completionDate));
}

export function contractAssetRollforward(
  jobs: WorkOrder[],
  invoices: Invoice[],
  asOf: string,
): {
  beginning: number;
  earnedUnbilled: number;
  billed: number;
  ending: number;
  rows: EarnedJobRow[];
} {
  const allEarned = earnedRevenueFromCompletions(jobs, invoices, null);
  const asOfRows = allEarned.filter((r) => r.completionDate <= asOf);
  const unbilled = asOfRows.filter((r) => !r.billed);
  const ending = unbilled.reduce((s, r) => s + r.amount, 0);

  const monthStart = `${asOf.slice(0, 7)}-01`;
  const beginning = allEarned
    .filter((r) => !r.billed && r.completionDate < monthStart)
    .reduce((s, r) => s + r.amount, 0);

  const earnedUnbilled = allEarned
    .filter((r) => !r.billed && r.completionDate >= monthStart && r.completionDate <= asOf)
    .reduce((s, r) => s + r.amount, 0);

  const billed = allEarned
    .filter((r) => r.billed && r.completionDate <= asOf)
    .filter((r) => {
      const inv = invoices.find((i) => i.id === r.invoiceId);
      const invDate = inv?.invoice_date?.slice(0, 10) ?? "";
      return invDate >= monthStart && invDate <= asOf;
    })
    .reduce((s, r) => s + r.amount, 0);

  return {
    beginning: Math.round(beginning * 100) / 100,
    earnedUnbilled: Math.round(earnedUnbilled * 100) / 100,
    billed: Math.round(billed * 100) / 100,
    ending: Math.round(ending * 100) / 100,
    rows: unbilled,
  };
}
