"use client";

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

export function DashboardCharts({
  workOrderTrend,
  revenueByMonth,
}: {
  workOrderTrend: { month: string; count: number }[];
  revenueByMonth: { month: string; revenue: number }[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base">Work Orders (6 months)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workOrderTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" name="Work Orders" fill="oklch(var(--p))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base">Invoiced Revenue (6 months)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueByMonth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v) => [`$${Number(v).toLocaleString()}`, "Revenue"]} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="oklch(var(--su))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
