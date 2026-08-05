import type { ReactNode } from "react";
import Link from "next/link";
import { format, subMonths, startOfMonth } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  ClipboardList,
  DollarSign,
  FileText,
  Package,
  Plus,
  Users,
  Wrench,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { DashboardCharts } from "@/components/DashboardCharts";
import { DemoWalkthrough } from "@/components/DemoWalkthrough";
import { StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import { relatedName } from "@/lib/relations";

function MetricCard({
  label,
  value,
  hint,
  href,
  icon: Icon,
  accent = "primary",
  alert = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href: string;
  icon: typeof Users;
  accent?: "primary" | "warning" | "success" | "error";
  alert?: boolean;
}) {
  const accentBar = {
    primary: "from-primary/80 to-primary/20",
    warning: "from-warning/80 to-warning/20",
    success: "from-success/80 to-success/20",
    error: "from-error/80 to-error/20",
  }[accent];
  const iconTone = {
    primary: "bg-primary/12 text-primary",
    warning: "bg-warning/15 text-warning",
    success: "bg-success/12 text-success",
    error: "bg-error/12 text-error",
  }[accent];

  return (
    <Link
      href={href}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-base-100 p-4 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-md ${
        alert ? "border-error/35" : "border-base-300/80"
      }`}
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accentBar}`} />
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconTone}`}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <ArrowUpRight className="h-4 w-4 text-base-content/25 transition group-hover:text-primary" />
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/50">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl ${alert ? "text-error" : ""}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-base-content/55">{hint}</p> : null}
    </Link>
  );
}

function Panel({
  title,
  eyebrow,
  href,
  linkLabel,
  children,
}: {
  title: string;
  eyebrow: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-base-300/80 bg-base-100 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-base-200 px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/50">
            {eyebrow}
          </p>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        </div>
        {href && linkLabel ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary transition hover:gap-1.5"
          >
            {linkLabel} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      <div className="flex-1 p-2 sm:p-3">{children}</div>
    </section>
  );
}

/**
 * This business faces operational blind-spot risk when managers lack real-time visibility.
 * Our app reduces the risk by surfacing open work, revenue, and contract health on one dashboard.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const profile = await getProfile();

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
      .select("id, work_order_number, priority, status, scheduled_date, customer_id, customers(name)")
      .not("status", "in", '("Completed","Closed","Canceled")')
      .order("scheduled_date", { ascending: true })
      .limit(8),
    supabase.from("work_orders").select("scheduled_date"),
    supabase.from("invoices").select("invoice_date, invoice_total, status"),
    supabase.from("service_contracts").select("id, name, status, end_date, contract_price, customer_id"),
    supabase.from("parts").select("id, name, part_number, quantity_on_hand, reorder_level").eq("is_active", true),
  ]);

  const lowStockParts = (allParts ?? []).filter((p) => p.quantity_on_hand <= p.reorder_level).slice(0, 5);
  const lowStockCount = (allParts ?? []).filter((p) => p.quantity_on_hand <= p.reorder_level).length;

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

  const todayKey = format(new Date(), "yyyy-MM-dd");
  const scheduledToday = (allScheduledWo ?? []).filter((wo) => wo.scheduled_date?.startsWith(todayKey)).length;
  const firstName = profile?.full_name?.split(" ")[0] || "there";
  const todayLabel = format(new Date(), "EEEE, MMM d");

  const quickLinks = [
    { href: "/work-orders", label: "Jobs board", icon: ClipboardList },
    { href: "/billing", label: "Billing", icon: DollarSign },
    { href: "/parts?filter=low", label: "Low stock", icon: Package },
    { href: "/contracts", label: "Contracts", icon: FileText },
    { href: "/customers", label: "Customers", icon: Users },
    { href: "/reports", label: "Reports", icon: ArrowUpRight },
  ];

  return (
    <div className="dashboard-page space-y-6">
      {/* Welcome band */}
      <section className="dashboard-hero relative overflow-hidden rounded-2xl px-5 py-6 text-white sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/55">{todayLabel}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Good day, {firstName}
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/70">
              Operations pulse for Ridley Equipment Services — open work, inventory risk, and receivables
              in one view.
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 backdrop-blur-sm">
                <CalendarClock className="h-3.5 w-3.5 text-teal-200" />
                {scheduledToday} scheduled today
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 backdrop-blur-sm">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-200" />
                {criticalCount ?? 0} high / critical
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/work-orders"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-black/15 transition hover:bg-teal-50"
            >
              <Plus className="h-4 w-4" /> Book job
            </Link>
            <Link
              href="/billing"
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/15"
            >
              <DollarSign className="h-4 w-4" /> Open billing
            </Link>
          </div>
        </div>
      </section>

      {/* KPI metrics */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active customers"
          value={customerCount ?? 0}
          href="/customers"
          icon={Users}
          accent="primary"
        />
        <MetricCard
          label="Open jobs"
          value={openWoCount ?? 0}
          hint={`${criticalCount ?? 0} high or critical priority`}
          href="/work-orders"
          icon={Wrench}
          accent={(criticalCount ?? 0) > 0 ? "warning" : "primary"}
          alert={(criticalCount ?? 0) > 2}
        />
        <MetricCard
          label="Active contracts"
          value={activeContracts}
          hint={`${expiringSoon.length} expiring in 30 days`}
          href="/contracts"
          icon={FileText}
          accent={expiringSoon.length > 0 ? "warning" : "success"}
        />
        <MetricCard
          label="Open AR"
          value={formatMoney(arBalance)}
          hint="Unpaid & partially paid invoices"
          href="/billing"
          icon={DollarSign}
          accent={arBalance > 0 ? "error" : "success"}
          alert={arBalance > 0}
        />
      </div>

      {/* Quick nav */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {quickLinks.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-base-300/80 bg-base-100 px-3.5 py-2 text-sm font-medium text-base-content/80 shadow-sm transition hover:border-primary/30 hover:text-primary"
            >
              <Icon className="h-3.5 w-3.5 opacity-60" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <DashboardCharts workOrderTrend={workOrderTrend} revenueByMonth={revenueByMonth} />

      {(profile?.role === "administrator" || profile?.role === "service_manager") ? (
        <DemoWalkthrough />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Panel title="Action required" eyebrow="Jobs" href="/work-orders" linkLabel="All jobs">
            {(openWorkOrders ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No open jobs"
                  description="Book a sample job so the demo board and charts have work to show."
                  action={
                    <Link href="/work-orders" className="btn btn-primary btn-sm">
                      Book job
                    </Link>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-base-200">
                {(openWorkOrders ?? []).map((wo) => {
                  const urgent = ["Critical", "High"].includes(wo.priority);
                  return (
                    <li key={wo.id}>
                      <Link
                        href={`/work-orders/${wo.id}`}
                        className={`group flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-base-200/70 ${
                          urgent ? "bg-error/[0.04]" : ""
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            urgent ? "bg-error/12 text-error" : "bg-primary/10 text-primary"
                          }`}
                        >
                          {urgent ? (
                            <AlertTriangle className="h-4 w-4" />
                          ) : (
                            <ClipboardList className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold tabular-nums text-primary group-hover:underline">
                              {wo.work_order_number}
                            </span>
                            <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                            <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                          </div>
                          <p className="mt-0.5 truncate text-sm text-base-content/60">
                            {relatedName(wo.customers)}
                            {wo.scheduled_date
                              ? ` · ${format(new Date(wo.scheduled_date + "T12:00:00"), "MMM d")}`
                              : " · Unscheduled"}
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 text-base-content/20 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4 xl:col-span-2">
          <Panel title="Low stock" eyebrow="Parts" href="/parts?filter=low" linkLabel="Inventory">
            {lowStockParts.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Inventory looks healthy"
                  description="No parts at or below reorder. Lower a reorder level or use stock on a job for a demo low-stock signal."
                  action={
                    <Link href="/parts" className="btn btn-outline btn-sm">
                      Open parts
                    </Link>
                  }
                />
              </div>
            ) : (
              <>
                <p className="px-3 pb-1 text-xs text-base-content/50">
                  {lowStockCount} SKU{lowStockCount === 1 ? "" : "s"} need attention
                </p>
                <ul className="divide-y divide-base-200">
                  {lowStockParts.map((p) => {
                    const deficit = Math.max(0, p.reorder_level - p.quantity_on_hand);
                    return (
                      <li key={p.id}>
                        <Link
                          href={`/parts?part=${p.id}`}
                          className="group flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-base-200/70"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                            <Package className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium group-hover:text-primary">
                              {p.name}
                            </p>
                            <p className="text-xs tabular-nums text-base-content/50">{p.part_number}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold tabular-nums text-warning">
                              {p.quantity_on_hand}
                            </p>
                            <p className="text-[11px] text-base-content/45">
                              reorder {p.reorder_level}
                              {deficit > 0 ? ` · short ${deficit}` : ""}
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Panel>

          {expiringSoon.length > 0 ? (
            <Panel title="Expiring soon" eyebrow="Contracts" href="/contracts" linkLabel="All">
              <ul className="divide-y divide-base-200">
                {expiringSoon.slice(0, 4).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/12 text-warning">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-base-content/50">
                        Ends {c.end_date ? format(new Date(c.end_date + "T12:00:00"), "MMM d, yyyy") : "—"}
                      </p>
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      {formatMoney(Number(c.contract_price))}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
