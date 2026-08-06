import type { ServiceContract } from "@/lib/types";
import {
  DEFAULT_CUSTOMER_PACK_ID,
  formatPlanSnapshot,
  getCatalogDrivenTier,
  getPack,
  listCatalogDrivenTiers,
  mergePlanSnapshotIntoNotes,
  resolvePlan,
} from "@/lib/contract-plans";

export const CONTRACT_TYPES = [
  "Preventive Maintenance",
  "Full-Service Maintenance",
  "Emergency Repair Plan",
  "Time and Materials",
  "Custom Service Agreement",
] as const;

export const BILLING_METHODS = [
  "Monthly Recurring Charge",
  "Annual Fixed Fee",
  "Per-Service Charge",
  "Time and Materials",
  "Cost Plus",
] as const;

export const SERVICE_FREQUENCIES = [
  "Monthly",
  "Quarterly",
  "Semi-Annual",
  "Annual",
  "As Needed",
] as const;

export const RENEWAL_OPTIONS = [
  "Auto-renew",
  "Manual renewal",
  "No renewal",
] as const;

export const PAYMENT_TERMS = [
  "Net 30",
  "Net 15",
  "Due on receipt",
] as const;

export const EMERGENCY_SLA_OPTIONS = [
  "4 business hours",
  "8 business hours",
  "Next business day",
  "Standard (best effort)",
] as const;

export type ContractTierId = "gold" | "silver" | "bronze";

export type ContractRequestFormState = {
  contract_type: string;
  start_date: string;
  end_date: string;
  renewal_option: string;
  equipment_ids: string[];
  included_service_visits: string;
  service_frequency: string;
  included_labor_hours: string;
  included_replacement_parts: string;
  emergency_response_commitment: string;
  billing_method: string;
  payment_terms: string;
  approval_requirements: string;
  notes: string;
};

export type ContractTier = {
  id: ContractTierId;
  name: string;
  tagline: string;
  coverages: string[];
  recommended?: boolean;
  formDefaults: Partial<Omit<ContractRequestFormState, "equipment_ids" | "start_date" | "end_date">>;
};

export const CONTRACT_TIERS: ContractTier[] = [
  {
    id: "gold",
    name: "Gold",
    tagline: "Full uptime protection",
    recommended: true,
    coverages: [
      "12 scheduled visits per year (monthly PM)",
      "48 included labor hours",
      "$2,500 parts allowance",
      "4 business hour emergency response",
      "Priority dispatch and after-hours coverage",
      "Corrective repairs within allowance",
      "Wear parts and consumables on PM visits",
      "OEM warranty coordination",
      "Unlimited covered equipment on account",
      "Annual performance summary",
      "Auto-renew eligible",
    ],
    formDefaults: {
      contract_type: "Full-Service Maintenance",
      renewal_option: "Auto-renew",
      included_service_visits: "12",
      service_frequency: "Monthly",
      included_labor_hours: "48",
      included_replacement_parts: "2500",
      emergency_response_commitment: "4 business hours",
      billing_method: "Monthly Recurring Charge",
      payment_terms: "Net 30",
      approval_requirements: "Manager approval for extras beyond allowance",
    },
  },
  {
    id: "silver",
    name: "Silver",
    tagline: "Balanced PM and limited repair",
    coverages: [
      "4 scheduled visits per year (quarterly PM)",
      "16 included labor hours",
      "$800 parts allowance",
      "Next business day emergency response",
      "PM inspections, cleaning, and tune-ups",
      "Limited corrective work within allowance",
      "Standard business-hours dispatch",
      "Consumables on PM visits only",
      "Manager approval for work exceeding allowance",
    ],
    formDefaults: {
      contract_type: "Preventive Maintenance",
      renewal_option: "Manual renewal",
      included_service_visits: "4",
      service_frequency: "Quarterly",
      included_labor_hours: "16",
      included_replacement_parts: "800",
      emergency_response_commitment: "Next business day",
      billing_method: "Monthly Recurring Charge",
      payment_terms: "Net 30",
      approval_requirements: "Manager approval for extras over $500",
    },
  },
  {
    id: "bronze",
    name: "Bronze",
    tagline: "Essential inspections only",
    coverages: [
      "2 scheduled visits per year (semi-annual PM)",
      "4 included labor hours",
      "No included parts — billed separately",
      "Standard (best effort) emergency response",
      "Semi-annual inspections and basic tune-ups",
      "Corrective work billed time and materials",
      "Business-hours scheduling only",
      "Customer approval required before non-PM dispatch",
    ],
    formDefaults: {
      contract_type: "Preventive Maintenance",
      renewal_option: "Manual renewal",
      included_service_visits: "2",
      service_frequency: "Semi-Annual",
      included_labor_hours: "4",
      included_replacement_parts: "0",
      emergency_response_commitment: "Standard (best effort)",
      billing_method: "Per-Service Charge",
      payment_terms: "Net 30",
      approval_requirements: "Customer approval required before non-PM dispatch",
    },
  },
];

export function getContractTier(tierId: ContractTierId, packId?: string): ContractTier {
  if (typeof window !== "undefined") {
    try {
      return getCatalogDrivenTier(tierId, packId ?? DEFAULT_CUSTOMER_PACK_ID) as ContractTier;
    } catch {
      /* fall through to static */
    }
  }
  const tier = CONTRACT_TIERS.find((t) => t.id === tierId);
  if (!tier) throw new Error(`Unknown contract tier: ${tierId}`);
  return tier;
}

export function listContractTiersForUi(packId?: string): ContractTier[] {
  if (typeof window !== "undefined") {
    try {
      return listCatalogDrivenTiers(packId ?? DEFAULT_CUSTOMER_PACK_ID) as ContractTier[];
    } catch {
      /* fall through */
    }
  }
  return CONTRACT_TIERS;
}

export function applyTierToFormState(
  tierId: ContractTierId,
  form: ContractRequestFormState,
  packId?: string,
): ContractRequestFormState {
  const tier = getContractTier(tierId, packId);
  return {
    ...form,
    ...tier.formDefaults,
    equipment_ids: form.equipment_ids,
    start_date: form.start_date,
    end_date: form.end_date,
  };
}

export function defaultContractFormState(): ContractRequestFormState {
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const endDate = new Date(today);
  endDate.setFullYear(endDate.getFullYear() + 1);
  return {
    contract_type: "Preventive Maintenance",
    start_date: start,
    end_date: endDate.toISOString().slice(0, 10),
    renewal_option: "Manual renewal",
    equipment_ids: [],
    included_service_visits: "4",
    service_frequency: "Quarterly",
    included_labor_hours: "8",
    included_replacement_parts: "0",
    emergency_response_commitment: "Next business day",
    billing_method: "Monthly Recurring Charge",
    payment_terms: "Net 30",
    approval_requirements: "",
    notes: "",
  };
}

/** Manager-created contracts — short descriptive title. */
export function buildContractName(
  contractType: string,
  startDate: string,
  tierId?: ContractTierId,
): string {
  const year = startDate.slice(0, 4) || new Date().getFullYear().toString();
  const shortType = contractType.replace(" Plan", "").replace(" Agreement", "");
  const tierPrefix = tierId ? `${getContractTier(tierId).name} ` : "";
  return `${tierPrefix}${shortType} Request ${year}`;
}

/** Short unique id so same-day requests are distinguishable in lists. */
export function makeRequestCode(): string {
  return Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, "0");
}

/**
 * Customer portal submissions — obvious trackable name for demos and manager queues.
 * Example: [Request] Northwind Cold Storage · Gold · 2026-08-05 · REQ-A3F2
 */
export function buildCustomerRequestContractName(input: {
  customerName: string;
  tierId?: ContractTierId;
  packId?: string;
  startDate: string;
  requestCode?: string;
}): string {
  const customer = input.customerName.trim() || "Customer";
  const pack = input.packId ? getPack(input.packId) : null;
  const packLabel = pack?.name;
  const tier = input.tierId ? getContractTier(input.tierId, input.packId).name : "Custom";
  const date =
    input.startDate.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const code = (input.requestCode ?? makeRequestCode()).toUpperCase();
  const middle = packLabel ? `${packLabel} · ${tier}` : tier;
  return `[Request] ${customer} · ${middle} · ${date} · REQ-${code}`;
}

type BuildSubmissionInput = {
  customerId: string;
  customerName: string;
  userId: string | null;
  form: ContractRequestFormState;
  tierId?: ContractTierId;
  packId?: string;
  /** Covered asset value for plan band snapshot (defaults Mid-ish $100k). */
  assetValue?: number;
};

export function buildContractSubmission(input: BuildSubmissionInput) {
  const { customerId, customerName, userId, form, tierId, packId } = input;
  const assetValue =
    input.assetValue != null && Number.isFinite(input.assetValue) && input.assetValue > 0
      ? input.assetValue
      : 100_000;

  let notes = form.notes || null;
  if (packId && tierId) {
    const resolved = resolvePlan(packId, tierId, assetValue);
    if (resolved) {
      const tag = formatPlanSnapshot({
        pack: resolved.pack,
        level: resolved.level,
        band: resolved.band,
        assetValue: resolved.assetValue,
      });
      notes = mergePlanSnapshotIntoNotes(notes, tag);
    }
  }

  return {
    customer_id: customerId,
    name: buildCustomerRequestContractName({
      customerName,
      tierId,
      packId,
      startDate: form.start_date,
    }),
    contract_type: form.contract_type,
    start_date: form.start_date,
    end_date: form.end_date,
    renewal_option: form.renewal_option || null,
    billing_method: form.billing_method,
    contract_price: 0,
    payment_terms: form.payment_terms || null,
    included_service_visits: Number(form.included_service_visits) || 0,
    service_frequency: form.service_frequency || null,
    included_labor_hours: Number(form.included_labor_hours) || 0,
    included_replacement_parts: Number(form.included_replacement_parts) || 0,
    emergency_response_commitment: form.emergency_response_commitment || null,
    warranty_terms: null,
    cancellation_terms: null,
    approval_requirements: form.approval_requirements || null,
    status: "Pending Approval",
    notes,
    created_by: userId,
  };
}

export const CONTRACT_TYPE_HELP: Record<string, string> = {
  "Preventive Maintenance": "Scheduled inspections, filter changes, and tune-ups.",
  "Full-Service Maintenance": "Preventive maintenance plus corrective work within included hours and parts.",
  "Emergency Repair Plan": "Priority response with a defined emergency SLA.",
  "Time and Materials": "Pay per visit — best for occasional or unpredictable service needs.",
  "Custom Service Agreement": "Non-standard scope such as multi-site or seasonal coverage.",
};

export type CustomerContractEquipment = {
  id: string;
  name: string;
  category: string | null;
  location: string | null;
};

export type CustomerContract = ServiceContract & {
  equipment: CustomerContractEquipment[];
};

export type ContractFilterTab = "all" | "active" | "pending" | "expired";

const TIER_BADGE_CLASS: Record<ContractTierId, string> = {
  gold: "badge-warning",
  silver: "badge-ghost",
  bronze: "badge-neutral",
};

export function inferContractTier(name: string): ContractTierId | null {
  const lower = name.toLowerCase();
  if (lower.includes("gold")) return "gold";
  if (lower.includes("silver")) return "silver";
  if (lower.includes("bronze")) return "bronze";
  return null;
}

export function tierBadgeClass(tierId: ContractTierId): string {
  return TIER_BADGE_CLASS[tierId];
}

export function contractStatusMessage(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("pending")) {
    return "Ridley is reviewing your request. You'll be notified when it's active.";
  }
  if (s === "active") {
    return "This agreement is active and coverage applies to listed equipment.";
  }
  if (s.includes("canceled") || s.includes("cancelled")) {
    return "This request was not approved. Contact Ridley Equipment Services or submit a new request.";
  }
  if (s.includes("expired")) {
    return "This agreement has ended. Request a new contract to restore coverage.";
  }
  if (s.includes("draft")) {
    return "This agreement is being prepared and is not yet active.";
  }
  if (s.includes("renewed")) {
    return "This agreement was renewed from a prior term.";
  }
  return "Contact Ridley Equipment Services if you have questions about this agreement.";
}

export function daysUntilEnd(endDate: string): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function isExpiringSoon(endDate: string, withinDays = 60): boolean {
  const days = daysUntilEnd(endDate);
  return days !== null && days >= 0 && days <= withinDays;
}

export function formatContractTerm(startDate: string, endDate: string): string {
  const fmt = (d: string) => {
    const date = new Date(`${d}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? d
      : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

export function formatRenewalNote(renewalOption: string | null): string | null {
  if (!renewalOption) return null;
  const lower = renewalOption.toLowerCase();
  if (lower.includes("auto")) return "Auto-renews";
  if (lower.includes("manual")) return "Manual renewal";
  if (lower.includes("none") || lower.includes("no renewal")) return "No auto-renewal";
  return renewalOption;
}

export function formatCoverageSummary(contract: Pick<
  ServiceContract,
  "included_service_visits" | "service_frequency" | "included_labor_hours" | "emergency_response_commitment"
>): string {
  const parts: string[] = [];
  if (contract.included_service_visits > 0) {
    const freq = contract.service_frequency?.toLowerCase() ?? "";
    parts.push(`${contract.included_service_visits} ${freq ? `${freq} ` : ""}visits`.replace("  ", " "));
  }
  if (contract.included_labor_hours > 0) {
    parts.push(`${contract.included_labor_hours} labor hrs`);
  }
  if (contract.emergency_response_commitment) {
    parts.push(contract.emergency_response_commitment);
  }
  return parts.length > 0 ? parts.join(" · ") : "Coverage details on file";
}

export function contractFilterTab(contract: ServiceContract, tab: ContractFilterTab): boolean {
  if (tab === "all") return true;
  const status = contract.status.toLowerCase();
  if (tab === "active") return status === "active" || status === "renewed";
  if (tab === "pending") return status.includes("pending") || status === "draft";
  if (tab === "expired") return status.includes("expired") || (daysUntilEnd(contract.end_date) ?? 1) < 0;
  return true;
}

export function parseCustomerContracts(
  rows: Array<
    ServiceContract & {
      contract_equipment?: Array<{ equipment: CustomerContractEquipment | null }>;
    }
  >,
): CustomerContract[] {
  return rows.map((row) => {
    const { contract_equipment, ...contract } = row;
    const equipment = (contract_equipment ?? [])
      .map((ce) => ce.equipment)
      .filter((eq): eq is CustomerContractEquipment => eq != null);
    return { ...contract, equipment };
  });
}

export function formatEquipmentPreview(equipment: CustomerContractEquipment[], max = 3): string {
  if (equipment.length === 0) return "No equipment listed";
  const names = equipment.slice(0, max).map((eq) => eq.name);
  const remaining = equipment.length - max;
  if (remaining > 0) return `${names.join(", ")} +${remaining} more`;
  return names.join(", ");
}

export function suggestTier(equipmentCount: number, hasActiveContract: boolean): ContractTierId {
  if (equipmentCount >= 5 || hasActiveContract) return "gold";
  if (equipmentCount >= 3) return "silver";
  return "bronze";
}

export function contractNamePreview(
  form: ContractRequestFormState,
  tierId: ContractTierId,
  customerName?: string,
): string {
  if (customerName?.trim()) {
    return buildCustomerRequestContractName({
      customerName,
      tierId,
      startDate: form.start_date,
      requestCode: "····",
    });
  }
  return buildContractName(form.contract_type, form.start_date, tierId);
}

export type EquipmentOverlap = {
  equipmentId: string;
  equipmentName: string;
  contractName: string;
};

export function findOverlappingEquipment(
  activeContracts: CustomerContract[],
  selectedEquipmentIds: string[],
  equipmentNames: Map<string, string>,
): EquipmentOverlap[] {
  const selected = new Set(selectedEquipmentIds);
  const overlaps: EquipmentOverlap[] = [];
  for (const contract of activeContracts) {
    const status = contract.status.toLowerCase();
    if (status !== "active" && status !== "renewed") continue;
    for (const eq of contract.equipment) {
      if (selected.has(eq.id)) {
        overlaps.push({
          equipmentId: eq.id,
          equipmentName: equipmentNames.get(eq.id) ?? eq.name,
          contractName: contract.name,
        });
      }
    }
  }
  return overlaps;
}

export const CONTRACT_SERVICE_REQUEST_WAIT_DAYS = 45;

export const CONTRACT_START_DATE_BLOCK_MESSAGE =
  "You cannot make a service request within 45 days of your contract start date.";

export const CONTRACT_START_DATE_ONE_OFF_TITLE = "One-Off Call";

export const CONTRACT_START_DATE_ONE_OFF_DESCRIPTION =
  "Request a billable service visit outside your contract coverage. Standard rates apply and this visit will not count toward included contract visits.";

export function isContractStartDateBlockError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    message.includes(CONTRACT_START_DATE_BLOCK_MESSAGE) ||
    normalized.includes("within 45 days of your contract start date")
  );
}

export function daysSinceContractStart(startDate: string, asOf = new Date()): number | null {
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function isWithinContractServiceRequestWaitingPeriod(
  startDate: string,
  asOf = new Date(),
): boolean {
  const days = daysSinceContractStart(startDate, asOf);
  return days !== null && days < CONTRACT_SERVICE_REQUEST_WAIT_DAYS;
}

function isActiveContractStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "active" || s === "renewed";
}

export function findBlockingContractForServiceRequest(
  contracts: CustomerContract[],
  equipmentId: string | null,
): CustomerContract | null {
  for (const contract of contracts) {
    if (!isActiveContractStatus(contract.status)) continue;
    if (!isWithinContractServiceRequestWaitingPeriod(contract.start_date)) continue;
    if (equipmentId && !contract.equipment.some((eq) => eq.id === equipmentId)) continue;
    return contract;
  }
  return null;
}

export type ContractRequestPreviewData = {
  tierName: string;
  tierTagline: string;
  contractName: string;
  contractType: string;
  term: string;
  renewal: string | null;
  coverageSummary: string;
  tierCoverages: string[];
  equipmentNames: string[];
  billingMethod: string;
  paymentTerms: string;
  notes: string | null;
  approvalRequirements: string | null;
};

type PreviewEquipment = { id: string; name: string };

export function buildContractPreview(
  form: ContractRequestFormState,
  tierId: ContractTierId,
  equipment: PreviewEquipment[],
  customerName?: string,
  packId?: string,
): ContractRequestPreviewData {
  const tier = getContractTier(tierId, packId);
  const selected = equipment.filter((eq) => form.equipment_ids.includes(eq.id));
  const visits = Number(form.included_service_visits) || 0;
  const labor = Number(form.included_labor_hours) || 0;

  return {
    tierName: tier.name,
    tierTagline: packId
      ? `${getPack(packId)?.name ?? "Industry"} · ${tier.tagline}`
      : tier.tagline,
    contractName: contractNamePreview(form, tierId, customerName),
    contractType: form.contract_type,
    term: formatContractTerm(form.start_date, form.end_date),
    renewal: formatRenewalNote(form.renewal_option || null),
    coverageSummary: formatCoverageSummary({
      included_service_visits: visits,
      service_frequency: form.service_frequency || null,
      included_labor_hours: labor,
      emergency_response_commitment: form.emergency_response_commitment || null,
    }),
    tierCoverages: tier.coverages,
    equipmentNames: selected.map((eq) => eq.name),
    billingMethod: form.billing_method,
    paymentTerms: form.payment_terms,
    notes: form.notes.trim() || null,
    approvalRequirements: form.approval_requirements.trim() || null,
  };
}

const DRAFT_KEY_PREFIX = "esm-contract-draft-";

export type ContractDraft = {
  form: ContractRequestFormState;
  tierId: ContractTierId;
  step: number;
  packId?: string;
};

export function saveContractDraft(customerId: string, data: ContractDraft) {
  try {
    sessionStorage.setItem(`${DRAFT_KEY_PREFIX}${customerId}`, JSON.stringify(data));
  } catch {
    /* ignore storage errors */
  }
}

export function loadContractDraft(customerId: string): ContractDraft | null {
  try {
    const raw = sessionStorage.getItem(`${DRAFT_KEY_PREFIX}${customerId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ContractDraft;
  } catch {
    return null;
  }
}

export function clearContractDraft(customerId: string) {
  try {
    sessionStorage.removeItem(`${DRAFT_KEY_PREFIX}${customerId}`);
  } catch {
    /* ignore */
  }
}
