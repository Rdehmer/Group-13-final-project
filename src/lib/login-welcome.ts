import type { UserRole } from "@/lib/types";

export function loadingSubtitleForRole(role: UserRole): string {
  switch (role) {
    case "customer":
      return "Loading your account…";
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
  return role === "customer" ? "Welcome to your portal" : "Welcome back";
}
