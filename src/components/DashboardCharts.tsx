"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid oklch(var(--bc) / 0.12)",
  background: "oklch(var(--b1))",
  boxShadow: "0 8px 24px oklch(var(--bc) / 0.08)",
  fontSize: 12,
};

export function DashboardCharts({
  workOrderTrend,
  revenueByMonth,
}: {
  workOrderTrend: { month: string; count: number }[];
  revenueByMonth: { month: string; revenue: number }[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="overflow-hidden rounded-2xl border border-base-300/80 bg-base-100 shadow-sm">
        <div className="flex items-end justify-between gap-3 border-b border-base-200 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/50">
              Field volume
            </p>
            <h3 className="text-base font-semibold tracking-tight">Jobs scheduled</h3>
          </div>
          <span className="text-xs text-base-content/50">Last 6 months</span>
        </div>
        <div className="h-64 px-2 pb-3 pt-4 sm:px-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={workOrderTrend} barCategoryGap="28%">
              <defs>
                <linearGradient id="woBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(var(--p))" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="oklch(var(--p))" stopOpacity={0.45} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" stroke="oklch(var(--bc) / 0.08)" vertical={false} />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "oklch(var(--bc) / 0.55)", fontSize: 12 }}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                width={28}
                tick={{ fill: "oklch(var(--bc) / 0.45)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "oklch(var(--p) / 0.06)" }}
                contentStyle={tooltipStyle}
                labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              />
              <Bar dataKey="count" name="Jobs" fill="url(#woBar)" radius={[8, 8, 2, 2]} maxBarSize={42} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-base-300/80 bg-base-100 shadow-sm">
        <div className="flex items-end justify-between gap-3 border-b border-base-200 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/50">
              Billing
            </p>
            <h3 className="text-base font-semibold tracking-tight">Invoiced revenue</h3>
          </div>
          <span className="text-xs text-base-content/50">Last 6 months</span>
        </div>
        <div className="h-64 px-2 pb-3 pt-4 sm:px-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueByMonth}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(var(--su))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="oklch(var(--su))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" stroke="oklch(var(--bc) / 0.08)" vertical={false} />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "oklch(var(--bc) / 0.55)", fontSize: 12 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={44}
                tick={{ fill: "oklch(var(--bc) / 0.45)", fontSize: 11 }}
                tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [`$${Number(v).toLocaleString()}`, "Revenue"]}
                labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="oklch(var(--su))"
                strokeWidth={2.5}
                fill="url(#revFill)"
                dot={{ r: 3, fill: "oklch(var(--b1))", stroke: "oklch(var(--su))", strokeWidth: 2 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
