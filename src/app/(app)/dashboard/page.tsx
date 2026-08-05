import Link from "next/link";
import { format, subMonths, startOfMonth } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { DashboardCharts } from "@/components/DashboardCharts";
import { formatMoney } from "@/lib/calculations";
import { relatedName } from "@/lib/relations";

/**
 * This business faces operational blind-spot risk when managers lack real-time visibility.
 * Our app reduces the risk by surfacing open work, revenue, and contract health on one dashboard.
 */
export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { count: customerCount },
    { count: openWoCount },
    { count: criticalCount },
    { data: openWorkOrders },
    { data: allScheduledWo },
    { data: invoices },
    { data: contracts },
    { data: allParts },
  ] = await Promise.all([
    supabase.from("customers").select("*", { count: "exact", head: true }).eq("status", "Active"),
    supabase
      .from("work_orders")
      .select("*", { count: "exact", head: true })
      .not("status", "in", '("Completed","Closed","Canceled")'),
    supabase
      .from("work_orders")
      .select("*", { count: "exact", head: true })
      .in("priority", ["Critical", "High"])
      .not("status", "in", '("Completed","Closed","Canceled")'),
    supabase
      .from("work_orders")
      .select("id, work_order_number, priority, status, scheduled_date, customers(name)")
      .not("status", "in", '("Completed","Closed","Canceled")')
      .order("scheduled_date", { ascending: true })
      .limit(8),
    supabase.from("work_orders").select("scheduled_date"),
    supabase.from("invoices").select("invoice_date, invoice_total, status"),
    supabase.from("service_contracts").select("id, name, status, end_date, contract_price"),
    supabase.from("parts").select("id, name, part_number, quantity_on_hand, reorder_level").eq("is_active", true),
  ]);

  const lowStockParts = (allParts ?? []).filter((p) => p.quantity_on_hand <= p.reorder_level).slice(0, 5);

  const months = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(new Date(), 5 - i)));
  const workOrderTrend = months.map((m) => ({
    month: format(m, "MMM"),
    count: (allScheduledWo ?? []).filter((wo) => wo.scheduled_date?.startsWith(format(m, "yyyy-MM"))).length,
  }));

  const revenueByMonth = months.map((m) => {
    const key = format(m, "yyyy-MM");
    const revenue = (invoices ?? [])
      .filter((inv) => inv.invoice_date?.startsWith(key))
      .reduce((sum, inv) => sum + Number(inv.invoice_total), 0);
    return { month: format(m, "MMM"), revenue };
  });

  const activeContracts = (contracts ?? []).filter((c) => c.status === "Active").length;
  const expiringSoon = (contracts ?? []).filter((c) => {
    if (!c.end_date) return false;
    const end = new Date(c.end_date);
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    return end <= in30 && c.status === "Active";
  });

  const arBalance = (invoices ?? [])
    .filter((i) => !["Paid", "Canceled"].includes(i.status))
    .reduce((s, i) => s + Number(i.invoice_total), 0);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Operations overview for Ridley Equipment Services"
        actions={
          <Link href="/work-orders" className="btn btn-primary btn-sm">
            Book job
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Customers" value={customerCount ?? 0} />
        <StatCard label="Open Jobs" value={openWoCount ?? 0} hint={`${criticalCount ?? 0} high/critical`} />
        <StatCard label="Active Contracts" value={activeContracts} hint={`${expiringSoon.length} expiring soon`} />
        <StatCard label="Open AR" value={formatMoney(arBalance)} danger={arBalance > 0} />
      </div>

      <div className="mt-6">
        <DashboardCharts workOrderTrend={workOrderTrend} revenueByMonth={revenueByMonth} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Action Required — Jobs</h2>
            {(openWorkOrders ?? []).length === 0 ? (
              <EmptyState title="No open jobs" description="Book a job to get started." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Job #</th>
                      <th>Customer</th>
                      <th>Priority</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(openWorkOrders ?? []).map((wo) => {
                      const urgent = ["Critical", "High"].includes(wo.priority);
                      return (
                        <tr key={wo.id} className={urgent ? "bg-error/10" : ""}>
                          <td>
                            <Link href={`/work-orders/${wo.id}`} className="link link-primary">
                              {wo.work_order_number}
                            </Link>
                          </td>
                          <td>{relatedName(wo.customers)}</td>
                          <td>
                            <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                          </td>
                          <td>
                            <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Low Stock Parts</h2>
            {(lowStockParts ?? []).length === 0 ? (
              <EmptyState title="Inventory looks good" description="No parts at or below reorder level." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Part</th>
                      <th>On Hand</th>
                      <th>Reorder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lowStockParts ?? []).map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.part_number} — {p.name}
                        </td>
                        <td>
                          <StatusBadge label={String(p.quantity_on_hand)} tone="warning" />
                        </td>
                        <td>{p.reorder_level}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
