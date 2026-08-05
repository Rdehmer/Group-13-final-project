"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  Paperclip,
  Plus,
  Trash2,
  ClipboardList,
  ExternalLink,
  Package,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { FormRow } from "@/components/PageHeader";
import { formatMoney } from "@/lib/calculations";
import {
  getReceiptViewUrl,
  lineTotal,
  loadPurchaseOrders,
  nextPoNumber,
  uploadPoReceipt,
  type PurchaseOrderWithDetails,
} from "@/lib/purchaseOrders";
import type { Part, PurchaseOrderLine } from "@/lib/types";

type LineDraft = {
  part_id: string;
  part_number: string;
  part_name: string;
  description: string;
  quantity: string;
  unit_cost: string;
};

const emptyLine = (): LineDraft => ({
  part_id: "",
  part_number: "",
  part_name: "",
  description: "",
  quantity: "1",
  unit_cost: "0",
});

/**
 * Create / view purchase orders with part lines and receipt attachments.
 * Used by technicians (jobs) and billing (invoices).
 */
export function PurchaseOrderPanel({
  invoiceId,
  workOrderId,
  invoicePoNumber,
  onInvoicePoChange,
  canEdit = true,
  compact,
}: {
  invoiceId?: string | null;
  workOrderId?: string | null;
  /** Invoice-level PO field (customer PO # on the document). */
  invoicePoNumber?: string | null;
  onInvoicePoChange?: (poNumber: string) => void | Promise<void>;
  canEdit?: boolean;
  compact?: boolean;
}) {
  const supabase = createClient();
  const [orders, setOrders] = useState<PurchaseOrderWithDetails[]>([]);
  const [inventory, setInventory] = useState<Part[]>([]);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    po_number: nextPoNumber(),
    vendor_name: "",
    notes: "",
  });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [files, setFiles] = useState<FileList | null>(null);
  const [invoicePoDraft, setInvoicePoDraft] = useState(invoicePoNumber ?? "");

  useEffect(() => {
    setInvoicePoDraft(invoicePoNumber ?? "");
  }, [invoicePoNumber]);

  const refresh = useCallback(async () => {
    if (!invoiceId && !workOrderId) {
      setOrders([]);
      return;
    }
    const { data, error: loadError } = await loadPurchaseOrders(supabase, {
      invoiceId: invoiceId ?? undefined,
      workOrderId: workOrderId ?? undefined,
    });
    setSchemaError(loadError);
    setOrders(data);

    // Resolve receipt preview URLs
    const urls: Record<string, string> = {};
    for (const po of data) {
      for (const att of po.purchase_order_attachments ?? []) {
        const url = await getReceiptViewUrl(supabase, att);
        if (url) urls[att.id] = url;
      }
    }
    setReceiptUrls(urls);
  }, [invoiceId, workOrderId, supabase]);

  useEffect(() => {
    refresh();
    supabase
      .from("parts")
      .select("*")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setInventory((data as Part[]) ?? []));
  }, [refresh]);

  function applyPartToLine(idx: number, partId: string) {
    const part = inventory.find((p) => p.id === partId);
    setLines((prev) => {
      const next = [...prev];
      if (!part) {
        next[idx] = { ...next[idx], part_id: "" };
        return next;
      }
      next[idx] = {
        part_id: part.id,
        part_number: part.part_number,
        part_name: part.name,
        description: part.description || part.name,
        quantity: next[idx].quantity || "1",
        unit_cost: String(part.unit_cost ?? 0),
      };
      return next;
    });
  }

  async function createPo(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .insert({
        po_number: form.po_number.trim(),
        invoice_id: invoiceId || null,
        work_order_id: workOrderId || null,
        vendor_name: form.vendor_name.trim() || null,
        notes: form.notes.trim() || null,
        created_by: user?.id ?? null,
      })
      .select()
      .single();

    if (poError || !po) {
      const msg =
        poError?.message?.includes("purchase_orders") || poError?.message?.includes("schema cache")
          ? `${poError?.message ?? "Error"} — run supabase/migrations/20260805_purchase_orders.sql in Supabase.`
          : poError?.message ?? "Could not create PO";
      setError(msg);
      setBusy(false);
      return;
    }

    const validLines = lines.filter(
      (l) => l.part_id || l.part_number.trim() || l.part_name.trim() || l.description.trim(),
    );
    if (validLines.length) {
      const { error: lineError } = await supabase.from("purchase_order_lines").insert(
        validLines.map((l) => ({
          purchase_order_id: po.id,
          part_id: l.part_id || null,
          part_number: l.part_number.trim() || null,
          part_name: l.part_name.trim() || null,
          description: l.description.trim() || null,
          quantity: Number(l.quantity) || 1,
          unit_cost: Number(l.unit_cost) || 0,
        })),
      );
      if (lineError) {
        setError(lineError.message);
        setBusy(false);
        await refresh();
        return;
      }
    }

    if (files?.length) {
      for (let i = 0; i < files.length; i++) {
        const file = files.item(i);
        if (!file) continue;
        const { error: upError } = await uploadPoReceipt(supabase, {
          purchaseOrderId: po.id,
          file,
          userId: user?.id ?? null,
        });
        if (upError) {
          setError(`PO saved; receipt upload issue: ${upError}`);
        }
      }
    }

    // Sync invoice document PO from first/main tech PO when field empty
    if (invoiceId && onInvoicePoChange && !invoicePoDraft) {
      await onInvoicePoChange(form.po_number.trim());
      setInvoicePoDraft(form.po_number.trim());
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "purchase_order",
      recordId: po.id,
      newValue: form.po_number,
    });

    setShowForm(false);
    setForm({ po_number: nextPoNumber(), vendor_name: "", notes: "" });
    setLines([emptyLine()]);
    setFiles(null);
    await refresh();
    setBusy(false);
  }

  async function removeAttachment(attId: string) {
    if (!canEdit) return;
    setBusy(true);
    await supabase.from("purchase_order_attachments").delete().eq("id", attId);
    await refresh();
    setBusy(false);
  }

  async function removeLine(line: PurchaseOrderLine) {
    if (!canEdit) return;
    setBusy(true);
    await supabase.from("purchase_order_lines").delete().eq("id", line.id);
    await refresh();
    setBusy(false);
  }

  async function saveInvoicePo() {
    if (!onInvoicePoChange) return;
    setBusy(true);
    setError(null);
    await onInvoicePoChange(invoicePoDraft.trim());
    setBusy(false);
  }

  async function addFilesToPo(poId: string, list: FileList | null) {
    if (!list?.length || !canEdit) return;
    setBusy(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    for (let i = 0; i < list.length; i++) {
      const file = list.item(i);
      if (!file) continue;
      const { error: upError } = await uploadPoReceipt(supabase, {
        purchaseOrderId: poId,
        file,
        userId: user?.id ?? null,
      });
      if (upError) setError(upError);
    }
    await refresh();
    setBusy(false);
  }

  if (!invoiceId && !workOrderId) {
    return <p className="text-sm opacity-60">Save or open a job/invoice to add purchase orders.</p>;
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {onInvoicePoChange ? (
        <div className="rounded-box border border-base-300 bg-base-200/30 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
            Invoice PO number
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="input input-bordered input-sm min-w-[12rem] flex-1 font-mono"
              value={invoicePoDraft}
              onChange={(e) => setInvoicePoDraft(e.target.value)}
              placeholder="Customer PO # (printed on invoice)"
              disabled={!canEdit || busy}
            />
            {canEdit ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveInvoicePo}>
                Save PO #
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Purchase orders</h3>
          <span className="badge badge-ghost badge-sm">{orders.length}</span>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="btn btn-outline btn-sm gap-1"
            disabled={busy || Boolean(schemaError)}
            onClick={() => {
              setShowForm((v) => !v);
              setForm((f) => ({ ...f, po_number: nextPoNumber() }));
            }}
          >
            <Plus className="h-4 w-4" /> New PO
          </button>
        ) : null}
      </div>

      {schemaError ? <div className="alert alert-warning text-sm">{schemaError}</div> : null}
      {error ? <div className="alert alert-error text-sm">{error}</div> : null}

      {showForm && canEdit ? (
        <form onSubmit={createPo} className="rounded-box border border-primary/30 bg-primary/5 p-4 space-y-3">
          <p className="text-sm opacity-70">
            Create a PO number, attach ordered parts, and upload receipt photos/PDFs for billing.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="PO number" required>
              <input
                className="input input-bordered input-sm w-full font-mono"
                value={form.po_number}
                onChange={(e) => setForm({ ...form, po_number: e.target.value })}
                required
                disabled={busy}
              />
            </FormRow>
            <FormRow label="Vendor">
              <input
                className="input input-bordered input-sm w-full"
                value={form.vendor_name}
                onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
                placeholder="Supplier name"
                disabled={busy}
              />
            </FormRow>
          </div>
          <FormRow label="Notes">
            <input
              className="input input-bordered input-sm w-full"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Why parts were needed"
              disabled={busy}
            />
          </FormRow>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Part lines</p>
              <button
                type="button"
                className="btn btn-ghost btn-xs gap-1"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
              >
                <Plus className="h-3 w-3" /> Line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid gap-2 rounded-box bg-base-100 p-2 sm:grid-cols-6">
                  <div className="sm:col-span-2">
                    <label className="label py-0 text-xs">Inventory part</label>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={line.part_id}
                      onChange={(e) => applyPartToLine(idx, e.target.value)}
                      disabled={busy}
                    >
                      <option value="">Custom / not catalogued</option>
                      {inventory.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.part_number} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label py-0 text-xs">Part #</label>
                    <input
                      className="input input-bordered input-sm w-full font-mono"
                      value={line.part_number}
                      onChange={(e) => {
                        const n = [...lines];
                        n[idx] = { ...n[idx], part_number: e.target.value };
                        setLines(n);
                      }}
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <label className="label py-0 text-xs">Name</label>
                    <input
                      className="input input-bordered input-sm w-full"
                      value={line.part_name}
                      onChange={(e) => {
                        const n = [...lines];
                        n[idx] = { ...n[idx], part_name: e.target.value };
                        setLines(n);
                      }}
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <label className="label py-0 text-xs">Qty</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input input-bordered input-sm w-full"
                      value={line.quantity}
                      onChange={(e) => {
                        const n = [...lines];
                        n[idx] = { ...n[idx], quantity: e.target.value };
                        setLines(n);
                      }}
                      disabled={busy}
                    />
                  </div>
                  <div className="flex items-end gap-1">
                    <div className="flex-1">
                      <label className="label py-0 text-xs">Unit cost</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input input-bordered input-sm w-full"
                        value={line.unit_cost}
                        onChange={(e) => {
                          const n = [...lines];
                          n[idx] = { ...n[idx], unit_cost: e.target.value };
                          setLines(n);
                        }}
                        disabled={busy}
                      />
                    </div>
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-square"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <FormRow label="Receipt files">
            <input
              type="file"
              className="file-input file-input-bordered file-input-sm w-full"
              accept="image/*,.pdf"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              disabled={busy}
            />
          </FormRow>
          <p className="text-xs opacity-50">
            Images or PDFs. Uses Storage bucket <code>po-receipts</code> when available; small files may store
            inline for demos.
          </p>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? "Saving…" : "Create PO"}
            </button>
          </div>
        </form>
      ) : null}

      {orders.length === 0 && !showForm ? (
        <p className="text-sm opacity-60">
          No purchase orders yet. Techs can create a PO #, log part purchases, and attach receipts.
        </p>
      ) : (
        <ul className="space-y-3">
          {orders.map((po) => {
            const poLines = po.purchase_order_lines ?? [];
            const attachments = po.purchase_order_attachments ?? [];
            const partsCost = poLines.reduce((s, l) => s + lineTotal(l), 0);
            return (
              <li key={po.id} className="rounded-box border border-base-300 bg-base-100 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-base font-bold">{po.po_number}</p>
                    {po.vendor_name ? <p className="text-sm opacity-70">{po.vendor_name}</p> : null}
                    {po.notes ? <p className="mt-1 text-sm opacity-80">{po.notes}</p> : null}
                    <p className="mt-1 text-xs opacity-50">
                      {new Date(po.created_at).toLocaleString()}
                      {partsCost > 0 ? ` · Parts total ${formatMoney(partsCost)}` : ""}
                    </p>
                  </div>
                  {canEdit ? (
                    <label className="btn btn-outline btn-xs gap-1 cursor-pointer">
                      <Paperclip className="h-3.5 w-3.5" /> Add receipt
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*,.pdf"
                        multiple
                        disabled={busy}
                        onChange={(e) => {
                          addFilesToPo(po.id, e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                </div>

                {poLines.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="table table-xs">
                      <thead>
                        <tr>
                          <th>
                            <Package className="inline h-3 w-3" /> Part
                          </th>
                          <th>Qty</th>
                          <th className="text-right">Unit</th>
                          <th className="text-right">Total</th>
                          {canEdit ? <th /> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {poLines.map((line) => (
                          <tr key={line.id}>
                            <td>
                              <span className="font-medium">
                                {line.part_name || line.description || "Part"}
                              </span>
                              {line.part_number ? (
                                <span className="ml-1 font-mono text-xs opacity-60">{line.part_number}</span>
                              ) : null}
                              {line.part_id ? (
                                <a href={`/parts?part=${line.part_id}`} className="ml-1 link link-hover text-xs">
                                  inv
                                </a>
                              ) : null}
                            </td>
                            <td>{line.quantity}</td>
                            <td className="text-right">{formatMoney(line.unit_cost)}</td>
                            <td className="text-right">{formatMoney(lineTotal(line))}</td>
                            {canEdit ? (
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs btn-square"
                                  onClick={() => removeLine(line)}
                                  aria-label="Remove part line"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-xs opacity-50">No part lines on this PO.</p>
                )}

                {attachments.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">Receipts</p>
                    <ul className="flex flex-wrap gap-2">
                      {attachments.map((att) => {
                        const url = receiptUrls[att.id];
                        return (
                          <li
                            key={att.id}
                            className="flex items-center gap-2 rounded-box border border-base-300 bg-base-200/50 px-2 py-1.5 text-xs"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="link link-hover max-w-[10rem] truncate font-medium"
                              >
                                {att.file_name}
                              </a>
                            ) : (
                              <span className="max-w-[10rem] truncate">{att.file_name}</span>
                            )}
                            {url ? (
                              <a href={url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-xs btn-square">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                            {canEdit ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs btn-square"
                                onClick={() => removeAttachment(att.id)}
                                aria-label="Remove receipt"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-2 text-xs opacity-50">No receipt files attached.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
