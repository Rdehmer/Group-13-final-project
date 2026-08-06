"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Download } from "lucide-react";
import {
  endOfMonth,
  endOfQuarter,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney, grossProfit, profitMargin, formatPct } from "@/lib/calculations";
import {
  contractEconomicsInRange,
  periodLabel,
  periodRangeFromPreset,
  TECH_HOURLY_COST,
} from "@/lib/contract-monthly-economics";
import type {
  Invoice,
  Profile,
  ServiceContract,
  WorkOrder,
} from "@/lib/types";

type HighlightColumn = "revenue" | "cost" | "margin";
type DatePreset = "all" | "month" | "quarter" | "ytd" | "custom";

type ContractRow = {
  id: string;
  name: string;
  customerId: string | null;
  customerName: string;
  revenue: number;
  cost: number;
  laborCost: number;
  partsCost: number;
  profit: number;
  margin: number | null;
  status: string;
  includedVisits: number;
  usedVisits: number;
  utilization: number | null;
  startDate: string;
  endDate: string;
};

type FilterKeys = "name" | "customer" | "status" | "visits";

const COMPLETED_WO = new Set(["Completed", "Closed"]);
const OPEN_WO = (status: string) => !["Completed", "Closed", "Canceled"].includes(status);

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter((v) => v.trim() !== ""))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function contractInDateRange(
  startDate: string,
  endDate: string,
  preset: DatePreset,
  customStart: string,
  customEnd: string,
  today: Date,
): boolean {
  if (preset === "all") return true;
  let rangeStart: Date;
  let rangeEnd: Date;
  if (preset === "month") {
    rangeStart = startOfMonth(today);
    rangeEnd = endOfMonth(today);
  } else if (preset === "quarter") {
    rangeStart = startOfQuarter(today);
    rangeEnd = endOfQuarter(today);
  } else if (preset === "ytd") {
    rangeStart = startOfYear(today);
    rangeEnd = today;
  } else {
    if (!customStart || !customEnd) return true;
    rangeStart = parseISO(customStart);
    rangeEnd = parseISO(customEnd);
  }
  try {
    const cStart = parseISO(startDate);
    const cEnd = parseISO(endDate);
    // Overlap: contract touches the selected period
    return cStart <= rangeEnd && cEnd >= rangeStart;
  } catch {
    return false;
  }
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ColumnFilterSelect({
  label,
  value,
  options,
  sortKey,
  activeSort,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  sortKey: string;
  activeSort: { column: string; direction: "asc" | "desc" };
  onChange: (value: string) => void;
}) {
  const sortingThis = activeSort.column === sortKey;
  return (
    <select
      className="select select-bordered select-xs w-full min-w-0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`Filter or sort ${label}`}
    >
      <option value="">All</option>
      <option value="__sort_asc">
        Sort A–Z{sortingThis && activeSort.direction === "asc" ? " ✓" : ""}
      </option>
      <option value="__sort_desc">
        Sort Z–A{sortingThis && activeSort.direction === "desc" ? " ✓" : ""}
      </option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

function WoJumpCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`View ${label} work orders`}
      className="stat rounded-box bg-base-100 shadow transition-colors duration-150
        cursor-pointer hover:bg-base-200/70 hover:ring-1 hover:ring-primary/30
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="stat-title">{label}</div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </div>
      <div className="stat-value text-2xl">{value}</div>
      {hint ? <div className="stat-desc">{hint}</div> : null}
      <div className="stat-desc mt-1 text-primary/80">Open work orders</div>
    </Link>
  );
}

/**
 * This business faces decision-making risk when profitability assumptions are hidden.
 * Our app reduces the risk by labeling estimates and showing accounting summaries clearly.
 */
export default function ReportsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const today = useMemo(() => new Date(), []);
  const fromContracts = searchParams.get("from") === "contracts";
  const focusFromUrl = searchParams.get("focus");

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contracts, setContracts] = useState<
    (ServiceContract & { customers?: { id: string; name: string } | null })[]
  >([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [highlight, setHighlight] = useState<HighlightColumn | null>(
    focusFromUrl === "revenue" || focusFromUrl === "cost" || focusFromUrl === "margin"
      ? focusFromUrl
      : null,
  );

  const [datePreset, setDatePreset] = useState<DatePreset>("month");
  const [customStart, setCustomStart] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(today, "yyyy-MM-dd"));

  const [laborCostAssumption, setLaborCostAssumption] = useState(45);
  const [avgHoursPerWo, setAvgHoursPerWo] = useState(2.5);
  const [marginThresholdPct, setMarginThresholdPct] = useState(20);

  const [activeFilters, setActiveFilters] = useState({
    name: "",
    customer: "",
    status: "",
    visits: "",
  });
  const [activeSort, setActiveSort] = useState<{
    column: FilterKeys | "revenue" | "cost" | "margin" | "profit" | "utilization";
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });

  const [inactiveFilters, setInactiveFilters] = useState({
    name: "",
    customer: "",
    status: "",
    visits: "",
  });
  const [inactiveSort, setInactiveSort] = useState<{
    column: FilterKeys | "revenue" | "cost" | "margin" | "profit" | "utilization";
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });

  const isManager =
    profile?.role === "service_manager" || profile?.role === "administrator";
  const lowMarginThreshold = marginThresholdPct / 100;

  useEffect(() => {
    (async () => {
      const [
        { data: inv },
        { data: sc },
        { data: wo },
        {
          data: { user },
        },
      ] = await Promise.all([
        supabase.from("invoices").select("*"),
        supabase.from("service_contracts").select("*, customers(id, name)"),
        supabase
          .from("work_orders")
          .select("id, contract_id, status, completion_date, scheduled_date, created_at"),
        supabase.auth.getUser(),
      ]);
      setInvoices((inv as Invoice[]) ?? []);
      setContracts((sc as typeof contracts) ?? []);
      setWorkOrders((wo as WorkOrder[]) ?? []);
      if (user) {
        const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
        setProfile(p as Profile);
      }
    })();
  }, []);

  useEffect(() => {
    if (focusFromUrl === "revenue" || focusFromUrl === "cost" || focusFromUrl === "margin") {
      setHighlight(focusFromUrl);
    }
  }, [focusFromUrl]);

  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById("contract-profitability");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlight, contracts]);

  const periodRange = useMemo(
    () => periodRangeFromPreset(datePreset, today, customStart, customEnd),
    [datePreset, today, customStart, customEnd],
  );

  const datedContracts = useMemo(
    () =>
      contracts.filter((c) =>
        contractInDateRange(c.start_date, c.end_date, datePreset, customStart, customEnd, today),
      ),
    [contracts, datePreset, customStart, customEnd, today],
  );

  function toRow(c: (typeof contracts)[number]): ContractRow {
    const econ = contractEconomicsInRange(c, workOrders, periodRange);
    return {
      id: c.id,
      name: c.name,
      customerId: c.customers?.id ?? c.customer_id ?? null,
      customerName: c.customers?.name ?? "—",
      revenue: econ.monthlyRevenue,
      cost: econ.directCost,
      laborCost: econ.laborCost,
      partsCost: econ.partsCost,
      profit: econ.profit,
      margin: econ.margin,
      status: c.status,
      includedVisits: econ.includedVisits,
      usedVisits: econ.usedVisits,
      utilization:
        econ.includedVisits > 0
          ? econ.usedVisits / econ.includedVisits
          : econ.usedVisits > 0
            ? null
            : 0,
      startDate: c.start_date,
      endDate: c.end_date,
    };
  }

  const activeRowsBase = useMemo(
    () => datedContracts.filter((c) => c.status === "Active").map(toRow),
    [datedContracts, workOrders, periodRange],
  );

  const inactiveRowsBase = useMemo(
    () => datedContracts.filter((c) => c.status !== "Active").map(toRow),
    [datedContracts, workOrders, periodRange],
  );

  function applyTableFilters(
    rows: ContractRow[],
    filters: typeof activeFilters,
    sort: typeof activeSort,
  ) {
    const filtered = rows.filter((r) => {
      if (filters.name && r.name !== filters.name) return false;
      if (filters.customer && r.customerName !== filters.customer) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.visits) {
        const label = `${r.usedVisits}/${r.includedVisits}`;
        if (label !== filters.visits) return false;
      }
      return true;
    });

    const valueFor = (r: ContractRow): string | number => {
      switch (sort.column) {
        case "customer":
          return r.customerName;
        case "status":
          return r.status;
        case "visits":
          return r.usedVisits;
        case "revenue":
          return r.revenue;
        case "cost":
          return r.cost;
        case "profit":
          return r.profit;
        case "margin":
          return r.margin ?? -999;
        case "utilization":
          return r.utilization ?? -999;
        case "name":
        default:
          return r.name;
      }
    };

    return [...filtered].sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }

  const contractRows = useMemo(
    () => applyTableFilters(activeRowsBase, activeFilters, activeSort),
    [activeRowsBase, activeFilters, activeSort],
  );

  const inactiveContractRows = useMemo(
    () => applyTableFilters(inactiveRowsBase, inactiveFilters, inactiveSort),
    [inactiveRowsBase, inactiveFilters, inactiveSort],
  );

  const totals = useMemo(() => {
    const revenue = contractRows.reduce((s, r) => s + r.revenue, 0);
    const cost = contractRows.reduce((s, r) => s + r.cost, 0);
    const profit = contractRows.reduce((s, r) => s + r.profit, 0);
    return {
      revenue,
      cost,
      profit,
      margin: profitMargin(revenue, profit),
    };
  }, [contractRows]);

  const activeContractRevenue = totals.revenue;
  const activeContractDirectCost = totals.cost;
  const activeContractProfit = totals.profit;
  const activeContractMargin = totals.margin;

  const recognizedRevenue = invoices
    .filter((i) => !["Draft", "Canceled"].includes(i.status))
    .reduce((s, i) => s + Number(i.invoice_total), 0);
  const collected = invoices.reduce((s, i) => s + Number(i.amount_paid), 0);
  const openAr = invoices.reduce((s, i) => s + Number(i.remaining_balance), 0);
  const completedWo = workOrders.filter((w) => COMPLETED_WO.has(w.status)).length;
  const openWo = workOrders.filter((w) => OPEN_WO(w.status)).length;
  const estDirectLabor = completedWo * avgHoursPerWo * laborCostAssumption;
  const estPartsCost = invoices.reduce((s, i) => s + Number(i.parts_charges) * 0.6, 0);
  const invoiceDirectCost = estDirectLabor + estPartsCost;
  const invoiceProfit = grossProfit(recognizedRevenue, invoiceDirectCost);
  const invoiceMargin = profitMargin(recognizedRevenue, invoiceProfit);

  const lowMarginCount = contractRows.filter(
    (r) => r.margin !== null && r.margin < lowMarginThreshold,
  ).length;

  function selectHighlight(column: HighlightColumn) {
    setHighlight((prev) => (prev === column ? null : column));
    window.setTimeout(() => {
      document
        .getElementById("contract-profitability")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function cellClass(column: HighlightColumn) {
    if (!highlight) return "";
    if (highlight === column) {
      return "bg-warning/30 font-semibold text-base-content";
    }
    return "bg-base-100 text-base-content/50";
  }

  function isLowMargin(r: ContractRow) {
    return r.margin !== null && r.margin < lowMarginThreshold;
  }

  function onActiveFilter(column: FilterKeys, value: string) {
    if (value === "__sort_asc") {
      setActiveSort({ column, direction: "asc" });
      return;
    }
    if (value === "__sort_desc") {
      setActiveSort({ column, direction: "desc" });
      return;
    }
    setActiveFilters((prev) => ({ ...prev, [column]: value }));
  }

  function onInactiveFilter(column: FilterKeys, value: string) {
    if (value === "__sort_asc") {
      setInactiveSort({ column, direction: "asc" });
      return;
    }
    if (value === "__sort_desc") {
      setInactiveSort({ column, direction: "desc" });
      return;
    }
    setInactiveFilters((prev) => ({ ...prev, [column]: value }));
  }

  function onNumericSort(
    which: "active" | "inactive",
    column: "revenue" | "cost" | "margin" | "profit" | "utilization",
  ) {
    if (which === "active") {
      setActiveSort((prev) =>
        prev.column === column
          ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
          : { column, direction: "desc" },
      );
    } else {
      setInactiveSort((prev) =>
        prev.column === column
          ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
          : { column, direction: "desc" },
      );
    }
  }

  function exportRows(filename: string, rows: ContractRow[]) {
    downloadCsv(
      filename,
      [
        "Contract",
        "Customer",
        "Status",
        "Start",
        "End",
        "Monthly Fee",
        "Direct Cost",
        "Labor Cost",
        "Parts Cost",
        "Gross Profit",
        "Margin %",
        "Included Visits",
        "Used Visits",
        "Utilization %",
      ],
      rows.map((r) => [
        r.name,
        r.customerName,
        r.status,
        r.startDate,
        r.endDate,
        r.revenue,
        r.cost,
        r.laborCost,
        r.partsCost,
        r.profit,
        r.margin !== null ? (r.margin * 100).toFixed(1) : "",
        r.includedVisits,
        r.usedVisits,
        r.utilization !== null ? (r.utilization * 100).toFixed(1) : "",
      ]),
    );
  }

  function SegmentButton({
    column,
    label,
    value,
    hint,
  }: {
    column: HighlightColumn;
    label: string;
    value: string;
    hint?: string;
  }) {
    const selected = highlight === column;
    return (
      <button
        type="button"
        id={`report-${column}`}
        onClick={() => selectHighlight(column)}
        aria-pressed={selected}
        aria-label={`Highlight ${label} column in contract profitability`}
        className={`stat w-full rounded-box bg-base-100 text-left shadow transition-colors duration-150
          cursor-pointer hover:bg-base-200/70 hover:ring-1 hover:ring-primary/30
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
          ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-base-100" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="stat-title">{label}</div>
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </div>
        <div className="stat-value text-2xl">{value}</div>
        {hint ? <div className="stat-desc">{hint}</div> : null}
        <div className="stat-desc mt-1 text-primary/80">
          {selected ? "Column highlighted — click to clear" : "Highlight in table"}
        </div>
      </button>
    );
  }

  function ProfitabilityTable({
    rows,
    filters,
    sort,
    onFilter,
    which,
    showTotals,
  }: {
    rows: ContractRow[];
    filters: typeof activeFilters;
    sort: typeof activeSort;
    onFilter: (column: FilterKeys, value: string) => void;
    which: "active" | "inactive";
    showTotals: boolean;
  }) {
    const base = which === "active" ? activeRowsBase : inactiveRowsBase;
    const options = {
      name: uniqueSorted(base.map((r) => r.name)),
      customer: uniqueSorted(base.map((r) => r.customerName)),
      status: uniqueSorted(base.map((r) => r.status)),
      visits: uniqueSorted(base.map((r) => `${r.usedVisits}/${r.includedVisits}`)),
    };

    const sortHint = (col: string) =>
      sort.column === col ? (sort.direction === "asc" ? " ↑" : " ↓") : "";

    return (
      <DualHorizontalScroll>
        <table className="table">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Customer</th>
              <th
                className={`cursor-pointer ${highlight === "revenue" ? "bg-warning/30" : ""}`}
                onClick={() => onNumericSort(which, "revenue")}
              >
                  Monthly fee{sortHint("revenue")}
              </th>
              <th
                className={`cursor-pointer ${highlight === "cost" ? "bg-warning/30" : ""}`}
                onClick={() => onNumericSort(which, "cost")}
              >
                Direct Cost{sortHint("cost")}
              </th>
              <th className="cursor-pointer" onClick={() => onNumericSort(which, "profit")}>
                Gross Profit{sortHint("profit")}
              </th>
              <th
                className={`cursor-pointer ${highlight === "margin" ? "bg-warning/30" : ""}`}
                onClick={() => onNumericSort(which, "margin")}
              >
                Margin{sortHint("margin")}
              </th>
              <th className="cursor-pointer" onClick={() => onNumericSort(which, "utilization")}>
                Visits (used/incl.){sortHint("utilization")}
              </th>
              <th>Status</th>
            </tr>
            <tr className="bg-base-200/50">
              <th className="font-normal">
                <ColumnFilterSelect
                  label="contract"
                  value={filters.name}
                  options={options.name}
                  sortKey="name"
                  activeSort={sort}
                  onChange={(v) => onFilter("name", v)}
                />
              </th>
              <th className="font-normal">
                <ColumnFilterSelect
                  label="customer"
                  value={filters.customer}
                  options={options.customer}
                  sortKey="customer"
                  activeSort={sort}
                  onChange={(v) => onFilter("customer", v)}
                />
              </th>
              <th />
              <th />
              <th />
              <th />
              <th className="font-normal">
                <ColumnFilterSelect
                  label="visits"
                  value={filters.visits}
                  options={options.visits}
                  sortKey="visits"
                  activeSort={sort}
                  onChange={(v) => onFilter("visits", v)}
                />
              </th>
              <th className="font-normal">
                <ColumnFilterSelect
                  label="status"
                  value={filters.status}
                  options={options.status}
                  sortKey="status"
                  activeSort={sort}
                  onChange={(v) => onFilter("status", v)}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={
                  isLowMargin(r)
                    ? r.margin !== null && r.margin < 0
                      ? "bg-error/15"
                      : "bg-warning/15"
                    : undefined
                }
              >
                <td>
                  <Link href={`/contracts/${r.id}`} className="link link-primary font-medium">
                    {r.name}
                  </Link>
                  {isLowMargin(r) ? (
                    <span className="ml-2 badge badge-warning badge-xs">
                      {r.margin !== null && r.margin < 0 ? "Loss" : "Low margin"}
                    </span>
                  ) : null}
                </td>
                <td>
                  {r.customerId ? (
                    <Link href={`/customers/${r.customerId}`} className="link link-primary">
                      {r.customerName}
                    </Link>
                  ) : (
                    r.customerName
                  )}
                </td>
                <td className={cellClass("revenue")}>{formatMoney(r.revenue)}</td>
                <td className={cellClass("cost")}>
                  <div>{formatMoney(r.cost)}</div>
                  <div className="text-xs font-normal opacity-60">
                    L {formatMoney(r.laborCost)} · P {formatMoney(r.partsCost)}
                  </div>
                </td>
                <td className={highlight ? "bg-base-100 text-base-content/50" : ""}>
                  {formatMoney(r.profit)}
                </td>
                <td className={cellClass("margin")}>{formatPct(r.margin)}</td>
                <td>
                  <span className={r.usedVisits > r.includedVisits ? "text-warning font-medium" : ""}>
                    {r.usedVisits}/{r.includedVisits}
                  </span>
                  <span className="ml-1 text-xs opacity-60">
                    ({r.utilization !== null ? formatPct(r.utilization) : "N/A"})
                  </span>
                </td>
                <td>
                  <StatusBadge label={r.status} tone={statusTone(r.status)} />
                </td>
              </tr>
            ))}
          </tbody>
          {showTotals ? (
            <tfoot>
              <tr className="border-t-2 border-base-300 font-semibold">
                <td colSpan={2}>Total</td>
                <td className={cellClass("revenue")}>{formatMoney(totals.revenue)}</td>
                <td className={cellClass("cost")}>{formatMoney(totals.cost)}</td>
                <td className={highlight ? "bg-base-100 text-base-content/50" : ""}>
                  {formatMoney(totals.profit)}
                </td>
                <td className={cellClass("margin")}>{formatPct(totals.margin)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </DualHorizontalScroll>
    );
  }

  return (
    <div>
      <PageHeader
        title="Contract profitability"
        description="Monthly fee vs planned direct cost (labor @ $42/hr + parts ÷ 12)"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/reports" className="btn btn-ghost btn-sm">
              ← Financial Reports
            </Link>
            {isManager ? (
              <Link href="/reports/invoice-cash" className="btn btn-outline btn-sm">
                Invoice & Cash
              </Link>
            ) : null}
            {fromContracts ? (
              <Link href="/contracts" className="btn btn-ghost btn-sm">
                ← Back to Contracts
              </Link>
            ) : null}
          </div>
        }
      />

      {profile && !isManager ? (
        <div className="mt-6">
          <EmptyState
            title="Manager / admin only"
            description="Monthly contract revenue and direct costs are available to service managers and administrators."
            action={
              <Link href="/dashboard" className="btn btn-sm">
                Back to dashboard
              </Link>
            }
          />
        </div>
      ) : null}

      {!profile || !isManager ? null : (
        <>
      {fromContracts ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-box border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>Opened from Contracts summary.</span>
          <Link href="/contracts" className="btn btn-ghost btn-xs">
            ← Back to Contracts
          </Link>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-box bg-base-100 p-4 text-sm shadow">
        <div>
          <p className="mb-1 font-semibold">Date range</p>
          <p className="mb-2 text-xs opacity-60">
            Contracts overlapping the period · monthly fee vs planned monthly direct cost (
            {periodLabel(periodRange, today)})
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All time"],
                ["month", "This month"],
                ["quarter", "This quarter"],
                ["ytd", "YTD"],
                ["custom", "Custom"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`btn btn-xs ${datePreset === key ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setDatePreset(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {datePreset === "custom" ? (
          <div className="flex flex-wrap gap-2">
            <label className="form-control">
              <span className="label-text text-xs">From</span>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">To</span>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn-outline btn-sm gap-1"
          onClick={() => {
            exportRows(`active-contracts-${format(today, "yyyy-MM-dd")}.csv`, contractRows);
            if (isManager) {
              exportRows(
                `non-active-contracts-${format(today, "yyyy-MM-dd")}.csv`,
                inactiveContractRows,
              );
            }
          }}
        >
          <Download className="h-4 w-4" aria-hidden />
          Export CSV
        </button>
      </div>

      <div className="mb-4 rounded-box bg-base-100 p-4 text-sm shadow">
        <p className="font-semibold">How monthly profit is measured</p>
        <p className="mt-1 text-xs opacity-60">
          Revenue is the contract Monthly fee. Direct cost spreads included labor hours and parts
          allowance across the year at ${TECH_HOURLY_COST}/hr for techs.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {!isManager ? (
            <>
              <label className="form-control">
                <span className="label-text text-xs">Labor cost ($/hr) — invoice what-if</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="input input-bordered input-sm"
                  value={laborCostAssumption}
                  onChange={(e) => setLaborCostAssumption(Number(e.target.value) || 0)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-xs">Avg hours / completed WO — invoice what-if</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className="input input-bordered input-sm"
                  value={avgHoursPerWo}
                  onChange={(e) => setAvgHoursPerWo(Number(e.target.value) || 0)}
                />
              </label>
            </>
          ) : null}
          <label className="form-control">
            <span className="label-text text-xs">Low-margin flag below (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              className="input input-bordered input-sm"
              value={marginThresholdPct}
              onChange={(e) => setMarginThresholdPct(Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <ul className="mt-3 list-inside list-disc opacity-80">
          <li>Revenue = Monthly fee on the contract</li>
          <li>
            Direct cost / month = (included labor hours × ${TECH_HOURLY_COST} + parts allowance) ÷ 12
          </li>
          <li>
            Visits are for utilization only (labor hours already cover visit work — not double-counted)
          </li>
          <li>Click summary cards to highlight Monthly fee, Direct Cost, or Margin in the table</li>
        </ul>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-medium opacity-70">
        <span>Contract summary · {periodLabel(periodRange, today)}</span>
        {lowMarginCount > 0 ? (
          <span className="badge badge-warning badge-sm font-normal">
            {lowMarginCount} active contract(s) below {marginThresholdPct}% margin
          </span>
        ) : null}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SegmentButton
          column="revenue"
          label="Monthly Fee Revenue"
          value={formatMoney(activeContractRevenue)}
          hint="Sum of contract monthly fees"
        />
        <SegmentButton
          column="cost"
          label="Monthly Direct Cost"
          value={formatMoney(activeContractDirectCost)}
          hint={`Labor @ $${TECH_HOURLY_COST}/hr + parts ÷ 12`}
        />
        <SegmentButton
          column="margin"
          label="Gross Margin"
          value={formatPct(activeContractMargin)}
          hint={`Profit ${formatMoney(activeContractProfit)}`}
        />
      </div>

      {!isManager ? (
        <>
          <div className="mb-2 text-sm font-medium opacity-70">Invoice & cash summary</div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              className="stat w-full cursor-pointer rounded-box bg-base-100 text-left shadow transition hover:bg-base-200/70"
              onClick={() =>
                document
                  .getElementById("contract-profitability")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <div className="stat-title">Recognized Revenue</div>
              <div className="stat-value text-2xl">{formatMoney(recognizedRevenue)}</div>
            </button>
            <button
              type="button"
              className="stat w-full cursor-pointer rounded-box bg-base-100 text-left shadow transition hover:bg-base-200/70"
              onClick={() =>
                document
                  .getElementById("contract-profitability")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <div className="stat-title">Cash Collected</div>
              <div className="stat-value text-2xl">{formatMoney(collected)}</div>
            </button>
            <button
              type="button"
              className="stat w-full cursor-pointer rounded-box bg-base-100 text-left shadow transition hover:bg-base-200/70"
              onClick={() =>
                document
                  .getElementById("contract-profitability")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <div className="stat-title">Open AR</div>
              <div className="stat-value text-2xl">{formatMoney(openAr)}</div>
            </button>
            <button
              type="button"
              className="stat w-full cursor-pointer rounded-box bg-base-100 text-left shadow transition hover:bg-base-200/70"
              onClick={() =>
                document
                  .getElementById("contract-profitability")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <div className="stat-title">Invoice Est. Gross Margin</div>
              <div className="stat-value text-2xl">{formatPct(invoiceMargin)}</div>
              <div className="stat-desc">Profit {formatMoney(invoiceProfit)}</div>
            </button>
          </div>
        </>
      ) : null}

      <div id="contract-profitability" className="card scroll-mt-4 bg-base-100 shadow">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="card-title text-base">
              {isManager ? "Active Contract Profitability" : "Contract Profitability"}
            </h2>
            <div className="flex flex-wrap gap-2">
              {highlight ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setHighlight(null)}
                >
                  Clear highlight
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-xs gap-1"
                onClick={() =>
                  exportRows(`active-contracts-${format(today, "yyyy-MM-dd")}.csv`, contractRows)
                }
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export
              </button>
            </div>
          </div>
          {contractRows.length === 0 ? (
            <EmptyState
              title="No active contracts"
              description="Active contracts in this date range will appear here."
            />
          ) : (
            <ProfitabilityTable
              rows={contractRows}
              filters={activeFilters}
              sort={activeSort}
              onFilter={onActiveFilter}
              which="active"
              showTotals
            />
          )}
        </div>
      </div>

      {isManager ? (
        <div className="mt-6 card bg-base-100 shadow">
          <div className="card-body">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="card-title text-base">Non-Active Contracts</h2>
                <p className="text-sm opacity-70">
                  Draft, pending approval, expired, canceled, and other non-active agreements.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs gap-1"
                onClick={() =>
                  exportRows(
                    `non-active-contracts-${format(today, "yyyy-MM-dd")}.csv`,
                    inactiveContractRows,
                  )
                }
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export
              </button>
            </div>
            {inactiveContractRows.length === 0 ? (
              <EmptyState
                title="No non-active contracts"
                description="Non-active agreements in this date range will appear here."
              />
            ) : (
              <ProfitabilityTable
                rows={inactiveContractRows}
                filters={inactiveFilters}
                sort={inactiveSort}
                onFilter={onInactiveFilter}
                which="inactive"
                showTotals={false}
              />
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-6 card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">Related operations</h2>
          <p className="text-sm opacity-70">
            Jump to work orders that drive contract utilization and service cost.
          </p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <WoJumpCard label="All work orders" value={workOrders.length} href="/work-orders" />
            <WoJumpCard
              label="Completed"
              value={completedWo}
              hint="Completed or closed"
              href="/work-orders?filter=completed"
            />
            <WoJumpCard label="Open" value={openWo} href="/work-orders?filter=open" />
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
