"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui";

export type InvoiceActivityPoint = {
  month: string;
  invoiced: number;
  collected: number;
  outstanding: number;
};

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

function InvoiceActivityChart({
  data,
  error,
}: {
  data: InvoiceActivityPoint[];
  error?: string | null;
}) {
  if (error) {
    return (
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base">Invoice Activity Over Time</h3>
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

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h3 className="card-title text-base">Invoice Activity Over Time</h3>
        {!hasActivity ? (
          <EmptyState
            title="No invoice activity is available yet"
            description="Invoice totals will appear here after invoices and payments are recorded."
          />
        ) : (
          <div className="h-64 w-full min-w-0">
            <ChartMount>
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
            </ChartMount>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartMount({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  if (!ready) {
    return <div className="h-64 w-full min-w-0 animate-pulse rounded-box bg-base-200/80" aria-hidden />;
  }
  return <>{children}</>;
}

export function DashboardCharts({
  workOrderTrend,
  revenueByMonth,
  invoiceActivity,
  invoiceActivityError,
  variant = "default",
}: {
  workOrderTrend: { month: string; count: number }[];
  revenueByMonth: { month: string; revenue: number }[];
  invoiceActivity?: InvoiceActivityPoint[];
  invoiceActivityError?: string | null;
  /** Manager gets the multi-line invoice activity chart; Admin keeps the original revenue line. */
  variant?: "default" | "manager";
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base">Work Orders (6 months)</h3>
          <div className="h-64 w-full min-w-0">
            <ChartMount>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workOrderTrend}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" name="Work Orders" fill="oklch(var(--p))" />
                </BarChart>
              </ResponsiveContainer>
            </ChartMount>
          </div>
        </div>
      </div>

      {variant === "manager" ? (
        <InvoiceActivityChart data={invoiceActivity ?? []} error={invoiceActivityError} />
      ) : (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-base">Invoiced Revenue (6 months)</h3>
            <div className="h-64 w-full min-w-0">
              <ChartMount>
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
                      stroke="oklch(var(--su))"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartMount>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
