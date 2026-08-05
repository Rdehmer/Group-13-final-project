"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Download } from "lucide-react";
import { downloadInvoicePdf, type InvoicePdfCustomer } from "@/lib/invoicePdf";
import {
  formatServiceDate,
  invoicePaymentMessage,
  isWorkOrderCompleted,
  isWorkOrderInProgress,
  pickDownloadableInvoice,
  type ServiceHistoryWorkOrder,
} from "@/lib/invoices";
import { formatMoney } from "@/lib/calculations";
import { StatusBadge, statusTone } from "@/components/ui";

type Props = {
  workOrder: ServiceHistoryWorkOrder;
  customer: InvoicePdfCustomer;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export function ServiceHistoryRow({ workOrder, customer }: Props) {
  const [expanded, setExpanded] = useState(false);
  const invoice = pickDownloadableInvoice(workOrder.invoices ?? undefined);
  const inProgress = isWorkOrderInProgress(workOrder.status);
  const completed = isWorkOrderCompleted(workOrder.status);

  function handleDownload() {
    if (!invoice) return;
    downloadInvoicePdf(invoice, workOrder, customer);
  }

  const completionLabel = workOrder.completion_date
    ? formatServiceDate(workOrder.completion_date)
    : completed
      ? "Completed"
      : null;

  return (
    <article className="rounded-box border border-base-300 bg-base-100">
      <div className="flex gap-2 p-3 sm:gap-3 sm:p-4">
        <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
          {invoice ? (
            <button
              type="button"
              className="btn btn-square btn-sm btn-outline"
              title={`Download ${invoice.invoice_number}`}
              aria-label={`Download invoice ${invoice.invoice_number}`}
              onClick={handleDownload}
            >
              <Download className="h-4 w-4" />
            </button>
          ) : (
            <span
              className="badge badge-ghost badge-sm whitespace-nowrap"
              title="Invoice not available yet"
            >
              Invoice pending
            </span>
          )}
        </div>

        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">
                {workOrder.work_order_number}
                <span className="font-normal opacity-60"> · </span>
                {workOrder.work_order_type}
                {workOrder.equipment?.name ? (
                  <>
                    <span className="font-normal opacity-60"> · </span>
                    {workOrder.equipment.name}
                  </>
                ) : null}
              </p>
              <p className="text-xs opacity-70">
                Scheduled {formatServiceDate(workOrder.scheduled_date)}
                {completionLabel ? (
                  <>
                    <span className="opacity-50"> · </span>
                    Completed {completionLabel}
                  </>
                ) : null}
                {workOrder.equipment?.location ? (
                  <>
                    <span className="opacity-50"> · </span>
                    {workOrder.equipment.location}
                  </>
                ) : null}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {inProgress ? (
                <Link
                  href="/customer/open-request"
                  className="badge badge-outline badge-sm hover:badge-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  Track in Active Service
                </Link>
              ) : null}
              <StatusBadge label={workOrder.status} tone={statusTone(workOrder.status)} />
              {invoice ? (
                <>
                  <StatusBadge label={invoice.status} tone={statusTone(invoice.status)} />
                  <span className="text-sm font-medium">{formatMoney(invoice.invoice_total)}</span>
                </>
              ) : null}
              <ChevronDown
                className={`h-4 w-4 opacity-50 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </div>
          </div>
        </button>
      </div>

      {expanded ? (
        <div className="border-t border-base-300 bg-base-200/40 px-3 py-3 sm:px-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            {workOrder.problem_description ? (
              <DetailRow label="Issue reported" value={workOrder.problem_description} />
            ) : null}
            {workOrder.work_performed ? (
              <DetailRow label="Work performed" value={workOrder.work_performed} />
            ) : null}
          </dl>

          {invoice ? (
            <div className="mt-4 rounded-box bg-base-100 p-3">
              <p className="mb-2 text-sm font-medium">Invoice {invoice.invoice_number}</p>
              <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <DetailRow label="Labor" value={formatMoney(invoice.labor_charges)} />
                <DetailRow label="Parts" value={formatMoney(invoice.parts_charges)} />
                <DetailRow label="Tax" value={formatMoney(invoice.tax)} />
                <DetailRow label="Total" value={formatMoney(invoice.invoice_total)} />
                <DetailRow label="Paid" value={formatMoney(invoice.amount_paid)} />
                <DetailRow label="Balance" value={formatMoney(invoice.remaining_balance)} />
              </dl>
              <p className="mt-2 text-sm opacity-80">{invoicePaymentMessage(invoice)}</p>
              <button
                type="button"
                className="btn btn-outline btn-xs mt-3 gap-1"
                onClick={handleDownload}
              >
                <Download className="h-3 w-3" />
                Download PDF
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm opacity-70">
              Your invoice will appear here once billing is complete for this visit.
            </p>
          )}

          {completed && workOrder.equipment_id ? (
            <div className="mt-3">
              <Link
                href={`/customer?equipment_id=${workOrder.equipment_id}`}
                className="btn btn-ghost btn-xs"
              >
                Request follow-up for this equipment
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
