"use client";

/**
 * Invoice line-item parts picker: search the inventory catalog and fill a parts line.
 */

import { useEffect, useMemo, useState } from "react";
import { Package, Plus, Search, X } from "lucide-react";
import { formatMoney } from "@/lib/calculations";
import type { Part } from "@/lib/types";

export type PickedCatalogPart = {
  part: Part;
  quantity: number;
};

type Props = {
  open: boolean;
  parts: Part[];
  loading?: boolean;
  busy?: boolean;
  onClose: () => void;
  onAdd: (picked: PickedCatalogPart[], options?: { keepOpen?: boolean }) => void;
};

export function InvoicePartsCatalogPicker({
  open,
  parts,
  loading = false,
  busy = false,
  onClose,
  onAdd,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId(null);
    setQty("1");
    setLocalError(null);
  }, [open]);

  const active = useMemo(() => parts.filter((p) => p.is_active), [parts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active.slice(0, 80);
    return active
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.part_number.toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q) ||
          (p.supplier ?? "").toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [active, query]);

  const selected = active.find((p) => p.id === selectedId) ?? null;

  if (!open) return null;

  function addSelected(keepOpen: boolean) {
    setLocalError(null);
    if (!selected) {
      setLocalError("Select a part from the list.");
      return;
    }
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setLocalError("Quantity must be greater than zero.");
      return;
    }
    onAdd([{ part: selected, quantity: n }], { keepOpen });
    if (keepOpen) {
      setQty("1");
    }
  }

  return (
    <dialog className="modal modal-open" open>
      <div className="modal-box flex max-h-[min(92dvh,40rem)] w-full max-w-2xl flex-col overflow-hidden p-0">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-base-300 bg-base-200/50 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Package className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h3 className="text-base font-bold leading-tight">Add parts from inventory</h3>
              <p className="text-xs opacity-60">
                Select a catalog part — description, price, and amount fill on the invoice.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-5">
          <label className="input input-bordered flex h-10 items-center gap-2">
            <Search className="h-4 w-4 opacity-50" />
            <input
              type="search"
              className="grow bg-transparent text-sm outline-none"
              placeholder="Search part #, name, category, supplier…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={busy || loading}
              autoFocus
            />
          </label>

          {localError ? (
            <div className="alert alert-error py-2 text-sm">{localError}</div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-box border border-base-300">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm opacity-60">
                <span className="loading loading-spinner loading-sm" />
                Loading parts catalog…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm opacity-60">
                {active.length === 0
                  ? "No active parts in inventory. Add parts under Parts first."
                  : "No parts match your search."}
              </div>
            ) : (
              <table className="table table-sm">
                <thead className="sticky top-0 bg-base-100 z-10">
                  <tr>
                    <th>Part</th>
                    <th className="hidden sm:table-cell">On hand</th>
                    <th className="text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const isSel = p.id === selectedId;
                    return (
                      <tr
                        key={p.id}
                        className={`cursor-pointer hover:bg-base-200/80 ${isSel ? "bg-primary/10" : ""}`}
                        onClick={() => setSelectedId(p.id)}
                      >
                        <td>
                          <div className="font-medium leading-tight">
                            {p.part_number}
                            {isSel ? (
                              <span className="badge badge-primary badge-xs ml-1.5 normal-case">Selected</span>
                            ) : null}
                          </div>
                          <div className="text-xs opacity-65">{p.name}</div>
                          {p.category ? (
                            <div className="text-[11px] opacity-45">{p.category}</div>
                          ) : null}
                        </td>
                        <td className="hidden sm:table-cell">
                          <span
                            className={
                              p.quantity_on_hand <= 0
                                ? "text-error"
                                : p.quantity_on_hand <= p.reorder_level
                                  ? "text-warning"
                                  : ""
                            }
                          >
                            {p.quantity_on_hand}
                          </span>
                        </td>
                        <td className="text-right font-medium">
                          {formatMoney(p.standard_customer_price)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {selected ? (
            <div className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-200/30 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase opacity-50">Selected</p>
                <p className="truncate text-sm font-semibold">
                  {selected.part_number} — {selected.name}
                </p>
                <p className="text-xs opacity-60">
                  Unit price {formatMoney(selected.standard_customer_price)}
                  {selected.quantity_on_hand <= 0 ? " · out of stock (still billable)" : ""}
                </p>
              </div>
              <label className="form-control w-24">
                <span className="label-text mb-0.5 text-xs opacity-60">Qty</span>
                <input
                  type="number"
                  min="0.01"
                  step="1"
                  className="input input-bordered input-sm w-full"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  disabled={busy}
                />
              </label>
              <div className="text-right">
                <p className="text-xs opacity-50">Line amount</p>
                <p className="text-sm font-bold">
                  {formatMoney(Number(qty) * Number(selected.standard_customer_price))}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-base-300 bg-base-200/30 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm gap-1"
            disabled={busy || !selected}
            onClick={() => addSelected(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add another
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1"
            disabled={busy || !selected}
            onClick={() => addSelected(false)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add to invoice
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" disabled={busy} onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}

/** Description line for invoice from a catalog part. */
export function catalogPartLineDescription(part: Part): string {
  return `${part.part_number} — ${part.name}`;
}
