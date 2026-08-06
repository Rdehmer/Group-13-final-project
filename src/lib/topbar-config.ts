import type { UserRole } from "@/lib/types";

export type TopbarConfig = {
  showSearch: boolean;
  showInbox: boolean;
  showSettings: boolean;
};

export function topbarConfigForRole(role: UserRole): TopbarConfig {
  switch (role) {
    case "customer":
      return { showSearch: false, showInbox: true, showSettings: false };
    case "technician":
      return { showSearch: false, showInbox: false, showSettings: false };
    case "service_manager":
      return { showSearch: true, showInbox: true, showSettings: false };
    case "billing":
      return { showSearch: true, showInbox: true, showSettings: false };
    case "vendor":
      return { showSearch: false, showInbox: true, showSettings: false };
    case "administrator":
      return { showSearch: true, showInbox: true, showSettings: true };
    default:
      return { showSearch: false, showInbox: false, showSettings: false };
  }
}

export function usesStaffInbox(role: UserRole): boolean {
  return role === "service_manager" || role === "billing" || role === "administrator";
}
