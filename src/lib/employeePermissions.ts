/**
 * ServiceTitan-style employee permissions:
 * - Role = template of module access
 * - permission_overrides on the profile fine-tune grants/denies
 */

import type { PermissionKey, PermissionOverrides, Profile, UserRole } from "@/lib/types";
import type { NavItem } from "@/lib/roles";
import { NAV_ITEMS } from "@/lib/roles";

export type PermissionGroup = {
  id: string;
  label: string;
  keys: PermissionKey[];
};

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  dashboard: "Dashboard",
  customers: "Customers",
  equipment: "Equipment",
  contracts: "Contracts",
  work_orders: "Work Orders",
  technician: "My Day / Availability",
  time_off: "Time Off Requests",
  timesheets: "Timesheets & Payroll Sign-off",
  dispatch: "Dispatch Board",
  parts: "Parts / Inventory",
  vendors: "Suppliers / AP",
  service_vendors: "Service Vendors",
  emergency_purchases: "Reimbursements",
  inbox: "Inbox (customer messages)",
  billing: "Billing / Invoices",
  payments: "Payments",
  batches: "Accounting Batches",
  period_close: "Period Close",
  reports: "Reports",
  invoice_cash: "Invoice & Cash Report",
  users: "User Directory",
  settings: "Company Settings",
  settings_gl: "GL Accounts",
  settings_employees: "Employee Data",
  settings_contract_plans: "Contract Plans",
  settings_vendor_matrix: "Vendor Matrix",
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "operations",
    label: "Operations",
    keys: [
      "dashboard",
      "customers",
      "equipment",
      "contracts",
      "work_orders",
      "technician",
      "time_off",
      "timesheets",
      "dispatch",
      "parts",
      "emergency_purchases",
      "inbox",
    ],
  },
  {
    id: "accounting",
    label: "Accounting & Revenue",
    keys: ["vendors", "service_vendors", "billing", "payments", "batches", "period_close", "reports", "invoice_cash"],
  },
  {
    id: "admin",
    label: "Administration",
    keys: ["users", "settings", "settings_gl", "settings_employees", "settings_contract_plans", "settings_vendor_matrix"],
  },
];

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as PermissionKey[];

/** Primary path prefix → permission key */
const HREF_PERMISSION: { prefix: string; key: PermissionKey }[] = [
  { prefix: "/settings/gl-accounts", key: "settings_gl" },
  { prefix: "/settings/employees", key: "settings_employees" },
  { prefix: "/settings/contract-plans", key: "settings_contract_plans" },
  { prefix: "/settings/vendor-matrix", key: "settings_vendor_matrix" },
  { prefix: "/settings", key: "settings" },
  { prefix: "/reports/invoice-cash", key: "invoice_cash" },
  { prefix: "/reports", key: "reports" },
  { prefix: "/dashboard", key: "dashboard" },
  { prefix: "/customers", key: "customers" },
  { prefix: "/equipment", key: "equipment" },
  { prefix: "/contracts", key: "contracts" },
  { prefix: "/work-orders", key: "work_orders" },
  { prefix: "/technician", key: "technician" },
  { prefix: "/scheduling", key: "technician" },
  { prefix: "/time-off", key: "time_off" },
  { prefix: "/timesheets", key: "timesheets" },
  { prefix: "/dispatch", key: "dispatch" },
  { prefix: "/parts", key: "parts" },
  { prefix: "/vendors", key: "vendors" },
  { prefix: "/service-vendors", key: "service_vendors" },
  { prefix: "/emergency-purchases", key: "emergency_purchases" },
  { prefix: "/inbox", key: "inbox" },
  { prefix: "/billing", key: "billing" },
  { prefix: "/payments", key: "payments" },
  { prefix: "/batches", key: "batches" },
  { prefix: "/accounting/close", key: "period_close" },
  { prefix: "/users", key: "users" },
];

/** Role templates (which modules the role package includes by default). */
export const ROLE_PERMISSION_DEFAULTS: Record<UserRole, PermissionKey[]> = {
  administrator: ALL_PERMISSION_KEYS,
  service_manager: [
    "dashboard",
    "customers",
    "equipment",
    "contracts",
    "work_orders",
    "technician",
    "time_off",
    "timesheets",
    "dispatch",
    "parts",
    "vendors",
    "service_vendors",
    "emergency_purchases",
    "inbox",
    "reports",
    "invoice_cash",
  ],
  technician: ["technician", "time_off", "timesheets", "dispatch", "parts"],
  billing: [
    "customers",
    "work_orders",
    "parts",
    "vendors",
    "service_vendors",
    "inbox",
    "billing",
    "payments",
    "batches",
    "period_close",
    "reports",
    "timesheets",
  ],
  customer: [],
  vendor: [],
};

export function permissionKeyForHref(href: string): PermissionKey | null {
  const path = href.split("?")[0] || href;
  for (const { prefix, key } of HREF_PERMISSION) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return key;
  }
  if (path.startsWith("/customer")) return null;
  if (path.startsWith("/vendor") && path !== "/vendors" && !path.startsWith("/vendors/")) {
    return null;
  }
  return null;
}

export function roleDefaultPermissions(role: UserRole): Set<PermissionKey> {
  return new Set(ROLE_PERMISSION_DEFAULTS[role] ?? []);
}

export function normalizeOverrides(
  raw: PermissionOverrides | null | undefined,
): PermissionOverrides {
  if (!raw || typeof raw !== "object") return {};
  const out: PermissionOverrides = {};
  for (const key of ALL_PERMISSION_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

/** Effective access after role template + overrides. */
export function hasModuleAccess(
  role: UserRole,
  overrides: PermissionOverrides | null | undefined,
  key: PermissionKey,
): boolean {
  const o = normalizeOverrides(overrides);
  if (typeof o[key] === "boolean") return o[key]!;
  return roleDefaultPermissions(role).has(key);
}

export function effectivePermissionMap(
  role: UserRole,
  overrides: PermissionOverrides | null | undefined,
): Record<PermissionKey, boolean> {
  const map = {} as Record<PermissionKey, boolean>;
  for (const key of ALL_PERMISSION_KEYS) {
    map[key] = hasModuleAccess(role, overrides, key);
  }
  return map;
}

export function profileHasModule(profile: Profile, key: PermissionKey): boolean {
  if (!profile.is_active) return false;
  return hasModuleAccess(profile.role, profile.permission_overrides, key);
}

export function profileCanAccessHref(profile: Profile, href: string): boolean {
  if (!profile.is_active) return false;
  // Customer / vendor portals use role only (not employee permission matrix)
  if (profile.role === "customer") {
    return href === "/customer" || href.startsWith("/customer/");
  }
  if (profile.role === "vendor") {
    return href === "/vendor" || href.startsWith("/vendor/");
  }
  const key = permissionKeyForHref(href);
  if (!key) return false;
  return profileHasModule(profile, key);
}

function navAllowed(item: NavItem, profile: Profile): boolean {
  if (profile.role === "customer") {
    return item.roles.includes("customer");
  }
  if (profile.role === "vendor") {
    return item.roles.includes("vendor");
  }
  // Section headers are labels only — visibility comes from children / role list.
  if (item.section) {
    return item.roles.includes(profile.role);
  }
  // Honor NAV_ITEMS.roles so manager-only tabs stay off Admin / other staff.
  if (!item.roles.includes(profile.role)) return false;
  return profileCanAccessHref(profile, item.href);
}

function filterNavItem(item: NavItem, profile: Profile): NavItem | null {
  if (profile.role === "customer") {
    if (!item.roles.includes("customer")) return null;
    if (!item.children?.length) return item;
    const kids = item.children
      .map((c) => filterNavItem(c, profile))
      .filter((c): c is NavItem => c != null);
    if (kids.length === 0) return null;
    return { ...item, children: kids };
  }

  if (profile.role === "vendor") {
    if (!item.roles.includes("vendor")) return null;
    if (!item.children?.length) return item;
    const kids = item.children
      .map((c) => filterNavItem(c, profile))
      .filter((c): c is NavItem => c != null);
    if (kids.length === 0) return null;
    return { ...item, children: kids };
  }

  if (item.section) {
    if (!item.roles.includes(profile.role)) return null;
    const kids = (item.children ?? [])
      .map((c) => filterNavItem(c, profile))
      .filter((c): c is NavItem => c != null);
    if (kids.length === 0) return null;
    return { ...item, children: kids };
  }

  // Nested parent page (e.g. Settings) with sub-links
  if (item.children?.length) {
    if (!navAllowed(item, profile)) return null;
    const kids = item.children
      .map((c) => filterNavItem(c, profile))
      .filter((c): c is NavItem => c != null);
    return { ...item, children: kids };
  }

  return navAllowed(item, profile) ? item : null;
}

/** Sidebar items filtering by effective employee permissions. */
export function filterNavForProfile(profile: Profile): NavItem[] {
  return NAV_ITEMS.map((item) => filterNavItem(item, profile)).filter(
    (item): item is NavItem => item != null,
  );
}

export function staffRoles(): UserRole[] {
  return ["administrator", "service_manager", "technician", "billing"];
}

export function isStaffRole(role: UserRole): boolean {
  return role !== "customer" && role !== "vendor";
}

/** Is an override different from the role default? */
export function isOverrideActive(
  role: UserRole,
  overrides: PermissionOverrides,
  key: PermissionKey,
): boolean {
  const o = normalizeOverrides(overrides);
  if (typeof o[key] !== "boolean") return false;
  return o[key]! !== roleDefaultPermissions(role).has(key);
}
