/** Encode/decode the unified “Assigned to” control (tech XOR portal vendor). */

export type AssignTarget =
  | { kind: "none" }
  | { kind: "tech"; id: string }
  | { kind: "vendor"; id: string };

export type VendorAssignmentStatus = "Pending" | "Accepted" | "Rejected";

export function encodeAssignTarget(target: AssignTarget): string {
  if (target.kind === "none") return "";
  return `${target.kind}:${target.id}`;
}

/** Accepts `tech:uuid`, `vendor:uuid`, legacy bare tech uuid, or empty. */
export function decodeAssignTarget(value: string): AssignTarget {
  const v = value.trim();
  if (!v) return { kind: "none" };
  if (v.startsWith("vendor:")) {
    const id = v.slice("vendor:".length);
    return id ? { kind: "vendor", id } : { kind: "none" };
  }
  if (v.startsWith("tech:")) {
    const id = v.slice("tech:".length);
    return id ? { kind: "tech", id } : { kind: "none" };
  }
  return { kind: "tech", id: v };
}

export function assignTargetFromWorkOrder(wo: {
  assigned_technician_id?: string | null;
  assigned_vendor_id?: string | null;
}): AssignTarget {
  if (wo.assigned_vendor_id) return { kind: "vendor", id: wo.assigned_vendor_id };
  if (wo.assigned_technician_id) return { kind: "tech", id: wo.assigned_technician_id };
  return { kind: "none" };
}

/** Patch fields for work_orders when saving assignment. */
export function assignmentPatchFromTarget(
  target: AssignTarget,
  current?: {
    assigned_vendor_id?: string | null;
    vendor_assignment_status?: string | null;
  },
): {
  assigned_technician_id: string | null;
  assigned_vendor_id: string | null;
  vendor_assignment_status: VendorAssignmentStatus | null;
} {
  if (target.kind === "tech") {
    return {
      assigned_technician_id: target.id,
      assigned_vendor_id: null,
      vendor_assignment_status: null,
    };
  }
  if (target.kind === "vendor") {
    const sameVendor = current?.assigned_vendor_id === target.id;
    const keepAccepted = sameVendor && current?.vendor_assignment_status === "Accepted";
    return {
      assigned_technician_id: null,
      assigned_vendor_id: target.id,
      // Offer only — vendor must Accept before the job is fully assigned.
      vendor_assignment_status: keepAccepted ? "Accepted" : "Pending",
    };
  }
  return {
    assigned_technician_id: null,
    assigned_vendor_id: null,
    vendor_assignment_status: null,
  };
}

export function hasAssignee(target: AssignTarget): boolean {
  return target.kind === "tech" || target.kind === "vendor";
}

/** True when a tech is assigned, or a vendor has accepted the offer. */
export function isFullyAssigned(wo: {
  assigned_technician_id?: string | null;
  assigned_vendor_id?: string | null;
  vendor_assignment_status?: string | null;
}): boolean {
  if (wo.assigned_technician_id) return true;
  return (
    !!wo.assigned_vendor_id &&
    (wo.vendor_assignment_status === "Accepted" || wo.vendor_assignment_status == null)
  );
}

/** Vendor offer is waiting for Accept / Reject. */
export function isVendorOfferPending(wo: {
  assigned_vendor_id?: string | null;
  vendor_assignment_status?: string | null;
}): boolean {
  return !!wo.assigned_vendor_id && wo.vendor_assignment_status === "Pending";
}
