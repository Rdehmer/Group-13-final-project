import type { UserRole } from "@/lib/types";

export type NavItem = {
  href: string;
  label: string;
  roles: UserRole[];
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
    roles: ["administrator", "service_manager"],
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
    href: "/reports",
    label: "Reports-Contracts",
    roles: ["administrator", "service_manager", "billing"],
  },
  {
    href: "/reports/invoice-cash",
    label: "Reports-Invoice & Cash",
    roles: ["service_manager"],
  },
  {
    href: "/customer",
    label: "My Portal",
    roles: ["customer"],
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
  const item = NAV_ITEMS.find((n) => n.href === href);
  if (!item) return false;
  return item.roles.includes(role);
}
