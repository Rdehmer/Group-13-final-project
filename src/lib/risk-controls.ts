/**
 * Risk control audit buckets for SOX-style segregation of duties.
 * Maps activity_logs rows into the three demonstrable control areas:
 * work order creation, extra-parts approvals, and billing release.
 */

export type RiskControlCategoryId =
  | "work_order_creation"
  | "parts_approvals"
  | "billing_releases";

export type RiskControlRule = {
  action: string;
  /** If set, row.record_type must be one of these. */
  recordTypes?: string[];
  /** If set, row.new_value must match one of these (case-insensitive). */
  newValueIn?: string[];
};

export type RiskControlCategory = {
  id: RiskControlCategoryId;
  label: string;
  shortLabel: string;
  description: string;
  rules: RiskControlRule[];
};

/**
 * This business faces weak segregation of duties between create, approve, and bill.
 * Our app reduces the risk by surfacing who performed each control step.
 */
export const RISK_CONTROL_CATEGORIES: RiskControlCategory[] = [
  {
    id: "work_order_creation",
    label: "Work order creation",
    shortLabel: "Work orders",
    description:
      "Who opened a service job — staff-created work orders, customer service requests, and cloned jobs.",
    rules: [
      { action: "created", recordTypes: ["work_order"] },
      { action: "service_request", recordTypes: ["work_order"] },
      { action: "cloned", recordTypes: ["work_order"] },
    ],
  },
  {
    id: "parts_approvals",
    label: "Extra parts approvals",
    shortLabel: "Parts approvals",
    description:
      "Who authorized extra, over-allowance, outside-contract, or purchase-order parts.",
    rules: [
      { action: "purchase_order_approved", recordTypes: ["purchase_order"] },
      { action: "extra_parts_approved", recordTypes: ["work_order", "purchase_order"] },
      { action: "extra_parts_outside_contract", recordTypes: ["work_order"] },
      { action: "extra_work_approved", recordTypes: ["work_order"] },
      { action: "awr_decision", recordTypes: ["work_order"], newValueIn: ["Approved"] },
      { action: "emergency_purchase_reimbursed", recordTypes: ["emergency_purchase"] },
    ],
  },
  {
    id: "billing_releases",
    label: "Billing releases",
    shortLabel: "Billing releases",
    description:
      "Who authorized revenue release — invoice send, batch post, and manager job completion for billing.",
    rules: [
      { action: "billing_release", recordTypes: ["invoice"] },
      { action: "invoice_released", recordTypes: ["invoice"] },
      { action: "invoice_emailed", recordTypes: ["invoice"] },
      { action: "posted", recordTypes: ["accounting_batch"] },
      { action: "approved_completion", recordTypes: ["work_order"] },
      // Legacy rows before dedicated billing_release action names
      { action: "status_change", recordTypes: ["invoice"], newValueIn: ["Sent"] },
    ],
  },
];

export type RiskControlActivityRow = {
  id: string;
  action: string;
  record_type: string;
  record_id?: string | null;
  previous_value: string | null;
  new_value: string | null;
  created_at: string;
  user_id?: string | null;
  profiles?: { full_name?: string | null; email?: string | null } | null;
};

function ruleMatches(rule: RiskControlRule, row: RiskControlActivityRow): boolean {
  if (rule.action !== row.action) return false;
  if (rule.recordTypes && !rule.recordTypes.includes(row.record_type)) return false;
  if (rule.newValueIn) {
    const nv = (row.new_value ?? "").trim().toLowerCase();
    if (!rule.newValueIn.some((v) => v.toLowerCase() === nv)) return false;
  }
  return true;
}

export function matchRiskControlCategory(
  row: RiskControlActivityRow,
): RiskControlCategoryId | null {
  for (const cat of RISK_CONTROL_CATEGORIES) {
    if (cat.rules.some((rule) => ruleMatches(rule, row))) return cat.id;
  }
  return null;
}

export function allRiskControlActions(): string[] {
  const set = new Set<string>();
  for (const cat of RISK_CONTROL_CATEGORIES) {
    for (const rule of cat.rules) set.add(rule.action);
  }
  return [...set];
}

export function isRiskControlAction(action: string): boolean {
  return allRiskControlActions().includes(action);
}

/** Deep-link target for a logged record, when a staff route exists. */
export function recordHref(recordType: string, recordId: string | null | undefined): string | null {
  if (!recordId) return null;
  switch (recordType) {
    case "work_order":
      return `/work-orders/${recordId}`;
    case "invoice":
      return `/billing/${recordId}`;
    case "accounting_batch":
      return `/batches/${recordId}`;
    case "purchase_order":
      return `/parts`;
    case "emergency_purchase":
      return `/emergency-purchases`;
    default:
      return null;
  }
}

export function recordTypeLabel(recordType: string): string {
  switch (recordType) {
    case "work_order":
      return "Work order";
    case "invoice":
      return "Invoice";
    case "accounting_batch":
      return "Batch";
    case "purchase_order":
      return "Purchase order";
    case "emergency_purchase":
      return "Emergency purchase";
    default:
      return recordType.replace(/_/g, " ");
  }
}

export function formatRiskAction(action: string): string {
  return action.replace(/_/g, " ");
}

export function riskControlActorLabel(row: RiskControlActivityRow): string {
  const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return p?.full_name?.trim() || p?.email?.trim() || "System / unknown";
}

export function riskControlSummary(row: RiskControlActivityRow): string {
  const parts: string[] = [];
  if (row.previous_value && row.new_value) {
    parts.push(`${row.previous_value} → ${row.new_value}`);
  } else if (row.new_value) {
    parts.push(row.new_value);
  } else if (row.previous_value) {
    parts.push(row.previous_value);
  }
  return parts.join(" · ") || "—";
}

/** Roles that may open the Risk Controls audit page. */
export const RISK_CONTROLS_ROLES = ["administrator"] as const;
