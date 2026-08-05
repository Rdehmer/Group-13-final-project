import { format, parseISO, startOfYear, endOfMonth, startOfMonth, subMonths, isValid } from "date-fns";
import { formatMoney, formatPct, grossProfit, profitMargin } from "@/lib/calculations";
import type { Invoice, Payment, ServiceContract, WorkOrder } from "@/lib/types";

/** QBO-style report catalog */
export type ReportId =
  | "pnl"
  | "balance_sheet"
  | "ar_aging"
  | "ar_detail"
  | "sales_customer"
  | "sales_month"
  | "sales_service"
  | "cash_flow"
  | "contract_profit"
  | "job_summary"
  | "unbilled"
  | "invoice_list";

export type ReportGroup = {
  title: string;
  reports: { id: ReportId; name: string; description: string }[];
};

export const REPORT_CATALOG: ReportGroup[] = [
  {
    title: "Business overview",
    reports: [
      {
        id: "pnl",
        name: "Profit and Loss",
        description: "Income, estimated COGS, and gross profit for a date range (accrual-style on invoices).",
      },
      {
        id: "balance_sheet",
        name: "Balance Sheet (summary)",
        description: "Key balances as of a date: cash collected proxy, AR, and retained earnings estimate.",
      },
      {
        id: "cash_flow",
        name: "Statement of Cash Flows",
        description: "Cash from customer payments in the period (operating activity).",
      },
    ],
  },
  {
    title: "Who owes you",
    reports: [
      {
        id: "ar_aging",
        name: "A/R Aging Summary",
        description: "Open balances by aging bucket — Current, 1–30, 31–60, 61+.",
      },
      {
        id: "ar_detail",
        name: "A/R Aging Detail",
        description: "Every open invoice with days past due and customer.",
      },
      {
        id: "invoice_list",
        name: "Invoice List",
        description: "All invoices in range with totals, paid, and balance (filterable by status).",
      },
    ],
  },
  {
    title: "Sales and customers",
    reports: [
      {
        id: "sales_customer",
        name: "Sales by Customer",
        description: "Invoiced revenue by customer for the period.",
      },
      {
        id: "sales_month",
        name: "Sales by Month",
        description: "Monthly billed revenue trend for the period.",
      },
      {
        id: "sales_service",
        name: "Sales by Product/Service",
        description: "Labor, parts, recurring, and other charge breakdown.",
      },
    ],
  },
  {
    title: "Operations",
    reports: [
      {
        id: "contract_profit",
        name: "Contract Profitability",
        description: "Contract revenue vs estimated delivery cost and margin.",
      },
      {
        id: "job_summary",
        name: "Job Status Summary",
        description: "Work orders by lifecycle status and priority.",
      },
      {
        id: "unbilled",
        name: "Unbilled Jobs",
        description: "Completed work not yet invoiced — revenue leakage watchlist.",
      },
    ],
  },
];

export const REPORT_NAME: Record<ReportId, string> = Object.fromEntries(
  REPORT_CATALOG.flatMap((g) => g.reports.map((r) => [r.id, r.name])),
) as Record<ReportId, string>;

export type DateRange = { start: string; end: string };

export function defaultYtdRange(today = new Date()): DateRange {
  return {
    start: format(startOfYear(today), "yyyy-MM-dd"),
    end: format(today, "yyyy-MM-dd"),
  };
}

export function defaultLast12Months(today = new Date()): DateRange {
  const end = endOfMonth(today);
  const start = startOfMonth(subMonths(today, 11));
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
  };
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  try {
    const d = s.includes("T") ? parseISO(s) : parseISO(`${s}T12:00:00`);
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

export function inDateRange(dateStr: string | null | undefined, range: DateRange): boolean {
  const d = parseDate(dateStr);
  if (!d) return false;
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  if (!start || !end) return false;
  return d >= start && d <= end;
}

export function isPostedInvoice(inv: Pick<Invoice, "status">): boolean {
  const s = (inv.status || "").toLowerCase();
  return !s.includes("draft") && !s.includes("canceled") && !s.includes("void") && !s.includes("needs review");
}

/** Include Needs Review / Reviewed for management AR views of committed revenue. */
export function isBilledInvoice(inv: Pick<Invoice, "status">): boolean {
  const s = (inv.status || "").toLowerCase();
  return !s.includes("draft") && !s.includes("canceled") && !s.includes("void");
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export type AgingBucket = "current" | "d30" | "d60" | "d90";

export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "d30";
  if (daysPastDue <= 60) return "d60";
  return "d90";
}

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d30: "1–30",
  d60: "31–60",
  d90: "61+",
};

export type InvoiceWithCustomer = Invoice & {
  customers?: { name: string } | null;
  work_orders?: { work_order_number: string } | null;
};

export function openInvoicesAt(
  invoices: InvoiceWithCustomer[],
  asOf: Date,
): (InvoiceWithCustomer & { daysPast: number; bucket: AgingBucket })[] {
  return invoices
    .filter((inv) => {
      if (["Canceled", "Draft"].includes(inv.status) || (inv.status || "").toLowerCase().includes("void")) {
        return false;
      }
      return Number(inv.remaining_balance) > 0;
    })
    .map((inv) => {
      const due = parseDate(inv.due_date) ?? asOf;
      const daysPast = Math.max(0, daysBetween(due, asOf));
      return { ...inv, daysPast, bucket: agingBucket(daysPast) };
    })
    .sort((a, b) => b.daysPast - a.daysPast);
}

export function arAgingSummary(open: ReturnType<typeof openInvoicesAt>) {
  const totals: Record<AgingBucket, number> = { current: 0, d30: 0, d60: 0, d90: 0 };
  const counts: Record<AgingBucket, number> = { current: 0, d30: 0, d60: 0, d90: 0 };
  for (const inv of open) {
    totals[inv.bucket] += Number(inv.remaining_balance);
    counts[inv.bucket] += 1;
  }
  const total = Object.values(totals).reduce((s, n) => s + n, 0);
  return { totals, counts, total };
}

export function profitAndLoss(
  invoices: InvoiceWithCustomer[],
  range: DateRange,
  opts?: { laborCostPerHr?: number; avgHoursPerJob?: number; partsCostRatio?: number; completedJobsInRange?: number },
) {
  const laborCostPerHr = opts?.laborCostPerHr ?? 45;
  const avgHours = opts?.avgHoursPerJob ?? 2.5;
  const partsCostRatio = opts?.partsCostRatio ?? 0.6;
  const completedJobs = opts?.completedJobsInRange ?? 0;

  const rows = invoices.filter((i) => isBilledInvoice(i) && inDateRange(i.invoice_date, range));

  const laborIncome = rows.reduce((s, i) => s + Number(i.labor_charges), 0);
  const partsIncome = rows.reduce((s, i) => s + Number(i.parts_charges), 0);
  const recurringIncome = rows.reduce((s, i) => s + Number(i.recurring_service_charge), 0);
  const otherIncome = rows.reduce((s, i) => s + Number(i.additional_charges), 0);
  const discounts = rows.reduce((s, i) => s + Number(i.discounts), 0);
  const warranty = rows.reduce((s, i) => s + Number(i.warranty_deductions), 0);
  const tax = rows.reduce((s, i) => s + Number(i.tax), 0);
  const grossSales = rows.reduce((s, i) => s + Number(i.invoice_total), 0);

  const income =
    laborIncome + partsIncome + recurringIncome + otherIncome - discounts - warranty;
  const cogsLabor = completedJobs * avgHours * laborCostPerHr;
  const cogsParts = partsIncome * partsCostRatio;
  const cogs = cogsLabor + cogsParts;
  const gross = grossProfit(income, cogs);
  const margin = profitMargin(income, gross);

  return {
    invoiceCount: rows.length,
    laborIncome,
    partsIncome,
    recurringIncome,
    otherIncome,
    discounts,
    warranty,
    tax,
    grossSales,
    income,
    cogsLabor,
    cogsParts,
    cogs,
    gross,
    margin,
    assumptions: {
      laborCostPerHr,
      avgHours,
      partsCostRatio,
      completedJobs,
    },
  };
}

export function salesByCustomer(invoices: InvoiceWithCustomer[], range: DateRange) {
  const map = new Map<
    string,
    { customerId: string | null; name: string; revenue: number; paid: number; balance: number; count: number }
  >();

  for (const inv of invoices) {
    if (!isBilledInvoice(inv) || !inDateRange(inv.invoice_date, range)) continue;
    const key = inv.customer_id || inv.customers?.name || "unknown";
    const cur = map.get(key) ?? {
      customerId: inv.customer_id,
      name: inv.customers?.name ?? "Unknown customer",
      revenue: 0,
      paid: 0,
      balance: 0,
      count: 0,
    };
    cur.revenue += Number(inv.invoice_total);
    cur.paid += Number(inv.amount_paid);
    cur.balance += Number(inv.remaining_balance);
    cur.count += 1;
    map.set(key, cur);
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

export function salesByMonth(invoices: InvoiceWithCustomer[], range: DateRange) {
  const map = new Map<string, { month: string; revenue: number; collected: number; count: number }>();
  for (const inv of invoices) {
    if (!isBilledInvoice(inv) || !inDateRange(inv.invoice_date, range)) continue;
    const month = (inv.invoice_date || "").slice(0, 7);
    if (!month) continue;
    const cur = map.get(month) ?? { month, revenue: 0, collected: 0, count: 0 };
    cur.revenue += Number(inv.invoice_total);
    cur.collected += Number(inv.amount_paid);
    cur.count += 1;
    map.set(month, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export function salesByService(invoices: InvoiceWithCustomer[], range: DateRange) {
  const rows = invoices.filter((i) => isBilledInvoice(i) && inDateRange(i.invoice_date, range));
  return [
    { service: "Labor", amount: rows.reduce((s, i) => s + Number(i.labor_charges), 0) },
    { service: "Parts / materials", amount: rows.reduce((s, i) => s + Number(i.parts_charges), 0) },
    {
      service: "Recurring contract / service",
      amount: rows.reduce((s, i) => s + Number(i.recurring_service_charge), 0),
    },
    { service: "Additional charges", amount: rows.reduce((s, i) => s + Number(i.additional_charges), 0) },
    { service: "Tax collected", amount: rows.reduce((s, i) => s + Number(i.tax), 0) },
    {
      service: "Warranty deductions (contra)",
      amount: -rows.reduce((s, i) => s + Number(i.warranty_deductions), 0),
    },
    { service: "Discounts (contra)", amount: -rows.reduce((s, i) => s + Number(i.discounts), 0) },
  ].filter((r) => r.amount !== 0);
}

export function cashFlowFromPayments(payments: Payment[], range: DateRange) {
  const rows = payments.filter((p) => inDateRange(p.payment_date, range));
  const byMethod = new Map<string, number>();
  let total = 0;
  for (const p of rows) {
    const m = p.payment_method || "Other";
    byMethod.set(m, (byMethod.get(m) ?? 0) + Number(p.payment_amount));
    total += Number(p.payment_amount);
  }
  return {
    total,
    count: rows.length,
    byMethod: Array.from(byMethod.entries())
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    lines: rows.sort((a, b) => (b.payment_date || "").localeCompare(a.payment_date || "")),
  };
}

export function balanceSheetSummary(
  invoices: InvoiceWithCustomer[],
  payments: Payment[],
  asOfStr: string,
) {
  const asOf = parseDate(asOfStr) ?? new Date();
  const cash = payments
    .filter((p) => {
      const d = parseDate(p.payment_date);
      return d && d <= asOf;
    })
    .reduce((s, p) => s + Number(p.payment_amount), 0);

  const ar = openInvoicesAt(invoices, asOf).reduce((s, i) => s + Number(i.remaining_balance), 0);

  const billedYtd = invoices
    .filter((i) => {
      if (!isBilledInvoice(i)) return false;
      const d = parseDate(i.invoice_date);
      return d && d.getFullYear() === asOf.getFullYear() && d <= asOf;
    })
    .reduce((s, i) => s + Number(i.invoice_total), 0);

  // Equity plug: cash + AR − simple liability placeholder (none) ≈ net assets
  const totalAssets = cash + ar;
  const retained = totalAssets; // single-owner service co. plug for demo

  return {
    asOf: asOfStr,
    cash,
    ar,
    totalAssets,
    liabilities: 0,
    equity: retained,
    billedYtd,
  };
}

export function contractProfitability(
  contracts: (ServiceContract & { customers?: { name: string } })[],
  visitCost = 350,
) {
  return contracts
    .map((c) => {
      const rev = Number(c.contract_price);
      const cost = Number(c.included_service_visits || 0) * visitCost;
      const profit = grossProfit(rev, cost);
      return {
        id: c.id,
        customerId: c.customer_id,
        customerName: c.customers?.name ?? "—",
        name: c.name,
        status: c.status,
        revenue: rev,
        cost,
        profit,
        margin: profitMargin(rev, profit),
        visits: c.included_service_visits,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

export function jobStatusSummary(jobs: WorkOrder[]) {
  const byStatus = new Map<string, number>();
  const byPriority = new Map<string, number>();
  let unbilled = 0;
  for (const j of jobs) {
    byStatus.set(j.status, (byStatus.get(j.status) ?? 0) + 1);
    byPriority.set(j.priority, (byPriority.get(j.priority) ?? 0) + 1);
    if (j.status === "Completed" && j.billing_status === "Unbilled") unbilled += 1;
  }
  return {
    total: jobs.length,
    byStatus: Array.from(byStatus.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    byPriority: Array.from(byPriority.entries())
      .map(([priority, count]) => ({ priority, count }))
      .sort((a, b) => b.count - a.count),
    unbilled,
    open: jobs.filter((j) => !["Completed", "Closed", "Canceled"].includes(j.status)).length,
    completed: jobs.filter((j) => ["Completed", "Closed"].includes(j.status)).length,
  };
}

export function unbilledJobs(jobs: (WorkOrder & { customers?: { name: string } })[]) {
  return jobs
    .filter((j) => j.status === "Completed" && j.billing_status === "Unbilled")
    .sort((a, b) => (b.completion_date || b.updated_at || "").localeCompare(a.completion_date || a.updated_at || ""));
}

export function invoicesInRange(invoices: InvoiceWithCustomer[], range: DateRange) {
  return invoices
    .filter((i) => inDateRange(i.invoice_date, range))
    .sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || ""));
}

export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatReportMoney(n: number): string {
  return formatMoney(n);
}

export function formatReportPct(n: number | null): string {
  return formatPct(n);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
}
