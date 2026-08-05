import Link from "next/link";
import { format, subMonths, startOfMonth, isBefore, parseISO, startOfDay } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { ClickableStatCard, ClickableSectionCard } from "@/components/ClickableStatCard";
import { DashboardCharts, type InvoiceActivityPoint } from "@/components/DashboardCharts";
import { formatMoney } from "@/lib/calculations";
import { relatedName } from "@/lib/relations";

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * This business faces operational blind-spot risk when managers lack real-time visibility.
 * Our app reduces the risk by surfacing open work, revenue, and contract health on one dashboard.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const profile = await getProfile();
  const isManager = profile?.role === "service_manager";

  const [
    { count: customerCount },
    { count: openWoCount },
    { count: criticalCount },
    { data: openWorkOrders },
    { data: allScheduledWo },
    invoicesResult,
    paymentsResult,
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
    supabase.from("invoices").select("invoice_date, invoice_total, status, remaining_balance"),
    isManager
      ? supabase.from("payments").select("payment_date, payment_amount")
      : Promise.resolve({ data: null as { payment_date: string; payment_amount: number }[] | null, error: null }),
    supabase.from("service_contracts").select("id, name, status, end_date, contract_price"),
    supabase.from("parts").select("id, name, part_number, quantity_on_hand, reorder_level").eq("is_active", true),
  ]);

  const invoices = invoicesResult.data;
  const invoiceError = invoicesResult.error?.message
    ? "Invoice activity could not be loaded. Please try again."
    : null;
  const payments = paymentsResult.data;
  const paymentError =
    isManager && "error" in paymentsResult && paymentsResult.error?.message
      ? "Invoice activity could not be loaded. Please try again."
      : null;
  const chartError = invoiceError ?? paymentError;

  const lowStockParts = (allParts ?? []).filter((p) => p.quantity_on_hand <= p.reorder_level).slice(0, 5);

  const months = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(new Date(), 5 - i)));
  const workOrderTrend = months.map((m) => ({
    month: format(m, "MMM yyyy"),
    count: (allScheduledWo ?? []).filter((wo) => wo.scheduled_date?.startsWith(format(m, "yyyy-MM"))).length,
  }));

  const revenueByMonth = months.map((m) => {
    const key = format(m, "yyyy-MM");
    const revenue = (invoices ?? [])
      .filter((inv) => inv.invoice_date?.startsWith(key))
      .reduce((sum, inv) => sum + safeNumber(inv.invoice_total), 0);
    return { month: format(m, "MMM yyyy"), revenue };
  });

  const invoiceActivity: InvoiceActivityPoint[] = months.map((m) => {
    const key = format(m, "yyyy-MM");
    const invoiced = (invoices ?? [])
      .filter((inv) => inv.invoice_date?.startsWith(key))
      .reduce((sum, inv) => sum + safeNumber(inv.invoice_total), 0);
    const collected = (payments ?? [])
      .filter((p) => p.payment_date?.startsWith(key))
      .reduce((sum, p) => sum + safeNumber(p.payment_amount), 0);
    return {
      month: format(m, "MMM yyyy"),
      invoiced,
      collected,
      outstanding: Math.max(0, invoiced - collected),
    };
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
    .reduce((s, i) => {
      const remaining =
        i.remaining_balance != null ? safeNumber(i.remaining_balance) : safeNumber(i.invoice_total);
      return s + remaining;
    }, 0);

  const today = startOfDay(new Date());

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={
          isManager
            ? "Manager operations overview — select a summary to open related records"
            : "Operations overview for Ridley Equipment Services"
        }
        actions={
          <Link href="/work-orders" className="btn btn-primary btn-sm">
            New Work Order
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isManager ? (
          <>
            <ClickableStatCard
              label="Active Customers"
              value={customerCount ?? 0}
              href="/customers"
              ariaLabel="View active customers"
            />
            <ClickableStatCard
              label="Open Work Orders"
              value={openWoCount ?? 0}
              hint={`${criticalCount ?? 0} high/critical open`}
              href="/work-orders?filter=open"
              ariaLabel="View open work orders"
            />
            <ClickableStatCard
              label="Active Contracts"
              value={activeContracts}
              hint={`${expiringSoon.length} expiring soon`}
              href="/contracts"
              ariaLabel="View service contracts"
            />
            <ClickableStatCard
              label="Open AR"
              value={formatMoney(arBalance)}
              href="/reports"
              danger={arBalance > 0}
              ariaLabel="View accounts receivable on reports"
            />
          </>
        ) : (
          <>
            <StatCard label="Active Customers" value={customerCount ?? 0} />
            <StatCard
              label="Open Work Orders"
              value={openWoCount ?? 0}
              hint={`${criticalCount ?? 0} high/critical`}
            />
            <StatCard
              label="Active Contracts"
              value={activeContracts}
              hint={`${expiringSoon.length} expiring soon`}
            />
            <StatCard label="Open AR" value={formatMoney(arBalance)} danger={arBalance > 0} />
          </>
        )}
      </div>

      <div className="mt-6">
        <DashboardCharts
          workOrderTrend={workOrderTrend}
          revenueByMonth={revenueByMonth}
          invoiceActivity={invoiceActivity}
          invoiceActivityError={chartError}
          variant={isManager ? "manager" : "default"}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {isManager ? (
          <ClickableSectionCard
            href="/work-orders?filter=open"
            title="Action Required — Work Orders"
            ariaLabel="View all open work orders needing action"
          >
            {(openWorkOrders ?? []).length === 0 ? (
              <EmptyState title="No open work orders" description="Create a work order to get started." />
            ) : (
              <ul className="divide-y divide-base-300">
                {(openWorkOrders ?? []).map((wo) => {
                  const urgent = ["Critical", "High"].includes(wo.priority);
                  const overdue =
                    !!wo.scheduled_date && isBefore(parseISO(wo.scheduled_date), today);
                  return (
                    <li key={wo.id}>
                      <Link
                        href={`/work-orders/${wo.id}`}
                        aria-label={`Open work order ${wo.work_order_number}`}
                        className={`flex flex-wrap items-center gap-3 px-2 py-3 transition-colors
                          hover:bg-base-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                          ${urgent || overdue ? "bg-error/10" : ""}`}
                      >
                        <span className="min-w-[5.5rem] font-medium text-primary">{wo.work_order_number}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{relatedName(wo.customers)}</span>
                        <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                        <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                        <span className="text-xs text-primary/80">View</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </ClickableSectionCard>
        ) : (
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-base">Action Required — Work Orders</h2>
              {(openWorkOrders ?? []).length === 0 ? (
                <EmptyState title="No open work orders" description="Create a work order to get started." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>WO #</th>
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
        )}

        {isManager ? (
          <ClickableSectionCard
            href="/parts?filter=low-stock"
            title="Low Stock Parts"
            ariaLabel="View parts at or below reorder level"
          >
            {(lowStockParts ?? []).length === 0 ? (
              <EmptyState title="Inventory looks good" description="No parts at or below reorder level." />
            ) : (
              <ul className="divide-y divide-base-300">
                {(lowStockParts ?? []).map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/parts?filter=low-stock&part=${p.id}`}
                      aria-label={`View low-stock part ${p.part_number} ${p.name}`}
                      className="flex flex-wrap items-center gap-3 px-2 py-3 transition-colors
                        hover:bg-base-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {p.part_number} — {p.name}
                      </span>
                      <StatusBadge label={`On hand ${p.quantity_on_hand}`} tone="warning" />
                      <span className="text-sm opacity-70">Reorder {p.reorder_level}</span>
                      <span className="text-xs text-primary/80">View</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ClickableSectionCard>
        ) : (
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
        )}
      </div>
    </div>
  );
}
