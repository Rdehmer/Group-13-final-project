import { differenceInCalendarDays, differenceInYears, parseISO, startOfDay } from "date-fns";
import type { Equipment } from "@/lib/types";

export type WarrantyAging =
  | "Under Warranty"
  | "Expiring ≤90 days"
  | "Expired"
  | "Unknown";

export type ServiceCompliance = "Overdue" | "Due soon" | "OK" | "None";

export type EquipmentCostRollup = {
  laborCost: number;
  partsCost: number;
  totalCost: number;
  billable: number;
  warranty: number;
  billablePct: number | null;
  warrantyPct: number | null;
};

export function equipmentAgeYears(
  installationDate: string | null | undefined,
  today = new Date(),
): number | null {
  if (!installationDate) return null;
  try {
    return Math.max(0, differenceInYears(today, parseISO(installationDate)));
  } catch {
    return null;
  }
}

export function warrantyAging(
  equipment: Pick<Equipment, "warranty_status" | "warranty_expiration_date">,
  today = new Date(),
): WarrantyAging {
  const exp = equipment.warranty_expiration_date;
  if (exp) {
    try {
      const days = differenceInCalendarDays(parseISO(exp), startOfDay(today));
      if (days < 0) return "Expired";
      if (days <= 90) return "Expiring ≤90 days";
      return "Under Warranty";
    } catch {
      /* fall through */
    }
  }
  const status = equipment.warranty_status ?? "Unknown";
  if (status === "Warranty Expired") return "Expired";
  if (status === "Under Warranty") return "Under Warranty";
  if (status === "Not Covered") return "Expired";
  return "Unknown";
}

export function warrantyAgingTone(aging: WarrantyAging): "success" | "warning" | "error" | "neutral" | "info" {
  switch (aging) {
    case "Under Warranty":
      return "success";
    case "Expiring ≤90 days":
      return "warning";
    case "Expired":
      return "error";
    default:
      return "neutral";
  }
}

export function serviceCompliance(
  nextScheduled: string | null | undefined,
  today = new Date(),
): ServiceCompliance {
  if (!nextScheduled) return "None";
  try {
    const days = differenceInCalendarDays(parseISO(nextScheduled), startOfDay(today));
    if (days < 0) return "Overdue";
    if (days <= 30) return "Due soon";
    return "OK";
  } catch {
    return "None";
  }
}

export function serviceComplianceTone(
  flag: ServiceCompliance,
): "success" | "warning" | "error" | "neutral" | "info" {
  switch (flag) {
    case "Overdue":
      return "error";
    case "Due soon":
      return "warning";
    case "OK":
      return "success";
    default:
      return "neutral";
  }
}

export function emptyCostRollup(): EquipmentCostRollup {
  return {
    laborCost: 0,
    partsCost: 0,
    totalCost: 0,
    billable: 0,
    warranty: 0,
    billablePct: null,
    warrantyPct: null,
  };
}

export function finalizeCostRollup(partial: {
  laborCost: number;
  partsCost: number;
  billable: number;
  warranty: number;
}): EquipmentCostRollup {
  const totalCost = partial.laborCost + partial.partsCost;
  const billedBase = partial.billable + partial.warranty;
  return {
    ...partial,
    totalCost,
    billablePct: billedBase > 0 ? partial.billable / billedBase : null,
    warrantyPct: billedBase > 0 ? partial.warranty / billedBase : null,
  };
}

export function isActiveEquipmentUnit(status: Equipment["operating_status"] | string) {
  return status !== "Retired";
}

export function needsAttentionStatus(status: Equipment["operating_status"] | string) {
  return status === "Needs Service" || status === "Out of Service";
}

export function customerConcentration(
  rows: { customer_id: string; customers?: { name?: string } | null; operating_status: string }[],
  limit = 5,
): { customerId: string; name: string; count: number }[] {
  const map = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    if (!isActiveEquipmentUnit(row.operating_status)) continue;
    const id = row.customer_id;
    const name = row.customers?.name?.trim() || "Unknown";
    const cur = map.get(id) ?? { name, count: 0 };
    cur.count += 1;
    map.set(id, cur);
  }
  return [...map.entries()]
    .map(([customerId, v]) => ({ customerId, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function downloadEquipmentCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
