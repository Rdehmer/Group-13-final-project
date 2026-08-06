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

export const NAV_ITEMS: NavItem[] = [
  // ── Staff: Overview ────────────────────────────────────────────────
  {
    section: true,
    href: "#nav-overview",
    label: "Overview",
    roles: ["administrator", "service_manager"],
    children: [
      {
        href: "/dashboard",
        label: "Dashboard",
        roles: ["administrator", "service_manager"],
      },
      {
        href: "/inbox",
        /** Manager mailbox linked to customer portal Inbox threads. */
        label: "Inbox",
        roles: ["service_manager"],
      },
    ],
  },
  // ── Staff: Customers & portfolio ───────────────────────────────────
  {
    section: true,
    href: "#nav-customers",
    label: "Customers",
    roles: ["administrator", "service_manager", "billing"],
    children: [
      {
        href: "/customers",
        label: "Customers",
        roles: ["administrator", "service_manager", "billing"],
      },
      {
        href: "/equipment",
        label: "Equipment",
        roles: ["administrator", "service_manager"],
      },
      {
        href: "/contracts",
        label: "Contracts",
        roles: ["administrator", "service_manager"],
      },
    ],
  },
  // ── Staff: Field ops ───────────────────────────────────────────────
  {
    section: true,
    href: "#nav-field",
    label: "Field Operations",
    roles: ["administrator", "service_manager", "technician", "billing"],
    children: [
      {
        href: "/work-orders",
        label: "Work Orders",
        roles: ["administrator", "service_manager", "billing"],
      },
      {
        href: "/technician",
        /** Managers see full schedule; techs land on “My Day” (label overridden in AppShell). */
        label: "Technician Schedule",
        roles: ["administrator", "service_manager", "technician"],
      },
      {
        href: "/dispatch",
        label: "Dispatch",
        roles: ["administrator", "service_manager", "technician"],
      },
      {
        href: "/time-off",
        label: "Time Off Requests",
        roles: ["administrator", "service_manager", "technician"],
      },
      {
        href: "/timesheets",
        label: "Timesheets",
        roles: ["administrator", "service_manager", "technician", "billing"],
      },
    ],
  },
  // ── Staff: Inventory ───────────────────────────────────────────────
  {
    section: true,
    href: "#nav-inventory",
    label: "Inventory",
    roles: ["administrator", "service_manager", "technician", "billing"],
    children: [
      {
        href: "/parts",
        label: "Parts",
        roles: ["administrator", "service_manager", "technician", "billing"],
      },
      {
        href: "/vendors",
        label: "Vendors",
        roles: ["administrator", "service_manager", "billing"],
        children: [
          {
            href: "/vendors",
            label: "Suppliers",
            roles: ["administrator", "service_manager", "billing"],
          },
          {
            href: "/service-vendors",
            label: "Service vendors",
            roles: ["administrator", "service_manager", "billing"],
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
  // ── Staff: Finance ─────────────────────────────────────────────────
  {
    section: true,
    href: "#nav-finance",
    label: "Finance",
    roles: ["administrator", "service_manager", "billing"],
    children: [
      {
        href: "/billing",
        label: "Billing",
        roles: ["administrator", "billing"],
      },
      {
        href: "/payments",
        label: "Payments",
        roles: ["administrator", "billing"],
      },
      {
        href: "/batches",
        label: "Batches",
        roles: ["administrator", "billing"],
      },
      {
        href: "/accounting/close",
        label: "Period Close",
        roles: ["administrator", "billing"],
      },
      {
        href: "/reports",
        label: "Reports",
        roles: ["administrator", "service_manager", "billing"],
      },
      {
        href: "/reports/invoice-cash",
        label: "Invoice & Cash",
        roles: ["service_manager"],
      },
    ],
  },
  // ── Staff: Administration ──────────────────────────────────────────
  {
    section: true,
    href: "#nav-admin",
    label: "Administration",
    roles: ["administrator"],
    children: [
      {
        href: "/users",
        label: "Users",
        roles: ["administrator"],
      },
      {
        href: "/settings",
        label: "Settings",
        roles: ["administrator"],
        children: [
          {
            href: "/settings/employees",
            label: "Employees",
            roles: ["administrator"],
          },
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
    case "administrator":
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
  for (const item of NAV_ITEMS) {
    if (itemMatchesHref(item, href, role)) return true;
  }
  return false;
}
