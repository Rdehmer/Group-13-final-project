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

export function getContractTier(tierId: ContractTierId): ContractTier {
  const tier = CONTRACT_TIERS.find((t) => t.id === tierId);
  if (!tier) throw new Error(`Unknown contract tier: ${tierId}`);
  return tier;
}

export function applyTierToFormState(
  tierId: ContractTierId,
  form: ContractRequestFormState,
): ContractRequestFormState {
  const tier = getContractTier(tierId);
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

type BuildSubmissionInput = {
  customerId: string;
  userId: string | null;
  form: ContractRequestFormState;
  tierId?: ContractTierId;
};

export function buildContractSubmission(input: BuildSubmissionInput) {
  const { customerId, userId, form, tierId } = input;
  return {
    customer_id: customerId,
    name: buildContractName(form.contract_type, form.start_date, tierId),
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
    notes: form.notes || null,
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
