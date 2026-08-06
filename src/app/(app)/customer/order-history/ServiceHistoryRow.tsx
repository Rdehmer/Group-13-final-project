"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/calculations";
import type { InvoicePdfCustomer } from "@/lib/invoices";
import {
  buildInvoiceLineItems,
  formatServiceDate,
  invoicePaymentMessage,
  isWorkOrderCompleted,
  isWorkOrderInProgress,
  pickDownloadableInvoice,
  type ServiceHistoryInvoice,
  type ServiceHistoryWorkOrder,
} from "@/lib/invoices";
import {
  averageRating,
  canRateWorkOrder,
  formatRatingAverage,
  type ServiceHistoryRating,
} from "@/lib/service-ratings";
import type { WorkOrderServiceRating } from "@/lib/types";
import { StatusBadge, statusTone } from "@/components/ui";
import { RateServiceModal } from "./RateServiceModal";

type Props = {
  workOrder: ServiceHistoryWorkOrder;
  customer: InvoicePdfCustomer;
  customerId: string;
  rating: ServiceHistoryRating | null;
  autoOpenRate?: boolean;
  onRated: (rating: ServiceHistoryRating) => void;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function InvoiceItemizedSummary({ invoice }: { invoice: ServiceHistoryInvoice }) {
  const lineItems = buildInvoiceLineItems(invoice);
  const balance = Number(invoice.remaining_balance ?? 0);
  const isPaid = balance <= 0 || invoice.status === "Paid";

  return (
    <div className="mt-3 space-y-3">
      <div className="overflow-hidden rounded-box border border-base-300">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Description</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((line) => (
              <tr key={line.label}>
                <td>{line.label}</td>
                <td className="text-right tabular-nums">
                  {line.negative ? "−" : ""}
                  {formatMoney(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="space-y-1.5 border-t border-base-300 pt-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="opacity-70">Invoice Total</dt>
          <dd className="font-semibold tabular-nums">{formatMoney(invoice.invoice_total)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="opacity-70">Amount Paid</dt>
          <dd className="tabular-nums">{formatMoney(invoice.amount_paid)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className={isPaid ? "opacity-70" : "font-medium text-error"}>Balance Due</dt>
          <dd className={`tabular-nums ${isPaid ? "" : "font-semibold text-error"}`}>
            {formatMoney(invoice.remaining_balance)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function ServiceHistoryRow({
  workOrder,
  customer,
  customerId,
  rating,
  autoOpenRate = false,
  onRated,
}: Props) {
  const supabase = createClient();
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const invoice = pickDownloadableInvoice(workOrder.invoices ?? undefined);
  const inProgress = isWorkOrderInProgress(workOrder.status);
  const completed = isWorkOrderCompleted(workOrder.status);
  const canRate = completed && !rating && canRateWorkOrder(workOrder.status);

  useEffect(() => {
    if (autoOpenRate && canRate) {
      setExpanded(true);
      setRateOpen(true);
    }
  }, [autoOpenRate, canRate]);

  async function handleDownload() {
    if (!invoice || downloading) return;
    setDownloading(true);
    try {
      const { downloadInvoicePdf } = await import("@/lib/invoicePdf");
      await downloadInvoicePdf(invoice, workOrder, customer);
    } finally {
      setDownloading(false);
    }
  }

  function handleRated(submitted: WorkOrderServiceRating) {
    onRated(submitted);
    setRateOpen(false);
  }

  const completionLabel = workOrder.completion_date
    ? formatServiceDate(workOrder.completion_date)
    : completed
      ? "Completed"
      : null;

  const ratingAverage = rating ? formatRatingAverage(averageRating(rating)) : null;

  return (
    <>
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
                disabled={downloading}
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
                {canRate ? (
                  <button
                    type="button"
                    className="badge badge-outline badge-sm gap-1 hover:badge-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(true);
                      setRateOpen(true);
                    }}
                  >
                    <Star className="h-3 w-3" />
                    Rate Service
                  </button>
                ) : null}
                {rating ? (
                  <span className="badge badge-success badge-sm gap-1">
                    <Star className="h-3 w-3 fill-current" />
                    Rated · {ratingAverage}
                  </span>
                ) : null}
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
                  <StatusBadge label={invoice.status} tone={statusTone(invoice.status)} />
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
              <div className="mt-4 rounded-box bg-base-100 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">Invoice {invoice.invoice_number}</p>
                  <StatusBadge label={invoice.status} tone={statusTone(invoice.status)} />
                </div>
                <p className="text-sm font-medium opacity-90">{invoicePaymentMessage(invoice)}</p>
                <InvoiceItemizedSummary invoice={invoice} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm gap-1"
                    onClick={handleDownload}
                    disabled={downloading}
                  >
                    <Download className="h-4 w-4" />
                    Download PDF
                  </button>
                  {Number(invoice.remaining_balance) > 0 ? (
                    <Link
                      href={`/customer/pay?invoice=${invoice.id}`}
                      className="btn btn-primary btn-sm"
                    >
                      Pay Invoice
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm opacity-70">
                Your invoice will appear here once billing is complete for this visit.
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {canRate ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm gap-1"
                  onClick={() => setRateOpen(true)}
                >
                  <Star className="h-4 w-4" />
                  Rate Service
                </button>
              ) : null}
              {completed && workOrder.equipment_id ? (
                <Link
                  href={`/customer/request-service?equipment_id=${workOrder.equipment_id}`}
                  className="btn btn-outline btn-sm"
                >
                  Request follow-up for this equipment
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </article>

      {canRate ? (
        <RateServiceModal
          open={rateOpen}
          supabase={supabase}
          customerId={customerId}
          workOrder={workOrder}
          onClose={() => setRateOpen(false)}
          onSubmitted={handleRated}
        />
      ) : null}
    </>
  );
}
