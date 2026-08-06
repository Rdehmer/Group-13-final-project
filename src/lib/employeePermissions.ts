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
  technician: "Technician Schedule",
  dispatch: "Dispatch Board",
  parts: "Parts / Inventory",
  billing: "Billing / Invoices",
  payments: "Payments",
  batches: "Accounting Batches",
  reports: "Reports",
  invoice_cash: "Invoice & Cash Report",
  users: "User Directory",
  settings: "Company Settings",
  settings_gl: "GL Accounts",
  settings_employees: "Employee Data",
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
      "dispatch",
      "parts",
    ],
  },
  {
    id: "accounting",
    label: "Accounting & Revenue",
    keys: ["billing", "payments", "batches", "reports", "invoice_cash"],
  },
  {
    id: "admin",
    label: "Administration",
    keys: ["users", "settings", "settings_gl", "settings_employees"],
  },
];

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as PermissionKey[];

/** Primary path prefix → permission key */
const HREF_PERMISSION: { prefix: string; key: PermissionKey }[] = [
  { prefix: "/settings/gl-accounts", key: "settings_gl" },
  { prefix: "/settings/employees", key: "settings_employees" },
  { prefix: "/settings", key: "settings" },
  { prefix: "/reports/invoice-cash", key: "invoice_cash" },
  { prefix: "/reports", key: "reports" },
  { prefix: "/dashboard", key: "dashboard" },
  { prefix: "/customers", key: "customers" },
  { prefix: "/equipment", key: "equipment" },
  { prefix: "/contracts", key: "contracts" },
  { prefix: "/work-orders", key: "work_orders" },
  { prefix: "/technician", key: "technician" },
  { prefix: "/dispatch", key: "dispatch" },
  { prefix: "/parts", key: "parts" },
  { prefix: "/billing", key: "billing" },
  { prefix: "/payments", key: "payments" },
  { prefix: "/batches", key: "batches" },
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
    "dispatch",
    "parts",
    "reports",
    "invoice_cash",
  ],
  technician: ["technician", "dispatch", "parts"],
  billing: [
    "customers",
    "work_orders",
    "parts",
    "billing",
    "payments",
    "batches",
    "reports",
  ],
  customer: [],
};

export function permissionKeyForHref(href: string): PermissionKey | null {
  const path = href.split("?")[0] || href;
  for (const { prefix, key } of HREF_PERMISSION) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return key;
  }
  if (path.startsWith("/customer")) return null;
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
  // Customer portal uses role only
  if (profile.role === "customer") {
    return href === "/customer" || href.startsWith("/customer/");
  }
  const key = permissionKeyForHref(href);
  if (!key) return false;
  return profileHasModule(profile, key);
}

function navAllowed(item: NavItem, profile: Profile): boolean {
  if (profile.role === "customer") {
    return item.roles.includes("customer");
  }
  return profileCanAccessHref(profile, item.href);
}

/** Sidebar items filtering by effective employee permissions. */
export function filterNavForProfile(profile: Profile): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (profile.role === "customer") {
      return item.roles.includes("customer");
    }
    if (item.children?.length) {
      const kids = item.children.filter((c) => navAllowed(c, profile));
      if (kids.length || profileCanAccessHref(profile, item.href)) {
        return true;
      }
      return false;
    }
    return profileCanAccessHref(profile, item.href);
  }).map((item) => {
    if (!item.children?.length) return item;
    return {
      ...item,
      children: item.children.filter((c) =>
        profile.role === "customer"
          ? c.roles.includes("customer")
          : profileCanAccessHref(profile, c.href),
      ),
    };
  });
}

export function staffRoles(): UserRole[] {
  return ["administrator", "service_manager", "technician", "billing"];
}

export function isStaffRole(role: UserRole): boolean {
  return role !== "customer";
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
