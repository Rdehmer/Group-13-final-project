"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Download,
  Printer,
  RefreshCw,
  Search,
  FileSpreadsheet,
  ChevronRight,
  BookOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import {
  AGING_LABELS,
  REPORT_CATALOG,
  REPORT_NAME,
  arAgingSummary,
  balanceSheetSummary,
  cashFlowFromPayments,
  contractProfitability,
  defaultLast12Months,
  defaultYtdRange,
  exportCsv,
  formatReportMoney,
  formatReportPct,
  invoicesInRange,
  jobStatusSummary,
  monthLabel,
  openInvoicesAt,
  profitAndLoss,
  salesByCustomer,
  salesByMonth,
  salesByService,
  unbilledJobs,
  type DateRange,
  type InvoiceWithCustomer,
  type ReportId,
} from "@/lib/reports";
import type { Payment, ServiceContract, WorkOrder } from "@/lib/types";

type JobRow = WorkOrder & { customers?: { name: string } };
type ContractRow = ServiceContract & { customers?: { name: string } };
type PaymentRow = Payment & { customers?: { name: string } };

const CHART_COLORS = ["#0f766e", "#0369a1", "#b45309", "#be123c", "#4f46e5", "#15803d"];

/**
 * QuickBooks Online–style reporting center for Ridley Equipment Services.
 * This business faces delayed decisions when financials live only in spreadsheets.
 * Reports pull live AR, sales, cash, jobs, and contracts into one run-date filterable hub.
 */
export default function ReportsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<ReportId>("pnl");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<DateRange>(() => defaultYtdRange());
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoices, setInvoices] = useState<InvoiceWithCustomer[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    const [{ data: inv }, { data: pay }, { data: sc }, { data: wo }] = await Promise.all([
      supabase
        .from("invoices")
        .select("*, customers(name), work_orders(work_order_number)")
        .order("invoice_date", { ascending: false }),
      supabase.from("payments").select("*, customers(name)").order("payment_date", { ascending: false }),
      supabase.from("service_contracts").select("*, customers(name)").order("name"),
      supabase.from("work_orders").select("*, customers(name)").order("created_at", { ascending: false }),
    ]);
    setInvoices((inv as InvoiceWithCustomer[]) ?? []);
    setPayments((pay as PaymentRow[]) ?? []);
    setContracts((sc as ContractRow[]) ?? []);
    setJobs((wo as JobRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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

  const completedInRange = useMemo(
    () =>
      jobs.filter(
        (j) =>
          ["Completed", "Closed"].includes(j.status) &&
          (j.completion_date
            ? j.completion_date >= range.start && j.completion_date <= range.end
            : true),
      ).length,
    [jobs, range],
  );

  const pnl = useMemo(
    () => profitAndLoss(invoices, range, { completedJobsInRange: completedInRange }),
    [invoices, range, completedInRange],
  );
  const openAr = useMemo(() => openInvoicesAt(invoices, new Date(asOf + "T12:00:00")), [invoices, asOf]);
  const aging = useMemo(() => arAgingSummary(openAr), [openAr]);
  const byCustomer = useMemo(() => salesByCustomer(invoices, range), [invoices, range]);
  const byMonth = useMemo(() => salesByMonth(invoices, range), [invoices, range]);
  const byService = useMemo(() => salesByService(invoices, range), [invoices, range]);
  const cash = useMemo(() => cashFlowFromPayments(payments, range), [payments, range]);
  const sheet = useMemo(() => balanceSheetSummary(invoices, payments, asOf), [invoices, payments, asOf]);
  const contractsProfit = useMemo(() => contractProfitability(contracts), [contracts]);
  const jobSummary = useMemo(() => jobStatusSummary(jobs), [jobs]);
  const unbilled = useMemo(() => unbilledJobs(jobs), [jobs]);
  const invList = useMemo(() => invoicesInRange(invoices, range), [invoices, range]);

  const needsAsOf =
    reportId === "ar_aging" || reportId === "ar_detail" || reportId === "balance_sheet";
  const needsRange = reportId !== "ar_aging" && reportId !== "ar_detail";

  function printReport() {
    window.print();
  }

  function exportCurrent() {
    const name = `${REPORT_NAME[reportId].replace(/\s+/g, "_")}_${range.start}_${range.end}`;
    switch (reportId) {
      case "pnl":
        exportCsv(name, ["Account", "Amount"], [
          ["Labor income", pnl.laborIncome],
          ["Parts income", pnl.partsIncome],
          ["Recurring", pnl.recurringIncome],
          ["Additional", pnl.otherIncome],
          ["Discounts", -pnl.discounts],
          ["Warranty deductions", -pnl.warranty],
          ["Total income", pnl.income],
          ["COGS labor (est.)", pnl.cogsLabor],
          ["COGS parts (est.)", pnl.cogsParts],
          ["Total COGS (est.)", pnl.cogs],
          ["Gross profit", pnl.gross],
          ["Gross margin", pnl.margin != null ? (pnl.margin * 100).toFixed(1) + "%" : "N/A"],
        ]);
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
      case "sales_customer":
        exportCsv(
          name,
          ["Customer", "Invoices", "Revenue", "Paid", "Balance"],
          byCustomer.map((r) => [r.name, r.count, r.revenue, r.paid, r.balance]),
        );
        break;
      case "sales_month":
        exportCsv(
          name,
          ["Month", "Invoices", "Revenue", "Collected"],
          byMonth.map((r) => [r.month, r.count, r.revenue, r.collected]),
        );
        break;
      case "sales_service":
        exportCsv(
          name,
          ["Service", "Amount"],
          byService.map((r) => [r.service, r.amount]),
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
          ["Contract", "Customer", "Revenue", "Est. cost", "Profit", "Margin", "Status"],
          contractsProfit.map((r) => [
            r.name,
            r.customerName,
            r.revenue,
            r.cost,
            r.profit,
            r.margin != null ? (r.margin * 100).toFixed(1) + "%" : "N/A",
            r.status,
          ]),
        );
        break;
      case "unbilled":
        exportCsv(
          name,
          ["Job", "Customer", "Completed", "Type"],
          unbilled.map((j) => [
            j.work_order_number,
            j.customers?.name ?? "",
            j.completion_date ?? "",
            j.work_order_type,
          ]),
        );
        break;
      case "invoice_list":
        exportCsv(
          name,
          ["Invoice", "Date", "Customer", "Total", "Paid", "Balance", "Status"],
          invList.map((i) => [
            i.invoice_number,
            i.invoice_date,
            i.customers?.name ?? "",
            Number(i.invoice_total),
            Number(i.amount_paid),
            Number(i.remaining_balance),
            i.status,
          ]),
        );
        break;
      case "balance_sheet":
        exportCsv(name, ["Line", "Amount"], [
          ["Cash (from recorded payments)", sheet.cash],
          ["Accounts receivable", sheet.ar],
          ["Total assets", sheet.totalAssets],
          ["Liabilities", sheet.liabilities],
          ["Equity (plug)", sheet.equity],
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
        description="QuickBooks-style financial and operational reports — live from your Ridley data"
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <Link href="/billing" className="btn btn-outline btn-sm">
              Billing
            </Link>
            <Link href="/payments" className="btn btn-outline btn-sm">
              Payments
            </Link>
          </div>
        }
      />

      {error ? <div className="alert alert-error mb-4 text-sm">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[16rem_1fr]">
        {/* Report menu (QBO left rail) */}
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

        {/* Report viewer */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm print:border-0 print:shadow-none">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/45">
                  Ridley Equipment Services
                </p>
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{REPORT_NAME[reportId]}</h2>
                <p className="mt-1 text-sm opacity-60">
                  {needsAsOf ? (
                    <>
                      As of <strong>{asOf}</strong>
                    </>
                  ) : null}
                  {needsRange && reportId !== "balance_sheet" ? (
                    <>
                      {needsAsOf ? " · " : null}
                      {range.start} → {range.end}
                    </>
                  ) : null}
                  {reportId === "pnl" ? " · Accrual (invoice date)" : null}
                  {reportId === "cash_flow" ? " · Cash basis (payment date)" : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button type="button" className="btn btn-outline btn-sm gap-1" onClick={exportCurrent}>
                  <Download className="h-4 w-4" /> Export CSV
                </button>
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
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => setRange(defaultYtdRange())}
                    >
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
              {reportId === "pnl" ? <PnLReport pnl={pnl} /> : null}
              {reportId === "balance_sheet" ? <BalanceSheetReport sheet={sheet} /> : null}
              {reportId === "ar_aging" ? <ArAgingSummary aging={aging} open={openAr} /> : null}
              {reportId === "ar_detail" ? <ArAgingDetail open={openAr} /> : null}
              {reportId === "sales_customer" ? <SalesByCustomer rows={byCustomer} /> : null}
              {reportId === "sales_month" ? <SalesByMonth rows={byMonth} /> : null}
              {reportId === "sales_service" ? <SalesByService rows={byService} /> : null}
              {reportId === "cash_flow" ? <CashFlowReport cash={cash} /> : null}
              {reportId === "contract_profit" ? <ContractProfitReport rows={contractsProfit} /> : null}
              {reportId === "job_summary" ? <JobSummaryReport summary={jobSummary} /> : null}
              {reportId === "unbilled" ? <UnbilledReport rows={unbilled} /> : null}
              {reportId === "invoice_list" ? <InvoiceListReport rows={invList} /> : null}
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

function PnLReport({ pnl }: { pnl: ReturnType<typeof profitAndLoss> }) {
  const incomeLines = [
    ["Labor income", pnl.laborIncome],
    ["Parts / materials", pnl.partsIncome],
    ["Recurring service", pnl.recurringIncome],
    ["Additional charges", pnl.otherIncome],
  ] as const;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Income" value={formatReportMoney(pnl.income)} hint={`${pnl.invoiceCount} invoices`} />
        <StatCard label="Est. COGS" value={formatReportMoney(pnl.cogs)} />
        <StatCard label="Gross profit" value={formatReportMoney(pnl.gross)} />
        <StatCard label="Gross margin" value={formatReportPct(pnl.margin)} />
      </div>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          Ordinary income
        </h3>
        <ReportTable headers={["Account", "Total"]}>
          {incomeLines.map(([label, amt]) => (
            <tr key={label}>
              <td className="pl-4">{label}</td>
              <MoneyCell n={amt} />
            </tr>
          ))}
          {pnl.discounts > 0 ? (
            <tr>
              <td className="pl-4">Discounts given</td>
              <MoneyCell n={-pnl.discounts} />
            </tr>
          ) : null}
          {pnl.warranty > 0 ? (
            <tr>
              <td className="pl-4">Warranty deductions</td>
              <MoneyCell n={-pnl.warranty} />
            </tr>
          ) : null}
          <tr className="border-t-2 border-base-content/15 font-semibold">
            <td>Total income</td>
            <MoneyCell n={pnl.income} bold />
          </tr>
        </ReportTable>
      </section>

      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          Cost of goods sold (estimated)
        </h3>
        <ReportTable headers={["Account", "Total"]}>
          <tr>
            <td className="pl-4">
              Direct labor ({pnl.assumptions.completedJobs} jobs × {pnl.assumptions.avgHours}h × $
              {pnl.assumptions.laborCostPerHr})
            </td>
            <MoneyCell n={pnl.cogsLabor} />
          </tr>
          <tr>
            <td className="pl-4">
              Parts cost ({(pnl.assumptions.partsCostRatio * 100).toFixed(0)}% of billed parts)
            </td>
            <MoneyCell n={pnl.cogsParts} />
          </tr>
          <tr className="border-t-2 border-base-content/15 font-semibold">
            <td>Total COGS</td>
            <MoneyCell n={pnl.cogs} bold />
          </tr>
        </ReportTable>
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
        {pnl.tax > 0 ? (
          <p className="mt-2 text-xs opacity-50">
            Tax collected (not profit): {formatReportMoney(pnl.tax)} · Invoice totals including tax:{" "}
            {formatReportMoney(pnl.grossSales)}
          </p>
        ) : null}
      </div>

      <p className="flex items-start gap-2 text-xs opacity-55">
        <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        COGS uses labeled estimates when true job cost journals are not posted. Accrual uses invoice date, similar to
        QBO Accrual P&amp;L.
      </p>
    </div>
  );
}

function BalanceSheetReport({ sheet }: { sheet: ReturnType<typeof balanceSheetSummary> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total assets" value={formatReportMoney(sheet.totalAssets)} />
        <StatCard label="Cash (payments)" value={formatReportMoney(sheet.cash)} />
        <StatCard label="Accounts receivable" value={formatReportMoney(sheet.ar)} />
      </div>
      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">ASSETS</h3>
        <ReportTable headers={["Account", "Total"]}>
          <tr>
            <td className="pl-4">Cash (sum of recorded payments)</td>
            <MoneyCell n={sheet.cash} />
          </tr>
          <tr>
            <td className="pl-4">Accounts receivable</td>
            <MoneyCell n={sheet.ar} />
          </tr>
          <tr className="border-t-2 font-semibold">
            <td>Total assets</td>
            <MoneyCell n={sheet.totalAssets} bold />
          </tr>
        </ReportTable>
      </section>
      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">
          LIABILITIES
        </h3>
        <ReportTable headers={["Account", "Total"]}>
          <tr>
            <td className="pl-4 opacity-60">Accounts payable (not tracked in v1)</td>
            <MoneyCell n={0} />
          </tr>
          <tr className="border-t-2 font-semibold">
            <td>Total liabilities</td>
            <MoneyCell n={sheet.liabilities} bold />
          </tr>
        </ReportTable>
      </section>
      <section>
        <h3 className="mb-2 border-b border-base-300 pb-1 text-sm font-bold uppercase tracking-wide">EQUITY</h3>
        <ReportTable headers={["Account", "Total"]}>
          <tr>
            <td className="pl-4">Net assets / retained equity (plug)</td>
            <MoneyCell n={sheet.equity} />
          </tr>
          <tr className="border-t-2 font-semibold">
            <td>Total equity</td>
            <MoneyCell n={sheet.equity} bold />
          </tr>
          <tr className="border-t-2 font-bold">
            <td>Liabilities + equity</td>
            <MoneyCell n={sheet.liabilities + sheet.equity} bold />
          </tr>
        </ReportTable>
      </section>
      <p className="text-xs opacity-55">
        Simplified balance sheet for a service company without a full GL. Billed YTD (posted invoices):{" "}
        {formatReportMoney(sheet.billedYtd)}.
      </p>
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(AGING_LABELS) as (keyof typeof AGING_LABELS)[]).map((k) => (
          <StatCard
            key={k}
            label={AGING_LABELS[k]}
            value={formatReportMoney(aging.totals[k])}
            hint={`${aging.counts[k]} invoice${aging.counts[k] === 1 ? "" : "s"}`}
            danger={k === "d90" && aging.totals[k] > 0}
          />
        ))}
        <StatCard label="Total AR" value={formatReportMoney(aging.total)} />
      </div>

      {aging.total > 0 ? (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--bc) / 0.08)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} width={40} />
              <Tooltip formatter={(v) => formatReportMoney(Number(v))} />
              <Bar dataKey="balance" name="Balance" fill="#0f766e" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <ReportTable headers={["Aging", "# Invoices", "Total"]}>
        {(Object.keys(AGING_LABELS) as (keyof typeof AGING_LABELS)[]).map((k) => (
          <tr key={k}>
            <td>{AGING_LABELS[k]}</td>
            <td className="text-right tabular-nums">{aging.counts[k]}</td>
            <MoneyCell n={aging.totals[k]} />
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td>Total</td>
          <td className="text-right tabular-nums">{open.length}</td>
          <MoneyCell n={aging.total} bold />
        </tr>
      </ReportTable>
      <p className="text-xs opacity-55">
        Open detail by customer is on <strong>A/R Aging Detail</strong>. Also available under Payments.
      </p>
    </div>
  );
}

function ArAgingDetail({ open }: { open: ReturnType<typeof openInvoicesAt> }) {
  if (open.length === 0) {
    return <EmptyState title="No open receivables" description="All customer balances are cleared." />;
  }
  return (
    <ReportTable headers={["Invoice", "Customer", "Due", "Days", "Aging", "Balance", "Status"]}>
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
    </ReportTable>
  );
}

function SalesByCustomer({ rows }: { rows: ReturnType<typeof salesByCustomer> }) {
  if (rows.length === 0) {
    return <EmptyState title="No sales in range" description="Adjust dates or post invoices." />;
  }
  const top = rows.slice(0, 8);
  return (
    <div className="space-y-6">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} layout="vertical" margin={{ left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--bc) / 0.08)" horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => formatReportMoney(Number(v))} />
            <Bar dataKey="revenue" name="Revenue" fill="#0369a1" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ReportTable headers={["Customer", "Invoices", "Revenue", "Paid", "Open balance"]}>
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
            <MoneyCell n={r.paid} />
            <MoneyCell n={r.balance} />
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td>Total</td>
          <td className="text-right tabular-nums">{rows.reduce((s, r) => s + r.count, 0)}</td>
          <MoneyCell n={rows.reduce((s, r) => s + r.revenue, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.paid, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.balance, 0)} bold />
        </tr>
      </ReportTable>
    </div>
  );
}

function SalesByMonth({ rows }: { rows: ReturnType<typeof salesByMonth> }) {
  if (rows.length === 0) {
    return <EmptyState title="No monthly sales" description="No invoices in this period." />;
  }
  const chart = rows.map((r) => ({ ...r, label: monthLabel(r.month) }));
  return (
    <div className="space-y-6">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--bc) / 0.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} width={44} />
            <Tooltip formatter={(v) => formatReportMoney(Number(v))} />
            <Bar dataKey="revenue" name="Billed" fill="#0f766e" radius={[6, 6, 0, 0]} />
            <Bar dataKey="collected" name="Collected" fill="#94a3b8" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ReportTable headers={["Month", "Invoices", "Billed", "Cash applied*"]}>
        {rows.map((r) => (
          <tr key={r.month}>
            <td>{monthLabel(r.month)}</td>
            <td className="text-right tabular-nums">{r.count}</td>
            <MoneyCell n={r.revenue} />
            <MoneyCell n={r.collected} />
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td>Total</td>
          <td className="text-right tabular-nums">{rows.reduce((s, r) => s + r.count, 0)}</td>
          <MoneyCell n={rows.reduce((s, r) => s + r.revenue, 0)} bold />
          <MoneyCell n={rows.reduce((s, r) => s + r.collected, 0)} bold />
        </tr>
      </ReportTable>
      <p className="text-xs opacity-50">
        *Cash applied is amount paid recorded on invoices dated in the month (not pure cash-basis). See Cash Flow for
        payment-date cash.
      </p>
    </div>
  );
}

function SalesByService({ rows }: { rows: ReturnType<typeof salesByService> }) {
  if (rows.length === 0) {
    return <EmptyState title="No service breakdown" description="No billed line categories in range." />;
  }
  const total = rows.reduce((s, r) => s + Math.max(0, r.amount), 0);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows.filter((r) => r.amount > 0)}
              dataKey="amount"
              nameKey="service"
              cx="50%"
              cy="50%"
              outerRadius={90}
              label={({ name }) => name}
            >
              {rows
                .filter((r) => r.amount > 0)
                .map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
            </Pie>
            <Tooltip formatter={(v) => formatReportMoney(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ReportTable headers={["Product / service", "Amount", "% of positive"]}>
        {rows.map((r) => (
          <tr key={r.service}>
            <td>{r.service}</td>
            <MoneyCell n={r.amount} />
            <td className="text-right tabular-nums opacity-70">
              {r.amount > 0 && total > 0 ? ((r.amount / total) * 100).toFixed(1) + "%" : "—"}
            </td>
          </tr>
        ))}
      </ReportTable>
    </div>
  );
}

function CashFlowReport({ cash }: { cash: ReturnType<typeof cashFlowFromPayments> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Cash received" value={formatReportMoney(cash.total)} hint={`${cash.count} payments`} />
        <StatCard
          label="Methods"
          value={cash.byMethod.length}
          hint={cash.byMethod[0] ? `Top: ${cash.byMethod[0].method}` : "—"}
        />
        <StatCard
          label="Avg payment"
          value={formatReportMoney(cash.count ? cash.total / cash.count : 0)}
        />
      </div>
      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Operating activities</h3>
        <ReportTable headers={["Activity", "Amount"]}>
          {cash.byMethod.map((m) => (
            <tr key={m.method}>
              <td className="pl-4">Collections — {m.method}</td>
              <MoneyCell n={m.amount} />
            </tr>
          ))}
          <tr className="border-t-2 font-bold">
            <td>Net cash from operations</td>
            <MoneyCell n={cash.total} bold />
          </tr>
        </ReportTable>
      </section>
      {cash.lines.length === 0 ? (
        <EmptyState title="No payments in range" description="Record payments in the Payments module." />
      ) : (
        <ReportTable headers={["Payment", "Date", "Method", "Customer", "Amount"]}>
          {cash.lines.slice(0, 40).map((p) => (
            <tr key={p.id}>
              <td className="font-mono text-xs">{p.payment_number}</td>
              <td className="tabular-nums">{p.payment_date}</td>
              <td>{p.payment_method}</td>
              <td>{(p as PaymentRow).customers?.name ?? "—"}</td>
              <MoneyCell n={Number(p.payment_amount)} />
            </tr>
          ))}
        </ReportTable>
      )}
      <p className="text-xs opacity-55">
        Cash basis uses payment date. Financing/investing sections are not modeled in this product version.
      </p>
    </div>
  );
}

function ContractProfitReport({ rows }: { rows: ReturnType<typeof contractProfitability> }) {
  if (rows.length === 0) {
    return <EmptyState title="No contracts" description="Add service contracts to analyze margins." />;
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Contract revenue" value={formatReportMoney(rows.reduce((s, r) => s + r.revenue, 0))} />
        <StatCard label="Est. cost" value={formatReportMoney(rows.reduce((s, r) => s + r.cost, 0))} />
        <StatCard label="Est. profit" value={formatReportMoney(rows.reduce((s, r) => s + r.profit, 0))} />
      </div>
      <ReportTable headers={["Contract", "Customer", "Revenue", "Est. cost", "Profit", "Margin", "Status"]}>
        {rows.map((r) => (
          <tr key={r.id} className={r.profit < 0 ? "bg-error/5" : ""}>
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
            <MoneyCell n={r.revenue} />
            <MoneyCell n={r.cost} />
            <MoneyCell n={r.profit} />
            <td className="text-right tabular-nums">{formatReportPct(r.margin)}</td>
            <td>
              <StatusBadge label={r.status} tone={statusTone(r.status)} />
            </td>
          </tr>
        ))}
      </ReportTable>
      <p className="text-xs opacity-55">Delivery cost estimated at $350 per included visit (labeled estimate).</p>
    </div>
  );
}

function JobSummaryReport({ summary }: { summary: ReturnType<typeof jobStatusSummary> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="All jobs" value={summary.total} />
        <StatCard label="Open" value={summary.open} />
        <StatCard label="Completed" value={summary.completed} />
        <StatCard
          label="Completed unbilled"
          value={summary.unbilled}
          danger={summary.unbilled > 0}
          hint="Go to Unbilled Jobs"
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">By status</h3>
          <ReportTable headers={["Status", "Count"]}>
            {summary.byStatus.map((r) => (
              <tr key={r.status}>
                <td>
                  <StatusBadge label={r.status} tone={statusTone(r.status)} />
                </td>
                <td className="text-right tabular-nums font-medium">{r.count}</td>
              </tr>
            ))}
          </ReportTable>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">By priority</h3>
          <ReportTable headers={["Priority", "Count"]}>
            {summary.byPriority.map((r) => (
              <tr key={r.priority}>
                <td>
                  <StatusBadge label={r.priority} tone={statusTone(r.priority)} />
                </td>
                <td className="text-right tabular-nums font-medium">{r.count}</td>
              </tr>
            ))}
          </ReportTable>
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
        description="Great — completed work is invoiced. Check Billing for drafts."
        action={
          <Link href="/billing" className="btn btn-primary btn-sm">
            Open billing
          </Link>
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="alert alert-warning text-sm">
        <span>
          <strong>{rows.length}</strong> completed job{rows.length === 1 ? "" : "s"} still unbilled — primary revenue
          leakage watchlist.
        </span>
      </div>
      <ReportTable headers={["Job", "Customer", "Type", "Completed", ""]}>
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
            <td className="text-right print:hidden">
              <Link href={`/billing?wo=${j.id}`} className="btn btn-primary btn-xs">
                Invoice
              </Link>
            </td>
          </tr>
        ))}
      </ReportTable>
    </div>
  );
}

function InvoiceListReport({ rows }: { rows: ReturnType<typeof invoicesInRange> }) {
  if (rows.length === 0) {
    return <EmptyState title="No invoices in range" description="Widen the date range or create invoices." />;
  }
  const total = rows.reduce((s, i) => s + Number(i.invoice_total), 0);
  const paid = rows.reduce((s, i) => s + Number(i.amount_paid), 0);
  const bal = rows.reduce((s, i) => s + Number(i.remaining_balance), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Invoices" value={rows.length} />
        <StatCard label="Billed" value={formatReportMoney(total)} />
        <StatCard label="Open balance" value={formatReportMoney(bal)} hint={`Paid ${formatReportMoney(paid)}`} />
      </div>
      <ReportTable headers={["Invoice", "Date", "Customer", "Total", "Paid", "Balance", "Status"]}>
        {rows.map((i) => (
          <tr key={i.id}>
            <td>
              <Link href={`/billing/${i.id}`} className="link link-primary font-medium">
                {i.invoice_number}
              </Link>
            </td>
            <td className="tabular-nums">{i.invoice_date}</td>
            <td>{i.customers?.name ?? "—"}</td>
            <MoneyCell n={Number(i.invoice_total)} />
            <MoneyCell n={Number(i.amount_paid)} />
            <MoneyCell n={Number(i.remaining_balance)} />
            <td>
              <StatusBadge label={i.status} tone={statusTone(i.status)} />
            </td>
          </tr>
        ))}
        <tr className="border-t-2 font-bold">
          <td colSpan={3}>Total</td>
          <MoneyCell n={total} bold />
          <MoneyCell n={paid} bold />
          <MoneyCell n={bal} bold />
          <td />
        </tr>
      </ReportTable>
    </div>
  );
}
