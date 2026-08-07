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
 * Staff summaries for the administrator dashboard.
 * Live admin UI is `AdminDashboardStudio` on `/dashboard`.
 */
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
