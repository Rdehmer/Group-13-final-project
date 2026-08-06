"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Download,
  Printer,
  RefreshCw,
  Search,
  FileSpreadsheet,
  ChevronRight,
  BookOpen,
  Scale,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import {
  ACCOUNTING_POLICIES,
  AGING_LABELS,
  REPORT_CATALOG,
  REPORT_NAME,
  arAgingSummary,
  balanceSheetGaap,
  cashFlowStatement,
  collectionsAnalysis,
  comparePnl,
  contractProfitabilityGaap,
  customerBalanceSummary,
  defaultLast12Months,
  defaultYtdRange,
  deferredRevenueSchedule,
  executiveSnapshot,
  exportCsv,
  formatReportMoney,
  formatReportPct,
  inventoryValuation,
  invoicesInRange,
  isRecognizedRevenue,
  jobProfitability,
  jobStatusSummary,
  monthLabel,
  openInvoicesAt,
  profitAndLoss,
  salesByCustomer,
  salesByMonth,
  salesByService,
  salesTaxReport,
  technicianLaborReport,
  unbilledJobs,
  type DateRange,
  type InvoiceWithCustomer,
  type ReportId,
  type TechProfile,
} from "@/lib/reports";
import { contractAssetRollforward } from "@/lib/accounting/earned-revenue";
import { trialBalance } from "@/lib/accounting/ledger-local";
import type {
  Part,
  Payment,
  ServiceContract,
  TechnicianLabor,
  WorkOrder,
  WorkOrderPart,
} from "@/lib/types";

type JobRow = WorkOrder & { customers?: { name: string } };
type ContractRow = ServiceContract & { customers?: { name: string } };
type PaymentRow = Payment & { customers?: { name: string } };

/**
 * GAAP-oriented financial reporting center for Ridley Equipment Services.
 * Full suite: financials, collections, job profitability, labor, inventory, tax.
 */
export default function ReportsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<ReportId>("executive");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<DateRange>(() => defaultYtdRange());
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoices, setInvoices] = useState<InvoiceWithCustomer[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [labor, setLabor] = useState<TechnicianLabor[]>([]);
  const [partsUsed, setPartsUsed] = useState<WorkOrderPart[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [profiles, setProfiles] = useState<TechProfile[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    const [
      { data: inv, error: e1 },
      { data: pay, error: e2 },
      { data: sc, error: e3 },
      { data: wo, error: e4 },
      { data: lab, error: e5 },
      { data: wop, error: e6 },
      { data: pts, error: e7 },
      { data: prof, error: e8 },
    ] = await Promise.all([
      supabase
        .from("invoices")
        .select("*, customers(name), work_orders(work_order_number)")
        .order("invoice_date", { ascending: false }),
      supabase.from("payments").select("*, customers(name)").order("payment_date", { ascending: false }),
      supabase.from("service_contracts").select("*, customers(name)").order("name"),
      supabase.from("work_orders").select("*, customers(name)").order("created_at", { ascending: false }),
      supabase.from("technician_labor").select("*"),
      supabase.from("work_order_parts").select("*"),
      supabase.from("parts").select("*"),
      supabase.from("profiles").select("id, full_name, email, role"),
    ]);

    const err = e1 || e2 || e3 || e4 || e5 || e6 || e7 || e8;
    if (err) setError(err.message);

    setInvoices((inv as InvoiceWithCustomer[]) ?? []);
    setPayments((pay as PaymentRow[]) ?? []);
    setContracts((sc as ContractRow[]) ?? []);
    setJobs((wo as JobRow[]) ?? []);
    setLabor((lab as TechnicianLabor[]) ?? []);
    setPartsUsed((wop as WorkOrderPart[]) ?? []);
    setParts((pts as Part[]) ?? []);
    setProfiles((prof as TechProfile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const costs = useMemo(() => ({ labor, partsUsed, jobs }), [labor, partsUsed, jobs]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return REPORT_CATALOG;
    return REPORT_CATALOG.map((g) => ({
      ...g,
      reports: g.reports.filter(
        (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
      ),
    })).filter((g) => g.reports.length > 0);
  }, [query]);

  const pnl = useMemo(() => profitAndLoss(invoices, range, costs, contracts), [invoices, range, costs, contracts]);
  const pnlCmp = useMemo(() => comparePnl(invoices, range, costs, contracts), [invoices, range, costs, contracts]);
  const openAr = useMemo(() => openInvoicesAt(invoices, new Date(asOf + "T12:00:00")), [invoices, asOf]);
  const aging = useMemo(() => arAgingSummary(openAr), [openAr]);
  const byCustomer = useMemo(() => salesByCustomer(invoices, range), [invoices, range]);
  const byMonth = useMemo(() => salesByMonth(invoices, range), [invoices, range]);
  const byService = useMemo(() => salesByService(invoices, range), [invoices, range]);
  const cash = useMemo(() => cashFlowStatement(invoices, payments, range), [invoices, payments, range]);
  const sheet = useMemo(
    () => balanceSheetGaap(invoices, payments, parts, jobs, costs, asOf, contracts),
    [invoices, payments, parts, jobs, costs, asOf, contracts],
  );
  const contractsProfit = useMemo(
    () => contractProfitabilityGaap(contracts, invoices, costs),
    [contracts, invoices, costs],
  );
  const jobSummary = useMemo(() => jobStatusSummary(jobs), [jobs]);
  const unbilled = useMemo(() => unbilledJobs(jobs, costs), [jobs, costs]);
  const invList = useMemo(() => invoicesInRange(invoices, range), [invoices, range]);
  const deferredRev = useMemo(() => deferredRevenueSchedule(contracts, asOf), [contracts, asOf]);
  const contractAsset = useMemo(() => contractAssetRollforward(jobs, invoices, asOf), [jobs, invoices, asOf]);
  const glTrial = useMemo(() => trialBalance(asOf), [asOf, invoices, contracts]); // refresh with data loads
  const executive = useMemo(
    () => executiveSnapshot(invoices, payments, parts, jobs, costs, range, asOf, contracts),
    [invoices, payments, parts, jobs, costs, range, asOf, contracts],
  );
  const collections = useMemo(
    () => collectionsAnalysis(invoices, payments, range, asOf),
    [invoices, payments, range, asOf],
  );
  const custBalances = useMemo(
    () => customerBalanceSummary(invoices, payments, range, asOf),
    [invoices, payments, range, asOf],
  );
  const jobProfit = useMemo(
    () => jobProfitability(invoices, jobs, costs, range),
    [invoices, jobs, costs, range],
  );
  const techLabor = useMemo(
    () => technicianLaborReport(labor, profiles, range),
    [labor, profiles, range],
  );
  const inventory = useMemo(
    () => inventoryValuation(parts, partsUsed, range),
    [parts, partsUsed, range],
  );
  const salesTax = useMemo(
    () => salesTaxReport(invoices, range, asOf),
    [invoices, range, asOf],
  );

  const needsAsOf = [
    "ar_aging",
    "ar_detail",
    "balance_sheet",
    "executive",
    "customer_balances",
    "collections",
    "sales_tax",
    "deferred_revenue",
    "trial_balance",
    "contract_asset",
  ].includes(reportId);
  const needsRange = ![
    "ar_aging",
    "ar_detail",
    "policies",
    "job_summary",
    "unbilled",
    "contract_profit",
    "balance_sheet",
    "deferred_revenue",
    "trial_balance",
    "contract_asset",
  ].includes(reportId);

  function printReport() {
    window.print();
  }

  function exportCurrent() {
    const name = `${REPORT_NAME[reportId].replace(/\s+/g, "_")}_${range.start}_${range.end}`;
    switch (reportId) {
      case "executive":
        exportCsv(name, ["KPI", "Value"], [
          ["Service revenue", executive.pnl.serviceRevenue],
          ["Gross profit", executive.pnl.gross],
          ["Gross margin", executive.pnl.margin != null ? (executive.pnl.margin * 100).toFixed(1) + "%" : "N/A"],
          ["Cash collected", executive.periodCash],
          ["DSO (days)", executive.dso != null ? executive.dso.toFixed(1) : "N/A"],
          ["AR net", executive.arNet],
          ["Unbilled contract assets", executive.unbilledValue],
          ["Inventory", executive.inventory],
          ["Sales tax payable", executive.taxPayable],
        ]);
        break;
      case "pnl":
        exportCsv(name, ["Account", "Amount"], [
          ["Labor services revenue", pnl.laborIncome],
          ["Parts revenue", pnl.partsIncome],
          ["Recurring service revenue", pnl.recurringIncome],
          ["Additional revenue", pnl.otherIncome],
          ["Discounts (contra)", -pnl.discounts],
          ["Warranty deductions (contra)", -pnl.warranty],
          ["Service revenue (ex-tax)", pnl.serviceRevenue],
          ["Sales tax (liability; not revenue)", pnl.salesTax],
          ["COGS — direct labor (actual)", pnl.cogsLabor],
          ["COGS — parts at cost (actual)", pnl.cogsParts],
          ["Total cost of services", pnl.cogs],
          ["Gross profit", pnl.gross],
          ["Gross margin", pnl.margin != null ? (pnl.margin * 100).toFixed(1) + "%" : "N/A"],
        ]);
        break;
      case "pnl_compare":
        exportCsv(
          name,
          ["Line", "Current", "Prior", "Variance", "% change"],
          pnlCmp.lines.map((l) => [
            l.label,
            l.current,
            l.previous,
            l.variance,
            l.pctChange != null ? (l.pctChange * 100).toFixed(1) + "%" : "N/A",
          ]),
        );
        break;
      case "ar_detail":
        exportCsv(
          name,
          ["Invoice", "Customer", "Due", "Days past", "Bucket", "Balance", "Status"],
          openAr.map((i) => [
            i.invoice_number,
            i.customers?.name ?? "",
            i.due_date,
            i.daysPast,
            AGING_LABELS[i.bucket],
            Number(i.remaining_balance),
            i.status,
          ]),
        );
        break;
      case "ar_aging":
        exportCsv(
          name,
          ["Bucket", "Invoices", "Balance"],
          (Object.keys(AGING_LABELS) as (keyof typeof AGING_LABELS)[]).map((k) => [
            AGING_LABELS[k],
            aging.counts[k],
            aging.totals[k],
          ]),
        );
        break;
      case "customer_balances":
        exportCsv(
          name,
          ["Customer", "Billed", "Collected", "Open balance", "Overdue", "Open invoices"],
          custBalances.map((r) => [
            r.name,
            r.billed,
            r.collected,
            r.openBalance,
            r.overdueBalance,
            r.openInvoices,
          ]),
        );
        break;
      case "collections":
        exportCsv(
          name,
          ["Invoice", "Customer", "Due", "Days past", "Balance"],
          collections.overdue.map((i) => [
            i.invoice_number,
            i.customers?.name ?? "",
            i.due_date,
            i.daysPast,
            Number(i.remaining_balance),
          ]),
        );
        break;
      case "sales_customer":
        exportCsv(
          name,
          ["Customer", "Invoices", "Service revenue", "Tax", "Paid", "Balance"],
          byCustomer.map((r) => [r.name, r.count, r.revenue, r.tax, r.paid, r.balance]),
        );
        break;
      case "sales_month":
        exportCsv(
          name,
          ["Month", "Invoices", "Service revenue", "Tax"],
          byMonth.map((r) => [r.month, r.count, r.revenue, r.tax]),
        );
        break;
      case "sales_service":
        exportCsv(
          name,
          ["Component", "Amount"],
          byService.map((r) => [r.service, r.amount]),
        );
        break;
      case "sales_tax":
        exportCsv(
          name,
          ["Invoice", "Date", "Customer", "Taxable service rev", "Tax", "Balance"],
          salesTax.invoices.map((i) => [
            i.invoice_number,
            i.invoice_date,
            i.customers?.name ?? "",
            Number(i.labor_charges) +
              Number(i.parts_charges) +
              Number(i.recurring_service_charge) +
              Number(i.additional_charges) -
              Number(i.warranty_deductions) -
              Number(i.discounts),
            Number(i.tax),
            Number(i.remaining_balance),
          ]),
        );
        break;
      case "deferred_revenue":
        exportCsv(
          `${REPORT_NAME[reportId].replace(/\s+/g, "_")}_${asOf}`,
          [
            "Contract",
            "Customer",
            "Billing method",
            "Start",
            "End",
            "Contract price",
            "Monthly recognition",
            "Recognized to date",
            "Deferred balance",
            "Current portion",
            "Noncurrent portion",
            "Status",
          ],
          deferredRev.rows.map((r) => [
            r.name,
            r.customerName,
            r.billingMethod,
            r.startDate,
            r.endDate,
            r.contractPrice,
            r.monthlyRecognition,
            r.recognizedToDate,
            r.deferredBalance,
            r.currentPortion,
            r.noncurrentPortion,
            r.status,
          ]),
        );
        break;
      case "cash_flow":
        exportCsv(
          name,
          ["Payment #", "Date", "Method", "Customer", "Amount"],
          cash.lines.map((p) => [
            p.payment_number,
            p.payment_date,
            p.payment_method,
            (p as PaymentRow).customers?.name ?? "",
            Number(p.payment_amount),
          ]),
        );
        break;
      case "contract_profit":
        exportCsv(
          name,
          ["Contract", "Customer", "Recognized revenue", "Matched COGS", "Gross profit", "Margin", "Status"],
          contractsProfit.map((r) => [
            r.name,
            r.customerName,
            r.revenue,
            r.cogs,
            r.profit,
            r.margin != null ? (r.margin * 100).toFixed(1) + "%" : "N/A",
            r.status,
          ]),
        );
        break;
      case "job_profit":
        exportCsv(
          name,
          ["Job", "Customer", "Revenue", "Labor cost", "Parts cost", "COGS", "Profit", "Margin", "Hours"],
          jobProfit.rows.map((r) => [
            r.workOrderNumber,
            r.customerName,
            r.revenue,
            r.laborCost,
            r.partsCost,
            r.cogs,
            r.profit,
            r.margin != null ? (r.margin * 100).toFixed(1) + "%" : "N/A",
            r.laborHours,
          ]),
        );
        break;
      case "tech_labor":
        exportCsv(
          name,
          ["Technician", "Reg hrs", "OT hrs", "Total hrs", "Labor cost", "Billable $", "Recovery"],
          techLabor.rows.map((r) => [
            r.name,
            r.regularHours,
            r.overtimeHours,
            r.totalHours,
            r.laborCost,
            r.billableAmount,
            r.recovery != null ? r.recovery.toFixed(2) + "x" : "N/A",
          ]),
        );
        break;
      case "inventory":
        exportCsv(
          name,
          ["Part #", "Name", "Qty", "Unit cost", "Value cost", "Value sell", "Used in range", "Below reorder"],
          inventory.rows.map((r) => [
            r.partNumber,
            r.name,
            r.qty,
            r.unitCost,
            r.valueAtCost,
            r.valueAtSell,
            r.usedInRange,
            r.belowReorder ? "Yes" : "No",
          ]),
        );
        break;
      case "unbilled":
        exportCsv(
          name,
          ["Job", "Customer", "Completed", "Type", "Est. billable", "Direct cost"],
          unbilled.map((j) => [
            j.work_order_number,
            j.customers?.name ?? "",
            j.completion_date ?? "",
            j.work_order_type,
            j.billableEstimate,
            j.directCost,
          ]),
        );
        break;
      case "invoice_list":
        exportCsv(
          name,
          ["Invoice", "Date", "Customer", "Recognized", "Service rev", "Tax", "Total", "Paid", "Balance", "Status"],
          invList.map((i) => [
            i.invoice_number,
            i.invoice_date,
            i.customers?.name ?? "",
            isRecognizedRevenue(i) ? "Yes" : "No",
            Number(i.labor_charges) +
              Number(i.parts_charges) +
              Number(i.recurring_service_charge) +
              Number(i.additional_charges) -
              Number(i.warranty_deductions) -
              Number(i.discounts),
            Number(i.tax),
            Number(i.invoice_total),
            Number(i.amount_paid),
            Number(i.remaining_balance),
            i.status,
          ]),
        );
        break;
      case "balance_sheet":
        exportCsv(name, ["Line", "Amount"], [
          ["Cash (collections through as of)", sheet.cash],
          ["Accounts receivable, gross", sheet.arGross],
          ["Allowance for credit losses", -sheet.allowance],
          ["Accounts receivable, net", sheet.arNet],
          ["Inventory at cost", sheet.inventory],
          ["Contract assets (unbilled)", sheet.contractAsset],
          ["Total assets", sheet.totalAssets],
          ["Sales tax payable", sheet.salesTaxPayable],
          ["Deferred revenue (current)", sheet.deferredCurrent],
          ["Deferred revenue (noncurrent)", sheet.deferredNoncurrent],
          ["Deferred revenue (total)", sheet.deferredRevenue],
          ["Total liabilities", sheet.totalLiabilities],
          ["Equity (assets − liabilities)", sheet.equity],
        ]);
        break;
      case "job_summary":
        exportCsv(
          name,
          ["Status", "Count"],
          jobSummary.byStatus.map((r) => [r.status, r.count]),
        );
        break;
      default:
        break;
    }
  }

  return (
    <div className="reports-page">
      <PageHeader
        title="Reports"
        description="GAAP financials plus collections, job profitability, labor productivity, inventory, and tax — live from Ridley data"
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button type="button" className="btn btn-outline btn-sm gap-1" onClick={() => setReportId("policies")}>
              <Scale className="h-4 w-4" /> Policies
            </button>
            <Link href="/billing" className="btn btn-outline btn-sm">
              Billing
            </Link>
            <Link href="/payments" className="btn btn-outline btn-sm">
              Payments
            </Link>
            <Link href="/reports/contracts" className="btn btn-ghost btn-sm">
              Contract profitability
            </Link>
          </div>
        }
      />

      {error ? <div className="alert alert-error mb-4 text-sm">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[16rem_1fr]">
        <aside className="print:hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <div className="border-b border-base-200 p-3">
            <label className="input input-bordered input-sm flex items-center gap-2">
              <Search className="h-3.5 w-3.5 opacity-50" />
              <input
                type="search"
                className="grow text-sm"
                placeholder="Find report…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <nav className="p-2">
            {filteredCatalog.map((group) => (
              <div key={group.title} className="mb-3">
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-base-content/45">
                  {group.title}
                </p>
                <ul className="space-y-0.5">
                  {group.reports.map((r) => {
                    const active = reportId === r.id;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setReportId(r.id)}
                          className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${
                            active
                              ? "bg-primary/12 font-semibold text-primary"
                              : "hover:bg-base-200/80"
                          }`}
                        >
                          <FileSpreadsheet className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                          <span>
                            <span className="block leading-tight">{r.name}</span>
                            <span className="mt-0.5 block text-[11px] font-normal leading-snug opacity-55">
                              {r.description}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {filteredCatalog.length === 0 ? (
              <p className="p-3 text-sm opacity-60">No reports match.</p>
            ) : null}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm print:border-0 print:shadow-none">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/45">
                  Ridley Equipment Services · U.S. GAAP orientation
                </p>
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{REPORT_NAME[reportId]}</h2>
                <p className="mt-1 text-sm opacity-60">
                  {needsAsOf ? (
                    <>
                      As of <strong>{asOf}</strong>
                    </>
                  ) : null}
                  {needsRange ? (
                    <>
                      {needsAsOf ? " · " : null}
                      {range.start} → {range.end}
                    </>
                  ) : null}
                  {reportId === "pnl" ? " · Accrual · invoice date · revenue ex-tax" : null}
                  {reportId === "pnl_compare" ? " · Period comparison" : null}
                  {reportId === "executive" ? " · KPI snapshot" : null}
                  {reportId === "collections" ? " · DSO & overdue priority" : null}
                  {reportId === "job_profit" ? " · Job-level margin" : null}
                  {reportId === "cash_flow" ? " · Cash · payment date" : null}
                  {reportId === "balance_sheet" ? " · Accrual position" : null}
                  {reportId === "deferred_revenue" ? " · Prepaid contract unearned balances" : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                {reportId !== "policies" ? (
                  <button type="button" className="btn btn-outline btn-sm gap-1" onClick={exportCurrent}>
                    <Download className="h-4 w-4" /> Export CSV
                  </button>
                ) : null}
                <button type="button" className="btn btn-outline btn-sm gap-1" onClick={printReport}>
                  <Printer className="h-4 w-4" /> Print
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-base-200 pt-4 print:hidden">
              {needsRange ? (
                <>
                  <label className="form-control">
                    <span className="label-text text-xs">From</span>
                    <input
                      type="date"
                      className="input input-bordered input-sm"
                      value={range.start}
                      onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text text-xs">To</span>
                    <input
                      type="date"
                      className="input input-bordered input-sm"
                      value={range.end}
                      onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
                    />
                  </label>
                  <div className="flex flex-wrap gap-1 pb-0.5">
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setRange(defaultYtdRange())}>
                      YTD
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => setRange(defaultLast12Months())}
                    >
                      Last 12 mo
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        const y = new Date().getFullYear();
                        setRange({ start: `${y}-01-01`, end: `${y}-12-31` });
                      }}
                    >
                      This year
                    </button>
                  </div>
                </>
              ) : null}
              {needsAsOf ? (
                <label className="form-control">
                  <span className="label-text text-xs">As of</span>
                  <input
                    type="date"
                    className="input input-bordered input-sm"
                    value={asOf}
                    onChange={(e) => setAsOf(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-base-300 bg-base-100 p-12 text-center text-sm opacity-60">
              Loading report data…
            </div>
          ) : (
            <div className="report-body rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm sm:p-6 print:border-0 print:p-0 print:shadow-none">
              {reportId === "executive" ? (
                <ExecutiveReport data={executive} onOpen={(id) => setReportId(id)} />
              ) : null}
              {reportId === "pnl" ? <PnLReport pnl={pnl} /> : null}
              {reportId === "pnl_compare" ? <PnlCompareReport data={pnlCmp} /> : null}
              {reportId === "balance_sheet" ? <BalanceSheetReport sheet={sheet} /> : null}
              {reportId === "ar_aging" ? <ArAgingSummary aging={aging} open={openAr} /> : null}
              {reportId === "ar_detail" ? <ArAgingDetail open={openAr} /> : null}
              {reportId === "customer_balances" ? <CustomerBalancesReport rows={custBalances} /> : null}
              {reportId === "collections" ? <CollectionsReport data={collections} /> : null}
              {reportId === "sales_customer" ? <SalesByCustomer rows={byCustomer} /> : null}
              {reportId === "sales_month" ? <SalesByMonth rows={byMonth} /> : null}
              {reportId === "sales_service" ? <SalesByService rows={byService} /> : null}
              {reportId === "sales_tax" ? <SalesTaxReportView data={salesTax} /> : null}
              {reportId === "cash_flow" ? <CashFlowReport cash={cash} /> : null}
              {reportId === "contract_profit" ? <ContractProfitReport rows={contractsProfit} /> : null}
              {reportId === "job_profit" ? <JobProfitReport data={jobProfit} /> : null}
              {reportId === "job_summary" ? <JobSummaryReport summary={jobSummary} /> : null}
              {reportId === "unbilled" ? <UnbilledReport rows={unbilled} /> : null}
              {reportId === "tech_labor" ? <TechLaborReport data={techLabor} /> : null}
              {reportId === "inventory" ? <InventoryReport data={inventory} /> : null}
              {reportId === "invoice_list" ? <InvoiceListReport rows={invList} /> : null}
              {reportId === "deferred_revenue" ? <DeferredRevenueReport data={deferredRev} /> : null}
              {reportId === "contract_asset" ? <ContractAssetReport data={contractAsset} asOf={asOf} /> : null}
              {reportId === "trial_balance" ? <TrialBalanceReport data={glTrial} asOf={asOf} /> : null}
              {reportId === "policies" ? <PoliciesReport /> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportTable({
  headers,
  children,
  footer,
}: {
  headers: string[];
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm w-full">
        <thead>
          <tr className="border-b-2 border-base-content/20">
            {headers.map((h, i) => (
              <th key={h} className={i > 0 && headers.length > 1 ? "text-right" : "text-left"}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}

function MoneyCell({ n, bold }: { n: number; bold?: boolean }) {
  return (
    <td className={`text-right tabular-nums ${bold ? "font-bold" : ""} ${n < 0 ? "text-error" : ""}`}>
      {formatReportMoney(n)}
    </td>
  );
}

function PolicyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs opacity-55">
      <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function VarianceCell({ n }: { n: number }) {
  return (
    <td
      className={`text-right tabular-nums ${n > 0.005 ? "text-success" : n < -0.005 ? "text-error" : ""}`}
    >
      {n > 0 ? "+" : ""}
      {formatReportMoney(n)}
    </td>
  );
}

function ReportStat(props: {
  label: string;
  value: string | number;
  hint?: string;
  danger?: boolean;
}) {
  return <StatCard {...props} scrollTarget="report-detail" />;
}

function ExecutiveReport({
  data,
  onOpen,
}: {
  data: ReturnType<typeof executiveSnapshot>;
  onOpen: (id: ReportId) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat
          label="Service revenue"
          value={formatReportMoney(data.pnl.serviceRevenue)}
          hint={
            data.revChange != null
              ? `${data.revChange >= 0 ? "▲" : "▼"} ${Math.abs(data.revChange * 100).toFixed(1)}% vs prior period`
              : "vs prior period N/A"
          }
        />
        <ReportStat
          label="Gross profit"
          value={formatReportMoney(data.pnl.gross)}
          hint={`Margin ${formatReportPct(data.pnl.margin)}`}
        />
        <ReportStat
          label="Cash collected"
          value={formatReportMoney(data.periodCash)}
          hint={
            data.collectionRate != null
              ? `Collection ratio ${(data.collectionRate * 100).toFixed(0)}% of billed`
              : "Payment period cash"
          }
        />
        <ReportStat
          label="Days sales outstanding"
          value={data.dso != null ? `${data.dso.toFixed(0)} days` : "N/A"}
          hint={`AR net ${formatReportMoney(data.arNet)}`}
          danger={data.dso != null && data.dso > 45}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat
          label="Unbilled (contract assets)"
          value={formatReportMoney(data.unbilledValue)}
          hint={`${data.unbilledCount} completed jobs`}
          danger={data.unbilledCount > 0}
        />
        <ReportStat label="Inventory at cost" value={formatReportMoney(data.inventory)} />
        <ReportStat label="Sales tax payable" value={formatReportMoney(data.taxPayable)} />
        <ReportStat
          label="Job losses in range"
          value={data.jobLossCount}
          hint={`${data.jobCount} billed jobs analyzed`}
          danger={data.jobLossCount > 0}
        />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Drill into detail</h3>
        <div className="flex flex-wrap gap-2 print:hidden">
          {(
            [
              ["pnl", "P&L"],
              ["pnl_compare", "vs Prior"],
              ["collections", "Collections"],
              ["job_profit", "Job profit"],
              ["unbilled", "Unbilled"],
              ["sales_tax", "Sales tax"],
              ["balance_sheet", "Balance sheet"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className="btn btn-outline btn-sm" onClick={() => onOpen(id)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <PolicyNote>
        Snapshot uses the same measurement bases as the GAAP reports (accrual revenue, matched costs, AR net of
        allowance). DSO = ending AR ÷ (period credit sales ÷ days in range).
      </PolicyNote>
    </div>
  );
}

function PnlCompareReport({ data }: { data: ReturnType<typeof comparePnl> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <ReportStat
          label="Current revenue"
          value={formatReportMoney(data.current.serviceRevenue)}
          hint={`${data.range.start} → ${data.range.end}`}
        />
        <ReportStat
          label="Prior revenue"
          value={formatReportMoney(data.previous.serviceRevenue)}
          hint={`${data.prior.start} → ${data.prior.end}`}
        />
        <ReportStat
          label="Revenue change"
          value={
            data.revenueGrowth != null
              ? `${data.revenueGrowth >= 0 ? "+" : ""}${(data.revenueGrowth * 100).toFixed(1)}%`
              : "N/A"
          }
          hint={`Margin ${formatReportPct(data.marginCurrent)} vs ${formatReportPct(data.marginPrior)}`}
        />
      </div>
      <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Line", "Current", "Prior period", "Variance", "% change"]}>
        {data.lines.map((l) => (
          <tr key={l.label} className={l.label === "Gross profit" ? "font-semibold border-t-2" : ""}>
            <td className={l.label.startsWith("  ") ? "pl-6 opacity-80" : ""}>{l.label.trim()}</td>
            <MoneyCell n={l.current} />
            <MoneyCell n={l.previous} />
            <VarianceCell n={l.variance} />
            <td className="text-right tabular-nums opacity-70">
              {l.pctChange != null ? `${(l.pctChange * 100).toFixed(1)}%` : "—"}
            </td>
          </tr>
        ))}
      </ReportTable></div>
      <PolicyNote>
        Prior period is the same number of days immediately before the current range start. Costs match actual
        labor and parts on work orders linked to recognized invoices in each window.
      </PolicyNote>
    </div>
  );
}

function CustomerBalancesReport({ rows }: { rows: ReturnType<typeof customerBalanceSummary> }) {
  if (rows.length === 0) {
    return <EmptyState title="No customer activity" description="No open balances or period activity." />;
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <ReportStat label="Customers" value={rows.length} />
        <ReportStat
          label="Open AR"
          value={formatReportMoney(rows.reduce((s, r) => s + r.openBalance, 0))}
        />
        <ReportStat
          label="Overdue"
          value={formatReportMoney(rows.reduce((s, r) => s + r.overdueBalance, 0))}
          danger={rows.some((r) => r.overdueBalance > 0)}
        />
      </div>
      <div id="report-detail" className="scroll-mt-4"><ReportTable
        headers={["Customer", "Period billed", "Period collected", "Open balance", "Overdue", "# Open"]}
      >
        {rows.map((r) => (
          <tr key={r.customerId ?? r.name} className={r.overdueBalance > 0 ? "bg-error/5" : ""}>
            <td>
              {r.customerId ? (
                <Link href={`/customers/${r.customerId}`} className="link link-hover font-medium">
                  {r.name}
                </Link>
              ) : (
                r.name
              )}
            </td>
            <MoneyCell n={r.billed} />
            <MoneyCell n={r.collected} />
            <MoneyCell n={r.openBalance} />
            <MoneyCell n={r.overdueBalance} />
            <td className="text-right tabular-nums">{r.openInvoices}</td>
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td>Total</td>
          <MoneyCell n={rows.reduce((s, r) => s + r.billed, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.collected, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.openBalance, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.overdueBalance, 0)} bold />
          <td className="text-right tabular-nums">{rows.reduce((s, r) => s + r.openInvoices, 0)}</td>
        </tr>
      </ReportTable></div>
      <PolicyNote>
        Open balance is remaining receivable as of the as-of date (recognized invoices only). Period billed /
        collected use the selected date range.
      </PolicyNote>
    </div>
  );
}

function CollectionsReport({ data }: { data: ReturnType<typeof collectionsAnalysis> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat
          label="DSO"
          value={data.dso != null ? `${data.dso.toFixed(1)} days` : "N/A"}
          danger={data.dso != null && data.dso > 45}
        />
        <ReportStat
          label="Collection ratio"
          value={data.collectionRate != null ? `${(data.collectionRate * 100).toFixed(0)}%` : "N/A"}
          hint="Cash ÷ billed (period)"
        />
        <ReportStat label="Open AR (gross)" value={formatReportMoney(data.arGross)} />
        <ReportStat
          label="Avg days past due"
          value={data.avgDaysPastDue.toFixed(0)}
          hint={`${data.openCount} open invoices`}
        />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Top open AR by customer</h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Customer", "Open balance", "Invoices", "Max days late"]}>
          {data.topCustomers.map((c) => (
            <tr key={c.customerId ?? c.name}>
              <td>
                {c.customerId ? (
                  <Link href={`/customers/${c.customerId}`} className="link link-hover font-medium">
                    {c.name}
                  </Link>
                ) : (
                  c.name
                )}
              </td>
              <MoneyCell n={c.balance} />
              <td className="text-right tabular-nums">{c.invoices}</td>
              <td className={`text-right tabular-nums ${c.maxDays > 60 ? "text-error font-semibold" : ""}`}>
                {c.maxDays}
              </td>
            </tr>
          ))}
        </ReportTable></div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Priority overdue invoices</h3>
        {data.overdue.length === 0 ? (
          <EmptyState title="Nothing past due" description="No open invoices past their due date." />
        ) : (
          <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Invoice", "Customer", "Due", "Days late", "Balance", "Aging"]}>
            {data.overdue.map((inv) => (
              <tr key={inv.id} className={inv.bucket === "d90" ? "bg-error/5" : ""}>
                <td>
                  <Link href={`/billing/${inv.id}`} className="link link-primary font-medium">
                    {inv.invoice_number}
                  </Link>
                </td>
                <td>{inv.customers?.name ?? "—"}</td>
                <td className="tabular-nums">{inv.due_date}</td>
                <td className="text-right tabular-nums font-medium">{inv.daysPast}</td>
                <MoneyCell n={Number(inv.remaining_balance)} />
                <td>
                  <StatusBadge
                    label={AGING_LABELS[inv.bucket]}
                    tone={inv.bucket === "d90" ? "error" : "warning"}
                  />
                </td>
              </tr>
            ))}
          </ReportTable></div>
        )}
      </section>
      <PolicyNote>
        DSO approximates how many days of sales sit in AR. Follow up overdue list first for cash acceleration.
      </PolicyNote>
    </div>
  );
}

function JobProfitReport({ data }: { data: ReturnType<typeof jobProfitability> }) {
  if (data.rows.length === 0) {
    return (
      <EmptyState
        title="No billed jobs in range"
        description="Job profitability requires recognized invoices linked to work orders."
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat label="Jobs" value={data.totals.jobCount} />
        <ReportStat label="Revenue" value={formatReportMoney(data.totals.revenue)} />
        <ReportStat label="Direct costs" value={formatReportMoney(data.totals.cogs)} />
        <ReportStat
          label="Gross profit"
          value={formatReportMoney(data.totals.profit)}
          hint={formatReportPct(data.totals.margin)}
          danger={data.totals.lossCount > 0}
        />
      </div>
      {data.totals.lossCount > 0 ? (
        <div className="alert alert-warning text-sm">
          <span>
            <strong>{data.totals.lossCount}</strong> job{data.totals.lossCount === 1 ? "" : "s"} with negative
            gross profit — review labor rates or parts cost vs price.
          </span>
        </div>
      ) : null}
      <div id="report-detail" className="scroll-mt-4"><ReportTable
        headers={["Job", "Customer", "Type", "Revenue", "Labor", "Parts", "Profit", "Margin", "Hrs"]}
      >
        {data.rows.map((r) => (
          <tr key={r.jobId} className={r.profit < 0 ? "bg-error/5" : ""}>
            <td>
              <Link href={`/work-orders/${r.jobId}`} className="link link-primary font-medium">
                {r.workOrderNumber}
              </Link>
            </td>
            <td>
              {r.customerId ? (
                <Link href={`/customers/${r.customerId}`} className="link link-hover">
                  {r.customerName}
                </Link>
              ) : (
                r.customerName
              )}
            </td>
            <td className="text-xs opacity-70">{r.type}</td>
            <MoneyCell n={r.revenue} />
            <MoneyCell n={r.laborCost} />
            <MoneyCell n={r.partsCost} />
            <MoneyCell n={r.profit} />
            <td className="text-right tabular-nums">{formatReportPct(r.margin)}</td>
            <td className="text-right tabular-nums">{r.laborHours.toFixed(1)}</td>
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td colSpan={3}>Total</td>
          <MoneyCell n={data.totals.revenue} bold />
          <td colSpan={2} />
          <MoneyCell n={data.totals.profit} bold />
          <td className="text-right tabular-nums">{formatReportPct(data.totals.margin)}</td>
          <td className="text-right tabular-nums">{data.totals.laborHours.toFixed(1)}</td>
        </tr>
      </ReportTable></div>
      <PolicyNote>
        Revenue is recognized service revenue (ex-tax) on linked invoices. COGS is actual technician cost rates
        and parts unit costs on that work order.
      </PolicyNote>
    </div>
  );
}

function TechLaborReport({ data }: { data: ReturnType<typeof technicianLaborReport> }) {
  if (data.rows.length === 0) {
    return <EmptyState title="No labor in range" description="Technicians need time entries on work dates in range." />;
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat label="Total hours" value={data.totals.totalHours.toFixed(1)} />
        <ReportStat label="Labor cost" value={formatReportMoney(data.totals.laborCost)} />
        <ReportStat label="Billable amount" value={formatReportMoney(data.totals.billableAmount)} />
        <ReportStat
          label="Cost recovery"
          value={data.totals.recovery != null ? `${data.totals.recovery.toFixed(2)}×` : "N/A"}
          hint="Billable $ ÷ cost $"
        />
      </div>
      <div id="report-detail" className="scroll-mt-4"><ReportTable
        headers={["Technician", "Reg", "OT", "Total hrs", "Cost", "Billable", "Recovery", "Avg bill rate"]}
      >
        {data.rows.map((r) => (
          <tr key={r.technicianId}>
            <td className="font-medium">{r.name}</td>
            <td className="text-right tabular-nums">{r.regularHours.toFixed(1)}</td>
            <td className="text-right tabular-nums">{r.overtimeHours.toFixed(1)}</td>
            <td className="text-right tabular-nums font-medium">{r.totalHours.toFixed(1)}</td>
            <MoneyCell n={r.laborCost} />
            <MoneyCell n={r.billableAmount} />
            <td className="text-right tabular-nums">
              {r.recovery != null ? `${r.recovery.toFixed(2)}×` : "—"}
            </td>
            <td className="text-right tabular-nums">{formatReportMoney(r.avgBillRate)}</td>
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td>Total</td>
          <td className="text-right tabular-nums">{data.totals.regularHours.toFixed(1)}</td>
          <td className="text-right tabular-nums">{data.totals.overtimeHours.toFixed(1)}</td>
          <td className="text-right tabular-nums">{data.totals.totalHours.toFixed(1)}</td>
          <MoneyCell n={data.totals.laborCost} bold />
          <MoneyCell n={data.totals.billableAmount} bold />
          <td className="text-right tabular-nums">
            {data.totals.recovery != null ? `${data.totals.recovery.toFixed(2)}×` : "—"}
          </td>
          <td />
        </tr>
      </ReportTable></div>
      <PolicyNote>
        Billable amount uses customer billing rates on labor lines (potential income). Recovery below 1.0× means
        list rates do not cover labor cost for that tech in the period.
      </PolicyNote>
    </div>
  );
}

function InventoryReport({ data }: { data: ReturnType<typeof inventoryValuation> }) {
  if (data.rows.length === 0) {
    return <EmptyState title="No parts inventory" description="Add parts in the Parts catalog." />;
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat label="Active SKUs" value={data.totals.sku} />
        <ReportStat label="Value at cost" value={formatReportMoney(data.totals.valueAtCost)} />
        <ReportStat label="Value at list" value={formatReportMoney(data.totals.valueAtSell)} />
        <ReportStat
          label="Below reorder"
          value={data.totals.reorderCount}
          danger={data.totals.reorderCount > 0}
        />
      </div>
      <div id="report-detail" className="scroll-mt-4"><ReportTable
        headers={[
          "Part #",
          "Name",
          "On hand",
          "Reorder",
          "Unit cost",
          "At cost",
          "At list",
          "Used (range)",
          "Flag",
        ]}
      >
        {data.rows.map((r) => (
          <tr key={r.id} className={r.belowReorder ? "bg-warning/10" : ""}>
            <td className="font-mono text-xs">{r.partNumber}</td>
            <td>
              <Link href="/parts" className="link link-hover">
                {r.name}
              </Link>
            </td>
            <td className="text-right tabular-nums">{r.qty}</td>
            <td className="text-right tabular-nums opacity-60">{r.reorderLevel}</td>
            <MoneyCell n={r.unitCost} />
            <MoneyCell n={r.valueAtCost} />
            <MoneyCell n={r.valueAtSell} />
            <td className="text-right tabular-nums">{r.usedInRange}</td>
            <td>
              {r.belowReorder ? (
                <StatusBadge label="Reorder" tone="warning" />
              ) : (
                <span className="text-xs opacity-40">—</span>
              )}
            </td>
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td colSpan={5}>Total</td>
          <MoneyCell n={data.totals.valueAtCost} bold />
          <MoneyCell n={data.totals.valueAtSell} bold />
          <td colSpan={2} />
        </tr>
      </ReportTable></div>
      <PolicyNote>
        Valuation is quantity on hand × unit cost (inventory asset on the balance sheet). Usage column is
        work-order consumption in the selected range.
      </PolicyNote>
    </div>
  );
}

function SalesTaxReportView({ data }: { data: ReturnType<typeof salesTaxReport> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat
          label="Tax billed (period)"
          value={formatReportMoney(data.taxBilled)}
          hint={`${data.invoiceCount} invoices`}
        />
        <ReportStat
          label="Taxable base"
          value={formatReportMoney(data.taxableBase)}
          hint={`Avg effective ${(data.avgRate * 100).toFixed(2)}%`}
        />
        <ReportStat label="Tax on open AR" value={formatReportMoney(data.taxOnOpen)} />
        <ReportStat
          label="Remittance estimate"
          value={formatReportMoney(data.remittanceEstimate)}
          hint="Open tax + held collected"
        />
      </div>
      <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Month", "Invoices", "Taxable (ex-tax rev)", "Sales tax"]}>
        {data.byMonth.map((m) => (
          <tr key={m.month}>
            <td>{monthLabel(m.month)}</td>
            <td className="text-right tabular-nums">{m.count}</td>
            <MoneyCell n={m.taxable} />
            <MoneyCell n={m.tax} />
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td>Total</td>
          <td className="text-right tabular-nums">{data.invoiceCount}</td>
          <MoneyCell n={data.taxableBase} bold />
          <MoneyCell n={data.taxBilled} bold />
        </tr>
      </ReportTable></div>
      <PolicyNote>
        {ACCOUNTING_POLICIES.taxLiability} Record remittances from Period Close when filed.
      </PolicyNote>
    </div>
  );
}

function PnLReport({ pnl }: { pnl: ReturnType<typeof profitAndLoss> }) {
  const incomeLines = [
    ["Labor services", pnl.laborIncome],
    ["Parts transferred", pnl.partsIncome],
    ["Recurring / contract services", pnl.recurringIncome],
    ["Additional performance obligations", pnl.otherIncome],
  ] as const;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <ReportStat
          label="Service revenue"
          value={formatReportMoney(pnl.serviceRevenue)}
          hint={`${pnl.earnedJobCount ?? 0} completed jobs · ASC 606`}
        />
        <ReportStat
          label="Cost of services"
          value={formatReportMoney(pnl.cogs)}
          hint={`${pnl.matchedJobCount} jobs matched`}
        />
        <ReportStat label="Gross profit" value={formatReportMoney(pnl.gross)} />
        <ReportStat label="Gross margin" value={formatReportPct(pnl.margin)} />
      </div>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          Earned revenue (ASC 606)
        </h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Component", "Amount"]}>
          <tr>
            <td className="pl-4">Completed work (invoiced)</td>
            <MoneyCell n={pnl.billedCompletion ?? 0} />
          </tr>
          <tr>
            <td className="pl-4">Completed work (unbilled estimate)</td>
            <MoneyCell n={pnl.unbilledCompletion ?? 0} />
          </tr>
          <tr>
            <td className="pl-4">Prepaid contract recognition</td>
            <MoneyCell n={pnl.deferredRecognized ?? 0} />
          </tr>
          <tr className="font-semibold">
            <td>Total earned service revenue</td>
            <MoneyCell n={pnl.serviceRevenue} bold />
          </tr>
        </ReportTable></div>
      </section>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          Billing components (invoice date, disclosure)
        </h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Account", "Total"]}>
          {incomeLines.map(([label, amt]) => (
            <tr key={label}>
              <td className="pl-4">{label}</td>
              <MoneyCell n={amt} />
            </tr>
          ))}
          {pnl.discounts > 0 ? (
            <tr>
              <td className="pl-4">Less: customer discounts</td>
              <MoneyCell n={-pnl.discounts} />
            </tr>
          ) : null}
          {pnl.warranty > 0 ? (
            <tr>
              <td className="pl-4">Less: warranty deductions</td>
              <MoneyCell n={-pnl.warranty} />
            </tr>
          ) : null}
          <tr className="border-t-2 border-base-content/15 font-semibold">
            <td>Invoice register total (disclosure)</td>
            <MoneyCell n={pnl.invoiceTotals} bold />
          </tr>
        </ReportTable></div>
      </section>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          Cost of services (matched actual costs)
        </h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Account", "Total"]}>
          <tr>
            <td className="pl-4">
              Direct labor at cost rates
              {pnl.laborHours > 0 ? ` (${pnl.laborHours.toFixed(1)} hrs on matched jobs)` : ""}
            </td>
            <MoneyCell n={pnl.cogsLabor} />
          </tr>
          <tr>
            <td className="pl-4">Parts consumed at unit cost</td>
            <MoneyCell n={pnl.cogsParts} />
          </tr>
          <tr className="border-t-2 border-base-content/15 font-semibold">
            <td>Total cost of services</td>
            <MoneyCell n={pnl.cogs} bold />
          </tr>
        </ReportTable></div>
      </section>

      <div className="rounded-box bg-base-200/50 p-4">
        <div className="flex justify-between text-base font-bold sm:text-lg">
          <span>Gross profit</span>
          <span className="tabular-nums">{formatReportMoney(pnl.gross)}</span>
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span className="opacity-70">Gross margin</span>
          <span className="font-semibold tabular-nums">{formatReportPct(pnl.margin)}</span>
        </div>
        {pnl.salesTax > 0 ? (
          <p className="mt-2 text-xs opacity-50">
            Sales tax on recognized invoices (liability, not revenue): {formatReportMoney(pnl.salesTax)}. Invoice
            grand totals: {formatReportMoney(pnl.invoiceTotals)}.
          </p>
        ) : null}
        {pnl.unmatchedRevenue > 0.01 ? (
          <p className="mt-2 text-xs text-warning">
            {formatReportMoney(pnl.unmatchedRevenue)} of revenue has no linked work order — COGS cannot be matched
            for those invoices.
          </p>
        ) : null}
      </div>

      <PolicyNote>
        {ACCOUNTING_POLICIES.revenue} {ACCOUNTING_POLICIES.cogs}
      </PolicyNote>
    </div>
  );
}

function BalanceSheetReport({ sheet }: { sheet: ReturnType<typeof balanceSheetGaap> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <ReportStat label="Total assets" value={formatReportMoney(sheet.totalAssets)} />
        <ReportStat label="Cash (collections)" value={formatReportMoney(sheet.cash)} />
        <ReportStat label="AR, net" value={formatReportMoney(sheet.arNet)} hint={`${sheet.openCount} open`} />
        <ReportStat label="Sales tax payable" value={formatReportMoney(sheet.salesTaxPayable)} />
      </div>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          Assets
        </h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Account", "Total"]}>
          <tr>
            <td className="pl-4">Cash — customer collections ledger</td>
            <MoneyCell n={sheet.cash} />
          </tr>
          <tr>
            <td className="pl-4">Accounts receivable, gross</td>
            <MoneyCell n={sheet.arGross} />
          </tr>
          <tr>
            <td className="pl-6 text-sm opacity-70">Less: allowance for credit losses</td>
            <MoneyCell n={-sheet.allowance} />
          </tr>
          <tr>
            <td className="pl-4 font-medium">Accounts receivable, net</td>
            <MoneyCell n={sheet.arNet} />
          </tr>
          <tr>
            <td className="pl-4">Inventory (parts at unit cost)</td>
            <MoneyCell n={sheet.inventory} />
          </tr>
          <tr>
            <td className="pl-4">
              Contract assets — unbilled completions
              {sheet.wipCount > 0 ? ` (${sheet.wipCount})` : ""}
            </td>
            <MoneyCell n={sheet.contractAsset} />
          </tr>
          <tr className="border-t-2 font-semibold">
            <td>Total assets</td>
            <MoneyCell n={sheet.totalAssets} bold />
          </tr>
        </ReportTable></div>
      </section>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          Liabilities
        </h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Account", "Total"]}>
          <tr>
            <td className="pl-4">
              Sales tax payable
              <span className="block text-[11px] font-normal opacity-50">
                Open-invoice share {formatReportMoney(sheet.taxOnOpen)} · Collected held{" "}
                {formatReportMoney(sheet.taxCollectedHeld)}
              </span>
            </td>
            <MoneyCell n={sheet.salesTaxPayable} />
          </tr>
          <tr>
            <td className="pl-4">
              Deferred revenue — current
              <span className="block text-[11px] font-normal opacity-50">
                Next 12 months of prepaid / annual contract recognition
              </span>
            </td>
            <MoneyCell n={sheet.deferredCurrent} />
          </tr>
          <tr>
            <td className="pl-4">
              Deferred revenue — noncurrent
              <span className="block text-[11px] font-normal opacity-50">Beyond 12 months</span>
            </td>
            <MoneyCell n={sheet.deferredNoncurrent} />
          </tr>
          <tr>
            <td className="pl-4 opacity-50">Accounts payable (not in subledger)</td>
            <MoneyCell n={0} />
          </tr>
          <tr className="border-t-2 font-semibold">
            <td>Total liabilities</td>
            <MoneyCell n={sheet.totalLiabilities} bold />
          </tr>
        </ReportTable></div>
      </section>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">Equity</h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Account", "Total"]}>
          <tr>
            <td className="pl-4">
              Net assets / equity
              <span className="block text-[11px] font-normal opacity-50">Assets − liabilities (balancing figure)</span>
            </td>
            <MoneyCell n={sheet.equity} />
          </tr>
          <tr className="border-t-2 font-semibold">
            <td>Total equity</td>
            <MoneyCell n={sheet.equity} bold />
          </tr>
          <tr className="border-t-2 font-bold">
            <td>Liabilities + equity</td>
            <MoneyCell n={sheet.totalLiabilities + sheet.equity} bold />
          </tr>
        </ReportTable></div>
      </section>

      {sheet.balances ? (
        <p className="text-xs text-success">Balance sheet equation holds (assets = liabilities + equity).</p>
      ) : (
        <p className="text-xs text-error">Balance sheet out of balance — check data.</p>
      )}

      <PolicyNote>
        {ACCOUNTING_POLICIES.cash} {ACCOUNTING_POLICIES.inventory} {ACCOUNTING_POLICIES.wip}{" "}
        {ACCOUNTING_POLICIES.deferredRevenue} {ACCOUNTING_POLICIES.limitations}
      </PolicyNote>
    </div>
  );
}

function ArAgingSummary({
  aging,
  open,
}: {
  aging: ReturnType<typeof arAgingSummary>;
  open: ReturnType<typeof openInvoicesAt>;
}) {
  const chartData = (Object.keys(AGING_LABELS) as (keyof typeof AGING_LABELS)[]).map((k) => ({
    name: AGING_LABELS[k],
    balance: aging.totals[k],
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {(Object.keys(AGING_LABELS) as (keyof typeof AGING_LABELS)[]).map((k) => (
          <ReportStat
            key={k}
            label={AGING_LABELS[k]}
            value={formatReportMoney(aging.totals[k])}
            hint={`${aging.counts[k]} invoice${aging.counts[k] === 1 ? "" : "s"}`}
            danger={k === "d90" && aging.totals[k] > 0}
          />
        ))}
        <ReportStat label="Gross AR" value={formatReportMoney(aging.gross)} />
        <ReportStat
          label="Net AR"
          value={formatReportMoney(aging.net)}
          hint={`Allowance ${formatReportMoney(aging.allowance)}`}
        />
      </div>

      <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Aging", "# Invoices", "Balance"]}>
        {(Object.keys(AGING_LABELS) as (keyof typeof AGING_LABELS)[]).map((k) => (
          <tr key={k}>
            <td>{AGING_LABELS[k]}</td>
            <td className="text-right tabular-nums">{aging.counts[k]}</td>
            <MoneyCell n={aging.totals[k]} />
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td>Total gross</td>
          <td className="text-right tabular-nums">{open.length}</td>
          <MoneyCell n={aging.gross} bold />
        </tr>
        <tr>
          <td colSpan={2} className="pl-4 opacity-70">
            Less: allowance for credit losses
          </td>
          <MoneyCell n={-aging.allowance} />
        </tr>
        <tr className="font-semibold">
          <td colSpan={2}>Accounts receivable, net</td>
          <MoneyCell n={aging.net} bold />
        </tr>
      </ReportTable></div>
      <PolicyNote>{ACCOUNTING_POLICIES.receivables} {ACCOUNTING_POLICIES.allowance}</PolicyNote>
    </div>
  );
}

function ArAgingDetail({ open }: { open: ReturnType<typeof openInvoicesAt> }) {
  if (open.length === 0) {
    return <EmptyState title="No open receivables" description="All customer balances are cleared." />;
  }
  return (
    <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Invoice", "Customer", "Due", "Days", "Aging", "Balance", "Status"]}>
      {open.map((inv) => (
        <tr key={inv.id} className={inv.bucket === "d90" ? "bg-error/5" : ""}>
          <td>
            <Link href={`/billing/${inv.id}`} className="link link-primary font-medium">
              {inv.invoice_number}
            </Link>
          </td>
          <td>
            {inv.customer_id ? (
              <Link href={`/customers/${inv.customer_id}`} className="link link-hover">
                {inv.customers?.name ?? "—"}
              </Link>
            ) : (
              inv.customers?.name ?? "—"
            )}
          </td>
          <td className="tabular-nums">{inv.due_date}</td>
          <td className="text-right tabular-nums">{inv.daysPast}</td>
          <td>
            <StatusBadge
              label={AGING_LABELS[inv.bucket]}
              tone={inv.bucket === "current" ? "success" : inv.bucket === "d90" ? "error" : "warning"}
            />
          </td>
          <MoneyCell n={Number(inv.remaining_balance)} />
          <td>
            <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
          </td>
        </tr>
      ))}
      <tr className="border-t-2 font-bold">
        <td colSpan={5}>Total</td>
        <MoneyCell n={open.reduce((s, i) => s + Number(i.remaining_balance), 0)} bold />
        <td />
      </tr>
    </ReportTable></div>
  );
}

function SalesByCustomer({ rows }: { rows: ReturnType<typeof salesByCustomer> }) {
  if (rows.length === 0) {
    return <EmptyState title="No recognized revenue in range" description="Adjust dates or finalize invoices." />;
  }
  const top = rows.slice(0, 8);
  return (
    <div className="space-y-6">
      <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Customer", "Invoices", "Service revenue", "Tax", "Paid", "Open balance"]}>
        {rows.map((r) => (
          <tr key={r.customerId ?? r.name}>
            <td>
              {r.customerId ? (
                <Link href={`/customers/${r.customerId}`} className="link link-hover font-medium">
                  {r.name}
                </Link>
              ) : (
                r.name
              )}
            </td>
            <td className="text-right tabular-nums">{r.count}</td>
            <MoneyCell n={r.revenue} />
            <MoneyCell n={r.tax} />
            <MoneyCell n={r.paid} />
            <MoneyCell n={r.balance} />
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td>Total</td>
          <td className="text-right tabular-nums">{rows.reduce((s, r) => s + r.count, 0)}</td>
          <MoneyCell n={rows.reduce((s, r) => s + r.revenue, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.tax, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.paid, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.balance, 0)} bold />
        </tr>
      </ReportTable></div>
      <PolicyNote>Recognized service revenue excludes sales tax (not revenue under GAAP).</PolicyNote>
    </div>
  );
}

function SalesByMonth({ rows }: { rows: ReturnType<typeof salesByMonth> }) {
  if (rows.length === 0) {
    return <EmptyState title="No monthly sales" description="No recognized invoices in this period." />;
  }
  const chart = rows.map((r) => ({ ...r, label: monthLabel(r.month) }));
  return (
    <div className="space-y-6">
      <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Month", "Invoices", "Service revenue", "Sales tax"]}>
        {rows.map((r) => (
          <tr key={r.month}>
            <td>{monthLabel(r.month)}</td>
            <td className="text-right tabular-nums">{r.count}</td>
            <MoneyCell n={r.revenue} />
            <MoneyCell n={r.tax} />
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td>Total</td>
          <td className="text-right tabular-nums">{rows.reduce((s, r) => s + r.count, 0)}</td>
          <MoneyCell n={rows.reduce((s, r) => s + r.revenue, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.tax, 0)} bold />
        </tr>
      </ReportTable></div>
      <PolicyNote>
        Accrual revenue by invoice date. For cash collections use the Statement of Cash Flows (payment date).
      </PolicyNote>
    </div>
  );
}

function SalesByService({ rows }: { rows: ReturnType<typeof salesByService> }) {
  if (rows.length === 0) {
    return <EmptyState title="No service breakdown" description="No billed line categories in range." />;
  }
  const total = rows.reduce((s, r) => s + Math.max(0, r.amount), 0);
  return (
    <div className="space-y-6">
      <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Transaction-price component", "Amount", "% of positive"]}>
        {rows.map((r) => (
          <tr key={r.service}>
            <td>{r.service}</td>
            <MoneyCell n={r.amount} />
            <td className="text-right tabular-nums opacity-70">
              {r.amount > 0 && total > 0 ? ((r.amount / total) * 100).toFixed(1) + "%" : "—"}
            </td>
          </tr>
        ))}
      </ReportTable></div>
    </div>
  );
}

function CashFlowReport({ cash }: { cash: ReturnType<typeof cashFlowStatement> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <ReportStat
          label="Cash from customers"
          value={formatReportMoney(cash.cashFromCustomers)}
          hint={`${cash.count} payments`}
        />
        <ReportStat
          label="Credit sales (period)"
          value={formatReportMoney(cash.salesOnAccount)}
          hint="Invoice totals incl. tax"
        />
        <ReportStat
          label="Ending open AR"
          value={formatReportMoney(cash.arEnd)}
          hint={`Begin ${formatReportMoney(cash.arBegin)}`}
        />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Cash flows from operating activities</h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Activity", "Amount"]}>
          {cash.byMethod.map((m) => (
            <tr key={m.method}>
              <td className="pl-4">Collections from customers — {m.method}</td>
              <MoneyCell n={m.amount} />
            </tr>
          ))}
          <tr className="border-t-2 font-bold">
            <td>Net cash provided by operating activities</td>
            <MoneyCell n={cash.cashFromCustomers} bold />
          </tr>
        </ReportTable></div>
        <p className="mt-2 text-xs opacity-50">
          Direct method (cash receipts). Investing and financing activities are not modeled in this application.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">A/R rollforward (disclosure)</h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Line", "Amount"]}>
          <tr>
            <td className="pl-4">Beginning open AR</td>
            <MoneyCell n={cash.arBegin} />
          </tr>
          <tr>
            <td className="pl-4">+ Recognized billed totals (period)</td>
            <MoneyCell n={cash.salesOnAccount} />
          </tr>
          <tr>
            <td className="pl-4">− Cash collections</td>
            <MoneyCell n={-cash.cashFromCustomers} />
          </tr>
          <tr className="font-medium">
            <td className="pl-4">Implied ending AR</td>
            <MoneyCell n={cash.arBegin + cash.salesOnAccount - cash.cashFromCustomers} />
          </tr>
          <tr>
            <td className="pl-4">Actual ending open AR</td>
            <MoneyCell n={cash.arEnd} />
          </tr>
          <tr className={Math.abs(cash.reconcilingDiff) > 0.5 ? "text-warning" : ""}>
            <td className="pl-4">Difference (timing / status / partial payments)</td>
            <MoneyCell n={cash.reconcilingDiff} />
          </tr>
        </ReportTable></div>
      </section>

      {cash.lines.length === 0 ? (
        <EmptyState title="No payments in range" description="Record payments in the Payments module." />
      ) : (
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Payment", "Date", "Method", "Customer", "Amount"]}>
          {cash.lines.slice(0, 40).map((p) => (
            <tr key={p.id}>
              <td className="font-mono text-xs">{p.payment_number}</td>
              <td className="tabular-nums">{p.payment_date}</td>
              <td>{p.payment_method}</td>
              <td>{(p as PaymentRow).customers?.name ?? "—"}</td>
              <MoneyCell n={Number(p.payment_amount)} />
            </tr>
          ))}
        </ReportTable></div>
      )}
    </div>
  );
}

function ContractProfitReport({ rows }: { rows: ReturnType<typeof contractProfitabilityGaap> }) {
  if (rows.length === 0) {
    return <EmptyState title="No contracts" description="Add service contracts to analyze margins." />;
  }
  const rev = rows.reduce((s, r) => s + r.revenue, 0);
  const cogs = rows.reduce((s, r) => s + r.cogs, 0);
  const profit = rows.reduce((s, r) => s + r.profit, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <ReportStat label="Recognized revenue" value={formatReportMoney(rev)} />
        <ReportStat label="Matched COGS" value={formatReportMoney(cogs)} />
        <ReportStat label="Gross profit" value={formatReportMoney(profit)} />
      </div>
      <div id="report-detail" className="scroll-mt-4"><ReportTable
        headers={["Contract", "Customer", "Price (book)", "Recognized", "COGS", "Profit", "Margin", "Status"]}
      >
        {rows.map((r) => (
          <tr key={r.id} className={r.profit < 0 && r.revenue > 0 ? "bg-error/5" : ""}>
            <td>
              <Link href="/contracts" className="link link-hover font-medium">
                {r.name}
              </Link>
            </td>
            <td>
              {r.customerId ? (
                <Link href={`/customers/${r.customerId}`} className="link link-hover">
                  {r.customerName}
                </Link>
              ) : (
                r.customerName
              )}
            </td>
            <MoneyCell n={r.contractPrice} />
            <MoneyCell n={r.revenue} />
            <MoneyCell n={r.cogs} />
            <MoneyCell n={r.profit} />
            <td className="text-right tabular-nums">{formatReportPct(r.margin)}</td>
            <td>
              <StatusBadge label={r.status} tone={statusTone(r.status)} />
            </td>
          </tr>
        ))}
      </ReportTable></div>
      <PolicyNote>
        Revenue is from recognized invoices linked to the contract. COGS is actual labor and parts cost on those
        invoices&apos; work orders. Contract price is disclosed as contractual backlog/book value, not automatically
        recognized revenue.
      </PolicyNote>
    </div>
  );
}

function JobSummaryReport({ summary }: { summary: ReturnType<typeof jobStatusSummary> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <ReportStat label="All jobs" value={summary.total} />
        <ReportStat label="Open" value={summary.open} />
        <ReportStat label="Completed" value={summary.completed} />
        <ReportStat
          label="Completed unbilled"
          value={summary.unbilled}
          danger={summary.unbilled > 0}
          hint="Contract assets risk"
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">By status</h3>
          <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Status", "Count"]}>
            {summary.byStatus.map((r) => (
              <tr key={r.status}>
                <td>
                  <StatusBadge label={r.status} tone={statusTone(r.status)} />
                </td>
                <td className="text-right tabular-nums font-medium">{r.count}</td>
              </tr>
            ))}
          </ReportTable></div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">By priority</h3>
          <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Priority", "Count"]}>
            {summary.byPriority.map((r) => (
              <tr key={r.priority}>
                <td>
                  <StatusBadge label={r.priority} tone={statusTone(r.priority)} />
                </td>
                <td className="text-right tabular-nums font-medium">{r.count}</td>
              </tr>
            ))}
          </ReportTable></div>
        </div>
      </div>
      <Link href="/work-orders" className="btn btn-outline btn-sm gap-1 print:hidden">
        Jobs board <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function UnbilledReport({ rows }: { rows: ReturnType<typeof unbilledJobs> }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No unbilled completed jobs"
        description="Completed work is invoiced — no material contract-asset backlog from jobs."
        action={
          <Link href="/billing" className="btn btn-primary btn-sm">
            Open billing
          </Link>
        }
      />
    );
  }
  const billable = rows.reduce((s, j) => s + j.billableEstimate, 0);
  const cost = rows.reduce((s, j) => s + j.directCost, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <ReportStat label="Jobs" value={rows.length} danger />
        <ReportStat label="Est. contract asset" value={formatReportMoney(billable)} />
        <ReportStat label="Direct cost to date" value={formatReportMoney(cost)} />
      </div>
      <div className="alert alert-warning text-sm">
        <span>
          Completed, unbilled work is a <strong>contract asset</strong> (unbilled receivable) until invoiced — track
          for revenue leakage.
        </span>
      </div>
      <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Job", "Customer", "Type", "Completed", "Est. billable", "Direct cost", ""]}>
        {rows.map((j) => (
          <tr key={j.id}>
            <td>
              <Link href={`/work-orders/${j.id}`} className="link link-primary font-medium">
                {j.work_order_number}
              </Link>
            </td>
            <td>
              {j.customer_id ? (
                <Link href={`/customers/${j.customer_id}`} className="link link-hover">
                  {j.customers?.name ?? "—"}
                </Link>
              ) : (
                j.customers?.name ?? "—"
              )}
            </td>
            <td>{j.work_order_type}</td>
            <td className="tabular-nums">{j.completion_date ?? "—"}</td>
            <MoneyCell n={j.billableEstimate} />
            <MoneyCell n={j.directCost} />
            <td className="text-right print:hidden">
              <Link href={`/billing?wo=${j.id}`} className="btn btn-primary btn-xs">
                Invoice
              </Link>
            </td>
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td colSpan={4}>Total</td>
          <MoneyCell n={billable} bold />
          <MoneyCell n={cost} bold />
          <td />
        </tr>
      </ReportTable></div>
      <PolicyNote>{ACCOUNTING_POLICIES.wip}</PolicyNote>
    </div>
  );
}

function InvoiceListReport({ rows }: { rows: ReturnType<typeof invoicesInRange> }) {
  if (rows.length === 0) {
    return <EmptyState title="No invoices in range" description="Widen the date range or create invoices." />;
  }
  const recognized = rows.filter((i) => isRecognizedRevenue(i));
  const total = rows.reduce((s, i) => s + Number(i.invoice_total), 0);
  const paid = rows.reduce((s, i) => s + Number(i.amount_paid), 0);
  const bal = rows.reduce((s, i) => s + Number(i.remaining_balance), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <ReportStat label="Invoices" value={rows.length} />
        <ReportStat label="Recognized" value={recognized.length} />
        <ReportStat label="Billed totals" value={formatReportMoney(total)} />
        <ReportStat label="Open balance" value={formatReportMoney(bal)} hint={`Paid ${formatReportMoney(paid)}`} />
      </div>
      <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Invoice", "Date", "Customer", "Rec.", "Total", "Paid", "Balance", "Status"]}>
        {rows.map((i) => (
          <tr key={i.id} className={!isRecognizedRevenue(i) ? "opacity-60" : ""}>
            <td>
              <Link href={`/billing/${i.id}`} className="link link-primary font-medium">
                {i.invoice_number}
              </Link>
            </td>
            <td className="tabular-nums">{i.invoice_date}</td>
            <td>{i.customers?.name ?? "—"}</td>
            <td className="text-center text-xs">{isRecognizedRevenue(i) ? "Yes" : "No"}</td>
            <MoneyCell n={Number(i.invoice_total)} />
            <MoneyCell n={Number(i.amount_paid)} />
            <MoneyCell n={Number(i.remaining_balance)} />
            <td>
              <StatusBadge label={i.status} tone={statusTone(i.status)} />
            </td>
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td colSpan={4}>Total</td>
          <MoneyCell n={total} bold />
          <MoneyCell n={paid} bold />
          <MoneyCell n={bal} bold />
          <td />
        </tr>
      </ReportTable></div>
      <PolicyNote>
        Draft / Needs Review / Canceled invoices are not recognized revenue until finalized (see Rec. column).
      </PolicyNote>
    </div>
  );
}

function ContractAssetReport({
  data,
  asOf,
}: {
  data: ReturnType<typeof contractAssetRollforward>;
  asOf: string;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat label="Beginning" value={formatReportMoney(data.beginning)} />
        <ReportStat label="+ Earned unbilled" value={formatReportMoney(data.earnedUnbilled)} />
        <ReportStat label="− Billed" value={formatReportMoney(data.billed)} />
        <ReportStat label="Ending contract asset" value={formatReportMoney(data.ending)} hint={`As of ${asOf}`} />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="No unbilled completions" description="Completed jobs without invoices appear here." />
      ) : (
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Work order", "Completed", "Source", "Amount"]}>
          {data.rows.map((r) => (
            <tr key={r.workOrderId}>
              <td>{r.workOrderNumber}</td>
              <td>{r.completionDate}</td>
              <td>{r.source}</td>
              <MoneyCell n={r.amount} />
            </tr>
          ))}
        </ReportTable></div>
      )}
      <PolicyNote>{ACCOUNTING_POLICIES.wip}</PolicyNote>
    </div>
  );
}

function TrialBalanceReport({
  data,
  asOf,
}: {
  data: ReturnType<typeof trialBalance>;
  asOf: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm opacity-70">
        Posted GL journals through {asOf}. Post batches and period-close entries from{" "}
        <a className="link" href="/accounting/close">
          Period Close
        </a>
        .
      </p>
      {data.rows.length === 0 ? (
        <EmptyState title="No GL activity" description="Trial balance fills as journals are posted." />
      ) : (
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Account", "Name", "Debit", "Credit", "Balance"]}>
          {data.rows.map((r) => (
            <tr key={r.accountCode}>
              <td className="font-mono text-xs">{r.accountCode}</td>
              <td>{r.accountName}</td>
              <MoneyCell n={r.debit} />
              <MoneyCell n={r.credit} />
              <MoneyCell n={r.balance} />
            </tr>
          ))}
          <tr className="border-t-2 font-bold">
            <td colSpan={2}>Total {data.balanced ? "(balanced)" : "(out of balance)"}</td>
            <MoneyCell n={data.totalDebit} bold />
            <MoneyCell n={data.totalCredit} bold />
            <td />
          </tr>
        </ReportTable></div>
      )}
      <PolicyNote>{ACCOUNTING_POLICIES.periodClose}</PolicyNote>
    </div>
  );
}

function DeferredRevenueReport({ data }: { data: ReturnType<typeof deferredRevenueSchedule> }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (data.contractCount === 0) {
    return (
      <EmptyState
        title="No deferred revenue contracts"
        description="Annual fixed-fee / prepaid maintenance contracts appear here with a straight-line recognition schedule."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat
          label="Deferred revenue"
          value={formatReportMoney(data.totalDeferred)}
          hint={`${data.contractCount} prepaid contract${data.contractCount === 1 ? "" : "s"}`}
        />
        <ReportStat label="Current portion" value={formatReportMoney(data.totalCurrent)} hint="Next 12 months" />
        <ReportStat
          label="Noncurrent portion"
          value={formatReportMoney(data.totalNoncurrent)}
          hint="Beyond 12 months"
        />
        <ReportStat
          label="Recognized to date"
          value={formatReportMoney(data.totalRecognized)}
          hint={`Of ${formatReportMoney(data.totalContractPrice)} prepaid`}
        />
      </div>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          Contract balances as of {data.asOf}
        </h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable
          headers={[
            "Contract",
            "Customer",
            "Term",
            "Price",
            "Monthly",
            "Earned to date",
            "Deferred",
            "Current",
            "Noncurrent",
          ]}
        >
          {data.rows.map((r) => (
            <Fragment key={r.id}>
              <tr
                className="cursor-pointer hover:bg-base-200/60"
                onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
              >
                <td>
                  <span className="font-medium">{r.name}</span>
                  <span className="mt-0.5 block text-[11px] opacity-60">
                    {r.billingMethod} · {r.status}
                    {expandedId === r.id ? " · hide schedule" : " · view schedule"}
                  </span>
                </td>
                <td>{r.customerName}</td>
                <td className="whitespace-nowrap text-xs">
                  {r.startDate} → {r.endDate}
                  <span className="mt-0.5 block opacity-60">
                    {r.monthsElapsed}/{r.monthsTotal} mo
                  </span>
                </td>
                <MoneyCell n={r.contractPrice} />
                <MoneyCell n={r.monthlyRecognition} />
                <MoneyCell n={r.recognizedToDate} />
                <MoneyCell n={r.deferredBalance} />
                <MoneyCell n={r.currentPortion} />
                <MoneyCell n={r.noncurrentPortion} />
              </tr>
              {expandedId === r.id ? (
                <tr>
                  <td colSpan={9} className="bg-base-200/40 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-70">
                      Recognition schedule
                    </p>
                    <div className="max-h-64 overflow-auto">
                      <table className="table table-xs">
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th className="text-right">Beginning</th>
                            <th className="text-right">Recognized</th>
                            <th className="text-right">Ending</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.schedule.map((m) => (
                            <tr key={m.month}>
                              <td>{monthLabel(m.month)}</td>
                              <td className="text-right tabular-nums">{formatReportMoney(m.beginningBalance)}</td>
                              <td className="text-right tabular-nums">{formatReportMoney(m.recognized)}</td>
                              <td className="text-right tabular-nums">{formatReportMoney(m.endingBalance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
          <tr className="border-t-2 font-bold">
            <td colSpan={3}>Total</td>
            <MoneyCell n={data.totalContractPrice} bold />
            <td />
            <MoneyCell n={data.totalRecognized} bold />
            <MoneyCell n={data.totalDeferred} bold />
            <MoneyCell n={data.totalCurrent} bold />
            <MoneyCell n={data.totalNoncurrent} bold />
          </tr>
        </ReportTable></div>
      </section>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          Consolidated monthly rollforward
        </h3>
        <div id="report-detail" className="scroll-mt-4"><ReportTable headers={["Month", "Beginning deferred", "Billings", "Recognized", "Ending deferred"]}>
          {data.consolidated.map((m) => (
            <tr key={m.month}>
              <td>{monthLabel(m.month)}</td>
              <MoneyCell n={m.beginningBalance} />
              <MoneyCell n={m.billings} />
              <MoneyCell n={m.recognized} />
              <MoneyCell n={m.endingBalance} />
            </tr>
          ))}
        </ReportTable></div>
      </section>

      <PolicyNote>{ACCOUNTING_POLICIES.deferredRevenue}</PolicyNote>
    </div>
  );
}

function PoliciesReport() {
  const entries: { key: string; title: string; body: string }[] = [
    { key: "framework", title: "Framework", body: ACCOUNTING_POLICIES.framework },
    { key: "basis", title: "Basis of accounting", body: ACCOUNTING_POLICIES.basis },
    { key: "revenue", title: "Revenue recognition", body: ACCOUNTING_POLICIES.revenue },
    { key: "deferred", title: "Deferred revenue", body: ACCOUNTING_POLICIES.deferredRevenue },
    { key: "periodClose", title: "Period close", body: ACCOUNTING_POLICIES.periodClose },
    { key: "receivables", title: "Accounts receivable", body: ACCOUNTING_POLICIES.receivables },
    { key: "allowance", title: "Allowance for credit losses", body: ACCOUNTING_POLICIES.allowance },
    { key: "cogs", title: "Cost of services", body: ACCOUNTING_POLICIES.cogs },
    { key: "inventory", title: "Inventory", body: ACCOUNTING_POLICIES.inventory },
    { key: "cash", title: "Cash", body: ACCOUNTING_POLICIES.cash },
    { key: "tax", title: "Sales tax payable", body: ACCOUNTING_POLICIES.taxLiability },
    { key: "wip", title: "Contract assets", body: ACCOUNTING_POLICIES.wip },
    { key: "limitations", title: "Limitations", body: ACCOUNTING_POLICIES.limitations },
  ];
  return (
    <div className="space-y-4">
      <div className="alert alert-info text-sm">
        <Scale className="h-4 w-4 shrink-0" />
        <span>
          These policies describe how this application measures report lines from operational subledgers. They are
          educational GAAP orientation for Ridley&apos;s service business — not a substitute for a full audited GL.
        </span>
      </div>
      <dl className="space-y-4">
        {entries.map((e) => (
          <div key={e.key} className="border-b border-base-200 pb-3 last:border-0">
            <dt className="text-sm font-bold">{e.title}</dt>
            <dd className="mt-1 text-sm leading-relaxed opacity-80">{e.body}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
