import Link from "next/link";
import {
  addDays,
  format,
  isBefore,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { ClickableStatCard } from "@/components/ClickableStatCard";
import {
  DashboardCharts,
  type DashboardPieSlice,
  type InvoiceActivityPoint,
} from "@/components/DashboardCharts";
import { ManagerDashboardStudio } from "@/components/ManagerDashboardStudio";
import { AdminDashboardStudio } from "@/components/AdminDashboardStudio";
import { summarizeStaffProfiles } from "@/components/AdminDashboardHome";
import { formatMoney } from "@/lib/calculations";
import { relatedName } from "@/lib/relations";
import { fetchManagerUnreadInboxCount } from "@/lib/manager-inbox";
import type { UserRole, WorkOrder, TechnicianLabor, WorkOrderPart } from "@/lib/types";
import { arAgingSummary, jobProfitability, openInvoicesAt, type InvoiceWithCustomer } from "@/lib/reports";
import { isBatchableInvoiceStatus } from "@/lib/batches";
import { loadTimeEntries, sumEntries } from "@/lib/timesheets";

/** Always re-read Supabase so admin/manager see the same live ops data. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type ContractRow = {
  id: string;
  name: string;
  status: string;
  end_date: string | null;
  contract_price: number | null;
  contract_type: string | null;
  customers?: { name?: string | null } | { name?: string | null }[] | null;
};

type OpenWoPulse = {
  id: string;
  scheduled_date: string | null;
  assigned_technician_id: string | null;
  priority: string;
  status: string;
};

type TimeOffRow = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
};

function groupPieSlices(
  rows: { key: string; value: number }[],
  hrefFor: (key: string) => string,
): DashboardPieSlice[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = r.key.trim() || "Unspecified";
    map.set(key, (map.get(key) ?? 0) + r.value);
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value, href: hrefFor(name) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

/**
 * Service managers get the live ops widget board.
 * Administrators get a customizable company / control-plane dashboard.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const profile = await getProfile();
  const isAdmin = profile?.role === "administrator";
  const isServiceManager = profile?.role === "service_manager";
  const isManager = isServiceManager;
  const needsOpsMetrics = isAdmin || isServiceManager;
  const canManageContracts = isServiceManager || isAdmin;

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
    openPulseResult,
    timeOffResult,
    staffResult,
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
    supabase
      .from("invoices")
      .select(
        "id, invoice_date, due_date, invoice_total, status, remaining_balance, customer_id, work_order_id, labor_charges, parts_charges, recurring_service_charge, additional_charges, discounts, warranty_deductions, tax",
      ),
    needsOpsMetrics
      ? supabase.from("payments").select("id, payment_date, payment_amount")
      : Promise.resolve({
          data: null as { id?: string; payment_date: string; payment_amount: number }[] | null,
          error: null,
        }),
    supabase
      .from("service_contracts")
      .select("id, name, status, end_date, contract_price, contract_type, customers(name)"),
    supabase
      .from("parts")
      .select("id, name, part_number, quantity_on_hand, reorder_level")
      .eq("is_active", true),
    needsOpsMetrics
      ? supabase
          .from("work_orders")
          .select("id, scheduled_date, assigned_technician_id, priority, status")
          .not("status", "in", '("Completed","Closed","Canceled")')
      : Promise.resolve({ data: null as OpenWoPulse[] | null, error: null }),
    isManager
      ? supabase.from("time_off_requests").select("id, status, start_date, end_date")
      : Promise.resolve({ data: null as TimeOffRow[] | null, error: null }),
    isAdmin
      ? supabase
          .from("profiles")
          .select("id, full_name, email, role, is_active")
          .in("role", ["administrator", "service_manager", "technician", "billing"])
          .order("full_name")
      : Promise.resolve({ data: null }),
  ]);

  const invoices = invoicesResult.data;
  const invoiceError = invoicesResult.error?.message
    ? "Invoice activity could not be loaded. Please try again."
    : null;
  const payments = paymentsResult.data;
  const paymentError =
    needsOpsMetrics && "error" in paymentsResult && paymentsResult.error?.message
      ? "Invoice activity could not be loaded. Please try again."
      : null;
  const chartError = invoiceError ?? paymentError;

  const contractRows = (contracts as ContractRow[] | null) ?? [];
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

  const activeContracts = contractRows.filter((c) => c.status === "Active").length;
  const pendingApprovals = contractRows.filter((c) => c.status === "Pending Approval").length;

  const today = startOfDay(new Date());
  const in30 = addDays(today, 30);
  const weekEnd = addDays(today, 6);

  const expiringSoon = contractRows
    .filter((c) => {
      if (!c.end_date || c.status !== "Active") return false;
      try {
        const end = startOfDay(parseISO(c.end_date.slice(0, 10)));
        return !isBefore(end, today) && !isBefore(in30, end);
      } catch {
        return false;
      }
    })
    .sort((a, b) => (a.end_date ?? "").localeCompare(b.end_date ?? ""))
    .slice(0, 6);

  const expiringSoonCount = contractRows.filter((c) => {
    if (!c.end_date || c.status !== "Active") return false;
    try {
      const end = startOfDay(parseISO(c.end_date.slice(0, 10)));
      return !isBefore(end, today) && !isBefore(in30, end);
    } catch {
      return false;
    }
  }).length;

  const contractStatusSlices = groupPieSlices(
    contractRows.map((c) => ({ key: c.status || "Unspecified", value: 1 })),
    (status) => `/contracts?status=${encodeURIComponent(status)}`,
  );

  const contractValueSlices = groupPieSlices(
    contractRows
      .filter((c) => c.status === "Active")
      .map((c) => ({
        key: c.contract_type?.trim() || "Unspecified",
        value: safeNumber(c.contract_price),
      })),
    (type) => `/contracts?status=Active&type=${encodeURIComponent(type)}`,
  );

  const arBalance = (invoices ?? [])
    .filter((i) => !["Paid", "Canceled"].includes(i.status))
    .reduce((s, i) => {
      const remaining =
        i.remaining_balance != null ? safeNumber(i.remaining_balance) : safeNumber(i.invoice_total);
      return s + remaining;
    }, 0);

  const openPulse = (openPulseResult.data as OpenWoPulse[] | null) ?? [];
  const unscheduledOpen = openPulse.filter((wo) => !wo.scheduled_date).length;
  const unassignedOpen = openPulse.filter((wo) => !wo.assigned_technician_id).length;

  const timeOffRows = (timeOffResult.data as TimeOffRow[] | null) ?? [];
  const pendingTimeOff = timeOffRows.filter((r) => r.status === "Pending").length;
  const ptoThisWeek = timeOffRows.filter((r) => {
    if (r.status !== "Approved") return false;
    try {
      const start = startOfDay(parseISO(r.start_date.slice(0, 10)));
      const end = startOfDay(parseISO(r.end_date.slice(0, 10)));
      return !isBefore(end, today) && !isBefore(weekEnd, start);
    } catch {
      return false;
    }
  }).length;

  let unreadInboxCount = 0;
  if (isManager) {
    try {
      unreadInboxCount = await fetchManagerUnreadInboxCount(supabase);
    } catch {
      unreadInboxCount = 0;
    }
  }

  const thisMonthKey = format(startOfMonth(new Date()), "yyyy-MM");
  const lastMonthKey = format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM");
  const cashThisMonth = (payments ?? [])
    .filter((p) => p.payment_date?.startsWith(thisMonthKey))
    .reduce((sum, p) => sum + safeNumber(p.payment_amount), 0);
  const cashLastMonth = (payments ?? [])
    .filter((p) => p.payment_date?.startsWith(lastMonthKey))
    .reduce((sum, p) => sum + safeNumber(p.payment_amount), 0);

  const openInvoiceCount = (invoices ?? []).filter((i) => {
    if (["Paid", "Canceled"].includes(i.status)) return false;
    const remaining =
      i.remaining_balance != null ? safeNumber(i.remaining_balance) : safeNumber(i.invoice_total);
    return remaining > 0;
  }).length;

  const staffSummary = summarizeStaffProfiles(
    ((staffResult.data as {
      id: string;
      full_name: string | null;
      email: string;
      role: UserRole;
      is_active: boolean;
    }[] | null) ?? []),
  );

  const lowStockCount = (allParts ?? []).filter(
    (p) => p.quantity_on_hand <= p.reorder_level,
  ).length;

  const managerAttentionTiles = [
    {
      label: "Unread inbox messages",
      value: unreadInboxCount,
      href: "/inbox",
      danger: unreadInboxCount > 0,
    },
    {
      label: "Pending contract approvals",
      value: pendingApprovals,
      href: "/contracts?status=Pending%20Approval",
      danger: pendingApprovals > 0,
    },
    {
      label: "Expiring ≤30 days",
      value: expiringSoonCount,
      href: "/contracts?status=Active",
      danger: expiringSoonCount > 0,
    },
    {
      label: "Pending PTO requests",
      value: pendingTimeOff,
      href: "/time-off",
      danger: pendingTimeOff > 0,
    },
    {
      label: "Unscheduled open WOs",
      value: unscheduledOpen,
      href: "/technician",
      danger: unscheduledOpen > 0,
    },
    {
      label: "High / critical open",
      value: criticalCount ?? 0,
      href: "/work-orders?filter=urgent",
      danger: (criticalCount ?? 0) > 0,
    },
  ].filter((t) => t.value > 0);

  const adminAttentionTiles = [
    {
      label: "Pending contract approvals",
      value: pendingApprovals,
      href: "/contracts?status=Pending%20Approval",
      danger: pendingApprovals > 0,
    },
    {
      label: "Expiring ≤30 days",
      value: expiringSoonCount,
      href: "/contracts?status=Active",
      danger: expiringSoonCount > 0,
    },
    {
      label: "Open invoices with balance",
      value: openInvoiceCount,
      href: "/billing",
      danger: openInvoiceCount > 0,
    },
    {
      label: "High / critical open WOs",
      value: criticalCount ?? 0,
      href: "/work-orders?filter=urgent",
      danger: (criticalCount ?? 0) > 0,
    },
    {
      label: "Low stock parts",
      value: lowStockCount,
      href: "/parts?filter=low-stock",
      danger: lowStockCount > 0,
    },
    {
      label: "Inactive staff",
      value: staffSummary.inactiveStaffCount,
      href: "/users",
      danger: staffSummary.inactiveStaffCount > 0,
    },
  ].filter((t) => t.value > 0);

  const attentionTiles = isManager ? managerAttentionTiles : isAdmin ? adminAttentionTiles : [];

  if (isAdmin) {
    const todayIso = format(today, "yyyy-MM-dd");
    const laborFrom = format(subDays(today, 13), "yyyy-MM-dd");
    const monthStart = format(startOfMonth(today), "yyyy-MM-dd");
    const monthEnd = format(today, "yyyy-MM-dd");

    const [
      timeEntries,
      { data: marginJobs },
      { data: marginLabor },
      { data: marginParts },
      { data: techProfiles },
    ] = await Promise.all([
      loadTimeEntries(supabase, { from: laborFrom, to: todayIso }).catch(() => []),
      supabase
        .from("work_orders")
        .select("*, customers(name)")
        .order("created_at", { ascending: false })
        .limit(400),
      supabase.from("technician_labor").select("*").limit(2000),
      supabase.from("work_order_parts").select("*").limit(2000),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "technician")
        .eq("is_active", true),
    ]);

    const laborTotals = sumEntries(timeEntries);
    const exceptionCount = timeEntries.filter(
      (e) =>
        !e.voided_at &&
        ((e.exception_flags && e.exception_flags.length > 0) ||
          e.approval_status === "pending_correction" ||
          e.approval_status === "missing_clock_out"),
    ).length;

    const invRows = (invoices ?? []) as InvoiceWithCustomer[];
    const openArRows = openInvoicesAt(invRows, new Date());
    const aging = arAgingSummary(openArRows);

    const unpaidCustomerIds = new Set(
      openArRows.map((i) => i.customer_id).filter(Boolean) as string[],
    );

    const jobProf = jobProfitability(
      invRows,
      (marginJobs as (WorkOrder & { customers?: { name: string } })[]) ?? [],
      {
        labor: (marginLabor as TechnicianLabor[]) ?? [],
        partsUsed: (marginParts as WorkOrderPart[]) ?? [],
        jobs: (marginJobs as WorkOrder[]) ?? [],
      },
      { start: monthStart, end: monthEnd },
    );

    const techNameById = new Map(
      ((techProfiles as { id: string; full_name: string | null; email: string }[] | null) ?? []).map(
        (p) => [p.id, p.full_name?.trim() || p.email || "Technician"],
      ),
    );
    const loadMap = new Map<string, number>();
    for (const wo of openPulse) {
      if (!wo.assigned_technician_id) continue;
      loadMap.set(wo.assigned_technician_id, (loadMap.get(wo.assigned_technician_id) ?? 0) + 1);
    }
    const teamLoadTechs = Array.from(loadMap.entries())
      .map(([id, openJobs]) => ({
        id,
        name: techNameById.get(id) ?? "Technician",
        openJobs,
      }))
      .sort((a, b) => b.openJobs - a.openJobs)
      .slice(0, 8);

    const batchableInvoiceIds = invRows
      .filter((i) => isBatchableInvoiceStatus(i.status))
      .map((i) => i.id)
      .filter(Boolean);
    const batchablePaymentIds = ((payments ?? []) as { id?: string }[])
      .map((p) => p.id)
      .filter((id): id is string => Boolean(id));

    return (
      <AdminDashboardStudio
        data={{
          ...staffSummary,
          customerCount: customerCount ?? 0,
          openWoCount: openWoCount ?? 0,
          criticalCount: criticalCount ?? 0,
          activeContracts,
          pendingApprovals,
          expiringSoonCount,
          arBalance,
          arLabel: formatMoney(arBalance),
          cashThisMonth,
          cashLastMonth,
          openInvoiceCount,
          attentionTiles,
          contractStatusSlices,
          contractValueSlices,
          workOrderTrend,
          invoiceActivity,
          chartError,
          expiringSoon: expiringSoon.map((c) => ({
            id: c.id,
            name: c.name,
            end_date: c.end_date,
            contract_price: c.contract_price,
            contract_type: c.contract_type,
            customers: c.customers,
          })),
          openWorkOrders: (openWorkOrders ?? []).map((wo) => ({
            id: wo.id,
            work_order_number: wo.work_order_number,
            priority: wo.priority,
            status: wo.status,
            scheduled_date: wo.scheduled_date,
            customers: wo.customers,
          })),
          lowStockParts: (lowStockParts ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            part_number: p.part_number,
            quantity_on_hand: p.quantity_on_hand,
            reorder_level: p.reorder_level,
          })),
          hasPartsCatalog: (allParts ?? []).length > 0,
          laborHealth: {
            totalHours: laborTotals.totalHours,
            regularHours: laborTotals.regularHours,
            overtimeHours: laborTotals.overtimeHours,
            billableHours: laborTotals.billableHours,
            pendingApproval: laborTotals.pending,
            exceptionCount,
          },
          arAging: {
            current: aging.totals.current,
            d30: aging.totals.d30,
            d60: aging.totals.d60,
            d90: aging.totals.d90,
            gross: aging.gross,
          },
          portalPulse: {
            openJobs: openWoCount ?? 0,
            unpaidCustomers: unpaidCustomerIds.size,
            pendingContractRequests: pendingApprovals,
            openInvoiceCount,
          },
          marginSnapshot: {
            revenue: jobProf.totals.revenue,
            cogs: jobProf.totals.cogs,
            profit: jobProf.totals.profit,
            marginPct:
              jobProf.totals.revenue > 0
                ? jobProf.totals.profit / jobProf.totals.revenue
                : null,
            jobCount: jobProf.totals.jobCount,
            jobLossCount: jobProf.totals.lossCount,
          },
          teamLoad: {
            unassignedOpen,
            techs: teamLoadTechs,
          },
          periodCloseSeed: {
            invoiceIds: batchableInvoiceIds,
            paymentIds: batchablePaymentIds,
          },
        }}
      />
    );
  }

  if (isManager) {
    return (
      <ManagerDashboardStudio
        data={{
          customerCount: customerCount ?? 0,
          openWoCount: openWoCount ?? 0,
          criticalCount: criticalCount ?? 0,
          activeContracts,
          pendingApprovals,
          expiringSoonCount,
          arBalance,
          arLabel: formatMoney(arBalance),
          attentionTiles,
          contractStatusSlices,
          contractValueSlices,
          workOrderTrend,
          invoiceActivity,
          chartError,
          expiringSoon: expiringSoon.map((c) => ({
            id: c.id,
            name: c.name,
            end_date: c.end_date,
            contract_price: c.contract_price,
            contract_type: c.contract_type,
            customers: c.customers,
          })),
          openWorkOrders: (openWorkOrders ?? []).map((wo) => ({
            id: wo.id,
            work_order_number: wo.work_order_number,
            priority: wo.priority,
            status: wo.status,
            scheduled_date: wo.scheduled_date,
            customers: wo.customers,
          })),
          lowStockParts: (lowStockParts ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            part_number: p.part_number,
            quantity_on_hand: p.quantity_on_hand,
            reorder_level: p.reorder_level,
          })),
          hasPartsCatalog: (allParts ?? []).length > 0,
          pendingTimeOff,
          ptoThisWeek,
          unscheduledOpen,
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Operations overview for EquipmentIQ"
        actions={
          <Link href="/work-orders" className="btn btn-primary btn-sm">
            New Work Order
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {canManageContracts ? (
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
              hint={`${expiringSoonCount} expiring soon`}
              href="/contracts?status=Active"
              ariaLabel="View service contracts"
            />
            <ClickableStatCard
              label="Pending Approvals"
              value={pendingApprovals}
              hint={pendingApprovals > 0 ? "Customer requests awaiting review" : "No requests waiting"}
              href="/contracts?status=Pending%20Approval"
              danger={pendingApprovals > 0}
              ariaLabel="View contracts pending approval"
            />
            <ClickableStatCard
              label="Open AR"
              value={formatMoney(arBalance)}
              href="/reports"
              danger={arBalance > 0}
              ariaLabel="View accounts receivable"
            />
          </>
        ) : (
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
              hint={`${criticalCount ?? 0} high/critical`}
              href="/work-orders?filter=open"
              ariaLabel="View open work orders"
            />
            <ClickableStatCard
              label="Active Contracts"
              value={activeContracts}
              hint={`${expiringSoonCount} expiring soon`}
              href="/contracts?status=Active"
              ariaLabel="View service contracts"
            />
            <ClickableStatCard
              label="Pending Approvals"
              value={pendingApprovals}
              hint={pendingApprovals > 0 ? "Customer requests awaiting review" : "No requests waiting"}
              href="/contracts?status=Pending%20Approval"
              danger={pendingApprovals > 0}
              ariaLabel="View contracts pending approval"
            />
            <ClickableStatCard
              label="Open AR"
              value={formatMoney(arBalance)}
              href="/billing"
              danger={arBalance > 0}
              ariaLabel="View accounts receivable"
            />
          </>
        )}
      </div>

      <div className="mt-6">
        <DashboardCharts
          workOrderTrend={workOrderTrend}
          revenueByMonth={revenueByMonth}
          invoiceActivity={invoiceActivity}
          invoiceActivityError={chartError}
          contractStatusSlices={contractStatusSlices}
          contractValueSlices={contractValueSlices}
          variant="default"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Action Required — Work Orders</h2>
            {(openWorkOrders ?? []).length === 0 ? (
              <EmptyState title="No open work orders" description="Create a work order to get started." />
            ) : (
              <DualHorizontalScroll>
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
              </DualHorizontalScroll>
            )}
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Low Stock Parts</h2>
            {(lowStockParts ?? []).length === 0 ? (
              <EmptyState
                title={
                  (allParts ?? []).length === 0
                    ? "No inventory catalog yet"
                    : "Inventory looks good"
                }
                description={
                  (allParts ?? []).length === 0
                    ? "Add parts to track on-hand quantities and reorder levels."
                    : "No parts at or below reorder level."
                }
              />
            ) : (
              <DualHorizontalScroll>
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
              </DualHorizontalScroll>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
