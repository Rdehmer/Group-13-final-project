export type UserRole =
  | "administrator"
  | "service_manager"
  | "technician"
  | "billing"
  | "customer";

/** ServiceTitan-style module keys used for employee permission matrices. */
export type PermissionKey =
  | "dashboard"
  | "customers"
  | "equipment"
  | "contracts"
  | "work_orders"
  | "technician"
  | "time_off"
  | "dispatch"
  | "parts"
  | "billing"
  | "payments"
  | "batches"
  | "period_close"
  | "reports"
  | "invoice_cash"
  | "users"
  | "settings"
  | "settings_gl"
  | "settings_employees";

/** Explicit allow/deny overrides on top of the role template (true/false). */
export type PermissionOverrides = Partial<Record<PermissionKey, boolean>>;

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  customer_id: string | null;
  hourly_cost_rate: number | null;
  hourly_billing_rate: number | null;
  /** Optional staff fields (employee HR-lite / settings). */
  job_title?: string | null;
  phone?: string | null;
  employee_number?: string | null;
  /**
   * Module permission overrides. Empty = use role defaults only.
   * true grants, false denies even when role would allow.
   */
  permission_overrides?: PermissionOverrides | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Customer = {
  id: string;
  name: string;
  primary_contact_name: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  service_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  /** Optional; used for global location filters and forms. */
  region: string | null;
  /** Optional; used for global location filters and forms. */
  country: string | null;
  status: "Active" | "Inactive" | "On Hold";
  payment_terms: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Equipment = {
  id: string;
  customer_id: string;
  name: string;
  category: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  installation_date: string | null;
  location: string | null;
  operating_status: "Operational" | "Needs Service" | "Out of Service" | "Retired";
  warranty_status: "Under Warranty" | "Warranty Expired" | "Not Covered" | "Unknown";
  warranty_expiration_date: string | null;
  last_service_date: string | null;
  next_scheduled_service_date: string | null;
  notes: string | null;
  /** Soft estimate — not a GAAP fixed-asset ledger field. */
  replacement_cost?: number | null;
  /** Soft residual estimate for accounting discussions. */
  estimated_residual?: number | null;
  /** Why retired / OOS — supports write-off conversations. */
  retirement_note?: string | null;
  /** Storage path in equipment-nameplates bucket. */
  nameplate_path?: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceContract = {
  id: string;
  customer_id: string;
  name: string;
  contract_type: string;
  start_date: string;
  end_date: string;
  renewal_option: string | null;
  billing_method: string;
  contract_price: number;
  payment_terms: string | null;
  included_service_visits: number;
  service_frequency: string | null;
  included_labor_hours: number;
  included_replacement_parts: number;
  emergency_response_commitment: string | null;
  warranty_terms: string | null;
  cancellation_terms: string | null;
  approval_requirements: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkOrder = {
  id: string;
  work_order_number: string;
  customer_id: string;
  equipment_id: string | null;
  contract_id: string | null;
  work_order_type: string;
  priority: "Low" | "Normal" | "High" | "Critical";
  assigned_technician_id: string | null;
  scheduled_date: string | null;
  scheduled_start_time: string | null;
  /** Optional end time when the column exists; duration falls back to estimated_labor_hours. */
  scheduled_end_time?: string | null;
  problem_description: string | null;
  requested_service: string | null;
  customer_approval_required: boolean;
  estimated_labor_hours: number | null;
  estimated_parts_cost: number | null;
  estimated_total_cost: number | null;
  warranty_coverage: string;
  billing_status: string;
  status: string;
  technician_notes: string | null;
  manager_notes: string | null;
  work_performed: string | null;
  equipment_condition: string | null;
  arrival_at: string | null;
  started_at: string | null;
  paused_at: string | null;
  /** Field dispatch board progress (En Route, Arrived, Working, …). */
  dispatch_status?: string | null;
  dispatch_note?: string | null;
  dispatch_updated_at?: string | null;
  completion_date: string | null;
  approved_by: string | null;
  approved_at: string | null;
  performed_before_approval: boolean;
  under_expired_contract: boolean;
  costs_after_billing: boolean;
  completion_proof_requirement: "photo_or_signature" | "photo" | "signature" | "both";
  created_at: string;
  updated_at: string;
};

export type WorkOrderCompletionProof = {
  id: string;
  job_id: string;
  type: "photo" | "signature";
  file_url: string | null;
  base64_data: string | null;
  captured_at: string;
  technician_id: string;
  created_at: string;
};

export type Part = {
  id: string;
  part_number: string;
  name: string;
  category: string | null;
  description: string | null;
  quantity_on_hand: number;
  reorder_level: number;
  unit_cost: number;
  standard_customer_price: number;
  warranty_eligible: boolean;
  supplier: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TruckInventory = {
  technician_id: string;
  part_id: string;
  quantity_on_hand: number;
  typical_job_quantity: number;
  last_restocked_at: string | null;
  updated_at: string;
};

/** Technician parts replenishment request (truck inventory PO request row). */
export type TechPartOrderRequest = {
  id: string;
  technician_id: string;
  part_id: string;
  quantity_requested: number;
  status: "pending" | "approved" | "fulfilled";
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** @deprecated Prefer TechPartOrderRequest — kept for import compatibility during rename. */
export type PurchaseOrderRequest = TechPartOrderRequest;

export type EmergencyPurchase = {
  id: string;
  technician_id: string;
  job_id: string;
  part_id: string;
  part_name: string;
  quantity: number;
  amount_paid: number;
  store_name: string;
  receipt_url: string;
  purchased_at: string;
  status: "submitted" | "reimbursed";
  reimbursed_at: string | null;
  created_at: string;
};

export type TechnicianLabor = {
  id: string;
  work_order_id: string;
  technician_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  regular_hours: number;
  overtime_hours: number;
  hourly_cost_rate: number;
  overtime_cost_rate: number;
  customer_billing_rate: number;
  billable_status: string;
  invoiced: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkOrderPart = {
  id: string;
  work_order_id: string;
  part_id: string;
  quantity_used: number;
  unit_cost: number;
  customer_price: number;
  warranty_covered_amount: number;
  billable_amount: number;
  date_used: string;
  manager_override: boolean;
  invoiced: boolean;
  created_at: string;
};

export type AdditionalWorkRequest = {
  id: string;
  work_order_id: string;
  description: string;
  recommended_repair: string | null;
  estimated_labor_hours: number | null;
  estimated_parts: number | null;
  estimated_additional_charge: number | null;
  supporting_notes: string | null;
  approval_status: string;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: string;
  invoice_number: string;
  customer_id: string;
  contract_id: string | null;
  work_order_id: string | null;
  /** Equipment unit this invoice covers (model / serial on equipment). */
  equipment_id: string | null;
  /** Customer / field PO number on the invoice document. */
  po_number: string | null;
  invoice_date: string;
  due_date: string;
  billing_period: string | null;
  labor_charges: number;
  parts_charges: number;
  recurring_service_charge: number;
  additional_charges: number;
  warranty_deductions: number;
  discounts: number;
  tax: number;
  invoice_total: number;
  amount_paid: number;
  remaining_balance: number;
  status: string;
  notes: string | null;
  created_by: string | null;
  /** Team member responsible for this invoice (profiles.id). */
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrder = {
  id: string;
  po_number: string;
  invoice_id: string | null;
  work_order_id: string | null;
  vendor_name: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderLine = {
  id: string;
  purchase_order_id: string;
  part_id: string | null;
  part_number: string | null;
  part_name: string | null;
  description: string | null;
  quantity: number;
  unit_cost: number;
  created_at: string;
};

export type PurchaseOrderAttachment = {
  id: string;
  purchase_order_id: string;
  file_name: string;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  /** Base64 data URL when Storage bucket is unavailable (demo fallback). */
  file_data: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  payment_number: string;
  customer_id: string;
  invoice_id: string;
  payment_date: string;
  payment_method: string;
  payment_amount: number;
  reference_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

/** Accounting batch lifecycle: Open (editable) → Posted (locked) → Exported (to GL). */
export type AccountingBatchStatus = "Open" | "Posted" | "Exported";
export type AccountingBatchType = "invoice" | "payment" | "mixed";

export type AccountingBatch = {
  id: string;
  batch_number: string;
  batch_type: AccountingBatchType;
  name: string | null;
  status: AccountingBatchStatus;
  batch_date: string;
  payment_method: string | null;
  notes: string | null;
  invoice_total: number;
  payment_total: number;
  invoice_count: number;
  payment_count: number;
  created_by: string | null;
  posted_by: string | null;
  posted_at: string | null;
  exported_by: string | null;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountingBatchInvoice = {
  id: string;
  batch_id: string;
  invoice_id: string;
  amount: number;
  added_at: string;
};

export type AccountingBatchPayment = {
  id: string;
  batch_id: string;
  payment_id: string;
  amount: number;
  added_at: string;
};

export type CompanySettings = {
  id: string;
  company_name: string;
  support_email: string | null;
  default_tax_rate: number;
  overtime_multiplier: number;
  created_at: string;
  updated_at: string;
};

/** PTO / blocked schedule days for a technician. */
export type TimeOffRequest = {
  id: string;
  technician_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: "Pending" | "Approved" | "Denied" | "Canceled";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  technician?: { id: string; full_name: string | null; email: string } | null;
};

/** Chart of accounts classification. */
export type GlAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type GlNormalBalance = "debit" | "credit";

export type GlAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: GlAccountType;
  normal_balance: GlNormalBalance;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** Maps operational posting purpose → GL account (for export / reports). */
export type GlPostingDefault = {
  id: string;
  purpose: string;
  gl_account_id: string | null;
  label: string;
  description: string | null;
  updated_at: string;
};

export const ROLE_LABELS: Record<UserRole, string> = {
  administrator: "Administrator",
  service_manager: "Service Manager",
  technician: "Technician",
  billing: "Billing Employee",
  customer: "Customer",
};
