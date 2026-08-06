import type { UserRole } from "@/lib/types";

export type NavItem = {
  href: string;
  label: string;
  roles: UserRole[];
  /** Indented sub-item in the sidebar (e.g. under Home). */
  indent?: boolean;
  /** Nested sidebar links shown in a dropdown under this item. */
  children?: NavItem[];
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    roles: ["administrator", "service_manager"],
  },
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
  {
    href: "/work-orders",
    label: "Work Orders",
    roles: ["administrator", "service_manager", "billing"],
  },
  {
    href: "/technician",
    label: "Technician Schedule",
    roles: ["administrator", "service_manager", "technician"],
  },
  {
    href: "/time-off",
    label: "Time Off Requests",
    roles: ["administrator", "service_manager", "technician"],
  },
  {
    href: "/dispatch",
    label: "Dispatch",
    roles: ["administrator", "service_manager", "technician"],
  },
  {
    href: "/parts",
    label: "Parts",
    roles: ["administrator", "service_manager", "technician", "billing"],
  },
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
    href: "/reports",
    label: "Reports",
    roles: ["administrator", "service_manager", "billing"],
  },
  {
    href: "/reports/invoice-cash",
    label: "Invoice & Cash",
    roles: ["service_manager"],
  },
  {
    href: "/customer",
    label: "Home",
    roles: ["customer"],
    children: [
      {
        href: "/customer/request-contract",
        label: "Request Contract",
        roles: ["customer"],
      },
      {
        href: "/customer/open-request",
        label: "Active Service",
        roles: ["customer"],
      },
      {
        href: "/customer/pay",
        label: "Pay bills",
        roles: ["customer"],
      },
      {
        href: "/customer/order-history",
        label: "Service History",
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
    href: "/users",
    label: "Users",
    roles: ["administrator"],
  },
  {
    href: "/settings",
    label: "Settings",
    roles: ["administrator"],
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

export function canAccess(role: UserRole, href: string): boolean {
  for (const item of NAV_ITEMS) {
    if (item.href === href && item.roles.includes(role)) return true;
    if (item.children?.some((child) => child.href === href && child.roles.includes(role))) {
      return true;
    }
  }
  return false;
}
