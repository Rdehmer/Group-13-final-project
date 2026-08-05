import type { Equipment, Invoice, WorkOrder } from "@/lib/types";

export type ServiceHistoryInvoice = Pick<
  Invoice,
  | "id"
  | "invoice_number"
  | "invoice_date"
  | "due_date"
  | "status"
  | "labor_charges"
  | "parts_charges"
  | "recurring_service_charge"
  | "additional_charges"
  | "warranty_deductions"
  | "discounts"
  | "tax"
  | "invoice_total"
  | "amount_paid"
  | "remaining_balance"
  | "created_at"
>;

export type ServiceHistoryWorkOrder = WorkOrder & {
  equipment?: Pick<Equipment, "id" | "name" | "location"> | null;
  invoices?: ServiceHistoryInvoice[] | null;
};

export type ServiceHistoryFilterTab = "all" | "completed" | "invoiced" | "open_balance";

export type InvoicePdfCustomer = {
  name: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
};

const DOWNLOADABLE_STATUSES = new Set([
  "Sent",
  "Partially Paid",
  "Paid",
  "Past Due",
  "Disputed",
]);

export function isInvoiceDownloadable(invoice: Pick<Invoice, "status">): boolean {
  return DOWNLOADABLE_STATUSES.has(invoice.status);
}

export function pickDownloadableInvoice<T extends ServiceHistoryInvoice>(
  invoices: T[] | null | undefined,
): T | null {
  if (!invoices?.length) return null;
  const eligible = invoices.filter(isInvoiceDownloadable);
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => {
    const dateA = new Date(a.created_at ?? a.invoice_date).getTime();
    const dateB = new Date(b.created_at ?? b.invoice_date).getTime();
    return dateB - dateA;
  })[0];
}

export function isWorkOrderCompleted(status: string): boolean {
  return status === "Completed" || status === "Closed";
}

export function isWorkOrderInProgress(status: string): boolean {
  return !isWorkOrderCompleted(status) && status !== "Canceled";
}

export function serviceHistoryFilterTab(
  wo: ServiceHistoryWorkOrder,
  tab: ServiceHistoryFilterTab,
): boolean {
  const invoice = pickDownloadableInvoice(wo.invoices ?? undefined);
  switch (tab) {
    case "all":
      return true;
    case "completed":
      return isWorkOrderCompleted(wo.status);
    case "invoiced":
      return invoice != null;
    case "open_balance":
      return invoice != null && Number(invoice.remaining_balance) > 0;
    default:
      return true;
  }
}

export function computeServiceHistoryStats(workOrders: ServiceHistoryWorkOrder[]) {
  return {
    totalVisits: workOrders.length,
    completed: workOrders.filter((w) => isWorkOrderCompleted(w.status)).length,
  };
}

export function invoicePaymentMessage(
  invoice: Pick<Invoice, "remaining_balance" | "due_date" | "status">,
): string {
  const balance = Number(invoice.remaining_balance ?? 0);
  if (balance <= 0 || invoice.status === "Paid") return "Paid in full";
  const due = invoice.due_date
    ? new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return due ? `Invoice unpaid — due ${due}` : "Invoice unpaid";
}

export function formatServiceDate(date: string | null | undefined): string {
  if (!date) return "—";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
