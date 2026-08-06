"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ExternalLink, ReceiptText, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/calculations";
import { StatusBadge } from "@/components/ui";
import type { EmergencyPurchase, Part, Profile, WorkOrder } from "@/lib/types";

const RECEIPT_BUCKET = "emergency-purchase-receipts";

export type EmergencyPurchaseReviewRow = EmergencyPurchase & {
  technician?: Pick<Profile, "id" | "full_name" | "email"> | null;
  parts?: Pick<Part, "id" | "part_number" | "name"> | null;
  work_orders?: Pick<WorkOrder, "id" | "work_order_number" | "problem_description"> | null;
};

function techLabel(tech: EmergencyPurchaseReviewRow["technician"]) {
  if (!tech) return "Unknown technician";
  return tech.full_name?.trim() || tech.email || "Technician";
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return iso;
  }
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-200/40 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide opacity-55">{label}</p>
      <div className="mt-0.5 text-sm font-medium leading-snug">{children}</div>
    </div>
  );
}

type Props = {
  purchase: EmergencyPurchaseReviewRow;
  onClose: () => void;
  /** When set, shows Mark reimbursed for submitted purchases. */
  onMarkReimbursed?: (purchase: EmergencyPurchaseReviewRow) => void | Promise<void>;
  reimbursing?: boolean;
  /** Hide technician field when the viewer is that technician. */
  hideTechnician?: boolean;
};

/**
 * Shared inquiry review for technician Parts + manager Reimbursements inbox.
 */
export function EmergencyPurchaseReview({
  purchase,
  onClose,
  onMarkReimbursed,
  reimbursing = false,
  hideTechnician = false,
}: Props) {
  const supabase = createClient();
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!purchase.receipt_url?.trim()) {
        setReceiptUrl(null);
        return;
      }
      const { data } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .createSignedUrl(purchase.receipt_url, 3600);
      if (!cancelled) setReceiptUrl(data?.signedUrl ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [purchase.receipt_url, supabase]);

  if (typeof document === "undefined") return null;

  const partNumber = purchase.parts?.part_number;
  const partName = purchase.parts?.name ?? purchase.part_name;
  const wo = purchase.work_orders;
  const canReimburse = Boolean(onMarkReimbursed) && purchase.status === "submitted";

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close review"
        onClick={onClose}
        disabled={reimbursing}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="emergency-purchase-review-title"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-base-300 bg-base-100 p-4 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="emergency-purchase-review-title" className="text-xl font-bold">
              Purchase inquiry
            </h2>
            <p className="text-sm opacity-70">Details from “I bought a part”</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            onClick={onClose}
            disabled={reimbursing}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusBadge
            label={purchase.status === "reimbursed" ? "Reimbursed" : "Pending reimbursement"}
            tone={purchase.status === "reimbursed" ? "success" : "warning"}
          />
          <span className="text-xs opacity-60">Logged {formatWhen(purchase.purchased_at)}</span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {!hideTechnician ? (
            <Detail label="Technician">{techLabel(purchase.technician)}</Detail>
          ) : null}
          <Detail label="Part">
            {partNumber ? (
              <>
                <Link href={`/parts/${purchase.part_id}`} className="link link-hover">
                  {partNumber}
                </Link>
                <span className="block font-normal opacity-80">{partName}</span>
              </>
            ) : (
              partName
            )}
          </Detail>
          <Detail label="Quantity">{purchase.quantity}</Detail>
          <Detail label="Amount paid">{formatMoney(purchase.amount_paid)}</Detail>
          <Detail label="Store">{purchase.store_name}</Detail>
          <Detail label="Job">
            {wo ? (
              <>
                <Link href={`/work-orders/${wo.id}`} className="link link-hover">
                  {wo.work_order_number}
                </Link>
                {wo.problem_description ? (
                  <span className="mt-0.5 block font-normal opacity-70">{wo.problem_description}</span>
                ) : null}
              </>
            ) : (
              <Link href={`/work-orders/${purchase.job_id}`} className="link link-hover">
                Open work order
              </Link>
            )}
          </Detail>
          <Detail label="Purchased at">{formatWhen(purchase.purchased_at)}</Detail>
          <Detail label="Reimbursed at">
            {purchase.status === "reimbursed" ? formatWhen(purchase.reimbursed_at) : "Not yet"}
          </Detail>
          <div className="sm:col-span-2">
            <Detail label="Receipt">
              {receiptUrl ? (
                <a
                  href={receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline btn-sm gap-1.5"
                >
                  <ReceiptText className="h-4 w-4" />
                  View receipt
                  <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                </a>
              ) : (
                <span className="opacity-60">On file</span>
              )}
            </Detail>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn min-h-11"
            onClick={onClose}
            disabled={reimbursing}
          >
            Close
          </button>
          {canReimburse ? (
            <button
              type="button"
              className="btn btn-primary min-h-11"
              disabled={reimbursing}
              onClick={() => void onMarkReimbursed?.(purchase)}
            >
              {reimbursing ? "Saving…" : "Mark reimbursed"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
