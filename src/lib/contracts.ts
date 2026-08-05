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

export function buildContractName(contractType: string, startDate: string): string {
  const year = startDate.slice(0, 4) || new Date().getFullYear().toString();
  const shortType = contractType.replace(" Plan", "").replace(" Agreement", "");
  return `${shortType} Request ${year}`;
}

type BuildSubmissionInput = {
  customerId: string;
  userId: string | null;
  form: ContractRequestFormState;
};

export function buildContractSubmission(input: BuildSubmissionInput) {
  const { customerId, userId, form } = input;
  return {
    customer_id: customerId,
    name: buildContractName(form.contract_type, form.start_date),
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
