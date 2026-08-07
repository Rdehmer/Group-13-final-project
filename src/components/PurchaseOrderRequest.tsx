"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ShoppingCart } from "lucide-react";
import { FormRow } from "@/components/PageHeader";
import { logActivity } from "@/lib/activity";
import { formatPurchaseOrderError } from "@/lib/purchaseOrders";
import { createClient } from "@/lib/supabase/client";
import type { Part } from "@/lib/types";

type Props = {
  technicianId: string;
  parts: Part[];
  onClose: () => void;
  onSubmitted: () => void | Promise<void>;
};

function partLabel(part: Part) {
  return `${part.part_number} — ${part.name}`;
}

export function PurchaseOrderRequest({
  technicianId,
  parts,
  onClose,
  onSubmitted,
}: Props) {
  const supabase = createClient();
  const [partSearch, setPartSearch] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const part = selectedPart();
    const requestedQuantity = Number(quantity);
    if (!part) {
      setError("Select a part from the company catalog.");
      return;
    }
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) {
      setError("Quantity must be a whole number of at least 1.");
      return;
    }

    setSaving(true);
    const { data, error: insertError } = await supabase
      .from("purchase_orders")
      .insert({
        order_type: "restock",
        technician_id: technicianId,
        part_id: part.id,
        quantity_requested: requestedQuantity,
        note: note.trim() || null,
        status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      setError(formatPurchaseOrderError(insertError.message));
      setSaving(false);
      return;
    }

    await logActivity(supabase, {
      userId: technicianId,
      action: "purchase_order_requested",
      recordType: "purchase_order",
      recordId: data.id,
      newValue: `${part.part_number} × ${requestedQuantity}`,
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
        aria-labelledby="purchase-order-title"
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-base-content/20 bg-base-100 p-4 shadow-2xl sm:p-6"
      >
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-7 w-7 shrink-0 text-primary" />
          <div>
            <h2 id="purchase-order-title" className="text-2xl font-bold">
              Request purchase order
            </h2>
            <p className="text-sm opacity-70">Ask the office to restock from warehouse inventory.</p>
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
              list="purchase-order-parts"
              value={partSearch}
              onChange={(event) => setPartSearch(event.target.value)}
              placeholder="Search by part number or name"
              autoComplete="off"
              required
            />
            <datalist id="purchase-order-parts">
              {parts.map((part) => (
                <option key={part.id} value={partLabel(part)} />
              ))}
            </datalist>
          </FormRow>

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

          <FormRow label="Note">
            <textarea
              className="textarea textarea-bordered min-h-24 w-full text-base"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Running low for upcoming jobs"
            />
          </FormRow>

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
              className="btn btn-primary min-h-14 text-base"
              disabled={saving}
            >
              {saving ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
