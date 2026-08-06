/**
 * Monthly contract P&L for managers/admins.
 *
 * Revenue: Monthly fee on the contract (resolvedMonthlyAmount).
 * Direct cost: amortized included allowances —
 *   (included_labor_hours × $42 + included_replacement_parts) ÷ 12
 * Visits are the service schedule / utilization denominator (labor hours already
 * price the visit work, so visits are not double-counted in dollars).
 */

import {
  endOfMonth,
  endOfQuarter,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from "date-fns";
import { resolvedMonthlyAmount } from "@/lib/contract-billing";
import { grossProfit, profitMargin } from "@/lib/calculations";
import type { ServiceContract, WorkOrder } from "@/lib/types";

/** Tech pay rate used for included labor-hour cost. */
export const TECH_HOURLY_COST = 42;

/** Inclusive calendar range using yyyy-MM-dd keys (avoids Invalid Date crashes). */
export type MonthRange = { startKey: string; endKey: string };

export type ContractMonthEconomics = {
  contractId: string;
  monthlyRevenue: number;
  /** included_labor_hours × $42 ÷ 12 */
  laborCost: number;
  /** included_replacement_parts ÷ 12 (parts allowance is annual $) */
  partsCost: number;
  directCost: number;
  profit: number;
  margin: number | null;
  includedVisits: number;
  includedLaborHours: number;
  includedPartsAllowance: number;
  /** Non-canceled WOs on this contract in the selected period (utilization). */
  usedVisits: number;
};

function toDateKey(value: string | Date | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const key = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
  }
  if (!(value instanceof Date) || !isValid(value)) return null;
  return format(value, "yyyy-MM-dd");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  try {
    const d = parseISO(value.slice(0, 10));
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

function rangeFromDates(start: Date, end: Date): MonthRange | null {
  if (!isValid(start) || !isValid(end)) return null;
  return {
    startKey: format(start, "yyyy-MM-dd"),
    endKey: format(end, "yyyy-MM-dd"),
  };
}

export function currentMonthRange(today: Date = new Date()): MonthRange {
  const safe = isValid(today) ? today : new Date();
  return rangeFromDates(startOfMonth(safe), endOfMonth(safe)) ?? {
    startKey: format(new Date(), "yyyy-MM-01"),
    endKey: format(endOfMonth(new Date()), "yyyy-MM-dd"),
  };
}

export function periodRangeFromPreset(
  preset: "all" | "month" | "quarter" | "ytd" | "custom",
  today: Date,
  customStart?: string,
  customEnd?: string,
): MonthRange | null {
  const safe = isValid(today) ? today : new Date();
  if (preset === "all") return null;
  if (preset === "month") return currentMonthRange(safe);
  if (preset === "quarter") {
    return rangeFromDates(startOfQuarter(safe), endOfQuarter(safe));
  }
  if (preset === "ytd") {
    return rangeFromDates(startOfYear(safe), safe);
  }
  if (!customStart || !customEnd) return null;
  const start = parseDate(customStart);
  const end = parseDate(customEnd);
  if (!start || !end) return null;
  return rangeFromDates(start, end);
}

export function periodLabel(range: MonthRange | null, today: Date = new Date()): string {
  const safe = isValid(today) ? today : new Date();
  if (!range) return `All time through ${format(safe, "MMM d, yyyy")}`;
  const start = parseDate(range.startKey);
  const end = parseDate(range.endKey);
  if (!start || !end) return "Selected period";
  if (range.startKey.slice(0, 7) === range.endKey.slice(0, 7)) {
    return format(start, "MMMM yyyy");
  }
  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
}

export function contractMonthlyFee(
  contract: Pick<ServiceContract, "contract_price" | "billing_method" | "monthly_amount">,
): number {
  return resolvedMonthlyAmount(contract);
}

/**
 * Planned monthly direct cost from contract inclusions.
 * Labor hours × tech rate + annual parts allowance, both spread over 12 months.
 */
export function monthlyDirectCostFromAllowances(
  contract: Pick<
    ServiceContract,
    "included_labor_hours" | "included_replacement_parts" | "included_service_visits"
  >,
): { laborCost: number; partsCost: number; directCost: number } {
  const hours = Math.max(0, Number(contract.included_labor_hours) || 0);
  const partsAllowance = Math.max(0, Number(contract.included_replacement_parts) || 0);
  const laborCost = Math.round(((hours * TECH_HOURLY_COST) / 12) * 100) / 100;
  const partsCost = Math.round((partsAllowance / 12) * 100) / 100;
  return {
    laborCost,
    partsCost,
    directCost: Math.round((laborCost + partsCost) * 100) / 100,
  };
}

function workOrderActivityDateKey(wo: WorkOrder): string | null {
  return (
    toDateKey(wo.completion_date) ??
    toDateKey(wo.scheduled_date) ??
    toDateKey(wo.created_at)
  );
}

function inRange(dateKey: string, range: MonthRange): boolean {
  if (!range.startKey || !range.endKey) return false;
  return dateKey >= range.startKey && dateKey <= range.endKey;
}

export function usedVisitsInRange(
  contractId: string,
  workOrders: WorkOrder[],
  range: MonthRange | null,
): number {
  const canceled = new Set(["Canceled"]);
  let count = 0;
  for (const wo of workOrders) {
    if (wo.contract_id !== contractId || canceled.has(wo.status)) continue;
    if (range) {
      const key = workOrderActivityDateKey(wo);
      if (!key || !inRange(key, range)) continue;
    }
    count += 1;
  }
  return count;
}

export function contractEconomicsInRange(
  contract: ServiceContract,
  workOrders: WorkOrder[],
  range: MonthRange | null,
): ContractMonthEconomics {
  const monthlyRevenue = contractMonthlyFee(contract);
  const costs = monthlyDirectCostFromAllowances(contract);
  const includedVisits = Math.max(0, Number(contract.included_service_visits) || 0);
  const includedLaborHours = Math.max(0, Number(contract.included_labor_hours) || 0);
  const includedPartsAllowance = Math.max(0, Number(contract.included_replacement_parts) || 0);
  const usedVisits = usedVisitsInRange(contract.id, workOrders, range);
  const profit = grossProfit(monthlyRevenue, costs.directCost);
  return {
    contractId: contract.id,
    monthlyRevenue,
    laborCost: costs.laborCost,
    partsCost: costs.partsCost,
    directCost: costs.directCost,
    profit,
    margin: profitMargin(monthlyRevenue, profit),
    includedVisits,
    includedLaborHours,
    includedPartsAllowance,
    usedVisits,
  };
}

export function sumEconomics(rows: ContractMonthEconomics[]) {
  const monthlyRevenue = rows.reduce((s, r) => s + r.monthlyRevenue, 0);
  const directCost = rows.reduce((s, r) => s + r.directCost, 0);
  const profit = rows.reduce((s, r) => s + r.profit, 0);
  return {
    monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    directCost: Math.round(directCost * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    margin: profitMargin(monthlyRevenue, profit),
  };
}
