/**
 * CONTROLS REFERENCE (Equipment Service Manager)
 *
 * This business faces unauthorized access risk.
 * Our app reduces the risk by role-based navigation and Supabase Row Level Security.
 *
 * This business faces customer data leakage risk.
 * Our app reduces the risk by scoping customer users to their own customer_id only.
 *
 * This business faces technician overreach risk.
 * Our app reduces the risk by allowing technicians to update only assigned, non-completed work orders.
 *
 * This business faces incomplete job documentation risk.
 * Our app reduces the risk by requiring manager approval before marking work completed.
 *
 * This business faces unapproved extra billing risk.
 * Our app reduces the risk by blocking billing of additional work until Approved.
 *
 * This business faces inventory shrinkage / negative stock risk.
 * Our app reduces the risk by rejecting part usage that exceeds on-hand quantity without manager override.
 *
 * This business faces warranty billing errors.
 * Our app reduces the risk by tracking warranty-covered amounts and excluding them from customer billable totals.
 *
 * This business faces duplicate billing risk.
 * Our app reduces the risk with unique invoice line source references for labor/parts/recurring/additional charges.
 *
 * This business faces overpayment / AR misstatement risk.
 * Our app reduces the risk by rejecting payments greater than remaining invoice balance.
 *
 * This business faces weak audit evidence.
 * Our app reduces the risk by writing activity_logs for important create/status/payment actions.
 *
 * This business faces weak segregation of duties between create, approve, and bill.
 * Our app reduces the risk with a Risk Controls view (/settings/risk-controls) that
 * filters activity_logs into work order creation, parts approvals, and billing releases.
 */

export const CONTROLS_DOCUMENTED = true;
