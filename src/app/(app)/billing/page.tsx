"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, FileText, ClipboardList, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import {
  buildWorkOrderPreview,
  daysPastDue,
  invoiceBucket,
  type InvoicePreview,
} from "@/lib/billing";
import type { Invoice, TechnicianLabor, WorkOrder, WorkOrderPart } from "@/lib/types";

type InvoiceRow = Invoice & { customers?: { name: string; billing_address?: string | null } };
type WoRow = WorkOrder & { customers?: { name: string } };

type StatusFilter = "all" | "draft" | "sent" | "open" | "past_due" | "paid";

/**
 * This business faces revenue leakage risk when completed work is not invoiced.
 * Our app reduces the risk by letting billing create invoices from completed work orders.
 */
export default function BillingPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkWo = searchParams.get("wo");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [completedWo, setCompletedWo] = useState<WoRow[]>([]);
  const [taxRate, setTaxRate] = useState(0.0825);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewWoId, setPreviewWoId] = useState<string | null>(null);
  const [woPreview, setWoPreview] = useState<InvoicePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadWoPreview(woId: string, rate: number) {
    setPreviewBusy(true);
    setError(null);
    setPreviewWoId(woId);
    setSelectedId(null);
    const [{ data: labor }, { data: parts }] = await Promise.all([
      supabase.from("technician_labor").select("*").eq("work_order_id", woId),
      supabase.from("work_order_parts").select("*").eq("work_order_id", woId),
    ]);
    setWoPreview(
      buildWorkOrderPreview(
        (labor as TechnicianLabor[]) ?? [],
        (parts as WorkOrderPart[]) ?? [],
        rate,
      ),
    );
    setPreviewBusy(false);
  }

  async function load() {
    const [{ data: inv }, { data: wo }, { data: settings }] = await Promise.all([
      supabase
        .from("invoices")
        .select("*, customers(name, billing_address)")
        .order("created_at", { ascending: false }),
      supabase
        .from("work_orders")
        .select("*, customers(name)")
        .eq("status", "Completed")
        .eq("billing_status", "Unbilled"),
      supabase.from("company_settings").select("default_tax_rate").limit(1).single(),
    ]);
    const list = (inv as InvoiceRow[]) ?? [];
    const ready = (wo as WoRow[]) ?? [];
    setInvoices(list);
    setCompletedWo(ready);
    const rate = settings?.default_tax_rate ? Number(settings.default_tax_rate) : taxRate;
    if (settings?.default_tax_rate) setTaxRate(rate);
    if (!selectedId && !deepLinkWo && list.length > 0) setSelectedId(list[0].id);
    if (deepLinkWo && ready.some((w) => w.id === deepLinkWo)) {
      await loadWoPreview(deepLinkWo, rate);
    }
  }

  useEffect(() => {
    load();
  }, [deepLinkWo]);

  const today = useMemo(() => new Date(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((inv) => {
      const bucket = invoiceBucket(inv, today);
      if (filter !== "all") {
        if (filter === "open") {
          if (!(bucket === "open" || bucket === "sent" || bucket === "past_due")) return false;
          if (Number(inv.remaining_balance) <= 0) return false;
        } else if (bucket !== filter) return false;
      }
      if (!q) return true;
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.customers?.name ?? "").toLowerCase().includes(q) ||
        inv.status.toLowerCase().includes(q)
      );
    });
  }, [invoices, filter, query, today]);

  const selected = invoices.find((i) => i.id === selectedId) ?? null;

  const stats = useMemo(() => {
    let openAr = 0;
    let pastDue = 0;
    let draftCount = 0;
    for (const inv of invoices) {
      const bal = Number(inv.remaining_balance);
      const bucket = invoiceBucket(inv, today);
      if (bucket === "draft") draftCount += 1;
      if (bal > 0 && bucket !== "draft") openAr += bal;
      if (bucket === "past_due") pastDue += bal;
    }
    return {
      openAr,
      pastDue,
      draftCount,
      readyCount: completedWo.length,
    };
  }, [invoices, completedWo, today]);

  async function loadPreviewForWo(woId: string) {
    await loadWoPreview(woId, taxRate);
  }

  async function createInvoice(asDraft: boolean) {
    if (!previewWoId || !woPreview) return;
    const wo = completedWo.find((w) => w.id === previewWoId);
    if (!wo) return;
    setError(null);
    setBusy(true);

    const due = new Date();
    due.setDate(due.getDate() + 30);
    const { data: { user } } = await supabase.auth.getUser();
    const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

    const { data: inv, error: insertError } = await supabase
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        customer_id: wo.customer_id,
        work_order_id: wo.id,
        contract_id: wo.contract_id,
        due_date: due.toISOString().slice(0, 10),
        labor_charges: woPreview.laborCharges,
        parts_charges: woPreview.partsCharges,
        warranty_deductions: woPreview.warrantyDeductions,
        tax: woPreview.tax,
        invoice_total: woPreview.total,
        remaining_balance: woPreview.total,
        status: asDraft ? "Draft" : "Sent",
        created_by: user?.id ?? null,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }

    await supabase.from("work_orders").update({ billing_status: "Billed" }).eq("id", wo.id);
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "invoice",
      recordId: inv.id,
      newValue: invoiceNumber,
    });

    setPreviewWoId(null);
    setWoPreview(null);
    await load();
    setSelectedId(inv.id);
    setBusy(false);
    router.push(`/billing/${inv.id}`);
  }

  const tabs: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "draft", label: "Draft" },
    { id: "sent", label: "Sent" },
    { id: "open", label: "Open" },
    { id: "past_due", label: "Past Due" },
    { id: "paid", label: "Paid" },
  ];

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Review billable work, preview charges, and post customer invoices"
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open AR" value={formatMoney(stats.openAr)} hint="Unpaid balances" />
        <StatCard
          label="Past due"
          value={formatMoney(stats.pastDue)}
          hint="Over due date"
          danger={stats.pastDue > 0}
        />
        <StatCard label="Ready to invoice" value={stats.readyCount} hint="Completed, unbilled jobs" />
        <StatCard label="Draft invoices" value={stats.draftCount} hint="Not yet sent" />
      </div>

      {completedWo.length > 0 ? (
        <div className="mb-5 rounded-box border border-primary/30 bg-primary/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Ready to invoice</h2>
            <span className="badge badge-primary badge-sm">{completedWo.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {completedWo.map((wo) => (
              <button
                key={wo.id}
                type="button"
                className={`btn btn-sm ${previewWoId === wo.id ? "btn-primary" : "btn-outline"}`}
                onClick={() => loadPreviewForWo(wo.id)}
              >
                {wo.work_order_number}
                <span className="opacity-70">· {wo.customers?.name ?? "Customer"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="tabs tabs-box tabs-sm w-full overflow-x-auto lg:w-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${filter === t.id ? "tab-active" : ""}`}
              onClick={() => setFilter(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="input input-bordered flex w-full items-center gap-2 lg:max-w-xs">
          <Search className="h-4 w-4 opacity-50" />
          <input
            type="search"
            className="grow"
            placeholder="Search invoice or customer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="card bg-base-100 shadow">
          <div className="card-body p-0">
            {filtered.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No invoices match"
                  description="Adjust filters or create an invoice from a completed work order above."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Due</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Balance</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((inv) => {
                      const active = selectedId === inv.id && !previewWoId;
                      const overdue = invoiceBucket(inv, today) === "past_due";
                      return (
                        <tr
                          key={inv.id}
                          className={`cursor-pointer hover:bg-base-200/80 ${active ? "bg-primary/10" : ""} ${overdue ? "text-error" : ""}`}
                          onClick={() => {
                            setSelectedId(inv.id);
                            setPreviewWoId(null);
                            setWoPreview(null);
                          }}
                        >
                          <td>
                            <Link
                              href={`/billing/${inv.id}`}
                              className="link link-hover font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {inv.invoice_number}
                            </Link>
                          </td>
                          <td>
                            {inv.customer_id ? (
                              <Link
                                href={`/customers/${inv.customer_id}`}
                                className="link link-hover"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {inv.customers?.name ?? "—"}
                              </Link>
                            ) : (
                              inv.customers?.name ?? "—"
                            )}
                          </td>
                          <td>{inv.invoice_date}</td>
                          <td>{inv.due_date}</td>
                          <td className="text-right">{formatMoney(inv.invoice_total)}</td>
                          <td className="text-right font-medium">{formatMoney(inv.remaining_balance)}</td>
                          <td>
                            <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                          </td>
                          <td>
                            <Link
                              href={`/billing/${inv.id}`}
                              className="btn btn-ghost btn-xs"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Open ${inv.invoice_number}`}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card bg-base-100 shadow xl:sticky xl:top-20 xl:self-start">
          <div className="card-body">
            {previewWoId && completedWo.find((w) => w.id === previewWoId) ? (
              <WorkOrderInvoicePreview
                wo={completedWo.find((w) => w.id === previewWoId)!}
                preview={woPreview}
                busy={previewBusy || busy}
                error={error}
                taxRate={taxRate}
                onCancel={() => {
                  setPreviewWoId(null);
                  setWoPreview(null);
                  setError(null);
                }}
                onCreateDraft={() => createInvoice(true)}
                onCreateSend={() => createInvoice(false)}
              />
            ) : selected ? (
              <InvoiceListPreview inv={selected} today={today} />
            ) : (
              <EmptyState
                title="Select an invoice"
                description="Click a row to preview charges, or pick a work order from Ready to invoice."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InvoiceListPreview({ inv, today }: { inv: InvoiceRow; today: Date }) {
  const overdueDays = daysPastDue(inv, today);
  const bucket = invoiceBucket(inv, today);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-60">Invoice preview</p>
          <h3 className="text-xl font-bold">
            <Link href={`/billing/${inv.id}`} className="link link-hover">
              {inv.invoice_number}
            </Link>
          </h3>
          <p className="text-sm opacity-70">
            {inv.customer_id ? (
              <Link href={`/customers/${inv.customer_id}`} className="link link-hover font-medium">
                {inv.customers?.name ?? "Customer"}
              </Link>
            ) : (
              inv.customers?.name ?? "Customer"
            )}
          </p>
        </div>
        <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
      </div>

      {inv.work_order_id ? (
        <p className="text-sm">
          <span className="opacity-60">Job: </span>
          <Link href={`/work-orders/${inv.work_order_id}`} className="link link-primary">
            View job
          </Link>
        </p>
      ) : null}

      {inv.customers?.billing_address ? (
        <p className="whitespace-pre-line text-sm opacity-80">{inv.customers.billing_address}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-box bg-base-200/60 p-3">
          <p className="opacity-60">Invoice date</p>
          <p className="font-medium">{inv.invoice_date}</p>
        </div>
        <div className={`rounded-box p-3 ${bucket === "past_due" ? "bg-error/10" : "bg-base-200/60"}`}>
          <p className="opacity-60">Due date</p>
          <p className="font-medium">
            {inv.due_date}
            {bucket === "past_due" ? (
              <span className="ml-1 text-error">({overdueDays}d overdue)</span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-box border border-base-300">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Description</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {Number(inv.labor_charges) > 0 ? (
              <tr>
                <td>Labor</td>
                <td className="text-right">{formatMoney(inv.labor_charges)}</td>
              </tr>
            ) : null}
            {Number(inv.parts_charges) > 0 ? (
              <tr>
                <td>Parts / materials</td>
                <td className="text-right">{formatMoney(inv.parts_charges)}</td>
              </tr>
            ) : null}
            {Number(inv.recurring_service_charge) > 0 ? (
              <tr>
                <td>Recurring service</td>
                <td className="text-right">{formatMoney(inv.recurring_service_charge)}</td>
              </tr>
            ) : null}
            {Number(inv.additional_charges) > 0 ? (
              <tr>
                <td>Additional charges</td>
                <td className="text-right">{formatMoney(inv.additional_charges)}</td>
              </tr>
            ) : null}
            {Number(inv.warranty_deductions) > 0 ? (
              <tr>
                <td>Warranty deductions</td>
                <td className="text-right">−{formatMoney(inv.warranty_deductions)}</td>
              </tr>
            ) : null}
            {Number(inv.discounts) > 0 ? (
              <tr>
                <td>Discounts</td>
                <td className="text-right">−{formatMoney(inv.discounts)}</td>
              </tr>
            ) : null}
            <tr>
              <td>Tax</td>
              <td className="text-right">{formatMoney(inv.tax)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="space-y-1 border-t border-base-300 pt-3 text-sm">
        <div className="flex justify-between">
          <span className="opacity-70">Invoice total</span>
          <span className="font-semibold">{formatMoney(inv.invoice_total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="opacity-70">Amount paid</span>
          <span>{formatMoney(inv.amount_paid)}</span>
        </div>
        <div className="flex justify-between text-base">
          <span className="font-medium">Balance due</span>
          <span className="font-bold">{formatMoney(inv.remaining_balance)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Link href={`/billing/${inv.id}`} className="btn btn-primary btn-sm gap-1">
          <FileText className="h-4 w-4" /> Open invoice
        </Link>
        {Number(inv.remaining_balance) > 0 && inv.status !== "Canceled" ? (
          <Link href={`/payments?invoice=${inv.id}`} className="btn btn-outline btn-sm">
            Record payment
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function WorkOrderInvoicePreview({
  wo,
  preview,
  busy,
  error,
  taxRate,
  onCancel,
  onCreateDraft,
  onCreateSend,
}: {
  wo: WoRow;
  preview: InvoicePreview | null;
  busy: boolean;
  error: string | null;
  taxRate: number;
  onCancel: () => void;
  onCreateDraft: () => void;
  onCreateSend: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide opacity-60">New invoice preview</p>
        <h3 className="text-xl font-bold">
          <Link href={`/work-orders/${wo.id}`} className="link link-hover">
            {wo.work_order_number}
          </Link>
        </h3>
        <p className="text-sm opacity-70">
          {wo.customer_id ? (
            <Link href={`/customers/${wo.customer_id}`} className="link link-hover font-medium">
              {wo.customers?.name ?? "Customer"}
            </Link>
          ) : (
            wo.customers?.name ?? "Customer"
          )}
        </p>
        <p className="mt-1 text-xs opacity-60">Tax rate {(taxRate * 100).toFixed(2)}% · from company settings</p>
        <Link href={`/work-orders/${wo.id}`} className="link link-primary text-xs">
          Open job detail
        </Link>
      </div>

      {error ? <div className="alert alert-error text-sm">{error}</div> : null}

      {busy && !preview ? (
        <p className="text-sm opacity-60">Loading labor and parts…</p>
      ) : preview ? (
        <>
          <div className="max-h-56 overflow-y-auto rounded-box border border-base-300">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Line item</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.laborLines.length === 0 && preview.partsLines.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="opacity-60">
                      No labor or parts on this work order — invoice will be $0 + tax.
                    </td>
                  </tr>
                ) : null}
                {preview.laborLines.map((line, i) => (
                  <tr key={`l-${i}`}>
                    <td className="max-w-[14rem] truncate text-xs sm:text-sm">{line.description}</td>
                    <td className="text-right">{formatMoney(line.amount)}</td>
                  </tr>
                ))}
                {preview.partsLines.map((line, i) => (
                  <tr key={`p-${i}`}>
                    <td className="max-w-[14rem] truncate text-xs sm:text-sm">{line.description}</td>
                    <td className="text-right">{formatMoney(line.amount)}</td>
                  </tr>
                ))}
                {preview.warrantyDeductions > 0 ? (
                  <tr>
                    <td>Warranty deductions</td>
                    <td className="text-right">−{formatMoney(preview.warrantyDeductions)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="opacity-70">Subtotal</span>
              <span>{formatMoney(preview.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Tax</span>
              <span>{formatMoney(preview.tax)}</span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span>{formatMoney(preview.total)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={onCreateDraft} disabled={busy}>
              Save as draft
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onCreateSend} disabled={busy}>
              {busy ? "Creating…" : "Create & send"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
