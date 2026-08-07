/**
 * Invoice generation gates — pending scope-change (AWR), duplicate billing, approved extras.
 */

import { isAwrApproved, isAwrPending } from "@/lib/additional-work";
import type { AdditionalWorkRequest } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const NON_BILLING_INVOICE_STATUSES = new Set([
  "canceled",
  "cancelled",
  "void",
  "credit memo",
  "credit",
]);

export function isActiveBillingInvoiceStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return true;
  return !NON_BILLING_INVOICE_STATUSES.has(s);
}

export function pendingAwrRequests(
  awrs: Pick<AdditionalWorkRequest, "approval_status">[],
): Pick<AdditionalWorkRequest, "approval_status">[] {
  return awrs.filter((a) => isAwrPending(a.approval_status));
}

export function approvedAwrBillableTotal(
  awrs: Pick<AdditionalWorkRequest, "approval_status" | "estimated_additional_charge">[],
): number {
  return Math.round(
    awrs
      .filter((a) => isAwrApproved(a.approval_status))
      .reduce((s, a) => s + Number(a.estimated_additional_charge ?? 0), 0) * 100,
  ) / 100;
}

export function invoiceBlockedByAwrMessage(count: number): string {
  return `Approve or reject ${count} pending scope-change request${count === 1 ? "" : "s"} before invoicing.`;
}

export type WorkOrderInvoiceGate =
  | { ok: true; approvedAwrTotal: number }
  | { ok: false; message: string; pendingAwrCount?: number };

export async function fetchWorkOrderInvoiceGate(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<WorkOrderInvoiceGate> {
  const [{ data: wo }, { data: awrs }, { data: existingInv }] = await Promise.all([
    supabase
      .from("work_orders")
      .select("id, billing_status, status")
      .eq("id", workOrderId)
      .maybeSingle(),
    supabase
      .from("additional_work_requests")
      .select("approval_status, estimated_additional_charge")
      .eq("work_order_id", workOrderId),
    supabase.from("invoices").select("id, status, invoice_number").eq("work_order_id", workOrderId),
  ]);

  if (!wo) return { ok: false, message: "Work order not found." };

  if ((wo as { billing_status?: string }).billing_status === "Billed") {
    return {
      ok: false,
      message: "This job is already billed. Duplicate invoices are not allowed.",
    };
  }

  const activeInv = (existingInv ?? []).filter((i) =>
    isActiveBillingInvoiceStatus((i as { status?: string }).status),
  );
  if (activeInv.length > 0) {
    const num = (activeInv[0] as { invoice_number?: string }).invoice_number;
    return {
      ok: false,
      message: num
        ? `Invoice ${num} already exists for this work order.`
        : "An invoice already exists for this work order.",
    };
  }

  const pending = pendingAwrRequests((awrs ?? []) as AdditionalWorkRequest[]);
  if (pending.length > 0) {
    return {
      ok: false,
      message: invoiceBlockedByAwrMessage(pending.length),
      pendingAwrCount: pending.length,
    };
  }

  return {
    ok: true,
    approvedAwrTotal: approvedAwrBillableTotal((awrs ?? []) as AdditionalWorkRequest[]),
  };
}

export function isDuplicateInvoiceError(message: string): boolean {
  return /duplicate|already billed|already exists for this work order|invoices_work_order_active|pending scope-change/i.test(
    message,
  );
}
