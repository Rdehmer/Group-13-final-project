/**
 * GAAP-oriented financial report engines for Ridley Equipment Service Manager.
 *
 * Policies documented in ACCOUNTING_POLICIES (surfaced in the UI).
 * Numbers are derived from posted transactional data — not arbitrary plugs —
 * except where the chart of accounts cannot store an item (disclosed).
 */

import { format, parseISO, startOfYear, endOfMonth, startOfMonth, subMonths, isValid } from "date-fns";
import { formatMoney, formatPct, grossProfit, profitMargin, laborCost } from "@/lib/calculations";
import type {
  Invoice,
  Part,
  Payment,
  ServiceContract,
  TechnicianLabor,
  WorkOrder,
  WorkOrderPart,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Accounting policies (ASC concepts applied to available data)
// ---------------------------------------------------------------------------

export const ACCOUNTING_POLICIES = {
  framework: "U.S. GAAP orientation for a service company using this application’s subledgers",
  basis: "Accrual basis for the statement of operations and balance sheet; cash basis detail on the cash flow statement",
  revenue:
    "Service revenue is recognized on the invoice date when the invoice is issued to the customer (Sent, Partially Paid, Paid, Overdue, etc.). Draft, Needs Review, Reviewed, On Hold, Canceled, and Void are not recognized. Sales tax is a liability, not revenue.",
  receivables:
    "Accounts receivable is the remaining_balance of recognized invoices still open as of the report date. Aging is based on days past due_date.",
  allowance:
    "Allowance for credit losses uses a simplified aging method on open balances: 2% of 1–30 days past due, 10% of 31–60, and 50% of 61+ (CECL proxy; management estimate disclosed in Policies).",
  cogs:
    "Cost of services for recognized invoices is matched to linked work orders: technician labor at stored cost rates (regular + overtime) and parts at stored unit_cost × quantity (matching principle).",
  inventory: "Inventory is measured at FIFO unit_cost × quantity_on_hand for active parts (approximate cost method in app).",
  cash: "Cash presented is the cumulative total of recorded customer payments on or before the as-of date (collections subledger). No separate bank reconciliation account exists in the schema.",
  taxLiability:
    "Sales tax payable equals sales tax on open (unpaid) recognized invoice balances, allocated by tax ÷ invoice_total when total > 0; remaining unallocated tax on fully paid invoices is treated as collected and still payable until remitted (app has no remittance ledger, so all tax on paid invoices remains in payable).",
  wip: "Contract assets / unbilled receivables: completed, unbilled work orders valued at estimated billable labor + parts on those jobs (contract asset).",
  limitations:
    "No full general ledger, fixed assets, AP, payroll tax, or bank feeds. Reports use the invoices, payments, labor, parts, and inventory subledgers. Equity is assets − liabilities (plug that forces the balance sheet to balance).",
} as const;

/**
 * Draft / internal workflow statuses are not recognized.
 * Revenue is recognized once the invoice is issued or collection has begun (ASC 606 timing
 * approximated with billing cycle data available in the app).
 */
const NON_RECOGNIZED = [
  "draft",
  "needs review",
  "reviewed", // approved internally but not yet issued to customer
  "on hold",
  "canceled",
  "cancelled",
  "void",
];

/** Explicit customer-facing / collectible statuses (case-insensitive includes). */
const RECOGNIZED_HINTS = ["sent", "partial", "paid", "overdue", "past due", "open", "outstanding"];

export function isRecognizedRevenue(
  inv: Pick<Invoice, "status"> & { amount_paid?: number },
): boolean {
  const s = (inv.status || "").trim().toLowerCase();
  if (!s) return false;
  if (NON_RECOGNIZED.some((x) => s === x || s.includes(x))) return false;
  if (RECOGNIZED_HINTS.some((x) => s.includes(x))) return true;
  // Collections imply prior recognition even if status label is custom
  if (Number(inv.amount_paid ?? 0) > 0.005) return true;
  // Unknown non-excluded status with a balance — treat as recognized once not in workflow holds
  return true;
}

export function isOpenReceivable(
  inv: Pick<Invoice, "status" | "remaining_balance"> & { amount_paid?: number },
): boolean {
  if (!isRecognizedRevenue(inv)) return false;
  return Number(inv.remaining_balance) > 0.005;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type ReportId =
  | "executive"
  | "pnl"
  | "pnl_compare"
  | "balance_sheet"
  | "ar_aging"
  | "ar_detail"
  | "customer_balances"
  | "collections"
  | "sales_customer"
  | "sales_month"
  | "sales_service"
  | "cash_flow"
  | "sales_tax"
  | "contract_profit"
  | "job_profit"
  | "job_summary"
  | "unbilled"
  | "tech_labor"
  | "inventory"
  | "invoice_list"
  | "policies";

export type ReportGroup = {
  title: string;
  reports: { id: ReportId; name: string; description: string }[];
};

export const REPORT_CATALOG: ReportGroup[] = [
  {
    title: "Financial statements",
    reports: [
      {
        id: "executive",
        name: "Management Snapshot",
        description: "KPIs: revenue, margin, DSO, cash collected, unbilled, tax payable.",
      },
      {
        id: "pnl",
        name: "Statement of Operations (P&L)",
        description: "Accrual revenue, matched cost of services, gross profit — GAAP-oriented.",
      },
      {
        id: "pnl_compare",
        name: "P&L vs Prior Period",
        description: "Current range vs equal prior period — variance and % change.",
      },
      {
        id: "balance_sheet",
        name: "Balance Sheet",
        description: "Assets (cash, AR net, inventory, contract assets), liabilities, equity as of date.",
      },
      {
        id: "cash_flow",
        name: "Statement of Cash Flows",
        description: "Cash receipts from customers by payment date, with AR rollforward.",
      },
      {
        id: "policies",
        name: "Significant Accounting Policies",
        description: "Disclosures describing how figures are measured in these reports.",
      },
    ],
  },
  {
    title: "Receivables & collections",
    reports: [
      {
        id: "ar_aging",
        name: "A/R Aging Summary",
        description: "Open AR by aging bucket with allowance estimate.",
      },
      {
        id: "ar_detail",
        name: "A/R Aging Detail",
        description: "Invoice-level open AR, days past due, customer.",
      },
      {
        id: "customer_balances",
        name: "Customer Balance Summary",
        description: "Open AR by customer with period activity — collections worklist.",
      },
      {
        id: "collections",
        name: "Collections & DSO",
        description: "Days sales outstanding, collection rate, top overdue accounts.",
      },
      {
        id: "invoice_list",
        name: "Invoice Register",
        description: "All invoices in range with recognition status, totals, tax, balance.",
      },
    ],
  },
  {
    title: "Revenue & tax",
    reports: [
      {
        id: "sales_customer",
        name: "Revenue by Customer",
        description: "Recognized service revenue by customer (ex-tax).",
      },
      {
        id: "sales_month",
        name: "Revenue by Month",
        description: "Accrual revenue by invoice month.",
      },
      {
        id: "sales_service",
        name: "Revenue by Performance Type",
        description: "Labor, parts, recurring, additional (component of transaction price).",
      },
      {
        id: "sales_tax",
        name: "Sales Tax Liability",
        description: "Tax billed, open, and remittance estimate for the period.",
      },
    ],
  },
  {
    title: "Jobs, labor & inventory",
    reports: [
      {
        id: "job_profit",
        name: "Job Profitability",
        description: "Per work order: billed revenue, actual labor/parts cost, margin.",
      },
      {
        id: "contract_profit",
        name: "Contract Profitability",
        description: "Contract-linked recognized revenue vs matched job costs.",
      },
      {
        id: "tech_labor",
        name: "Technician Labor Productivity",
        description: "Hours, cost, billable rate recovery by technician.",
      },
      {
        id: "inventory",
        name: "Inventory Valuation",
        description: "On-hand stock at cost/sell, reorder flags, usage in range.",
      },
      {
        id: "job_summary",
        name: "Job Status Summary",
        description: "Work order volumes by status and priority.",
      },
      {
        id: "unbilled",
        name: "Unbilled Completions (Contract Assets)",
        description: "Completed unbilled jobs and estimated billable value.",
      },
    ],
  },
];

export const REPORT_NAME: Record<ReportId, string> = Object.fromEntries(
  REPORT_CATALOG.flatMap((g) => g.reports.map((r) => [r.id, r.name])),
) as Record<ReportId, string>;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

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
  return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
}

export function parseDate(s: string | null | undefined): Date | null {
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

export function onOrBefore(dateStr: string | null | undefined, asOfStr: string): boolean {
  const d = parseDate(dateStr);
  const asOf = parseDate(asOfStr);
  if (!d || !asOf) return false;
  return d <= asOf;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvoiceWithCustomer = Invoice & {
  customers?: { name: string } | null;
  work_orders?: { work_order_number: string } | null;
};

export type AgingBucket = "current" | "d30" | "d60" | "d90";

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d30: "1–30 days",
  d60: "31–60 days",
  d90: "61+ days",
};

export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "d30";
  if (daysPastDue <= 60) return "d60";
  return "d90";
}

/** Service revenue exclusive of sales tax (transaction price components). */
export function serviceRevenueAmount(inv: Invoice): number {
  return Math.max(
    0,
    Number(inv.labor_charges) +
      Number(inv.parts_charges) +
      Number(inv.recurring_service_charge) +
      Number(inv.additional_charges) -
      Number(inv.warranty_deductions) -
      Number(inv.discounts),
  );
}

export function laborCostAmount(row: TechnicianLabor): number {
  return laborCost(
    Number(row.regular_hours),
    Number(row.overtime_hours),
    Number(row.hourly_cost_rate),
    Number(row.overtime_cost_rate || row.hourly_cost_rate * 1.5),
  );
}

export function partCostAmount(row: WorkOrderPart): number {
  return Number(row.quantity_used) * Number(row.unit_cost);
}

export function partBillableAmount(row: WorkOrderPart): number {
  return Number(row.billable_amount ?? Number(row.quantity_used) * Number(row.customer_price));
}

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

export function openInvoicesAt(
  invoices: InvoiceWithCustomer[],
  asOf: Date,
): (InvoiceWithCustomer & { daysPast: number; bucket: AgingBucket })[] {
  return invoices
    .filter((inv) => isOpenReceivable(inv))
    .filter((inv) => {
      // Invoice must have been issued on/before as-of
      const invDate = parseDate(inv.invoice_date);
      return !invDate || invDate <= asOf;
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
  const gross = Object.values(totals).reduce((s, n) => s + n, 0);
  // CECL simplified aging method (management estimate) — see ACCOUNTING_POLICIES.allowance
  const allowance = totals.d30 * 0.02 + totals.d60 * 0.1 + totals.d90 * 0.5;
  const net = Math.max(0, gross - allowance);
  return { totals, counts, gross, allowance, net, total: gross };
}

export type CostContext = {
  labor: TechnicianLabor[];
  partsUsed: WorkOrderPart[];
  jobs: WorkOrder[];
};

export function profitAndLoss(
  invoices: InvoiceWithCustomer[],
  range: DateRange,
  costs: CostContext,
) {
  const recognized = invoices.filter(
    (i) => isRecognizedRevenue(i) && inDateRange(i.invoice_date, range),
  );

  const laborIncome = recognized.reduce((s, i) => s + Number(i.labor_charges), 0);
  const partsIncome = recognized.reduce((s, i) => s + Number(i.parts_charges), 0);
  const recurringIncome = recognized.reduce((s, i) => s + Number(i.recurring_service_charge), 0);
  const otherIncome = recognized.reduce((s, i) => s + Number(i.additional_charges), 0);
  const discounts = recognized.reduce((s, i) => s + Number(i.discounts), 0);
  const warranty = recognized.reduce((s, i) => s + Number(i.warranty_deductions), 0);
  const salesTax = recognized.reduce((s, i) => s + Number(i.tax), 0);
  const invoiceTotals = recognized.reduce((s, i) => s + Number(i.invoice_total), 0);

  // Service revenue (excludes tax) — GAAP sales
  const serviceRevenue = laborIncome + partsIncome + recurringIncome + otherIncome - discounts - warranty;

  // Match costs to recognized invoices via work_order_id
  const woIds = new Set(
    recognized.map((i) => i.work_order_id).filter((id): id is string => Boolean(id)),
  );

  let cogsLabor = 0;
  let cogsParts = 0;
  let laborHours = 0;
  for (const row of costs.labor) {
    if (!woIds.has(row.work_order_id)) continue;
    cogsLabor += laborCostAmount(row);
    laborHours += Number(row.regular_hours) + Number(row.overtime_hours);
  }
  for (const row of costs.partsUsed) {
    if (!woIds.has(row.work_order_id)) continue;
    cogsParts += partCostAmount(row);
  }

  // Unlinked invoices (no WO): cannot match actual COGS — disclose residual revenue without matched costs
  const unmatchedRevenue = recognized
    .filter((i) => !i.work_order_id)
    .reduce((s, i) => s + serviceRevenueAmount(i), 0);

  const cogs = cogsLabor + cogsParts;
  const gross = grossProfit(serviceRevenue, cogs);
  const margin = profitMargin(serviceRevenue, gross);

  return {
    invoiceCount: recognized.length,
    laborIncome,
    partsIncome,
    recurringIncome,
    otherIncome,
    discounts,
    warranty,
    salesTax,
    invoiceTotals,
    serviceRevenue,
    cogsLabor,
    cogsParts,
    cogs,
    laborHours,
    gross,
    margin,
    unmatchedRevenue,
    matchedJobCount: woIds.size,
    policy: ACCOUNTING_POLICIES.revenue,
  };
}

export function salesByCustomer(invoices: InvoiceWithCustomer[], range: DateRange) {
  const map = new Map<
    string,
    { customerId: string | null; name: string; revenue: number; tax: number; paid: number; balance: number; count: number }
  >();

  for (const inv of invoices) {
    if (!isRecognizedRevenue(inv) || !inDateRange(inv.invoice_date, range)) continue;
    const key = inv.customer_id || inv.customers?.name || "unknown";
    const cur = map.get(key) ?? {
      customerId: inv.customer_id,
      name: inv.customers?.name ?? "Unknown customer",
      revenue: 0,
      tax: 0,
      paid: 0,
      balance: 0,
      count: 0,
    };
    cur.revenue += serviceRevenueAmount(inv);
    cur.tax += Number(inv.tax);
    cur.paid += Number(inv.amount_paid);
    cur.balance += Number(inv.remaining_balance);
    cur.count += 1;
    map.set(key, cur);
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

export function salesByMonth(invoices: InvoiceWithCustomer[], range: DateRange) {
  const map = new Map<string, { month: string; revenue: number; tax: number; count: number }>();
  for (const inv of invoices) {
    if (!isRecognizedRevenue(inv) || !inDateRange(inv.invoice_date, range)) continue;
    const month = (inv.invoice_date || "").slice(0, 7);
    if (!month) continue;
    const cur = map.get(month) ?? { month, revenue: 0, tax: 0, count: 0 };
    cur.revenue += serviceRevenueAmount(inv);
    cur.tax += Number(inv.tax);
    cur.count += 1;
    map.set(month, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export function salesByService(invoices: InvoiceWithCustomer[], range: DateRange) {
  const rows = invoices.filter((i) => isRecognizedRevenue(i) && inDateRange(i.invoice_date, range));
  return [
    { service: "Labor services", amount: rows.reduce((s, i) => s + Number(i.labor_charges), 0) },
    { service: "Parts transferred to customer", amount: rows.reduce((s, i) => s + Number(i.parts_charges), 0) },
    {
      service: "Recurring / contract services",
      amount: rows.reduce((s, i) => s + Number(i.recurring_service_charge), 0),
    },
    { service: "Additional performance obligations", amount: rows.reduce((s, i) => s + Number(i.additional_charges), 0) },
    {
      service: "Warranty deductions (contra-revenue)",
      amount: -rows.reduce((s, i) => s + Number(i.warranty_deductions), 0),
    },
    {
      service: "Customer discounts (contra-revenue)",
      amount: -rows.reduce((s, i) => s + Number(i.discounts), 0),
    },
  ].filter((r) => r.amount !== 0);
}

export function cashFlowStatement(
  invoices: InvoiceWithCustomer[],
  payments: Payment[],
  range: DateRange,
) {
  const periodPayments = payments.filter((p) => inDateRange(p.payment_date, range));
  const cashFromCustomers = periodPayments.reduce((s, p) => s + Number(p.payment_amount), 0);

  const byMethod = new Map<string, number>();
  for (const p of periodPayments) {
    const m = p.payment_method || "Other";
    byMethod.set(m, (byMethod.get(m) ?? 0) + Number(p.payment_amount));
  }

  // AR rollforward (accrual reconciliation disclosure)
  const start = parseDate(range.start)!;
  const end = parseDate(range.end)!;
  const dayBefore = new Date(start);
  dayBefore.setDate(dayBefore.getDate() - 1);

  const arBegin = openInvoicesAt(invoices, dayBefore).reduce((s, i) => s + Number(i.remaining_balance), 0);
  const arEnd = openInvoicesAt(invoices, end).reduce((s, i) => s + Number(i.remaining_balance), 0);

  const salesOnAccount = invoices
    .filter((i) => isRecognizedRevenue(i) && inDateRange(i.invoice_date, range))
    .reduce((s, i) => s + Number(i.invoice_total), 0);

  // Beginning AR + credit sales − cash collections ≈ ending AR (timing / write-offs create residual)
  const impliedEnd = arBegin + salesOnAccount - cashFromCustomers;
  const reconcilingDiff = arEnd - impliedEnd;

  return {
    cashFromCustomers,
    count: periodPayments.length,
    byMethod: Array.from(byMethod.entries())
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    lines: periodPayments.sort((a, b) => (b.payment_date || "").localeCompare(a.payment_date || "")),
    arBegin,
    arEnd,
    salesOnAccount,
    reconcilingDiff,
  };
}

export function contractAssets(
  jobs: (WorkOrder & { customers?: { name: string } })[],
  costs: CostContext,
) {
  const unbilled = jobs.filter((j) => j.status === "Completed" && j.billing_status === "Unbilled");

  return unbilled
    .map((j) => {
      const laborBill = costs.labor
        .filter((l) => l.work_order_id === j.id)
        .reduce(
          (s, l) =>
            s +
            (Number(l.regular_hours) + Number(l.overtime_hours)) * Number(l.customer_billing_rate || 0),
          0,
        );
      const laborCostOnly = costs.labor
        .filter((l) => l.work_order_id === j.id)
        .reduce((s, l) => s + laborCostAmount(l), 0);
      const partsBill = costs.partsUsed
        .filter((p) => p.work_order_id === j.id)
        .reduce((s, p) => s + partBillableAmount(p), 0);
      const partsCostOnly = costs.partsUsed
        .filter((p) => p.work_order_id === j.id)
        .reduce((s, p) => s + partCostAmount(p), 0);
      const billableEstimate = laborBill + partsBill;
      return {
        job: j,
        billableEstimate,
        directCost: laborCostOnly + partsCostOnly,
      };
    })
    .sort((a, b) => b.billableEstimate - a.billableEstimate);
}

export function balanceSheetGaap(
  invoices: InvoiceWithCustomer[],
  payments: Payment[],
  parts: Part[],
  jobs: (WorkOrder & { customers?: { name: string } })[],
  costs: CostContext,
  asOfStr: string,
) {
  const asOf = parseDate(asOfStr) ?? new Date();

  // Cash: cumulative collections through as-of (collections subledger)
  const cash = payments
    .filter((p) => onOrBefore(p.payment_date, asOfStr))
    .reduce((s, p) => s + Number(p.payment_amount), 0);

  const open = openInvoicesAt(invoices, asOf);
  const aging = arAgingSummary(open);
  const arGross = aging.gross;
  const allowance = aging.allowance;
  const arNet = aging.net;

  // Inventory at cost
  const inventory = parts
    .filter((p) => p.is_active)
    .reduce((s, p) => s + Number(p.quantity_on_hand) * Number(p.unit_cost), 0);

  // Contract assets (unbilled AR)
  const wipRows = contractAssets(jobs, costs);
  const contractAsset = wipRows.reduce((s, r) => s + r.billableEstimate, 0);

  const totalCurrentAssets = cash + arNet + inventory + contractAsset;
  const totalAssets = totalCurrentAssets;

  // Sales tax payable:
  // 1) Portion of open balances attributable to tax
  // 2) Plus tax on fully paid recognized invoices (collected, not remitted in-app)
  let taxOnOpen = 0;
  for (const inv of open) {
    const total = Number(inv.invoice_total);
    const tax = Number(inv.tax);
    if (total > 0 && tax > 0) {
      taxOnOpen += (Number(inv.remaining_balance) / total) * tax;
    }
  }
  let taxCollectedHeld = 0;
  for (const inv of invoices) {
    if (!isRecognizedRevenue(inv)) continue;
    if (!onOrBefore(inv.invoice_date, asOfStr)) continue;
    if (Number(inv.remaining_balance) > 0.005) continue; // still open — counted above partially
    taxCollectedHeld += Number(inv.tax);
  }
  const salesTaxPayable = taxOnOpen + taxCollectedHeld;

  const totalLiabilities = salesTaxPayable;
  const equity = totalAssets - totalLiabilities;

  return {
    asOf: asOfStr,
    cash,
    arGross,
    allowance,
    arNet,
    inventory,
    contractAsset,
    totalCurrentAssets,
    totalAssets,
    salesTaxPayable,
    taxOnOpen,
    taxCollectedHeld,
    totalLiabilities,
    equity,
    openCount: open.length,
    wipCount: wipRows.length,
    balances: Math.abs(totalAssets - (totalLiabilities + equity)) < 0.01,
  };
}

export function contractProfitabilityGaap(
  contracts: (ServiceContract & { customers?: { name: string } })[],
  invoices: InvoiceWithCustomer[],
  costs: CostContext,
) {
  return contracts
    .map((c) => {
      const linked = invoices.filter(
        (i) => i.contract_id === c.id && isRecognizedRevenue(i),
      );
      const revenue = linked.reduce((s, i) => s + serviceRevenueAmount(i), 0);
      const woIds = new Set(linked.map((i) => i.work_order_id).filter(Boolean) as string[]);
      let cogs = 0;
      for (const l of costs.labor) {
        if (woIds.has(l.work_order_id)) cogs += laborCostAmount(l);
      }
      for (const p of costs.partsUsed) {
        if (woIds.has(p.work_order_id)) cogs += partCostAmount(p);
      }
      // Contract price is unearned/booked amount for disclosure if no invoices yet
      const contractPrice = Number(c.contract_price);
      const profit = grossProfit(revenue, cogs);
      return {
        id: c.id,
        customerId: c.customer_id,
        customerName: c.customers?.name ?? "—",
        name: c.name,
        status: c.status,
        contractPrice,
        revenue,
        cogs,
        profit,
        margin: profitMargin(revenue, profit),
        invoiceCount: linked.length,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
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

export function unbilledJobs(
  jobs: (WorkOrder & { customers?: { name: string } })[],
  costs: CostContext,
) {
  return contractAssets(jobs, costs).map((r) => ({
    ...r.job,
    billableEstimate: r.billableEstimate,
    directCost: r.directCost,
  }));
}

export function invoicesInRange(invoices: InvoiceWithCustomer[], range: DateRange) {
  return invoices
    .filter((i) => inDateRange(i.invoice_date, range))
    .sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || ""));
}

// ---------------------------------------------------------------------------
// High-value operational & analytical reports
// ---------------------------------------------------------------------------

/** Equal-length period immediately before the current range. */
export function priorEqualRange(range: DateRange): DateRange {
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  if (!start || !end) return range;
  const days = Math.max(1, daysBetween(start, end) + 1);
  const priorEnd = new Date(start);
  priorEnd.setDate(priorEnd.getDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - (days - 1));
  return {
    start: format(priorStart, "yyyy-MM-dd"),
    end: format(priorEnd, "yyyy-MM-dd"),
  };
}

export function comparePnl(invoices: InvoiceWithCustomer[], range: DateRange, costs: CostContext) {
  const prior = priorEqualRange(range);
  const current = profitAndLoss(invoices, range, costs);
  const previous = profitAndLoss(invoices, prior, costs);
  const delta = (a: number, b: number) => a - b;
  const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : null) : (a - b) / Math.abs(b));

  const lines = [
    { label: "Service revenue", current: current.serviceRevenue, previous: previous.serviceRevenue },
    { label: "Cost of services", current: current.cogs, previous: previous.cogs },
    { label: "  Direct labor", current: current.cogsLabor, previous: previous.cogsLabor },
    { label: "  Parts cost", current: current.cogsParts, previous: previous.cogsParts },
    { label: "Gross profit", current: current.gross, previous: previous.gross },
  ].map((l) => ({
    ...l,
    variance: delta(l.current, l.previous),
    pctChange: pct(l.current, l.previous),
  }));

  return {
    range,
    prior,
    current,
    previous,
    lines,
    revenueGrowth: pct(current.serviceRevenue, previous.serviceRevenue),
    marginCurrent: current.margin,
    marginPrior: previous.margin,
  };
}

/** Simple DSO: ending AR ÷ (period credit sales / days in period). */
export function daysSalesOutstanding(
  invoices: InvoiceWithCustomer[],
  range: DateRange,
  asOfStr?: string,
): number | null {
  const start = parseDate(range.start);
  const end = parseDate(asOfStr ?? range.end) ?? parseDate(range.end);
  if (!start || !end) return null;
  const days = Math.max(1, daysBetween(start, end) + 1);
  const sales = invoices
    .filter((i) => isRecognizedRevenue(i) && inDateRange(i.invoice_date, range))
    .reduce((s, i) => s + Number(i.invoice_total), 0);
  if (sales <= 0) return null;
  const ar = openInvoicesAt(invoices, end).reduce((s, i) => s + Number(i.remaining_balance), 0);
  return (ar / sales) * days;
}

export function collectionsAnalysis(
  invoices: InvoiceWithCustomer[],
  payments: Payment[],
  range: DateRange,
  asOfStr: string,
) {
  const asOf = parseDate(asOfStr) ?? new Date();
  const open = openInvoicesAt(invoices, asOf);
  const aging = arAgingSummary(open);
  const dso = daysSalesOutstanding(invoices, range, asOfStr);

  const periodSales = invoices
    .filter((i) => isRecognizedRevenue(i) && inDateRange(i.invoice_date, range))
    .reduce((s, i) => s + Number(i.invoice_total), 0);
  const periodCash = payments
    .filter((p) => inDateRange(p.payment_date, range))
    .reduce((s, p) => s + Number(p.payment_amount), 0);
  const collectionRate = periodSales > 0 ? periodCash / periodSales : null;

  // Weighted avg days past due on open
  let weightedDays = 0;
  let weight = 0;
  for (const inv of open) {
    const bal = Number(inv.remaining_balance);
    weightedDays += inv.daysPast * bal;
    weight += bal;
  }
  const avgDaysPastDue = weight > 0 ? weightedDays / weight : 0;

  // Top overdue (61+ first, then by balance)
  const overdue = open
    .filter((i) => i.daysPast > 0)
    .sort((a, b) => b.daysPast - a.daysPast || Number(b.remaining_balance) - Number(a.remaining_balance))
    .slice(0, 25);

  // By customer open AR
  const byCustomer = new Map<
    string,
    { customerId: string | null; name: string; balance: number; invoices: number; maxDays: number }
  >();
  for (const inv of open) {
    const key = inv.customer_id || inv.customers?.name || "unknown";
    const cur = byCustomer.get(key) ?? {
      customerId: inv.customer_id,
      name: inv.customers?.name ?? "Unknown",
      balance: 0,
      invoices: 0,
      maxDays: 0,
    };
    cur.balance += Number(inv.remaining_balance);
    cur.invoices += 1;
    cur.maxDays = Math.max(cur.maxDays, inv.daysPast);
    byCustomer.set(key, cur);
  }

  const topCustomers = Array.from(byCustomer.values())
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 15);

  return {
    dso,
    collectionRate,
    periodSales,
    periodCash,
    avgDaysPastDue,
    openCount: open.length,
    arGross: aging.gross,
    arNet: aging.net,
    allowance: aging.allowance,
    aging,
    overdue,
    topCustomers,
  };
}

export function customerBalanceSummary(
  invoices: InvoiceWithCustomer[],
  payments: Payment[],
  range: DateRange,
  asOfStr: string,
) {
  const asOf = parseDate(asOfStr) ?? new Date();
  const open = openInvoicesAt(invoices, asOf);
  const map = new Map<
    string,
    {
      customerId: string | null;
      name: string;
      billed: number;
      collected: number;
      openBalance: number;
      openInvoices: number;
      overdueBalance: number;
    }
  >();

  // Open balances
  for (const inv of open) {
    const key = inv.customer_id || inv.customers?.name || "unknown";
    const cur = map.get(key) ?? {
      customerId: inv.customer_id,
      name: inv.customers?.name ?? "Unknown",
      billed: 0,
      collected: 0,
      openBalance: 0,
      openInvoices: 0,
      overdueBalance: 0,
    };
    cur.openBalance += Number(inv.remaining_balance);
    cur.openInvoices += 1;
    if (inv.daysPast > 0) cur.overdueBalance += Number(inv.remaining_balance);
    map.set(key, cur);
  }

  // Period billed
  for (const inv of invoices) {
    if (!isRecognizedRevenue(inv) || !inDateRange(inv.invoice_date, range)) continue;
    const key = inv.customer_id || inv.customers?.name || "unknown";
    const cur = map.get(key) ?? {
      customerId: inv.customer_id,
      name: inv.customers?.name ?? "Unknown",
      billed: 0,
      collected: 0,
      openBalance: 0,
      openInvoices: 0,
      overdueBalance: 0,
    };
    cur.billed += Number(inv.invoice_total);
    if (!cur.name || cur.name === "Unknown") cur.name = inv.customers?.name ?? cur.name;
    map.set(key, cur);
  }

  // Period collections by customer
  for (const p of payments) {
    if (!inDateRange(p.payment_date, range)) continue;
    const key = p.customer_id || "unknown";
    const cur = map.get(key) ?? {
      customerId: p.customer_id,
      name: "Unknown",
      billed: 0,
      collected: 0,
      openBalance: 0,
      openInvoices: 0,
      overdueBalance: 0,
    };
    cur.collected += Number(p.payment_amount);
    map.set(key, cur);
  }

  return Array.from(map.values())
    .filter((r) => r.openBalance > 0.005 || r.billed > 0.005 || r.collected > 0.005)
    .sort((a, b) => b.openBalance - a.openBalance || b.billed - a.billed);
}

export function jobProfitability(
  invoices: InvoiceWithCustomer[],
  jobs: (WorkOrder & { customers?: { name: string } })[],
  costs: CostContext,
  range: DateRange,
) {
  // Prefer jobs that have recognized invoices in range, also include completed/closed with costs in range
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const rows = new Map<
    string,
    {
      jobId: string;
      workOrderNumber: string;
      customerId: string | null;
      customerName: string;
      status: string;
      billingStatus: string;
      type: string;
      revenue: number;
      laborCost: number;
      partsCost: number;
      cogs: number;
      profit: number;
      margin: number | null;
      laborHours: number;
      invoiceCount: number;
    }
  >();

  for (const inv of invoices) {
    if (!isRecognizedRevenue(inv) || !inDateRange(inv.invoice_date, range)) continue;
    if (!inv.work_order_id) continue;
    const job = jobMap.get(inv.work_order_id);
    const cur = rows.get(inv.work_order_id) ?? {
      jobId: inv.work_order_id,
      workOrderNumber: job?.work_order_number ?? inv.work_orders?.work_order_number ?? inv.work_order_id.slice(0, 8),
      customerId: inv.customer_id,
      customerName: inv.customers?.name ?? job?.customers?.name ?? "—",
      status: job?.status ?? "—",
      billingStatus: job?.billing_status ?? "—",
      type: job?.work_order_type ?? "—",
      revenue: 0,
      laborCost: 0,
      partsCost: 0,
      cogs: 0,
      profit: 0,
      margin: null as number | null,
      laborHours: 0,
      invoiceCount: 0,
    };
    cur.revenue += serviceRevenueAmount(inv);
    cur.invoiceCount += 1;
    rows.set(inv.work_order_id, cur);
  }

  for (const [woId, row] of rows) {
    for (const l of costs.labor) {
      if (l.work_order_id !== woId) continue;
      row.laborCost += laborCostAmount(l);
      row.laborHours += Number(l.regular_hours) + Number(l.overtime_hours);
    }
    for (const p of costs.partsUsed) {
      if (p.work_order_id !== woId) continue;
      row.partsCost += partCostAmount(p);
    }
    row.cogs = row.laborCost + row.partsCost;
    row.profit = grossProfit(row.revenue, row.cogs);
    row.margin = profitMargin(row.revenue, row.profit);
  }

  const list = Array.from(rows.values()).sort((a, b) => b.profit - a.profit);
  const totals = list.reduce(
    (acc, r) => {
      acc.revenue += r.revenue;
      acc.cogs += r.cogs;
      acc.profit += r.profit;
      acc.laborHours += r.laborHours;
      return acc;
    },
    { revenue: 0, cogs: 0, profit: 0, laborHours: 0 },
  );
  return {
    rows: list,
    totals: {
      ...totals,
      margin: profitMargin(totals.revenue, totals.profit),
      jobCount: list.length,
      lossCount: list.filter((r) => r.profit < 0).length,
    },
  };
}

export type TechProfile = {
  id: string;
  full_name: string | null;
  email?: string | null;
  role?: string;
};

export function technicianLaborReport(
  labor: TechnicianLabor[],
  profiles: TechProfile[],
  range: DateRange,
) {
  const nameOf = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || id.slice(0, 8);
  };

  const map = new Map<
    string,
    {
      technicianId: string;
      name: string;
      regularHours: number;
      overtimeHours: number;
      totalHours: number;
      laborCost: number;
      billableAmount: number;
      entries: number;
    }
  >();

  for (const row of labor) {
    if (!inDateRange(row.work_date, range)) continue;
    const cur = map.get(row.technician_id) ?? {
      technicianId: row.technician_id,
      name: nameOf(row.technician_id),
      regularHours: 0,
      overtimeHours: 0,
      totalHours: 0,
      laborCost: 0,
      billableAmount: 0,
      entries: 0,
    };
    const rh = Number(row.regular_hours);
    const oh = Number(row.overtime_hours);
    cur.regularHours += rh;
    cur.overtimeHours += oh;
    cur.totalHours += rh + oh;
    cur.laborCost += laborCostAmount(row);
    cur.billableAmount += (rh + oh) * Number(row.customer_billing_rate || 0);
    cur.entries += 1;
    map.set(row.technician_id, cur);
  }

  const rows = Array.from(map.values())
    .map((r) => ({
      ...r,
      recovery: r.laborCost > 0 ? r.billableAmount / r.laborCost : null,
      markup: r.laborCost > 0 ? (r.billableAmount - r.laborCost) / r.laborCost : null,
      avgCostRate: r.totalHours > 0 ? r.laborCost / r.totalHours : 0,
      avgBillRate: r.totalHours > 0 ? r.billableAmount / r.totalHours : 0,
    }))
    .sort((a, b) => b.totalHours - a.totalHours);

  const totals = rows.reduce(
    (a, r) => {
      a.regularHours += r.regularHours;
      a.overtimeHours += r.overtimeHours;
      a.totalHours += r.totalHours;
      a.laborCost += r.laborCost;
      a.billableAmount += r.billableAmount;
      return a;
    },
    { regularHours: 0, overtimeHours: 0, totalHours: 0, laborCost: 0, billableAmount: 0 },
  );

  return {
    rows,
    totals: {
      ...totals,
      recovery: totals.laborCost > 0 ? totals.billableAmount / totals.laborCost : null,
    },
  };
}

export function inventoryValuation(
  parts: Part[],
  partsUsed: WorkOrderPart[],
  range: DateRange,
) {
  const usage = new Map<string, number>();
  for (const u of partsUsed) {
    if (!inDateRange(u.date_used, range)) continue;
    usage.set(u.part_id, (usage.get(u.part_id) ?? 0) + Number(u.quantity_used));
  }

  const rows = parts
    .filter((p) => p.is_active || Number(p.quantity_on_hand) > 0)
    .map((p) => {
      const qty = Number(p.quantity_on_hand);
      const unitCost = Number(p.unit_cost);
      const sell = Number(p.standard_customer_price);
      const valueAtCost = qty * unitCost;
      const valueAtSell = qty * sell;
      const used = usage.get(p.id) ?? 0;
      const belowReorder = qty <= Number(p.reorder_level);
      return {
        id: p.id,
        partNumber: p.part_number,
        name: p.name,
        category: p.category ?? "—",
        qty,
        reorderLevel: Number(p.reorder_level),
        unitCost,
        sell,
        valueAtCost,
        valueAtSell,
        potentialMargin: valueAtSell - valueAtCost,
        usedInRange: used,
        belowReorder,
        isActive: p.is_active,
      };
    })
    .sort((a, b) => b.valueAtCost - a.valueAtCost);

  const totals = rows.reduce(
    (a, r) => {
      a.valueAtCost += r.valueAtCost;
      a.valueAtSell += r.valueAtSell;
      a.sku += 1;
      if (r.belowReorder) a.reorderCount += 1;
      a.units += r.qty;
      return a;
    },
    { valueAtCost: 0, valueAtSell: 0, sku: 0, reorderCount: 0, units: 0 },
  );

  return { rows, totals };
}

export function salesTaxReport(invoices: InvoiceWithCustomer[], range: DateRange, asOfStr: string) {
  const billed = invoices.filter(
    (i) => isRecognizedRevenue(i) && inDateRange(i.invoice_date, range),
  );
  const taxBilled = billed.reduce((s, i) => s + Number(i.tax), 0);
  const taxableBase = billed.reduce((s, i) => s + serviceRevenueAmount(i), 0);
  const avgRate = taxableBase > 0 ? taxBilled / taxableBase : 0;

  const asOf = parseDate(asOfStr) ?? new Date();
  const open = openInvoicesAt(invoices, asOf);
  let taxOnOpen = 0;
  for (const inv of open) {
    const total = Number(inv.invoice_total);
    const tax = Number(inv.tax);
    if (total > 0 && tax > 0) taxOnOpen += (Number(inv.remaining_balance) / total) * tax;
  }

  let taxCollectedHeld = 0;
  for (const inv of invoices) {
    if (!isRecognizedRevenue(inv)) continue;
    if (!onOrBefore(inv.invoice_date, asOfStr)) continue;
    if (Number(inv.remaining_balance) > 0.005) continue;
    taxCollectedHeld += Number(inv.tax);
  }

  const remittanceEstimate = taxOnOpen + taxCollectedHeld;

  const byMonth = new Map<string, { month: string; tax: number; taxable: number; count: number }>();
  for (const inv of billed) {
    const month = (inv.invoice_date || "").slice(0, 7);
    if (!month) continue;
    const cur = byMonth.get(month) ?? { month, tax: 0, taxable: 0, count: 0 };
    cur.tax += Number(inv.tax);
    cur.taxable += serviceRevenueAmount(inv);
    cur.count += 1;
    byMonth.set(month, cur);
  }

  return {
    taxBilled,
    taxableBase,
    avgRate,
    taxOnOpen,
    taxCollectedHeld,
    remittanceEstimate,
    invoiceCount: billed.length,
    byMonth: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
    invoices: billed
      .filter((i) => Number(i.tax) > 0)
      .sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || "")),
  };
}

export function executiveSnapshot(
  invoices: InvoiceWithCustomer[],
  payments: Payment[],
  parts: Part[],
  jobs: (WorkOrder & { customers?: { name: string } })[],
  costs: CostContext,
  range: DateRange,
  asOfStr: string,
) {
  const pnl = profitAndLoss(invoices, range, costs);
  const prior = profitAndLoss(invoices, priorEqualRange(range), costs);
  const sheet = balanceSheetGaap(invoices, payments, parts, jobs, costs, asOfStr);
  const collections = collectionsAnalysis(invoices, payments, range, asOfStr);
  const unbilled = unbilledJobs(jobs, costs);
  const jobProf = jobProfitability(invoices, jobs, costs, range);
  const tax = salesTaxReport(invoices, range, asOfStr);

  const revChange =
    prior.serviceRevenue === 0
      ? pnl.serviceRevenue === 0
        ? 0
        : null
      : (pnl.serviceRevenue - prior.serviceRevenue) / Math.abs(prior.serviceRevenue);

  return {
    pnl,
    priorRev: prior.serviceRevenue,
    revChange,
    sheet,
    dso: collections.dso,
    collectionRate: collections.collectionRate,
    periodCash: collections.periodCash,
    arGross: collections.arGross,
    arNet: collections.arNet,
    overdueCount: collections.overdue.length,
    unbilledCount: unbilled.length,
    unbilledValue: unbilled.reduce((s, j) => s + j.billableEstimate, 0),
    inventory: sheet.inventory,
    taxPayable: tax.remittanceEstimate,
    jobLossCount: jobProf.totals.lossCount,
    jobCount: jobProf.totals.jobCount,
  };
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

/** Legacy name used by some UI — prefer cashFlowStatement. */
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
