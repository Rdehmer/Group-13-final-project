"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ReceiptText, Upload } from "lucide-react";
import { FormRow } from "@/components/PageHeader";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/client";
import type { Part, WorkOrder } from "@/lib/types";

type JobOption = Pick<WorkOrder, "id" | "work_order_number" | "problem_description">;

type Props = {
  technicianId: string;
  parts: Part[];
  jobs: JobOption[];
  onClose: () => void;
  onSubmitted: () => void | Promise<void>;
};

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

function partLabel(part: Part) {
  return `${part.part_number} — ${part.name}`;
}

function receiptExtension(file: File) {
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

export function EmergencyPurchaseLog({
  technicianId,
  parts,
  jobs,
  onClose,
  onSubmitted,
}: Props) {
  const supabase = createClient();
  const [partSearch, setPartSearch] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [amountPaid, setAmountPaid] = useState("");
  const [storeName, setStoreName] = useState("");
  const [jobId, setJobId] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectedPart() {
    const normalized = partSearch.trim().toLowerCase();
    return parts.find(
      (part) =>
        partLabel(part).toLowerCase() === normalized ||
        part.part_number.toLowerCase() === normalized,
    );
  }

  function selectReceipt(file?: File) {
    setError(null);
    if (!file) {
      setReceipt(null);
      return;
    }
    if (!ALLOWED_RECEIPT_TYPES.includes(file.type)) {
      setReceipt(null);
      setError("Receipt must be a JPG, PNG, WEBP, or PDF file.");
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      setReceipt(null);
      setError("Receipt must be 10 MB or smaller.");
      return;
    }
    setReceipt(file);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const part = selectedPart();
    const purchasedQuantity = Number(quantity);
    const paid = Number(amountPaid);
    if (!part) {
      setError("Select a part from the company catalog.");
      return;
    }
    if (!Number.isInteger(purchasedQuantity) || purchasedQuantity < 1) {
      setError("Quantity must be a whole number of at least 1.");
      return;
    }
    if (amountPaid.trim() === "" || !Number.isFinite(paid) || paid <= 0) {
      setError("Amount paid must be greater than zero.");
      return;
    }
    if (!storeName.trim()) {
      setError("Store name is required.");
      return;
    }
    if (!jobId) {
      setError("Select the job this purchase was for.");
      return;
    }
    if (!receipt) {
      setError("Receipt required to log an emergency purchase");
      return;
    }

    setSaving(true);
    const receiptPath = `${technicianId}/${jobId}/${crypto.randomUUID()}.${receiptExtension(receipt)}`;
    const { error: uploadError } = await supabase.storage
      .from("emergency-purchase-receipts")
      .upload(receiptPath, receipt, {
        contentType: receipt.type,
        upsert: false,
      });

    if (uploadError) {
      setError(uploadError.message);
      setSaving(false);
      return;
    }

    const { data: purchaseId, error: purchaseError } = await supabase.rpc(
      "log_emergency_purchase",
      {
        p_job_id: jobId,
        p_part_id: part.id,
        p_quantity: purchasedQuantity,
        p_amount_paid: paid,
        p_store_name: storeName.trim(),
        p_receipt_url: receiptPath,
      },
    );

    if (purchaseError) {
      await supabase.storage.from("emergency-purchase-receipts").remove([receiptPath]);
      setError(purchaseError.message);
      setSaving(false);
      return;
    }

    await logActivity(supabase, {
      userId: technicianId,
      action: "emergency_purchase_logged",
      recordType: "emergency_purchase",
      recordId: purchaseId,
      newValue: `${part.part_number} × ${purchasedQuantity} · $${paid.toFixed(2)}`,
    });
    await onSubmitted();
    setSaving(false);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close dialog"
        onClick={onClose}
        disabled={saving}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="emergency-purchase-title"
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-warning/50 bg-base-100 p-4 shadow-2xl sm:p-6"
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-7 w-7 shrink-0 text-warning" />
          <div>
            <h2 id="emergency-purchase-title" className="text-2xl font-bold">
              I bought a part today
            </h2>
            <p className="text-sm opacity-70">Log an urgent out-of-pocket job cost.</p>
          </div>
        </div>

        {error ? (
          <div role="alert" className="alert alert-error mt-4">
            <span>{error}</span>
          </div>
        ) : null}

        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          <FormRow label="Part" required>
            <input
              className="input input-bordered min-h-12 w-full text-base"
              list="emergency-purchase-parts"
              value={partSearch}
              onChange={(event) => setPartSearch(event.target.value)}
              placeholder="Search by part number or name"
              autoComplete="off"
              required
            />
            <datalist id="emergency-purchase-parts">
              {parts.map((part) => (
                <option key={part.id} value={partLabel(part)} />
              ))}
            </datalist>
          </FormRow>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="Quantity" required>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                className="input input-bordered min-h-12 w-full text-base"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
              />
            </FormRow>
            <FormRow label="Amount paid" required>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                className="input input-bordered min-h-12 w-full text-base"
                value={amountPaid}
                onChange={(event) => setAmountPaid(event.target.value)}
                placeholder="0.00"
                required
              />
            </FormRow>
          </div>

          <FormRow label="Store name" required>
            <input
              className="input input-bordered min-h-12 w-full text-base"
              value={storeName}
              onChange={(event) => setStoreName(event.target.value)}
              placeholder="Hardware or supply store"
              required
            />
          </FormRow>

          <FormRow label="Job" required>
            <select
              className="select select-bordered min-h-12 w-full text-base"
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              required
            >
              <option value="">Select assigned job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.work_order_number} — {job.problem_description ?? "Service job"}
                </option>
              ))}
            </select>
          </FormRow>

          <FormRow label="Receipt" required>
            <label className="btn btn-outline min-h-16 w-full justify-start text-base">
              <Upload className="h-5 w-5" />
              <span className="truncate">{receipt ? receipt.name : "Attach image or PDF"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(event) => selectReceipt(event.target.files?.[0])}
                required
              />
            </label>
          </FormRow>

          {receipt ? (
            <div className="alert alert-success">
              <ReceiptText className="h-5 w-5" />
              <span>Receipt attached: {receipt.name}</span>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="btn min-h-14 text-base"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-warning min-h-14 text-base"
              disabled={saving}
            >
              {saving ? "Uploading…" : "Log purchase"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
