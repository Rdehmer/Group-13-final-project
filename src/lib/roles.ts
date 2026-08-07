import type { UserRole } from "@/lib/types";

export type NavItem = {
  href: string;
  label: string;
  roles: UserRole[];
  /** Indented sub-item in the sidebar (e.g. under Home). */
  indent?: boolean;
  /** Nested sidebar links shown in a dropdown under this item. */
  children?: NavItem[];
  /**
   * Non-clickable sidebar category label. Only `children` are real destinations.
   * `href` is a stable id (e.g. #nav-field) for React keys — not a page route.
   */
  section?: boolean;
};

/**
 * Sidebar IA by role:
 * - Administrator: lean control plane (users / settings / finance first)
 * - Service manager: day-to-day field operations
 * - Billing / tech / portals: unchanged specialty trees
 */
export const NAV_ITEMS: NavItem[] = [
  // ── Administrator: people & system first ───────────────────────────
  {
    section: true,
    href: "#nav-admin-people",
    label: "People & access",
    roles: ["administrator"],
    children: [
      {
        href: "/users",
        label: "Users",
        roles: ["administrator"],
      },
      {
        href: "/settings/employees",
        label: "Employee permissions",
        roles: ["administrator"],
      },
    ],
  },
  {
    section: true,
    href: "#nav-admin-company",
    label: "Company",
    roles: ["administrator"],
    children: [
      {
        href: "/dashboard",
        label: "Admin home",
        roles: ["administrator"],
      },
      {
        href: "/settings",
        label: "Settings",
        roles: ["administrator"],
        children: [
          {
            href: "/settings/gl-accounts",
            label: "GL Accounts",
            roles: ["administrator"],
          },
          {
            href: "/settings/contract-plans",
            label: "Contract Plans",
            roles: ["administrator"],
          },
        ],
      },
    ],
  },
  {
    section: true,
    href: "#nav-admin-finance",
    label: "Finance controls",
    roles: ["administrator"],
    children: [
      {
        href: "/billing",
        label: "Billing",
        roles: ["administrator"],
      },
      {
        href: "/payments",
        label: "Payments",
        roles: ["administrator"],
      },
      {
        href: "/batches",
        label: "Batches",
        roles: ["administrator"],
      },
      {
        href: "/accounting/close",
        label: "Period Close",
        roles: ["administrator"],
      },
      {
        href: "/reports",
        label: "Reports",
        roles: ["administrator"],
      },
    ],
  },

  // ── Service manager / billing: Overview ────────────────────────────
  {
    section: true,
    href: "#nav-overview",
    label: "Overview",
    roles: ["service_manager", "billing"],
    children: [
      {
        href: "/dashboard",
        label: "Dashboard",
        roles: ["service_manager"],
      },
      {
        href: "/inbox",
        /** Staff mailbox linked to customer portal Inbox threads. */
        label: "Inbox",
        roles: ["service_manager", "billing"],
      },
    ],
  },
  // ── Manager / billing: Customers & portfolio ───────────────────────
  {
    section: true,
    href: "#nav-customers",
    label: "Customers",
    roles: ["service_manager", "billing"],
    children: [
      {
        href: "/customers",
        label: "Customers",
        roles: ["service_manager", "billing"],
      },
      {
        href: "/equipment",
        label: "Equipment",
        roles: ["service_manager"],
      },
      {
        href: "/contracts",
        label: "Contracts",
        roles: ["service_manager"],
      },
    ],
  },
  // ── Manager / tech / billing: Field ops ────────────────────────────
  {
    section: true,
    href: "#nav-field",
    label: "Field Operations",
    roles: ["service_manager", "technician", "billing"],
    children: [
      {
        href: "/work-orders",
        label: "Work Orders",
        roles: ["service_manager", "billing"],
      },
      {
        href: "/technician",
        /** Managers see full schedule; techs land on “My Day” (label overridden in AppShell). */
        label: "Technician Schedule",
        roles: ["service_manager", "technician"],
      },
      {
        href: "/scheduling",
        /** Techs set preferred availability hours; managers also assign shifts. */
        label: "Team Schedule",
        roles: ["service_manager", "technician"],
      },
      {
        href: "/dispatch",
        label: "Dispatch",
        roles: ["service_manager"],
      },
      {
        href: "/timesheets",
        label: "Timesheets",
        roles: ["service_manager", "technician", "billing"],
      },
      {
        href: "/timesheets/billing-report",
        label: "Timesheet Report",
        roles: ["service_manager", "billing"],
      },
      {
        href: "/time-off",
        label: "Time Off Requests",
        roles: ["service_manager", "technician"],
      },
    ],
  },
  // ── Manager / tech / billing: Inventory ────────────────────────────
  {
    section: true,
    href: "#nav-inventory",
    label: "Inventory",
    roles: ["service_manager", "technician", "billing"],
    children: [
      {
        href: "/parts",
        label: "Parts",
        roles: ["service_manager", "technician", "billing"],
      },
      {
        href: "/vendors",
        label: "Vendors",
        roles: ["service_manager", "billing"],
        children: [
          {
            href: "/vendors",
            label: "Suppliers",
            roles: ["service_manager", "billing"],
          },
          {
            href: "/service-vendors",
            label: "Service vendors",
            roles: ["service_manager", "billing"],
          },
        ],
      },
      {
        href: "/emergency-purchases",
        /** Manager inbox for technician “I bought a part” emergency buys. */
        label: "Reimbursements",
        roles: ["service_manager"],
      },
    ],
  },
  // ── Manager / billing: Finance (ops + AR views) ────────────────────
  {
    section: true,
    href: "#nav-finance",
    label: "Finance",
    roles: ["service_manager", "billing"],
    children: [
      {
        href: "/billing",
        label: "Billing",
        roles: ["billing"],
      },
      {
        href: "/payments",
        label: "Payments",
        roles: ["billing"],
      },
      {
        href: "/batches",
        label: "Batches",
        roles: ["billing"],
      },
      {
        href: "/accounting/close",
        label: "Period Close",
        roles: ["billing"],
      },
      {
        href: "/reports",
        label: "Reports",
        roles: ["service_manager", "billing"],
      },
      {
        href: "/reports/invoice-cash",
        label: "Invoice & Cash",
        roles: ["service_manager"],
      },
    ],
  },
  // ── Vendor portal ──────────────────────────────────────────────────
  {
    href: "/vendor",
    label: "Vendor Home",
    roles: ["vendor"],
  },
  {
    href: "/vendor/inbox",
    label: "Inbox",
    roles: ["vendor"],
  },
  // ── Customer portal ────────────────────────────────────────────────
  {
    href: "/customer",
    label: "Home",
    roles: ["customer"],
    children: [
      {
        href: "/customer/contracts",
        label: "Contracts",
        roles: ["customer"],
        children: [
          {
            href: "/customer/request-contract",
            label: "Request Contract",
            roles: ["customer"],
          },
          {
            href: "/customer/contracts",
            label: "My Contracts",
            roles: ["customer"],
          },
          {
            href: "/customer/equipment",
            label: "My Equipment",
            roles: ["customer"],
          },
        ],
      },
      {
        href: "/customer/request-service",
        label: "Service",
        roles: ["customer"],
        children: [
          {
            href: "/customer/request-service",
            label: "Request Service",
            roles: ["customer"],
          },
          {
            href: "/customer/open-request",
            label: "Active Service",
            roles: ["customer"],
          },
          {
            href: "/customer/order-history",
            label: "Service History",
            roles: ["customer"],
          },
        ],
      },
      {
        href: "/customer/pay",
        label: "Billing & Account",
        roles: ["customer"],
        children: [
          {
            href: "/customer/pay",
            label: "Payments",
            roles: ["customer"],
          },
          {
            href: "/customer/account",
            label: "Account Information",
            roles: ["customer"],
          },
        ],
      },
    ],
  },
];

export function homeForRole(role: UserRole): string {
  switch (role) {
    case "technician":
      return "/technician";
    case "billing":
      return "/billing";
    case "customer":
      return "/customer";
    case "vendor":
      return "/vendor";
    case "administrator":
      return "/dashboard";
    case "service_manager":
    default:
      return "/dashboard";
  }
}

function itemMatchesHref(item: NavItem, href: string, role: UserRole): boolean {
  const path = href.split("?")[0] || href;
  if (
    !item.section &&
    item.roles.includes(role) &&
    (path === item.href || path.startsWith(`${item.href}/`))
  ) {
    return true;
  }
  if (item.children?.some((child) => itemMatchesHref(child, href, role))) return true;
  return false;
}

export function canAccess(role: UserRole, href: string): boolean {
  // Administrators retain deep-link access to ops pages even when the sidebar is lean.
  if (role === "administrator") {
    const path = href.split("?")[0] || href;
    if (
      path.startsWith("/customer") ||
      (path.startsWith("/vendor") && path !== "/vendors" && !path.startsWith("/vendors/"))
    ) {
      return false;
    }
    return true;
  }
  for (const item of NAV_ITEMS) {
    if (itemMatchesHref(item, href, role)) return true;
  }
  return false;
}
