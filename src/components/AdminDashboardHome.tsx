import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ClickableStatCard } from "@/components/ClickableStatCard";
import type { UserRole } from "@/lib/types";

export type AdminDashboardData = {
  managerCount: number;
  technicianCount: number;
  billingCount: number;
  adminCount: number;
  activeStaffCount: number;
  inactiveStaffCount: number;
  managers: {
    id: string;
    full_name: string | null;
    email: string;
    is_active: boolean;
  }[];
};

/**
 * Administrator control-plane home — people and system first,
 * not the manager operations widget board.
 */
export function AdminDashboardHome({ data }: { data: AdminDashboardData }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin home"
        description="Manage manager accounts, staff access, and company controls — field operations stay with service managers."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/users" className="btn btn-primary btn-sm">
              Manage users
            </Link>
            <Link href="/settings/employees" className="btn btn-outline btn-sm">
              Permissions & rates
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ClickableStatCard
          label="Service managers"
          value={String(data.managerCount)}
          href="/users"
          hint="Primary accounts to review"
        />
        <ClickableStatCard
          label="Technicians"
          value={String(data.technicianCount)}
          href="/users"
        />
        <ClickableStatCard
          label="Billing staff"
          value={String(data.billingCount)}
          href="/users"
        />
        <ClickableStatCard
          label="Active staff"
          value={String(data.activeStaffCount)}
          href="/users"
          hint={
            data.inactiveStaffCount > 0
              ? `${data.inactiveStaffCount} inactive`
              : "All listed staff active"
          }
        />
      </div>

      <section className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="card-title text-base">Service managers</h2>
              <p className="text-sm opacity-70">
                These accounts run day-to-day dispatch, schedules, and approvals.
              </p>
            </div>
            <Link href="/users" className="btn btn-ghost btn-sm">
              Open user directory
            </Link>
          </div>
          {data.managers.length === 0 ? (
            <p className="text-sm opacity-60">No service manager accounts yet.</p>
          ) : (
            <ul className="divide-y divide-base-300 rounded-box border border-base-300">
              {data.managers.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{m.full_name?.trim() || m.email}</p>
                    <p className="text-xs opacity-60 truncate">{m.email}</p>
                  </div>
                  <span
                    className={`badge badge-sm ${m.is_active ? "badge-success" : "badge-ghost"}`}
                  >
                    {m.is_active ? "Active" : "Inactive"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link
          href="/users"
          className="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm transition hover:border-primary/40"
        >
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">1</p>
          <p className="mt-1 font-semibold">Assign manager roles</p>
          <p className="mt-1 text-sm opacity-70">
            Create or update service manager accounts in Users.
          </p>
        </Link>
        <Link
          href="/settings/employees"
          className="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm transition hover:border-primary/40"
        >
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">2</p>
          <p className="mt-1 font-semibold">Tune permissions</p>
          <p className="mt-1 text-sm opacity-70">
            Set module access and rates per employee without cluttering their ops sidebar.
          </p>
        </Link>
        <Link
          href="/settings"
          className="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm transition hover:border-primary/40"
        >
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">3</p>
          <p className="mt-1 font-semibold">Company settings</p>
          <p className="mt-1 text-sm opacity-70">
            GL accounts, contract plans, and other system configuration.
          </p>
        </Link>
      </section>

      <p className="text-xs opacity-60">
        Administrators: {data.adminCount}. Field work stays on the service manager dashboard and
        sidebar.
      </p>
    </div>
  );
}

export function emptyAdminDashboard(): AdminDashboardData {
  return {
    managerCount: 0,
    technicianCount: 0,
    billingCount: 0,
    adminCount: 0,
    activeStaffCount: 0,
    inactiveStaffCount: 0,
    managers: [],
  };
}

export function summarizeStaffProfiles(
  rows: {
    id: string;
    full_name: string | null;
    email: string;
    role: UserRole;
    is_active: boolean;
  }[],
): AdminDashboardData {
  const staff = rows.filter((r) =>
    ["administrator", "service_manager", "technician", "billing"].includes(r.role),
  );
  const managers = staff
    .filter((r) => r.role === "service_manager")
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
  return {
    managerCount: managers.length,
    technicianCount: staff.filter((r) => r.role === "technician").length,
    billingCount: staff.filter((r) => r.role === "billing").length,
    adminCount: staff.filter((r) => r.role === "administrator").length,
    activeStaffCount: staff.filter((r) => r.is_active).length,
    inactiveStaffCount: staff.filter((r) => !r.is_active).length,
    managers: managers.map((m) => ({
      id: m.id,
      full_name: m.full_name,
      email: m.email,
      is_active: m.is_active,
    })),
  };
}
