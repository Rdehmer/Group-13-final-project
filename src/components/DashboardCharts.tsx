"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";

export type InvoiceActivityPoint = {
  month: string;
  invoiced: number;
  collected: number;
  outstanding: number;
};

export type DashboardPieSlice = {
  name: string;
  value: number;
  href: string;
};

/** Workshop-friendly palette (avoid purple / neon gradient defaults). */
const PIE_COLORS = [
  "#1f5c42",
  "#c27803",
  "#1d4ed8",
  "#0f766e",
  "#b45309",
  "#be123c",
  "#475569",
  "#365314",
];

function shortCurrency(value: number): string {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 100_000) return `$${Math.round(n / 1000)}K`;
  if (Math.abs(n) >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fullCurrency(value: number): string {
  const n = Number(value) || 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function InvoiceActivityChart({
  data,
  error,
  compact,
  fillParent,
}: {
  data: InvoiceActivityPoint[];
  error?: string | null;
  compact?: boolean;
  fillParent?: boolean;
}) {
  if (error) {
    return (
      <div className="card flex h-full min-h-0 flex-col rounded-2xl border border-base-300/70 bg-base-100 shadow-none">
        <div className="card-body">
          <h3 className="card-title font-display text-base">Invoice Activity Over Time</h3>
          <EmptyState
            title="Invoice activity could not be loaded"
            description="Please try again in a moment."
          />
        </div>
      </div>
    );
  }

  const hasActivity = data.some(
    (d) => d.invoiced > 0 || d.collected > 0 || d.outstanding > 0,
  );
  const chartH = fillParent
    ? "h-full min-h-[10rem] w-full min-w-0"
    : compact
      ? "h-40 w-full min-w-0"
      : "h-64 w-full min-w-0";

  return (
    <div
      className={`card bg-base-100 shadow-none ${
        fillParent
          ? "flex h-full min-h-0 flex-col border-0"
          : "h-full border border-base-300/70"
      }`}
    >
      <div className={`card-body ${fillParent ? "flex min-h-0 flex-1 flex-col overflow-hidden" : ""}`}>
        <div className="flex shrink-0 items-center justify-between gap-2">
          <h3 className="card-title font-display text-base">Invoice Activity Over Time</h3>
          <Link href="/reports/invoice-cash" className="btn btn-ghost btn-xs">
            Invoice &amp; Cash
          </Link>
        </div>
        {!hasActivity ? (
          <EmptyState
            title="No invoice activity is available yet"
            description="Invoice totals will appear here after invoices and payments are recorded."
          />
        ) : (
          <div className={`${chartH} ${fillParent ? "min-h-0 flex-1" : ""}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 12 }}
                  width={56}
                  tickFormatter={(v) => shortCurrency(Number(v))}
                />
                <Tooltip
                  formatter={(value, name) => [
                    fullCurrency(Number(value)),
                    String(name),
                  ]}
                  labelFormatter={(label) => String(label)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="invoiced"
                  name="Total Invoiced"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 2, fill: "#fff", stroke: "#2563eb" }}
                  activeDot={{ r: 6 }}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="collected"
                  name="Amount Collected"
                  stroke="#16a34a"
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 2, fill: "#fff", stroke: "#16a34a" }}
                  activeDot={{ r: 6 }}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="outstanding"
                  name="Outstanding Balance"
                  stroke="#d97706"
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 2, fill: "#fff", stroke: "#d97706" }}
                  activeDot={{ r: 6 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

export function ContractPieCard({
  title,
  description,
  data,
  valueKind,
  viewAllHref,
  compact,
  fillParent,
}: {
  title: string;
  description: string;
  data: DashboardPieSlice[];
  valueKind: "count" | "money";
  viewAllHref: string;
  compact?: boolean;
  /** Fill a resizable parent instead of fixed chart height. */
  fillParent?: boolean;
}) {
  const router = useRouter();
  const total = data.reduce((s, d) => s + d.value, 0);
  const hasData = data.length > 0 && total > 0;
  const chartClass = fillParent
    ? "h-full min-h-[10rem] w-full min-w-0"
    : compact
      ? "h-40 w-full min-w-0"
      : "h-56 w-full min-w-0";

  return (
    <div
      className={`card border-base-300/70 bg-base-100 shadow-none ${
        fillParent
          ? "flex h-full min-h-0 flex-col border-0"
          : "h-full border"
      }`}
    >
      <div className={`card-body gap-3 ${fillParent ? "min-h-0 flex-1 overflow-hidden" : ""}`}>
        <div className="flex shrink-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="card-title font-display text-base">{title}</h3>
            <p className="text-xs text-base-content/55">{description}</p>
          </div>
          <Link href={viewAllHref} className="btn btn-ghost btn-xs shrink-0">
            Contracts
          </Link>
        </div>
        {!hasData ? (
          <EmptyState
            title="No contract data yet"
            description="Approved and active contracts will appear here as the portfolio grows."
          />
        ) : (
          <div
            className={`grid min-h-0 items-center gap-3 ${
              fillParent
                ? "min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)] sm:grid-rows-1"
                : "sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]"
            }`}
          >
            <div className={`${chartClass} min-h-0 overflow-hidden`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={fillParent || !compact ? "28%" : 36}
                    outerRadius={fillParent || !compact ? "48%" : 58}
                    paddingAngle={2}
                    isAnimationActive={false}
                    onClick={(_, index) => {
                      const slice = data[index];
                      if (slice?.href) router.push(slice.href);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {data.map((entry, i) => (
                      <Cell
                        key={`${entry.name}-${i}`}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                        stroke="transparent"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      valueKind === "money"
                        ? fullCurrency(Number(value))
                        : `${Number(value).toLocaleString("en-US")} contracts`,
                      String(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="max-h-full min-h-0 space-y-1.5 overflow-y-auto text-sm">
              {data.map((slice, i) => {
                const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
                return (
                  <li key={`${slice.name}-${i}`}>
                    <Link
                      href={slice.href}
                      className="flex items-start gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-base-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{slice.name}</span>
                        <span className="text-xs text-base-content/55">
                          {valueKind === "money"
                            ? formatMoney(slice.value)
                            : `${slice.value} · ${pct}%`}
                          {valueKind === "money" ? ` · ${pct}%` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {hasData && !fillParent ? (
          <p className="shrink-0 text-center text-xs text-base-content/50">
            Total{" "}
            {valueKind === "money"
              ? formatMoney(total)
              : `${total.toLocaleString("en-US")} contracts`}
            {" · "}
            click a slice or label to open Contracts
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function WorkOrderTrendChart({
  workOrderTrend,
  compact,
  fillParent,
}: {
  workOrderTrend: { month: string; count: number }[];
  compact?: boolean;
  fillParent?: boolean;
}) {
  const chartH = fillParent
    ? "h-full min-h-[10rem] w-full min-w-0"
    : compact
      ? "h-40 w-full min-w-0"
      : "h-64 w-full min-w-0";

  return (
    <div
      className={`card bg-base-100 shadow-none ${
        fillParent
          ? "flex h-full min-h-0 flex-col border-0"
          : "h-full border border-base-300/70"
      }`}
    >
      <div className={`card-body ${fillParent ? "flex min-h-0 flex-1 flex-col overflow-hidden" : ""}`}>
        <div className="flex shrink-0 items-center justify-between gap-2">
          <h3 className="card-title font-display text-base">Work Orders (6 months)</h3>
          <Link href="/work-orders?filter=open" className="btn btn-ghost btn-xs">
            Work orders
          </Link>
        </div>
        <div className={`${chartH} ${fillParent ? "min-h-0 flex-1" : ""}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={workOrderTrend}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="count" name="Work Orders" fill="#1f5c42" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export function DashboardCharts({
  workOrderTrend,
  revenueByMonth,
  invoiceActivity,
  invoiceActivityError,
  contractStatusSlices,
  contractValueSlices,
  managerAside,
  variant = "default",
}: {
  workOrderTrend: { month: string; count: number }[];
  revenueByMonth: { month: string; revenue: number }[];
  invoiceActivity?: InvoiceActivityPoint[];
  invoiceActivityError?: string | null;
  contractStatusSlices?: DashboardPieSlice[];
  contractValueSlices?: DashboardPieSlice[];
  /** Optional third column beside contract pies (e.g. field pulse). */
  managerAside?: ReactNode;
  /** Manager gets pies + multi-line invoice activity; Admin keeps revenue line. */
  variant?: "default" | "manager";
}) {
  return (
    <div className="space-y-4">
      {variant === "manager" ? (
        <div
          className={`grid items-stretch gap-4 ${
            managerAside
              ? "xl:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(18rem,1.3fr)]"
              : "lg:grid-cols-2"
          }`}
        >
          <ContractPieCard
            title="Contracts by status"
            description="Portfolio mix across every contract status"
            data={contractStatusSlices ?? []}
            valueKind="count"
            viewAllHref="/contracts"
          />
          <ContractPieCard
            title="Active contract value by type"
            description="Annual/booked price for Active contracts only"
            data={contractValueSlices ?? []}
            valueKind="money"
            viewAllHref="/contracts?status=Active"
          />
          {managerAside ? <div className="min-w-0 xl:min-h-full">{managerAside}</div> : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkOrderTrendChart workOrderTrend={workOrderTrend} />

        {variant === "manager" ? (
          <InvoiceActivityChart data={invoiceActivity ?? []} error={invoiceActivityError} />
        ) : (
          <div className="card rounded-2xl border border-base-300/70 bg-base-100 shadow-none">
            <div className="card-body">
              <h3 className="card-title font-display text-base">Invoiced Revenue (6 months)</h3>
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueByMonth}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => shortCurrency(Number(v))} />
                    <Tooltip formatter={(v) => [fullCurrency(Number(v)), "Revenue"]} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="#0f766e"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
