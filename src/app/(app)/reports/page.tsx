"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  const [contracts, setContracts] = useState<(ServiceContract & { customers?: { name: string } })[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: inv }, { data: sc }, { data: wo }] = await Promise.all([
        supabase.from("invoices").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("service_contracts").select("*, customers(name)"),
        supabase.from("work_orders").select("*"),
      ]);
      setInvoices((inv as Invoice[]) ?? []);
      setContracts((sc as typeof contracts) ?? []);
      setWorkOrders((wo as WorkOrder[]) ?? []);
    })();
  }, []);

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
  const directCost = estDirectLabor + estPartsCost;
  const profit = grossProfit(recognizedRevenue, directCost);
  const margin = profitMargin(recognizedRevenue, profit);

  const contractRows = contracts.map((c) => {
    const rev = Number(c.contract_price);
    const cost = c.included_service_visits * 350;
    const gp = grossProfit(rev, cost);
    return {
      id: c.id,
      customer_id: c.customer_id,
      customerName: c.customers?.name,
      name: c.name,
      revenue: rev,
      cost,
      profit: gp,
      margin: profitMargin(rev, gp),
      status: c.status,
    };
  });

  const openJobs = workOrders
    .filter((w) => !["Completed", "Closed", "Canceled"].includes(w.status))
    .slice(0, 6);
  const openInvoices = invoices.filter((i) => Number(i.remaining_balance) > 0).slice(0, 6);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Accounting summary and profitability analysis"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/billing" className="btn btn-outline btn-sm">
              Billing
            </Link>
            <Link href="/work-orders" className="btn btn-outline btn-sm">
              Jobs
            </Link>
            <Link href="/contracts" className="btn btn-outline btn-sm">
              Contracts
            </Link>
          </div>
        }
      />

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
        <StatCard label="Open AR" value={formatMoney(openAr)} hint="See open invoices below" />
        <StatCard label="Est. Gross Margin" value={formatPct(margin)} hint={`Profit ${formatMoney(profit)}`} />
      </div>

      <div className="mt-6 card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-base">Contract Profitability</h2>
            <Link href="/contracts" className="link link-primary text-sm">
              Manage contracts
            </Link>
          </div>
          {contractRows.length === 0 ? (
            <EmptyState title="No contract data" description="Active contracts will appear in profitability tables." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Customer</th>
                    <th>Revenue</th>
                    <th>Est. Cost</th>
                    <th>Est. Profit</th>
                    <th>Margin</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contractRows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href="/contracts" className="link link-hover font-medium">
                          {r.name}
                        </Link>
                      </td>
                      <td>
                        {r.customer_id ? (
                          <Link href={`/customers/${r.customer_id}`} className="link link-hover">
                            {r.customerName ?? "—"}
                          </Link>
                        ) : (
                          r.customerName ?? "—"
                        )}
                      </td>
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

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h2 className="card-title text-base">Open invoices</h2>
              <Link href="/billing" className="link link-primary text-sm">
                Billing
              </Link>
            </div>
            {openInvoices.length === 0 ? (
              <p className="text-sm opacity-60">No open balances.</p>
            ) : (
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <Link href={`/billing/${inv.id}`} className="link link-primary">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="text-right">{formatMoney(inv.remaining_balance)}</td>
                      <td>{inv.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h2 className="card-title text-base">Open jobs sample</h2>
              <Link href="/work-orders" className="link link-primary text-sm">
                Jobs board
              </Link>
            </div>
            {openJobs.length === 0 ? (
              <p className="text-sm opacity-60">No open jobs.</p>
            ) : (
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {openJobs.map((wo) => (
                    <tr key={wo.id}>
                      <td>
                        <Link href={`/work-orders/${wo.id}`} className="link link-primary">
                          {wo.work_order_number}
                        </Link>
                      </td>
                      <td>{wo.status}</td>
                      <td>{wo.priority}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-base">Work Order Summary</h2>
            <Link href="/work-orders" className="link link-primary text-sm">
              View jobs
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total Work Orders" value={workOrders.length} />
            <StatCard label="Completed" value={completedWo} />
            <StatCard
              label="Open"
              value={workOrders.filter((w) => !["Completed", "Closed", "Canceled"].includes(w.status)).length}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
