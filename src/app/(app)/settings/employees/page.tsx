"use client";

/**
 * Admin employee directory — rates, identity, link into permission editor.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  Users,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge } from "@/components/ui";
import { formatMoneyRate, listEmployees } from "@/lib/employees";
import { effectivePermissionMap } from "@/lib/employeePermissions";
import { ROLE_LABELS, type Profile } from "@/lib/types";

export default function EmployeesSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extrasLocal, setExtrasLocal] = useState(false);
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listEmployees(supabase);
    setError(res.error);
    setEmployees(res.data);
    setExtrasLocal(res.extrasLocal);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees.filter((e) => {
      if (!showInactive && !e.is_active) return false;
      if (roleFilter !== "all" && e.role !== roleFilter) return false;
      if (!needle) return true;
      return (
        (e.full_name ?? "").toLowerCase().includes(needle) ||
        e.email.toLowerCase().includes(needle) ||
        (e.employee_number ?? "").toLowerCase().includes(needle) ||
        (e.job_title ?? "").toLowerCase().includes(needle)
      );
    });
  }, [employees, q, roleFilter, showInactive]);

  if (loading) {
    return <p className="p-8 text-center text-sm opacity-50">Loading employees…</p>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        description="Staff rates, contact data, and module permissions (ServiceTitan-style)"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/settings" className="btn btn-ghost btn-sm gap-1">
              <ArrowLeft className="h-4 w-4" /> Company settings
            </Link>
            <Link href="/users" className="btn btn-ghost btn-sm gap-1">
              User directory
            </Link>
            <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        }
      />

      {extrasLocal ? (
        <div className="alert alert-warning text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Some employee fields are browser-only</p>
            <p className="opacity-80">
              Run{" "}
              <code className="text-xs">supabase/migrations/20260806_employee_data.sql</code> in
              Supabase so title, phone, employee #, and permission overrides sync for all admins.
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input input-bordered input-sm w-full max-w-xs"
          placeholder="Search name, email, title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="select select-bordered select-sm"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="all">All roles</option>
          {(Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[])
            .filter((r) => r !== "customer")
            .map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
        </select>
        <label className="flex cursor-pointer items-center gap-1 text-xs">
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show Inactive
        </label>
      </div>

      <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
        <div className="flex items-center gap-2 border-b border-base-200 px-4 py-3">
          <Users className="h-4 w-4" />
          <h2 className="font-bold">Staff Directory</h2>
          <span className="text-xs opacity-50">({filtered.length})</span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No Staff Employees"
              description="Staff are users with an employee role (not customer). Create accounts on login/signup, then assign a staff role here or in Users."
            />
          </div>
        ) : (
          <DualHorizontalScroll>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Cost Rate</th>
                  <th>Billing Rate</th>
                  <th>Permissions</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => {
                  const map = effectivePermissionMap(emp.role, emp.permission_overrides);
                  const granted = Object.values(map).filter(Boolean).length;
                  const overrides = Object.keys(emp.permission_overrides ?? {}).length;
                  return (
                    <tr key={emp.id} className={!emp.is_active ? "opacity-55" : ""}>
                      <td>
                        <div className="font-medium">{emp.full_name || "—"}</div>
                        <div className="text-xs opacity-55">{emp.email}</div>
                        {emp.job_title || emp.employee_number ? (
                          <div className="text-[11px] opacity-45">
                            {[emp.employee_number ? `#${emp.employee_number}` : null, emp.job_title]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        ) : null}
                      </td>
                      <td>{ROLE_LABELS[emp.role]}</td>
                      <td className="font-mono text-xs">{formatMoneyRate(emp.hourly_cost_rate)}</td>
                      <td className="font-mono text-xs">{formatMoneyRate(emp.hourly_billing_rate)}</td>
                      <td className="text-xs">
                        {granted} modules
                        {overrides > 0 ? (
                          <span className="badge badge-warning badge-xs ml-1">{overrides} overrides</span>
                        ) : (
                          <span className="badge badge-ghost badge-xs ml-1">role default</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge
                          label={emp.is_active ? "Active" : "Inactive"}
                          tone={emp.is_active ? "success" : "neutral"}
                        />
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/settings/employees/${emp.id}`}
                          className="btn btn-ghost btn-xs gap-0.5"
                        >
                          Manage <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DualHorizontalScroll>
        )}
      </section>
    </div>
  );
}
