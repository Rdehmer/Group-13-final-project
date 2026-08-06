import type { UserRole } from "@/lib/types";

export type TopbarConfig = {
  showSearch: boolean;
  showInbox: boolean;
};

export function topbarConfigForRole(role: UserRole): TopbarConfig {
  switch (role) {
    case "customer":
      return { showSearch: false, showInbox: true };
    case "technician":
      return { showSearch: false, showInbox: false };
    case "service_manager":
      return { showSearch: true, showInbox: true };
    case "billing":
      return { showSearch: true, showInbox: true };
    case "vendor":
      return { showSearch: false, showInbox: false };
    case "administrator":
      return { showSearch: true, showInbox: true };
    default:
      return { showSearch: false, showInbox: false };
  }
}

export function usesStaffInbox(role: UserRole): boolean {
  return role === "service_manager" || role === "billing" || role === "administrator";
}
