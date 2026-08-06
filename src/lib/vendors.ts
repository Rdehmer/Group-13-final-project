/**
 * Vendor AP helpers — balances, status, and aging buckets (QuickBooks-style).
 */

import type { UserRole, VendorBill, VendorBillStatus } from "@/lib/types";

export type AgingBucket = "Current" | "1-30" | "31-60" | "61+";

export function isVendorManager(role: UserRole): boolean {
  return role === "administrator" || role === "service_manager";
}

export function canApproveVendors(role: UserRole): boolean {
  return isVendorManager(role);
}

/** Only managers/admins may create suppliers or service vendors. */
export function canCreateVendor(role: UserRole): boolean {
  return isVendorManager(role);
}

/** Profile edits, active/inactive — manager/admin only (billing is AP only). */
export function canEditVendorMaster(role: UserRole): boolean {
  return isVendorManager(role);
}

export function canDeleteVendor(role: UserRole): boolean {
  return isVendorManager(role);
}

/** Managers/admins add vendors as Approved. */
export function newVendorApprovalStatus(role: UserRole): "Pending" | "Approved" {
  return isVendorManager(role) ? "Approved" : "Pending";
}

export function canEnterBillsForVendor(vendor: {
  is_active: boolean;
  approval_status?: string | null;
}): boolean {
  return vendor.is_active && (vendor.approval_status ?? "Approved") === "Approved";
}

export function billBalance(bill: Pick<VendorBill, "amount" | "amount_paid" | "status">): number {
  if (bill.status === "Void") return 0;
  return Math.max(0, Math.round((Number(bill.amount) - Number(bill.amount_paid)) * 100) / 100);
}

export function recomputeBillStatus(
  amount: number,
  amountPaid: number,
  current: VendorBillStatus = "Open",
): VendorBillStatus {
  if (current === "Void") return "Void";
  const paid = Math.round(Number(amountPaid) * 100) / 100;
  const total = Math.round(Number(amount) * 100) / 100;
  if (paid <= 0) return "Open";
  if (paid + 0.005 >= total) return "Paid";
  return "Partial";
}

/** Days past due relative to asOf (YYYY-MM-DD). Negative = not yet due. */
export function daysPastDue(dueDate: string, asOf: string = todayIso()): number {
  const due = parseIsoDate(dueDate);
  const asOfDate = parseIsoDate(asOf);
  if (!due || !asOfDate) return 0;
  const ms = asOfDate.getTime() - due.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function agingBucketForBill(
  bill: Pick<VendorBill, "amount" | "amount_paid" | "status" | "due_date">,
  asOf: string = todayIso(),
): AgingBucket | null {
  const balance = billBalance(bill);
  if (balance <= 0) return null;
  const days = daysPastDue(bill.due_date, asOf);
  if (days <= 0) return "Current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  return "61+";
}

export function agingHint(
  bill: Pick<VendorBill, "amount" | "amount_paid" | "status" | "due_date">,
  asOf: string = todayIso(),
): string {
  const bucket = agingBucketForBill(bill, asOf);
  if (!bucket) return "—";
  if (bucket === "Current") return "Current";
  return `${bucket} days`;
}

export function openBalanceForBills(
  bills: Pick<VendorBill, "amount" | "amount_paid" | "status">[],
): number {
  return Math.round(bills.reduce((sum, b) => sum + billBalance(b), 0) * 100) / 100;
}

export function overdueBalanceForBills(
  bills: Pick<VendorBill, "amount" | "amount_paid" | "status" | "due_date">[],
  asOf: string = todayIso(),
): number {
  return (
    Math.round(
      bills
        .filter((b) => billBalance(b) > 0 && daysPastDue(b.due_date, asOf) > 0)
        .reduce((sum, b) => sum + billBalance(b), 0) * 100,
    ) / 100
  );
}

/** Worst (oldest) open aging bucket across bills, for list display. */
export function worstAgingHint(
  bills: Pick<VendorBill, "amount" | "amount_paid" | "status" | "due_date">[],
  asOf: string = todayIso(),
): string {
  const order: AgingBucket[] = ["61+", "31-60", "1-30", "Current"];
  let worst: AgingBucket | null = null;
  for (const bill of bills) {
    const bucket = agingBucketForBill(bill, asOf);
    if (!bucket) continue;
    if (!worst || order.indexOf(bucket) < order.indexOf(worst)) worst = bucket;
  }
  if (!worst) return "—";
  if (worst === "Current") return "Current";
  return `${worst} overdue`;
}

export type VendorAgingRow = {
  vendorId: string;
  vendorName: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_plus: number;
  total: number;
};

export type ApAgingSummary = {
  asOf: string;
  rows: VendorAgingRow[];
  totals: Omit<VendorAgingRow, "vendorId" | "vendorName">;
};

/** QuickBooks-style A/P Aging Summary — open balances by vendor and bucket. */
export function buildApAgingSummary(
  vendors: { id: string; name: string }[],
  bills: Pick<VendorBill, "vendor_id" | "amount" | "amount_paid" | "status" | "due_date">[],
  asOf: string = todayIso(),
): ApAgingSummary {
  const empty = () => ({ current: 0, d1_30: 0, d31_60: 0, d61_plus: 0, total: 0 });
  const byVendor = new Map<string, ReturnType<typeof empty>>();

  for (const bill of bills) {
    const balance = billBalance(bill);
    const bucket = agingBucketForBill(bill, asOf);
    if (balance <= 0 || !bucket) continue;
    const row = byVendor.get(bill.vendor_id) ?? empty();
    if (bucket === "Current") row.current += balance;
    else if (bucket === "1-30") row.d1_30 += balance;
    else if (bucket === "31-60") row.d31_60 += balance;
    else row.d61_plus += balance;
    row.total += balance;
    byVendor.set(bill.vendor_id, row);
  }

  const nameById = new Map(vendors.map((v) => [v.id, v.name]));
  const rows: VendorAgingRow[] = [...byVendor.entries()]
    .map(([vendorId, amounts]) => ({
      vendorId,
      vendorName: nameById.get(vendorId) ?? "Unknown vendor",
      current: round2(amounts.current),
      d1_30: round2(amounts.d1_30),
      d31_60: round2(amounts.d31_60),
      d61_plus: round2(amounts.d61_plus),
      total: round2(amounts.total),
    }))
    .sort((a, b) => b.total - a.total || a.vendorName.localeCompare(b.vendorName));

  const totals = rows.reduce(
    (acc, r) => ({
      current: acc.current + r.current,
      d1_30: acc.d1_30 + r.d1_30,
      d31_60: acc.d31_60 + r.d31_60,
      d61_plus: acc.d61_plus + r.d61_plus,
      total: acc.total + r.total,
    }),
    empty(),
  );

  return {
    asOf,
    rows,
    totals: {
      current: round2(totals.current),
      d1_30: round2(totals.d1_30),
      d31_60: round2(totals.d31_60),
      d61_plus: round2(totals.d61_plus),
      total: round2(totals.total),
    },
  };
}

export type AgingFilterKey = "current" | "d1_30" | "d31_60" | "d61_plus" | "total";

export function agingFilterToBucket(filter: AgingFilterKey | null): AgingBucket | null {
  if (!filter || filter === "total") return null;
  if (filter === "current") return "Current";
  if (filter === "d1_30") return "1-30";
  if (filter === "d31_60") return "31-60";
  return "61+";
}

export function agingBucketLabel(bucket: AgingBucket | null): string {
  if (!bucket) return "All";
  if (bucket === "Current") return "Current";
  if (bucket === "1-30") return "1–30 days";
  if (bucket === "31-60") return "31–60 days";
  return "61+ days";
}

/** Bills for one vendor that fall in a specific aging bucket (or all open if bucket null). */
export function billsInAgingBucket<T extends Pick<VendorBill, "amount" | "amount_paid" | "status" | "due_date">>(
  bills: T[],
  bucket: AgingBucket | null,
  asOf: string = todayIso(),
): T[] {
  return bills.filter((bill) => {
    const bal = billBalance(bill);
    if (bal <= 0) return false;
    if (!bucket) return true;
    return agingBucketForBill(bill, asOf) === bucket;
  });
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Excel-friendly CSV for the current aging summary rows. */
export function buildApAgingCsv(
  rows: VendorAgingRow[],
  asOf: string,
  filterLabel: string,
): string {
  const headers = [
    "Vendor",
    "Current",
    "1-30 days",
    "31-60 days",
    "61+ days",
    "Total",
    "As of",
    "Filter",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.vendorName,
        r.current.toFixed(2),
        r.d1_30.toFixed(2),
        r.d31_60.toFixed(2),
        r.d61_plus.toFixed(2),
        r.total.toFixed(2),
        asOf,
        filterLabel,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadApAgingCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function addDaysIso(isoDate: string, days: number): string {
  const d = parseIsoDate(isoDate);
  if (!d) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isVendorSchemaError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("vendors") ||
    m.includes("vendor_bills") ||
    m.includes("vendor_bill_payments")
  ) && (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find") ||
    m.includes("pgrst205") ||
    m.includes("42p01")
  );
}

function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
