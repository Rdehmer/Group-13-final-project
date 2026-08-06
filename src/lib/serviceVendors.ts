/**
 * Ecotrak-style service vendor helpers.
 */

import type { UserRole } from "@/lib/types";
import {
  canApproveVendors,
  canCreateVendor,
  canDeleteVendor,
  canEditVendorMaster,
  isVendorManager,
  newVendorApprovalStatus,
  todayIso,
  addDaysIso,
} from "@/lib/vendors";

export {
  canApproveVendors,
  canCreateVendor,
  canDeleteVendor,
  canEditVendorMaster,
  isVendorManager,
  newVendorApprovalStatus,
  todayIso,
  addDaysIso,
};

export const SERVICE_TRADES = [
  "HVAC",
  "Electrical",
  "Plumbing",
  "Refrigeration",
  "Welding",
  "Hydraulics",
  "General",
  "Other",
] as const;

export function canUseServiceVendor(vendor: {
  is_active: boolean;
  approval_status?: string | null;
}): boolean {
  return vendor.is_active && (vendor.approval_status ?? "Approved") === "Approved";
}

export function avgRating(ratings: { rating: number }[]): number | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((s, r) => s + Number(r.rating), 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}

export function isServiceVendorSchemaError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    (m.includes("service_vendor") || m.includes("service_vendors")) &&
    (m.includes("does not exist") ||
      m.includes("schema cache") ||
      m.includes("could not find") ||
      m.includes("pgrst205") ||
      m.includes("42p01"))
  );
}

export function serviceVendorAllowedRoles(): UserRole[] {
  return ["administrator", "service_manager", "billing"];
}
