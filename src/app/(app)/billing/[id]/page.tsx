"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, Send, FileEdit, Plus, Trash2, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import {
  buildWorkOrderPreview,
  daysPastDue,
  EDITABLE_LINE_KINDS,
  invoiceBucket,
  invoiceToEditableLines,
  isUnsentInvoice,
  linesFromStoredInvoice,
  newEditableLine,
  recomputeLineAmount,
  rollupEditableLines,
  type BillableLine,
  type EditableInvoiceLine,
} from "@/lib/billing";
import type { Invoice, Payment, TechnicianLabor, WorkOrderPart } from "@/lib/types";

type InvoiceDetail = Invoice & {
  customers?: {
    name: string;
    billing_address?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  work_orders?: { work_order_number: string; problem_description?: string | null } | null;
};

/**
 * Full invoice document view (ServiceTitan-style invoice detail).
 * Draft / unsent invoices can edit line items before send.
 */
export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [lines, setLines] = useState<BillableLine[]>([]);
  const [editLines, setEditLines] = useState<EditableInvoiceLine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [taxRate, setTaxRate] = useState(0.0825);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notes, setNotes] = useState("");

  async function load() {
    const [{ data }, { data: pay }, { data: settings }] = await Promise.all([
      supabase
        .from("invoices")
        .select("*, customers(name, billing_address, email, phone), work_orders(work_order_number, problem_description)")
        .eq("id", id)
        .single(),
      supabase.from("payments").select("*").eq("invoice_id", id).order("payment_date", { ascending: false }),
      supabase.from("company_settings").select("default_tax_rate").limit(1).single(),
    ]);

    const invoice = data as InvoiceDetail | null;
    setInv(invoice);
    setPayments((pay as Payment[]) ?? []);
    if (settings?.default_tax_rate) setTaxRate(Number(settings.default_tax_rate));
    if (!invoice) return;

    setNotes(invoice.notes ?? "");
    setDirty(false);
    setSavedMsg(null);

    let detailLines: BillableLine[] = [];

    if (invoice.work_order_id) {
      const [{ data: labor }, { data: parts }] = await Promise.all([
        supabase.from("technician_labor").select("*").eq("work_order_id", invoice.work_order_id),
        supabase.from("work_order_parts").select("*").eq("work_order_id", invoice.work_order_id),
      ]);
      const lab = (labor as TechnicianLabor[]) ?? [];
      const pts = (parts as WorkOrderPart[]) ?? [];
      if (lab.length > 0 || pts.length > 0) {
        const rate = settings?.default_tax_rate ? Number(settings.default_tax_rate) : 0;
        const preview = buildWorkOrderPreview(lab, pts, rate, {
          recurring: Number(invoice.recurring_service_charge),
          additional: Number(invoice.additional_charges),
          discounts: Number(invoice.discounts),
        });
        detailLines = [...preview.laborLines, ...preview.partsLines];
        if (Number(invoice.warranty_deductions) > 0) {
          detailLines.push({
            kind: "warranty",
            description: "Warranty deductions",
            quantity: null,
            unitPrice: null,
            amount: -Number(invoice.warranty_deductions),
          });
        }
        if (Number(invoice.recurring_service_charge) > 0) {
          detailLines.push({
            kind: "recurring",
            description: "Recurring service charge",
            quantity: null,
            unitPrice: null,
            amount: Number(invoice.recurring_service_charge),
          });
        }
        if (Number(invoice.additional_charges) > 0) {
          detailLines.push({
            kind: "additional",
            description: "Additional charges",
            quantity: null,
            unitPrice: null,
            amount: Number(invoice.additional_charges),
          });
        }
        if (Number(invoice.discounts) > 0) {
          detailLines.push({
            kind: "discount",
            description: "Discounts",
            quantity: null,
            unitPrice: null,
            amount: -Number(invoice.discounts),
          });
        }
      }
    }

    if (detailLines.length === 0) {
      detailLines = linesFromStoredInvoice(invoice).filter((l) => l.kind !== "tax");
    }

    setLines(detailLines);

    // Prefer stored totals as the editable source of truth so save is predictable.
    if (isUnsentInvoice(invoice.status)) {
      setEditLines(invoiceToEditableLines(invoice));
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  const canEdit = inv ? isUnsentInvoice(inv.status) : false;

  const liveTotals = useMemo(() => {
    if (!inv || !canEdit) return null;
    return rollupEditableLines(editLines, taxRate, Number(inv.amount_paid));
  }, [editLines, taxRate, inv, canEdit]);

  function updateLine(lineId: string, patch: Partial<EditableInvoiceLine>) {
    setEditLines((rows) =>
      rows.map((row) => {
        if (row.id !== lineId) return row;
        const next = { ...row, ...patch };
        if ("quantity" in patch || "unitPrice" in patch) {
          if (next.quantity !== "" && next.unitPrice !== "") {
            next.amount = recomputeLineAmount(next);
          }
        }
        return next;
      }),
    );
    setDirty(true);
    setSavedMsg(null);
  }

  function addLine(kind: EditableInvoiceLine["kind"] = "additional") {
    setEditLines((rows) => [...rows, newEditableLine(kind)]);
    setDirty(true);
    setSavedMsg(null);
  }

  function removeLine(lineId: string) {
    setEditLines((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.id !== lineId)));
    setDirty(true);
    setSavedMsg(null);
  }

  async function saveLines() {
    if (!inv || !liveTotals) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("invoices")
      .update({
        labor_charges: liveTotals.labor_charges,
        parts_charges: liveTotals.parts_charges,
        recurring_service_charge: liveTotals.recurring_service_charge,
        additional_charges: liveTotals.additional_charges,
        warranty_deductions: liveTotals.warranty_deductions,
        discounts: liveTotals.discounts,
        tax: liveTotals.tax,
        invoice_total: liveTotals.invoice_total,
        remaining_balance: liveTotals.remaining_balance,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inv.id);

    if (updError) {
      setError(updError.message);
      setSaving(false);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "line_items_updated",
      recordType: "invoice",
      recordId: inv.id,
      newValue: formatMoney(liveTotals.invoice_total),
    });

    setDirty(false);
    setSavedMsg("Line items saved");
    await load();
    setSaving(false);
  }

  async function setStatus(status: string) {
    if (!inv) return;
    if (canEdit && dirty) {
      await saveLines();
    }
    setSaving(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("invoices")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (updError) {
      setError(updError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "status_change",
      recordType: "invoice",
      recordId: inv.id,
      newValue: status,
    });
    await load();
    setSaving(false);
  }

  if (!inv) {
    return <div className="p-8 text-center opacity-60">Loading invoice…</div>;
  }

  const today = new Date();
  const bucket = invoiceBucket(inv, today);
  const overdueDays = daysPastDue(inv, today);
  const displaySubtotal = liveTotals?.subtotal ??
    Number(inv.labor_charges) +
      Number(inv.parts_charges) +
      Number(inv.recurring_service_charge) +
      Number(inv.additional_charges) -
      Number(inv.warranty_deductions) -
      Number(inv.discounts);
  const displayTax = liveTotals?.tax ?? Number(inv.tax);
  const displayTotal = liveTotals?.invoice_total ?? Number(inv.invoice_total);
  const displayBalance = liveTotals?.remaining_balance ?? Number(inv.remaining_balance);

  const workOrder = inv.work_orders;
  const showLines = canEdit ? editLines : lines;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => router.push("/billing")}>
          <ArrowLeft className="h-4 w-4" /> Back to invoices
        </button>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              disabled={saving || !dirty}
              onClick={saveLines}
            >
              <Save className="h-4 w-4" /> Save line items
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              disabled={saving}
              onClick={() => setStatus("Sent")}
            >
              <Send className="h-4 w-4" /> {dirty ? "Save & send" : "Send invoice"}
            </button>
          ) : null}
          {inv.status === "Sent" || inv.status === "Partially Paid" ? (
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              disabled={saving}
              onClick={() => setStatus("Draft")}
            >
              <FileEdit className="h-4 w-4" /> Revert to draft
            </button>
          ) : null}
          {Number(inv.remaining_balance) > 0 && inv.status !== "Canceled" && !canEdit ? (
            <Link href={`/payments?invoice=${inv.id}`} className="btn btn-outline btn-sm gap-1">
              <CreditCard className="h-4 w-4" /> Record payment
            </Link>
          ) : null}
        </div>
      </div>

      {error ? <div className="alert alert-error mb-4 text-sm">{error}</div> : null}
      {savedMsg ? <div className="alert alert-success mb-4 text-sm">{savedMsg}</div> : null}

      {canEdit ? (
        <div className="alert alert-info mb-4 text-sm">
          <span>
            This invoice is unsent. Edit line items below, then <strong>Save</strong> or <strong>Send</strong>.
            Tax is recalculated at {(taxRate * 100).toFixed(2)}%.
          </span>
        </div>
      ) : null}

      <article className="card overflow-hidden bg-base-100 shadow-lg">
        <div className="border-b border-base-300 bg-base-200/50 px-6 py-5 sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
                Ridley Equipment Services
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{inv.invoice_number}</h1>
              <div className="mt-2">
                <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                {bucket === "past_due" ? (
                  <span className="ml-2 text-sm text-error">{overdueDays} days past due</span>
                ) : null}
                {dirty ? <span className="badge badge-warning badge-sm ml-2">Unsaved edits</span> : null}
              </div>
            </div>
            <div className="text-sm sm:text-right">
              <p className="opacity-60">Balance due</p>
              <p className="text-2xl font-bold">{formatMoney(displayBalance)}</p>
              <p className="mt-1 opacity-70">
                Total {formatMoney(displayTotal)} · Paid {formatMoney(inv.amount_paid)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 border-b border-base-300 px-6 py-6 sm:grid-cols-2 sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Bill to</p>
            <p className="mt-1 text-lg font-semibold">
              {inv.customer_id ? (
                <Link href={`/customers/${inv.customer_id}`} className="link link-hover">
                  {inv.customers?.name ?? "Customer"}
                </Link>
              ) : (
                inv.customers?.name ?? "Customer"
              )}
            </p>
            {inv.customers?.billing_address ? (
              <p className="mt-1 whitespace-pre-line text-sm opacity-80">{inv.customers.billing_address}</p>
            ) : null}
            {inv.customers?.email ? (
              <p className="mt-1 text-sm opacity-70">
                <a href={`mailto:${inv.customers.email}`} className="link link-hover">
                  {inv.customers.email}
                </a>
              </p>
            ) : null}
            {inv.customers?.phone ? (
              <p className="text-sm opacity-70">
                <a href={`tel:${inv.customers.phone}`} className="link link-hover">
                  {inv.customers.phone}
                </a>
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:text-right">
            <div>
              <p className="opacity-60">Invoice date</p>
              <p className="font-medium">{inv.invoice_date}</p>
            </div>
            <div>
              <p className="opacity-60">Due date</p>
              <p className={`font-medium ${bucket === "past_due" ? "text-error" : ""}`}>{inv.due_date}</p>
            </div>
            {workOrder?.work_order_number ? (
              <div className="col-span-2">
                <p className="opacity-60">Job</p>
                <p className="font-medium">
                  {inv.work_order_id ? (
                    <Link href={`/work-orders/${inv.work_order_id}`} className="link link-primary">
                      {workOrder.work_order_number}
                    </Link>
                  ) : (
                    workOrder.work_order_number
                  )}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="px-6 py-4 sm:px-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Line items</h2>
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-outline btn-xs gap-1" onClick={() => addLine("labor")}>
                  <Plus className="h-3 w-3" /> Labor
                </button>
                <button type="button" className="btn btn-outline btn-xs gap-1" onClick={() => addLine("parts")}>
                  <Plus className="h-3 w-3" /> Parts
                </button>
                <button type="button" className="btn btn-outline btn-xs gap-1" onClick={() => addLine("additional")}>
                  <Plus className="h-3 w-3" /> Charge
                </button>
                <button type="button" className="btn btn-outline btn-xs gap-1" onClick={() => addLine("discount")}>
                  <Plus className="h-3 w-3" /> Discount
                </button>
              </div>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-box border border-base-300">
            {canEdit ? (
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th className="min-w-[7rem]">Type</th>
                    <th className="min-w-[12rem]">Description</th>
                    <th className="w-24 text-right">Qty</th>
                    <th className="w-28 text-right">Rate</th>
                    <th className="w-32 text-right">Amount</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {editLines.map((line) => {
                    const isDeduction = line.kind === "warranty" || line.kind === "discount";
                    return (
                      <tr key={line.id}>
                        <td>
                          <select
                            className="select select-bordered select-sm w-full max-w-[9rem]"
                            value={line.kind}
                            onChange={(e) =>
                              updateLine(line.id, {
                                kind: e.target.value as EditableInvoiceLine["kind"],
                              })
                            }
                          >
                            {EDITABLE_LINE_KINDS.map((k) => (
                              <option key={k.value} value={k.value}>
                                {k.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input input-bordered input-sm w-full min-w-[10rem]"
                            value={line.description}
                            onChange={(e) => updateLine(line.id, { description: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            className="input input-bordered input-sm w-full text-right"
                            placeholder="—"
                            value={line.quantity}
                            onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="input input-bordered input-sm w-full text-right"
                            placeholder="—"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                          />
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            {isDeduction ? <span className="text-error">−</span> : null}
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="input input-bordered input-sm w-full text-right"
                              value={line.amount}
                              onChange={(e) => updateLine(line.id, { amount: e.target.value })}
                            />
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-error"
                            onClick={() => removeLine(line.id)}
                            disabled={editLines.length <= 1}
                            aria-label="Remove line"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {showLines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="opacity-60">
                        No line detail stored for this invoice.
                      </td>
                    </tr>
                  ) : (
                    (showLines as BillableLine[]).map((line, i) => (
                      <tr key={i}>
                        <td>{line.description}</td>
                        <td className="text-right">{line.quantity != null ? line.quantity : "—"}</td>
                        <td className="text-right">
                          {line.unitPrice != null ? formatMoney(line.unitPrice) : "—"}
                        </td>
                        <td className="text-right font-medium">{formatMoney(line.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {canEdit ? (
            <p className="mt-2 text-xs opacity-60">
              Tip: enter Qty and Rate to auto-calc amount, or type Amount directly. Warranty and discounts reduce the
              subtotal.
            </p>
          ) : null}

          <div className="mt-6 ml-auto max-w-xs space-y-2 text-sm">
            {liveTotals ? (
              <>
                <div className="flex justify-between text-xs opacity-70">
                  <span>Labor</span>
                  <span>{formatMoney(liveTotals.labor_charges)}</span>
                </div>
                <div className="flex justify-between text-xs opacity-70">
                  <span>Parts</span>
                  <span>{formatMoney(liveTotals.parts_charges)}</span>
                </div>
                {liveTotals.recurring_service_charge > 0 ? (
                  <div className="flex justify-between text-xs opacity-70">
                    <span>Recurring</span>
                    <span>{formatMoney(liveTotals.recurring_service_charge)}</span>
                  </div>
                ) : null}
                {liveTotals.additional_charges > 0 ? (
                  <div className="flex justify-between text-xs opacity-70">
                    <span>Additional</span>
                    <span>{formatMoney(liveTotals.additional_charges)}</span>
                  </div>
                ) : null}
                {liveTotals.warranty_deductions > 0 ? (
                  <div className="flex justify-between text-xs opacity-70">
                    <span>Warranty</span>
                    <span>−{formatMoney(liveTotals.warranty_deductions)}</span>
                  </div>
                ) : null}
                {liveTotals.discounts > 0 ? (
                  <div className="flex justify-between text-xs opacity-70">
                    <span>Discounts</span>
                    <span>−{formatMoney(liveTotals.discounts)}</span>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-between">
              <span className="opacity-70">Subtotal</span>
              <span>{formatMoney(displaySubtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Tax ({(taxRate * 100).toFixed(2)}%)</span>
              <span>{formatMoney(displayTax)}</span>
            </div>
            <div className="flex justify-between border-t border-base-300 pt-2 text-base font-bold">
              <span>Invoice total</span>
              <span>{formatMoney(displayTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Payments</span>
              <span>−{formatMoney(inv.amount_paid)}</span>
            </div>
            <div className="flex justify-between border-t border-base-300 pt-2 text-lg font-bold">
              <span>Balance due</span>
              <span>{formatMoney(displayBalance)}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-base-300 px-6 py-4 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Notes</p>
          {canEdit ? (
            <textarea
              className="textarea textarea-bordered mt-2 w-full"
              rows={2}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
              placeholder="Internal or customer-facing notes…"
            />
          ) : inv.notes ? (
            <p className="mt-1 whitespace-pre-line text-sm">{inv.notes}</p>
          ) : (
            <p className="mt-1 text-sm opacity-50">No notes</p>
          )}
        </div>

        {payments.length > 0 ? (
          <div className="border-t border-base-300 px-6 py-4 sm:px-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-70">Payments</h2>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Payment #</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.payment_number}</td>
                      <td>{p.payment_date}</td>
                      <td>{p.payment_method}</td>
                      <td className="text-right">{formatMoney(p.payment_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </article>
    </div>
  );
}
