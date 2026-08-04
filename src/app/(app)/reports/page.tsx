"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, EmptyState } from "@/components/ui";
import { formatMoney, grossProfit, profitMargin, formatPct } from "@/lib/calculations";
import type { Invoice, ServiceContract, WorkOrder } from "@/lib/types";

/**
 * This business faces decision-making risk when profitability assumptions are hidden.
 * Our app reduces the risk by labeling estimates and showing accounting summaries clearly.
 */
export default function ReportsPage() {
  const supabase = createClient();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contracts, setContracts] = useState<ServiceContract[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

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

  const recognizedRevenue = invoices.filter((i) => !["Draft", "Canceled"].includes(i.status)).reduce((s, i) => s + Number(i.invoice_total), 0);
  const collected = invoices.reduce((s, i) => s + Number(i.amount_paid), 0);
  const openAr = invoices.reduce((s, i) => s + Number(i.remaining_balance), 0);

  const laborCostAssumption = 45;
  const avgHoursPerWo = 2.5;
  const completedWo = workOrders.filter((w) => ["Completed", "Closed"].includes(w.status)).length;
  const estDirectLabor = completedWo * avgHoursPerWo * laborCostAssumption;
  const estPartsCost = invoices.reduce((s, i) => s + Number(i.parts_charges) * 0.6, 0);
  const directCost = estDirectLabor + estPartsCost;
  const profit = grossProfit(recognizedRevenue, directCost);
  const margin = profitMargin(recognizedRevenue, profit);

  const contractRows = contracts.map((c) => {
    const rev = Number(c.contract_price);
    const cost = c.included_service_visits * 350;
    const gp = grossProfit(rev, cost);
    return { name: c.name, revenue: rev, cost, profit: gp, margin: profitMargin(rev, gp), status: c.status };
  });

  return (
    <div>
      <PageHeader title="Reports" description="Accounting summary and profitability analysis" />

      <div className="mb-4 rounded-box bg-base-100 p-4 text-sm shadow">
        <p className="font-semibold">Assumptions (clearly labeled)</p>
        <ul className="mt-2 list-inside list-disc opacity-80">
          <li>Labor cost rate: ${laborCostAssumption}/hr for direct cost estimates</li>
          <li>Average {avgHoursPerWo} billable hours per completed work order</li>
          <li>Parts direct cost estimated at 60% of billed parts charges</li>
          <li>Contract visit cost estimated at $350 per included visit</li>
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Recognized Revenue" value={formatMoney(recognizedRevenue)} />
        <StatCard label="Cash Collected" value={formatMoney(collected)} />
        <StatCard label="Open AR" value={formatMoney(openAr)} />
        <StatCard label="Est. Gross Margin" value={formatPct(margin)} hint={`Profit ${formatMoney(profit)}`} />
      </div>

      <div className="mt-6 card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">Contract Profitability</h2>
          {contractRows.length === 0 ? (
            <EmptyState title="No contract data" description="Active contracts will appear in profitability tables." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Contract</th><th>Revenue</th><th>Est. Cost</th><th>Est. Profit</th><th>Margin</th><th>Status</th></tr></thead>
                <tbody>
                  {contractRows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td>{formatMoney(r.revenue)}</td>
                      <td>{formatMoney(r.cost)}</td>
                      <td>{formatMoney(r.profit)}</td>
                      <td>{formatPct(r.margin)}</td>
                      <td>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
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
            <StatCard label="Open" value={workOrders.filter((w) => !["Completed", "Closed", "Canceled"].includes(w.status)).length} />
          </div>
        </div>
      </div>
    </div>
  );
}
