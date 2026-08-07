export type UserRole =
  | "administrator"
  | "service_manager"
  | "technician"
  | "billing"
  | "customer"
  | "vendor";

/** ServiceTitan-style module keys used for employee permission matrices. */
export type PermissionKey =
  | "dashboard"
  | "customers"
  | "equipment"
  | "contracts"
  | "work_orders"
  | "technician"
  | "time_off"
  | "timesheets"
  | "dispatch"
  | "parts"
  | "vendors"
  | "service_vendors"
  | "emergency_purchases"
  | "inbox"
  | "billing"
  | "payments"
  | "batches"
  | "period_close"
  | "reports"
  | "invoice_cash"
  | "users"
  | "settings"
  | "settings_gl"
  | "settings_employees"
  | "settings_contract_plans";

/** Explicit allow/deny overrides on top of the role template (true/false). */
export type PermissionOverrides = Partial<Record<PermissionKey, boolean>>;

export type Company = {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  customer_id: string | null;
  /** When role = vendor, scopes the login to this AP vendor. */
  vendor_id?: string | null;
  /** Multi-tenant company; catalogs and branding are scoped here. */
  company_id?: string | null;
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
  /** Owning service company (multi-tenant). */
  company_id?: string | null;
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
  /** Monthly recurring fee (typically annual / 12 for MRC). */
  monthly_amount: number;
  /** Customer deductible before covered work. */
  deductible: number;
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
  /** External service provider assigned to this job (Ecotrak-style). */
  service_vendor_id?: string | null;
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
  /** Billable visit requested outside contract coverage (e.g. during 45-day start window). */
  outside_contract?: boolean;
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

export type WorkOrderServiceRating = {
  id: string;
  work_order_id: string;
  customer_id: string;
  submitted_by: string | null;
  overall_rating: number;
  technician_rating: number | null;
  timeliness_rating: number | null;
  quality_rating: number | null;
  comments: string | null;
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
  /** Denormalized supplier name (synced from vendors.name when vendor_id is set). */
  supplier: string | null;
  /** Optional link to parts AP supplier (public.vendors). */
  vendor_id: string | null;
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

/** Technician parts replenishment request (purchase order request row). */
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

export type VendorBillStatus = "Open" | "Partial" | "Paid" | "Void";
export type VendorPaymentMethod = "Check" | "ACH" | "Cash" | "Card" | "Other";
export type VendorApprovalStatus = "Pending" | "Approved" | "Rejected";

export type Vendor = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  payment_terms: string;
  notes: string | null;
  /** Trade type for vendor portal (HVAC, Plumbing, etc.). */
  specialty?: string | null;
  is_active: boolean;
  approval_status: VendorApprovalStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorSpecialty = "HVAC" | "Plumbing" | "Electrical" | "Parts" | "Other";

export type VendorWorkItemStatus = "Pending" | "Accepted" | "Rejected";

export type VendorWorkItem = {
  id: string;
  vendor_id: string;
  title: string;
  description: string | null;
  status: VendorWorkItemStatus;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorSupplyOrderStatus = "Pending" | "Accepted" | "Rejected";

export type VendorSupplyOrder = {
  id: string;
  vendor_id: string;
  item_name: string;
  quantity: number;
  status: VendorSupplyOrderStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorBill = {
  id: string;
  vendor_id: string;
  bill_number: string;
  bill_date: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  status: VendorBillStatus;
  memo: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorBillPayment = {
  id: string;
  bill_id: string;
  payment_date: string;
  amount: number;
  method: VendorPaymentMethod;
  memo: string | null;
  created_by: string | null;
  created_at: string;
};

/** Ecotrak-style service provider (company we buy services from). */
export type ServiceVendor = {
  id: string;
  name: string;
  primary_trade: string;
  trades: string[];
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  service_area: string | null;
  notes: string | null;
  is_active: boolean;
  approval_status: VendorApprovalStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceVendorBill = {
  id: string;
  service_vendor_id: string;
  work_order_id: string | null;
  bill_number: string;
  bill_date: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  status: VendorBillStatus;
  memo: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceVendorRating = {
  id: string;
  service_vendor_id: string;
  work_order_id: string | null;
  rating: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
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
  /** Days after Active contract start before included service requests are allowed. 0 disables. */
  contract_service_request_wait_days: number;
  created_at: string;
  updated_at: string;
};

/** Payroll timesheet cycle length (configurable in timesheet_settings). */
export type TimesheetCycleType = "weekly" | "biweekly";

export type TimesheetSettings = {
  id: string;
  cycle_type: TimesheetCycleType;
  week_starts_on: number;
  updated_at: string;
};

export type TimesheetCycleStatus = "Open" | "Closed";

export type TimesheetCycle = {
  id: string;
  start_date: string;
  end_date: string;
  label: string;
  status: TimesheetCycleStatus;
  created_at: string;
  updated_at: string;
};

export type TimesheetEntry = {
  id: string;
  technician_id: string;
  cycle_id: string;
  work_date: string;
  hours: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TimesheetSubmissionStatus = "Draft" | "Submitted" | "Approved" | "Rejected";

export type TimesheetSubmission = {
  id: string;
  technician_id: string;
  cycle_id: string;
  status: TimesheetSubmissionStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
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

/**
 * ServiceTitan-style payroll timesheet workflow for one employee × pay period.
 * Hours still come from live field labor; this records sign-off / approval state.
 * @deprecated Prefer TimeEntry + time_entries table. Kept for transitional imports.
 */
export type TimesheetWorkflowStatus =
  | "open"
  | "released"
  | "employee_approved"
  | "disputed"
  | "manager_approved"
  | "locked";

export type EmployeeTimesheet = {
  id: string;
  technician_id: string;
  period_start: string;
  period_end: string;
  status: TimesheetWorkflowStatus;
  released_at: string | null;
  released_by: string | null;
  employee_signed_at: string | null;
  employee_signature_name: string | null;
  dispute_note: string | null;
  disputed_at: string | null;
  manager_id: string | null;
  manager_approved_at: string | null;
  locked_at: string | null;
  last_synced_at: string | null;
  manager_note: string | null;
  created_at: string;
  updated_at: string;
};

/** Non-job hours (shop, training, admin) layered onto the synced timesheet. */
export type TimesheetAdjustment = {
  id: string;
  technician_id: string;
  work_date: string;
  activity_code: string;
  regular_hours: number;
  overtime_hours: number;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Field-service time entry categories (ServiceTitan-style). */
export type TimeActivityType =
  | "regular_work"
  | "overtime"
  | "travel"
  | "shop"
  | "training"
  | "meeting"
  | "break"
  | "admin_nonbillable";

export type TimeBillableStatus = "billable" | "nonbillable" | "contract_included";

export type TimeApprovalStatus =
  | "active"
  | "missing_clock_out"
  | "pending_correction"
  | "complete"
  | "pending_approval"
  | "submitted"
  | "approved"
  | "rejected"
  | "locked";

export type TimeBillingControlStatus =
  | "not_ready"
  | "ready_to_bill"
  | "included_on_draft"
  | "billed"
  | "nonbillable"
  | "disputed";

/** Canonical timesheet row stored in Supabase `time_entries`. */
export type TimeEntry = {
  id: string;
  technician_id: string;
  work_order_id: string | null;
  customer_id: string | null;
  equipment_id: string | null;
  service_location: string | null;
  entry_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number;
  activity_type: TimeActivityType;
  billable_status: TimeBillableStatus;
  regular_hours: number;
  overtime_hours: number;
  hourly_cost_rate: number;
  overtime_cost_rate: number;
  billing_rate: number;
  labor_cost: number;
  billable_amount: number;
  notes: string | null;
  manual_entry_reason: string | null;
  is_manual: boolean;
  approval_status: TimeApprovalStatus;
  submitted_at?: string | null;
  submitted_by?: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  rejection_reason: string | null;
  reopened_at?: string | null;
  reopened_by?: string | null;
  reopen_reason?: string | null;
  correction_reason?: string | null;
  edit_reason?: string | null;
  original_clock_in_at?: string | null;
  original_clock_out_at?: string | null;
  original_regular_hours?: number | null;
  original_overtime_hours?: number | null;
  original_activity_type?: string | null;
  original_notes?: string | null;
  original_values?: Record<string, unknown> | null;
  revised_values?: Record<string, unknown> | null;
  requires_manager_assignment_override?: boolean;
  unassigned_work_order?: boolean;
  exception_flags?: string[] | null;
  exception_severity?: "critical" | "warning" | "review" | "resolved" | null;
  duration_flag_12h?: boolean;
  duration_flag_16h?: boolean;
  is_duplicate_suspect?: boolean;
  billing_status?: TimeBillingControlStatus;
  invoice_id?: string | null;
  billed_at?: string | null;
  billed_by?: string | null;
  is_void?: boolean;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  weekly_timesheet_id?: string | null;
  cert_week_start?: string | null;
  created_by: string | null;
  updated_by: string | null;
  locked_at: string | null;
  locked_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  technician_labor_id: string | null;
  created_at: string;
  updated_at: string;
  technician?: { id: string; full_name: string | null; email: string } | null;
  work_orders?: {
    id: string;
    work_order_number: string | null;
    work_order_type?: string | null;
    problem_description?: string | null;
    status?: string | null;
    billing_status?: string | null;
    dispatch_status?: string | null;
    customers?: {
      id: string;
      name: string;
      service_address?: string | null;
      city?: string | null;
      state?: string | null;
    } | null;
    equipment?: { id: string; name: string | null; serial_number?: string | null } | null;
  } | null;
  customers?: { id: string; name: string } | null;
};

export type WeeklyTimesheet = {
  id: string;
  technician_id: string;
  week_start: string;
  week_end: string;
  status: "open" | "submitted" | "manager_approved" | "locked" | "returned";
  certification_text: string | null;
  certified_at: string | null;
  certified_name: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  manager_id: string | null;
  manager_approved_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  return_reason: string | null;
  returned_at: string | null;
  returned_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TimeEntryAudit = {
  id: string;
  time_entry_id: string | null;
  action: string;
  actor_id: string | null;
  actor_role?: string | null;
  work_order_id?: string | null;
  detail?: string | null;
  reason?: string | null;
  original_values?: Record<string, unknown> | null;
  revised_values?: Record<string, unknown> | null;
  status_before?: string | null;
  status_after?: string | null;
  created_at: string;
};

/** Weekly preferred availability window (0=Sun … 6=Sat). Multiple rows per day = split shifts. */
export type TechnicianAvailability = {
  id: string;
  technician_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type TechnicianShiftStatus = "draft" | "published" | "canceled";

/** Manager-published shift on a calendar day. */
export type TechnicianShift = {
  id: string;
  technician_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  status: TechnicianShiftStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Day attendance punch (arrive / leave work) — separate from job labor. */
export type TechnicianDayClock = {
  id: string;
  technician_id: string;
  work_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const ROLE_LABELS: Record<UserRole, string> = {
  administrator: "Administrator",
  service_manager: "Service Manager",
  technician: "Technician",
  billing: "Billing Employee",
  customer: "Customer",
  vendor: "Vendor",
};
