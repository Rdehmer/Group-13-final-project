/**
 * Monthly contract fees, deductibles, invoice generation, and payment standing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { invoiceSubtotal, invoiceTotal, remainingBalance } from "@/lib/calculations";
import { daysPastDue, formatMonthLabel, monthKeyFromDate } from "@/lib/billing";
import {
  parsePlanSnapshotFromNotes,
  resolvePlan,
  type ResolvedPlan,
} from "@/lib/contract-plans";
import type { Invoice, ServiceContract } from "@/lib/types";

export type ContractPaymentStandingId =
  | "up_to_date"
  | "payment_due"
  | "past_due"
  | "pending_setup"
  | "not_monthly";

export type ContractPaymentStanding = {
  id: ContractPaymentStandingId;
  label: string;
  monthlyAmount: number;
  deductible: number;
  billingPeriod: string | null;
  dueDate: string | null;
  lastPaidDate: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export type ContractStandingSummary = {
  upToDate: number;
  paymentDue: number;
  pastDue: number;
  pendingSetup: number;
};

/** Annual → monthly fee (2 decimal places). */
export function monthlyFromAnnual(annual: number): number {
  const n = Number(annual) || 0;
  if (n <= 0) return 0;
  return Math.round((n / 12) * 100) / 100;
}

export function isMonthlyRecurringBilling(billingMethod: string | null | undefined): boolean {
  return /monthly\s*recurring/i.test(billingMethod ?? "");
}

export function deductibleFromExtras(
  extras: Record<string, string | number | boolean> | null | undefined,
): number {
  if (!extras) return 0;
  const raw = extras.deductible;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function moneyFieldsFromResolvedPlan(resolved: ResolvedPlan): {
  contract_price: number;
  monthly_amount: number;
  deductible: number;
  billing_method: string;
} {
  const annual = Number(resolved.thresholds.annual_price) || 0;
  const billing = resolved.thresholds.billing_method;
  return {
    contract_price: annual,
    monthly_amount: isMonthlyRecurringBilling(billing) ? monthlyFromAnnual(annual) : 0,
    deductible: deductibleFromExtras(resolved.thresholds.extras),
    billing_method: billing,
  };
}

/** Prefer stored monthly_amount; fall back to annual/12 for MRC. */
export function resolvedMonthlyAmount(
  contract: Pick<ServiceContract, "contract_price" | "billing_method" | "monthly_amount">,
): number {
  const stored = Number(contract.monthly_amount) || 0;
  if (stored > 0) return stored;
  if (isMonthlyRecurringBilling(contract.billing_method)) {
    return monthlyFromAnnual(contract.contract_price);
  }
  return 0;
}

export function resolvedDeductible(contract: Pick<ServiceContract, "deductible">): number {
  return Math.max(0, Number(contract.deductible) || 0);
}

export function currentBillingPeriodKey(asOf = new Date()): string {
  return `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}`;
}

export function isMonthlyStandingInvoice(inv: Pick<Invoice, "work_order_id" | "recurring_service_charge" | "contract_id" | "status">): boolean {
  if (!inv.contract_id) return false;
  if (inv.work_order_id) return false;
  if (Number(inv.recurring_service_charge) <= 0) return false;
  const status = (inv.status || "").toLowerCase();
  if (status.includes("canceled") || status.includes("void") || status.includes("credit")) return false;
  return true;
}

function openBalance(inv: Pick<Invoice, "remaining_balance" | "invoice_total" | "amount_paid" | "status">): number {
  const status = (inv.status || "").toLowerCase();
  if (status.includes("paid") && !status.includes("partial")) return 0;
  const remaining = Number(inv.remaining_balance);
  if (Number.isFinite(remaining)) return Math.max(0, remaining);
  return remainingBalance(Number(inv.invoice_total) || 0, Number(inv.amount_paid) || 0);
}

/**
 * Standing for one contract from its monthly standing invoices.
 * Non-MRC contracts return not_monthly.
 */
export function getContractPaymentStanding(
  contract: ServiceContract,
  invoices: Invoice[],
  today = new Date(),
): ContractPaymentStanding {
  const monthlyAmount = resolvedMonthlyAmount(contract);
  const deductible = resolvedDeductible(contract);
  const base = {
    monthlyAmount,
    deductible,
    billingPeriod: null as string | null,
    dueDate: null as string | null,
    lastPaidDate: null as string | null,
    invoiceId: null as string | null,
    invoiceNumber: null as string | null,
  };

  if (!isMonthlyRecurringBilling(contract.billing_method)) {
    return { id: "not_monthly", label: "Not monthly billing", ...base };
  }

  const status = (contract.status || "").toLowerCase();
  const isLive = status === "active" || status === "renewed";
  if (!isLive) {
    return { id: "pending_setup", label: "Pending setup", ...base };
  }

  const monthlyInvoices = invoices
    .filter((inv) => inv.contract_id === contract.id && isMonthlyStandingInvoice(inv))
    .sort((a, b) => {
      const pa = a.billing_period || monthKeyFromDate(a.invoice_date) || "";
      const pb = b.billing_period || monthKeyFromDate(b.invoice_date) || "";
      return pb.localeCompare(pa);
    });

  if (monthlyInvoices.length === 0) {
    return { id: "pending_setup", label: "Pending setup", ...base };
  }

  const currentPeriod = currentBillingPeriodKey(today);
  const periodInvoice =
    monthlyInvoices.find((inv) => (inv.billing_period || "") === currentPeriod) ??
    monthlyInvoices[0];

  const balance = openBalance(periodInvoice);
  const paid =
    balance <= 0.005 ||
    ((periodInvoice.status || "").toLowerCase().includes("paid") &&
      !(periodInvoice.status || "").toLowerCase().includes("partial"));

  const standingBase = {
    ...base,
    billingPeriod: periodInvoice.billing_period,
    dueDate: periodInvoice.due_date,
    invoiceId: periodInvoice.id,
    invoiceNumber: periodInvoice.invoice_number,
    lastPaidDate: paid ? periodInvoice.invoice_date : null,
  };

  if (paid) {
    return { id: "up_to_date", label: "Up to date", ...standingBase };
  }

  const past = daysPastDue(periodInvoice, today) > 0;
  if (past) {
    return { id: "past_due", label: "Past due", ...standingBase };
  }

  return { id: "payment_due", label: "Payment due", ...standingBase };
}

export function summarizeContractStandings(
  standings: ContractPaymentStanding[],
): ContractStandingSummary {
  const summary: ContractStandingSummary = {
    upToDate: 0,
    paymentDue: 0,
    pastDue: 0,
    pendingSetup: 0,
  };
  for (const s of standings) {
    if (s.id === "up_to_date") summary.upToDate += 1;
    else if (s.id === "payment_due") summary.paymentDue += 1;
    else if (s.id === "past_due") summary.pastDue += 1;
    else if (s.id === "pending_setup") summary.pendingSetup += 1;
  }
  return summary;
}

export function standingBadgeClass(id: ContractPaymentStandingId): string {
  switch (id) {
    case "up_to_date":
      return "badge-success";
    case "payment_due":
      return "badge-warning";
    case "past_due":
      return "badge-error";
    case "pending_setup":
      return "badge-ghost";
    default:
      return "badge-ghost";
  }
}

export function formatStandingDetail(standing: ContractPaymentStanding): string {
  const fee =
    standing.monthlyAmount > 0 ? `Monthly fee ${formatUsd(standing.monthlyAmount)}` : null;
  if (standing.id === "up_to_date") {
    const period = standing.billingPeriod
      ? formatMonthLabel(standing.billingPeriod)
      : null;
    return [fee, period ? `Paid for ${period}` : "Paid up"].filter(Boolean).join(" · ");
  }
  if (standing.id === "payment_due" || standing.id === "past_due") {
    return [fee, standing.dueDate ? `Due ${standing.dueDate}` : null].filter(Boolean).join(" · ");
  }
  if (standing.id === "pending_setup") {
    return [fee, "Monthly invoice not generated yet"].filter(Boolean).join(" · ");
  }
  return fee ?? "—";
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Resolve price fields from plan notes when contract still has $0 (customer request). */
export function resolveMoneyFromContractNotes(
  notes: string | null | undefined,
  assetValue = 100_000,
): ReturnType<typeof moneyFieldsFromResolvedPlan> | null {
  const snap = parsePlanSnapshotFromNotes(notes);
  if (!snap?.packName || !snap.tierId) return null;
  const packId = snap.packId;
  const resolved =
    resolvePlan(packId, snap.tierId, snap.assetValue || assetValue) ??
    resolvePlan(
      snap.packName.toLowerCase().replace(/\s+/g, "_"),
      snap.tierId,
      snap.assetValue || assetValue,
    );
  if (!resolved) return null;
  return moneyFieldsFromResolvedPlan(resolved);
}

export type GenerateMonthlyInvoiceResult =
  | { ok: true; created: number; skipped: number; errors: string[] }
  | { ok: false; error: string };

function dueDateFromTerms(invoiceDate: string, paymentTerms: string | null | undefined): string {
  const days = /(\d+)/.exec(paymentTerms ?? "")?.[1];
  const add = days ? Number(days) : 30;
  const d = new Date(`${invoiceDate}T12:00:00`);
  d.setDate(d.getDate() + (Number.isFinite(add) ? add : 30));
  return d.toISOString().slice(0, 10);
}

/**
 * Create Sent monthly fee invoices for Active/Renewed MRC contracts for a billing period.
 * Skips contracts that already have a standing invoice for that period.
 */
export async function generateMonthlyInvoicesForPeriod(
  supabase: SupabaseClient,
  options: {
    billingPeriod?: string;
    userId?: string | null;
    contractIds?: string[];
  } = {},
): Promise<GenerateMonthlyInvoiceResult> {
  const billingPeriod = options.billingPeriod || currentBillingPeriodKey();
  const invoiceDate = new Date().toISOString().slice(0, 10);

  let query = supabase
    .from("service_contracts")
    .select("*")
    .in("status", ["Active", "Renewed"])
    .ilike("billing_method", "%Monthly Recurring%");

  if (options.contractIds?.length) {
    query = query.in("id", options.contractIds);
  }

  const { data: contracts, error } = await query;
  if (error) return { ok: false, error: error.message };

  const list = (contracts ?? []) as ServiceContract[];
  if (list.length === 0) {
    return { ok: true, created: 0, skipped: 0, errors: ["No Active monthly recurring contracts found."] };
  }

  const { data: existing, error: existErr } = await supabase
    .from("invoices")
    .select("id, contract_id, billing_period, work_order_id, recurring_service_charge, status")
    .in(
      "contract_id",
      list.map((c) => c.id),
    )
    .eq("billing_period", billingPeriod)
    .is("work_order_id", null);
  if (existErr) return { ok: false, error: existErr.message };

  const already = new Set(
    (existing ?? [])
      .filter((inv) => isMonthlyStandingInvoice(inv as Invoice))
      .map((inv) => inv.contract_id as string),
  );

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const contract of list) {
    if (already.has(contract.id)) {
      skipped += 1;
      continue;
    }
    const monthly = resolvedMonthlyAmount(contract);
    if (monthly <= 0) {
      skipped += 1;
      errors.push(`${contract.name}: monthly amount is $0 — set contract price first.`);
      continue;
    }

    const subtotal = invoiceSubtotal({
      billableLabor: 0,
      billableParts: 0,
      recurring: monthly,
      additional: 0,
      warrantyDeductions: 0,
      discounts: 0,
    });
    const tax = 0;
    const total = invoiceTotal(subtotal, tax);
    const invoiceNumber = `INV-M${billingPeriod.replace("-", "")}-${Date.now().toString().slice(-5)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

    const { error: insertError } = await supabase.from("invoices").insert({
      invoice_number: invoiceNumber,
      customer_id: contract.customer_id,
      contract_id: contract.id,
      work_order_id: null,
      equipment_id: null,
      invoice_date: invoiceDate,
      due_date: dueDateFromTerms(invoiceDate, contract.payment_terms),
      billing_period: billingPeriod,
      labor_charges: 0,
      parts_charges: 0,
      recurring_service_charge: monthly,
      additional_charges: 0,
      warranty_deductions: 0,
      discounts: 0,
      tax,
      invoice_total: total,
      amount_paid: 0,
      remaining_balance: total,
      status: "Sent",
      notes: `Monthly contract fee — ${contract.name} (${formatMonthLabel(billingPeriod)})`,
      created_by: options.userId ?? null,
      assigned_to: options.userId ?? null,
    });

    if (insertError) {
      errors.push(`${contract.name}: ${insertError.message}`);
      continue;
    }
    created += 1;
  }

  return { ok: true, created, skipped, errors };
}
