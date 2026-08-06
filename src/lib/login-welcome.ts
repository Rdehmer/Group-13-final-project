import type { UserRole } from "@/lib/types";

export function loadingSubtitleForRole(role: UserRole): string {
  switch (role) {
    case "customer":
      return "Loading your account…";
    case "vendor":
      return "Loading vendor portal…";
    case "technician":
      return "Loading My Day…";
    case "billing":
      return "Loading billing workspace…";
    case "service_manager":
    case "administrator":
    default:
      return "Loading dashboard…";
  }
}

export function welcomeGreeting(displayName: string | null | undefined, role: UserRole): string {
  if (displayName?.trim()) {
    return `Welcome back, ${displayName.split(" ")[0]}`;
  }
  if (role === "customer") return "Welcome to your portal";
  if (role === "vendor") return "Welcome to the vendor portal";
  return "Welcome back";
}
