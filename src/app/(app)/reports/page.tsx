"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney, grossProfit, profitMargin, formatPct } from "@/lib/calculations";
import type { Invoice, ServiceContract, WorkOrder } from "@/lib/types";

type HighlightColumn = "revenue" | "cost" | "margin";

/**
 * This business faces decision-making risk when profitability assumptions are hidden.
 * Our app reduces the risk by labeling estimates and showing accounting summaries clearly.
 */
export default function ReportsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const fromContracts = searchParams.get("from") === "contracts";
  const focusFromUrl = searchParams.get("focus");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contracts, setContracts] = useState<ServiceContract[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [highlight, setHighlight] = useState<HighlightColumn | null>(
    focusFromUrl === "revenue" || focusFromUrl === "cost" || focusFromUrl === "margin"
      ? focusFromUrl
      : null,
  );

  useEffect(() => {
    (async () => {
      const [{ data: inv }, { data: sc }, { data: wo }] = await Promise.all([
        supabase.from("invoices").select("*"),
        supabase.from("service_contracts").select("*"),
        supabase.from("work_orders").select("*"),
      ]);
      setInvoices((inv as Invoice[]) ?? []);
      setContracts((sc as ServiceContract[]) ?? []);
      setWorkOrders((wo as WorkOrder[]) ?? []);
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

  const recognizedRevenue = invoices
    .filter((i) => !["Draft", "Canceled"].includes(i.status))
    .reduce((s, i) => s + Number(i.invoice_total), 0);
  const collected = invoices.reduce((s, i) => s + Number(i.amount_paid), 0);
  const openAr = invoices.reduce((s, i) => s + Number(i.remaining_balance), 0);

  const laborCostAssumption = 45;
  const avgHoursPerWo = 2.5;
  const completedWo = workOrders.filter((w) => ["Completed", "Closed"].includes(w.status)).length;
  const estDirectLabor = completedWo * avgHoursPerWo * laborCostAssumption;
  const estPartsCost = invoices.reduce((s, i) => s + Number(i.parts_charges) * 0.6, 0);
  const invoiceDirectCost = estDirectLabor + estPartsCost;
  const invoiceProfit = grossProfit(recognizedRevenue, invoiceDirectCost);
  const invoiceMargin = profitMargin(recognizedRevenue, invoiceProfit);

  const activeContracts = contracts.filter((c) => c.status === "Active");
  const contractVisitCost = 350;
  const activeContractRevenue = activeContracts.reduce((s, c) => s + Number(c.contract_price), 0);
  const activeContractDirectCost = activeContracts.reduce(
    (s, c) => s + c.included_service_visits * contractVisitCost,
    0,
  );
  const activeContractProfit = grossProfit(activeContractRevenue, activeContractDirectCost);
  const activeContractMargin = profitMargin(activeContractRevenue, activeContractProfit);

  const contractRows = useMemo(
    () =>
      contracts
        .filter((c) => c.status === "Active")
        .map((c) => {
          const rev = Number(c.contract_price);
          const cost = c.included_service_visits * contractVisitCost;
          const gp = grossProfit(rev, cost);
          return {
            id: c.id,
            name: c.name,
            revenue: rev,
            cost,
            profit: gp,
            margin: profitMargin(rev, gp),
            status: c.status,
          };
        }),
    [contracts],
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

  function selectHighlight(column: HighlightColumn) {
    setHighlight((prev) => (prev === column ? null : column));
  }

  function cellClass(column: HighlightColumn) {
    if (!highlight) return "";
    if (highlight === column) {
      return "bg-warning/30 font-semibold text-base-content";
    }
    return "bg-base-100 text-base-content/50";
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

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Accounting summary and profitability analysis"
        actions={
          fromContracts ? (
            <Link href="/contracts" className="btn btn-ghost btn-sm">
              ← Back to Contracts
            </Link>
          ) : undefined
        }
      />

      {fromContracts ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-box border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>Opened from Contracts summary.</span>
          <Link href="/contracts" className="btn btn-ghost btn-xs">
            ← Back to Contracts
          </Link>
        </div>
      ) : null}

      <div className="mb-4 rounded-box bg-base-100 p-4 text-sm shadow">
        <p className="font-semibold">Assumptions (clearly labeled)</p>
        <ul className="mt-2 list-inside list-disc opacity-80">
          <li>Labor cost rate: ${laborCostAssumption}/hr for direct cost estimates</li>
          <li>Average {avgHoursPerWo} billable hours per completed work order</li>
          <li>Parts direct cost estimated at 60% of billed parts charges</li>
          <li>Contract visit cost estimated at ${contractVisitCost} per included visit</li>
          <li>
            Contract Est. Direct Cost / Est. Gross Margin use Active contracts only (same as Contracts
            tab)
          </li>
        </ul>
      </div>

      <div className="mb-2 text-sm font-medium opacity-70">Contract summary (matches Contracts tab)</div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SegmentButton
          column="revenue"
          label="Active Contract Revenue"
          value={formatMoney(activeContractRevenue)}
        />
        <SegmentButton
          column="cost"
          label="Est. Direct Cost"
          value={formatMoney(activeContractDirectCost)}
          hint={`Assumes $${contractVisitCost}/visit avg`}
        />
        <SegmentButton
          column="margin"
          label="Est. Gross Margin"
          value={formatPct(activeContractMargin)}
          hint={`Profit ${formatMoney(activeContractProfit)}`}
        />
      </div>

      <div className="mb-2 text-sm font-medium opacity-70">Invoice & cash summary</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Recognized Revenue" value={formatMoney(recognizedRevenue)} />
        <StatCard label="Cash Collected" value={formatMoney(collected)} />
        <StatCard label="Open AR" value={formatMoney(openAr)} />
        <StatCard
          label="Invoice Est. Gross Margin"
          value={formatPct(invoiceMargin)}
          hint={`Profit ${formatMoney(invoiceProfit)}`}
        />
      </div>

      <div id="contract-profitability" className="mt-6 card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="card-title text-base">Contract Profitability</h2>
            {highlight ? (
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setHighlight(null)}>
                Clear highlight
              </button>
            ) : null}
          </div>
          {contractRows.length === 0 ? (
            <EmptyState
              title="No active contracts"
              description="Active contracts will appear in profitability tables."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th className={highlight === "revenue" ? "bg-warning/30" : ""}>Revenue</th>
                    <th className={highlight === "cost" ? "bg-warning/30" : ""}>Est. Cost</th>
                    <th>Est. Profit</th>
                    <th className={highlight === "margin" ? "bg-warning/30" : ""}>Margin</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contractRows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.name}</td>
                      <td className={cellClass("revenue")}>{formatMoney(r.revenue)}</td>
                      <td className={cellClass("cost")}>{formatMoney(r.cost)}</td>
                      <td className={highlight ? "bg-base-100 text-base-content/50" : ""}>
                        {formatMoney(r.profit)}
                      </td>
                      <td className={cellClass("margin")}>{formatPct(r.margin)}</td>
                      <td>
                        <StatusBadge label={r.status} tone={statusTone(r.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-base-300 font-semibold">
                    <td>Total</td>
                    <td className={cellClass("revenue")}>{formatMoney(totals.revenue)}</td>
                    <td className={cellClass("cost")}>{formatMoney(totals.cost)}</td>
                    <td className={highlight ? "bg-base-100 text-base-content/50" : ""}>
                      {formatMoney(totals.profit)}
                    </td>
                    <td className={cellClass("margin")}>{formatPct(totals.margin)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">Work Order Summary</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total Work Orders" value={workOrders.length} />
            <StatCard label="Completed" value={completedWo} />
            <StatCard
              label="Open"
              value={
                workOrders.filter((w) => !["Completed", "Closed", "Canceled"].includes(w.status))
                  .length
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
