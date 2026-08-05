"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, FileText, ClipboardList, ChevronRight, Paperclip, Clipboard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import {
  buildWorkOrderPreview,
  daysPastDue,
  invoiceBucket,
  calendarMonthsForYear,
  formatMonthLabel,
  monthKeyFromDate,
  matchesInvoiceQueue,
  INVOICE_QUEUE_TABS,
  type InvoicePreview,
  type InvoiceQueueFilter,
} from "@/lib/billing";
import { InvoiceWorkflowControls } from "@/components/InvoiceWorkflowControls";
import { equipmentLabel } from "@/lib/equipment";
import { linkWorkOrderPosToInvoice } from "@/lib/purchaseOrders";
import type { Invoice, Profile, TechnicianLabor, WorkOrder, WorkOrderPart } from "@/lib/types";

type InvoiceRow = Invoice & {
  customers?: { name: string; billing_address?: string | null };
  assigned_to?: string | null;
  equipment?: {
    name?: string | null;
    model?: string | null;
    serial_number?: string | null;
  } | null;
  po_number?: string | null;
};

type PoBadge = {
  poCount: number;
  receiptCount: number;
  lastPoNumber: string | null;
};

type WoRow = WorkOrder & {
  customers?: { name: string };
  equipment?: {
    name?: string | null;
    model?: string | null;
    serial_number?: string | null;
    installation_date?: string | null;
  } | null;
};
type TeamMember = Pick<Profile, "id" | "full_name" | "email" | "role">;

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
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamMap, setTeamMap] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [taxRate, setTaxRate] = useState(0.0825);
  const [filter, setFilter] = useState<InvoiceQueueFilter>("all");
  const [invoiceMonth, setInvoiceMonth] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"customer" | "date" | "due" | "total" | "balance">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const readySectionRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewWoId, setPreviewWoId] = useState<string | null>(null);
  const [woPreview, setWoPreview] = useState<InvoicePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [poByInvoice, setPoByInvoice] = useState<Record<string, PoBadge>>({});
  const [poByWorkOrder, setPoByWorkOrder] = useState<Record<string, PoBadge>>({});

  async function loadPoBadges(invoiceList: InvoiceRow[], readyWo: WoRow[]) {
    const invIds = invoiceList.map((i) => i.id);
    const woIds = [
      ...new Set([
        ...invoiceList.map((i) => i.work_order_id).filter(Boolean),
        ...readyWo.map((w) => w.id),
      ]),
    ] as string[];

    if (!invIds.length && !woIds.length) {
      setPoByInvoice({});
      setPoByWorkOrder({});
      return;
    }

    let query = supabase
      .from("purchase_orders")
      .select("id, po_number, invoice_id, work_order_id, purchase_order_attachments(id)");

    // Prefer invoice ids; also load work-order-linked POs
    if (invIds.length && woIds.length) {
      query = query.or(
        `invoice_id.in.(${invIds.join(",")}),work_order_id.in.(${woIds.join(",")})`,
      );
    } else if (invIds.length) {
      query = query.in("invoice_id", invIds);
    } else {
      query = query.in("work_order_id", woIds);
    }

    const { data, error: poError } = await query;
    if (poError || !data) {
      setPoByInvoice({});
      setPoByWorkOrder({});
      return;
    }

    const byInv: Record<string, PoBadge> = {};
    const byWo: Record<string, PoBadge> = {};

    function bump(map: Record<string, PoBadge>, key: string, poNumber: string, receipts: number) {
      const cur = map[key] ?? { poCount: 0, receiptCount: 0, lastPoNumber: null };
      cur.poCount += 1;
      cur.receiptCount += receipts;
      cur.lastPoNumber = poNumber || cur.lastPoNumber;
      map[key] = cur;
    }

    for (const row of data as {
      id: string;
      po_number: string;
      invoice_id: string | null;
      work_order_id: string | null;
      purchase_order_attachments?: { id: string }[] | null;
    }[]) {
      const receipts = row.purchase_order_attachments?.length ?? 0;
      if (row.invoice_id) bump(byInv, row.invoice_id, row.po_number, receipts);
      if (row.work_order_id) bump(byWo, row.work_order_id, row.po_number, receipts);
    }

    // Also mark invoices that only have invoice.po_number text field
    for (const inv of invoiceList) {
      if (inv.po_number && !byInv[inv.id]) {
        byInv[inv.id] = {
          poCount: 0,
          receiptCount: 0,
          lastPoNumber: inv.po_number,
        };
      } else if (inv.po_number && byInv[inv.id] && !byInv[inv.id].lastPoNumber) {
        byInv[inv.id].lastPoNumber = inv.po_number;
      }
    }

    setPoByInvoice(byInv);
    setPoByWorkOrder(byWo);
  }

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
    const [{ data: inv }, { data: wo }, { data: settings }, { data: members }, { data: auth }] =
      await Promise.all([
        supabase
          .from("invoices")
          .select("*, customers(name, billing_address), equipment(name, model, serial_number)")
          .order("created_at", { ascending: false }),
        supabase
          .from("work_orders")
          .select("*, customers(name), equipment(name, model, serial_number, installation_date)")
          .eq("status", "Completed")
          .eq("billing_status", "Unbilled"),
        supabase.from("company_settings").select("default_tax_rate").limit(1).single(),
        supabase
          .from("profiles")
          .select("id, full_name, email, role")
          .in("role", ["billing", "administrator", "service_manager"])
          .eq("is_active", true)
          .order("full_name"),
        supabase.auth.getUser(),
      ]);
    const list = (inv as InvoiceRow[]) ?? [];
    const ready = (wo as WoRow[]) ?? [];
    setInvoices(list);
    setCompletedWo(ready);
    setCurrentUserId(auth.user?.id ?? null);
    const teamList = (members as TeamMember[]) ?? [];
    setTeam(teamList);
    const map: Record<string, string> = {};
    for (const m of teamList) map[m.id] = m.full_name || m.email;
    setTeamMap(map);
    await loadPoBadges(list, ready);
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

  const invoiceMonthOptions = useMemo(() => calendarMonthsForYear(new Date().getFullYear()), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (!matchesInvoiceQueue(inv, filter, today, currentUserId)) return false;
      if (invoiceMonth !== "all" && monthKeyFromDate(inv.invoice_date) !== invoiceMonth) {
        return false;
      }
      if (!q) return true;
      const assignee = inv.assigned_to ? teamMap[inv.assigned_to] ?? "" : "";
      const poBadge = poByInvoice[inv.id];
      const poText = `${inv.po_number ?? ""} ${poBadge?.lastPoNumber ?? ""}`.toLowerCase();
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.customers?.name ?? "").toLowerCase().includes(q) ||
        inv.status.toLowerCase().includes(q) ||
        assignee.toLowerCase().includes(q) ||
        poText.includes(q)
      );
    });
  }, [invoices, filter, invoiceMonth, query, today, currentUserId, teamMap, poByInvoice]);

  const sortedFiltered = useMemo(() => {
    const rows = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "customer":
          cmp = (a.customers?.name ?? "").localeCompare(b.customers?.name ?? "", undefined, {
            sensitivity: "base",
          });
          break;
        case "date":
          cmp = (a.invoice_date || "").localeCompare(b.invoice_date || "");
          break;
        case "due":
          cmp = (a.due_date || "").localeCompare(b.due_date || "");
          break;
        case "total":
          cmp = Number(a.invoice_total) - Number(b.invoice_total);
          break;
        case "balance":
          cmp = Number(a.remaining_balance) - Number(b.remaining_balance);
          break;
        default:
          cmp = 0;
      }
      return cmp * dir;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const filtersActive = filter !== "all" || invoiceMonth !== "all" || query.trim() !== "";

  function clearFilters() {
    setFilter("all");
    setInvoiceMonth("all");
    setQuery("");
  }

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "customer" ? "asc" : "desc");
    }
  }

  function sortLabel(key: typeof sortKey, label: string) {
    if (sortKey !== key) return label;
    return `${label} ${sortDir === "asc" ? "↑" : "↓"}`;
  }

  function applyQueueFilter(next: InvoiceQueueFilter) {
    setFilter((prev) => (prev === next ? "all" : next));
    setPreviewWoId(null);
    setWoPreview(null);
  }

  const selected = invoices.find((i) => i.id === selectedId) ?? null;

  const stats = useMemo(() => {
    let openAr = 0;
    let pastDue = 0;
    let needsReview = 0;
    let onHold = 0;
    let unassigned = 0;
    for (const inv of invoices) {
      const bal = Number(inv.remaining_balance);
      const bucket = invoiceBucket(inv, today);
      if (bal > 0 && bucket !== "draft" && bucket !== "on_hold" && bucket !== "needs_review" && bucket !== "reviewed") {
        openAr += bal;
      }
      if (bucket === "past_due") pastDue += bal;
      if (bucket === "needs_review") needsReview += 1;
      if (bucket === "on_hold") onHold += 1;
      if (!inv.assigned_to && inv.status !== "Paid" && inv.status !== "Canceled") unassigned += 1;
    }
    return {
      openAr,
      pastDue,
      needsReview,
      onHold,
      unassigned,
      readyCount: completedWo.length,
    };
  }, [invoices, completedWo, today]);

  async function updateInvoiceWorkflow(
    invoiceId: string,
    patch: { status?: string; assigned_to?: string | null },
  ) {
    setBusy(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updError } = await supabase
      .from("invoices")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", invoiceId);
    if (updError) {
      const msg = updError.message.includes("assigned_to")
        ? `${updError.message} — run supabase/migrations/20260805_invoice_assignment_status.sql in Supabase if assigned_to is missing.`
        : updError.message;
      setError(msg);
      setBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: patch.status ? "status_change" : "assigned",
      recordType: "invoice",
      recordId: invoiceId,
      newValue: patch.status ?? patch.assigned_to ?? "unassigned",
    });
    await load();
    setSelectedId(invoiceId);
    setBusy(false);
  }

  async function loadPreviewForWo(woId: string) {
    await loadWoPreview(woId, taxRate);
  }

  async function createInvoice(status: "Draft" | "Needs Review" | "Sent" = "Draft") {
    if (!previewWoId || !woPreview) return;
    const wo = completedWo.find((w) => w.id === previewWoId);
    if (!wo) return;
    setError(null);
    setBusy(true);

    const due = new Date();
    due.setDate(due.getDate() + 30);
    const { data: { user } } = await supabase.auth.getUser();
    const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

    const payload: Record<string, unknown> = {
      invoice_number: invoiceNumber,
      customer_id: wo.customer_id,
      work_order_id: wo.id,
      contract_id: wo.contract_id,
      equipment_id: wo.equipment_id,
      due_date: due.toISOString().slice(0, 10),
      labor_charges: woPreview.laborCharges,
      parts_charges: woPreview.partsCharges,
      warranty_deductions: woPreview.warrantyDeductions,
      tax: woPreview.tax,
      invoice_total: woPreview.total,
      remaining_balance: woPreview.total,
      status,
      created_by: user?.id ?? null,
      assigned_to: user?.id ?? null,
    };

    let { data: inv, error: insertError } = await supabase
      .from("invoices")
      .insert(payload)
      .select()
      .single();

    // Retry without optional columns if not migrated yet.
    if (insertError?.message?.includes("assigned_to") || insertError?.message?.includes("equipment_id")) {
      if (insertError.message.includes("assigned_to")) delete payload.assigned_to;
      if (insertError.message.includes("equipment_id")) delete payload.equipment_id;
      ({ data: inv, error: insertError } = await supabase.from("invoices").insert(payload).select().single());
    }

    if (insertError || !inv) {
      setError(insertError?.message ?? "Could not create invoice");
      setBusy(false);
      return;
    }

    await supabase.from("work_orders").update({ billing_status: "Billed" }).eq("id", wo.id);
    await linkWorkOrderPosToInvoice(supabase, wo.id, inv.id);
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

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Status queues, team assignment, and posting customer invoices"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/batches" className="btn btn-outline btn-sm">
              Batches
            </Link>
            <Link href="/payments" className="btn btn-outline btn-sm">
              Payments
            </Link>
          </div>
        }
      />

      {error ? <div className="alert alert-error mb-4 text-sm">{error}</div> : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open AR"
          value={formatMoney(stats.openAr)}
          hint="Unpaid balances · click for Sent/Open"
          onClick={() => applyQueueFilter("sent")}
          active={filter === "sent"}
        />
        <StatCard
          label="Past due"
          value={formatMoney(stats.pastDue)}
          hint="Over due date · click to filter"
          danger={stats.pastDue > 0}
          onClick={() => applyQueueFilter("past_due")}
          active={filter === "past_due"}
        />
        <StatCard
          label="Needs review"
          value={stats.needsReview}
          danger={stats.needsReview > 0}
          hint={`${stats.onHold} on hold · ${stats.unassigned} unassigned · click to filter`}
          onClick={() => applyQueueFilter("needs_review")}
          active={filter === "needs_review"}
        />
        <StatCard
          label="Ready to invoice"
          value={stats.readyCount}
          hint="Completed, unbilled jobs · click to jump"
          onClick={() => {
            readySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          active={Boolean(previewWoId)}
        />
      </div>

      {completedWo.length > 0 ? (
        <div
          ref={readySectionRef}
          className="mb-5 scroll-mt-4 rounded-box border border-primary/30 bg-primary/5 p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Ready to invoice</h2>
            <span className="badge badge-primary badge-sm">{completedWo.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {completedWo.map((wo) => {
              const missingEq = !wo.equipment_id && !wo.equipment;
              const poInfo = poByWorkOrder[wo.id];
              return (
              <button
                key={wo.id}
                type="button"
                className={`btn btn-sm ${previewWoId === wo.id ? "btn-primary" : missingEq ? "btn-outline border-warning" : "btn-outline"}`}
                onClick={() => loadPreviewForWo(wo.id)}
              >
                {wo.work_order_number}
                <span className="opacity-70">· {wo.customers?.name ?? "Customer"}</span>
                {missingEq ? <span className="badge badge-warning badge-xs">No equip</span> : null}
                {poInfo?.poCount ? (
                  <span className="badge badge-ghost badge-xs gap-0.5">
                    <Clipboard className="h-2.5 w-2.5" /> {poInfo.poCount}
                  </span>
                ) : null}
              </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <label className="form-control w-full sm:max-w-[14rem]">
          <select
            className="select select-bordered select-sm w-full"
            value={filter}
            onChange={(e) => setFilter(e.target.value as InvoiceQueueFilter)}
            aria-label="Invoice status"
          >
            {INVOICE_QUEUE_TABS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control w-full sm:max-w-[14rem]">
          <select
            className="select select-bordered select-sm w-full"
            value={invoiceMonth}
            onChange={(e) => setInvoiceMonth(e.target.value)}
            aria-label="Invoice month"
          >
            <option value="all">All months</option>
            {invoiceMonthOptions.map((key) => (
              <option key={key} value={key}>
                {formatMonthLabel(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="input input-bordered input-sm flex w-full items-center gap-2 sm:max-w-xs sm:flex-1">
          <Search className="h-4 w-4 opacity-50" />
          <input
            type="search"
            className="grow"
            placeholder="Search invoice, customer, assignee…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {filtersActive ? (
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="card bg-base-100 shadow">
          <div className="card-body p-0">
            {sortedFiltered.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title={
                    invoiceMonth !== "all"
                      ? `No invoices in ${formatMonthLabel(invoiceMonth)}`
                      : filter !== "all"
                        ? `No invoices for ${INVOICE_QUEUE_TABS.find((t) => t.id === filter)?.label ?? "this filter"}`
                        : "No invoices match"
                  }
                  description={
                    filtersActive
                      ? "Try Clear filters, or change status/month/search. You can also create an invoice from a completed work order above."
                      : "Adjust search or create an invoice from a completed work order above."
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>
                        <button type="button" className="btn btn-ghost btn-xs px-1 font-bold" onClick={() => toggleSort("customer")}>
                          {sortLabel("customer", "Customer")}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="btn btn-ghost btn-xs px-1 font-bold" onClick={() => toggleSort("date")}>
                          {sortLabel("date", "Date")}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="btn btn-ghost btn-xs px-1 font-bold" onClick={() => toggleSort("due")}>
                          {sortLabel("due", "Due")}
                        </button>
                      </th>
                      <th className="text-right">
                        <button type="button" className="btn btn-ghost btn-xs px-1 font-bold" onClick={() => toggleSort("total")}>
                          {sortLabel("total", "Total")}
                        </button>
                      </th>
                      <th className="text-right">
                        <button type="button" className="btn btn-ghost btn-xs px-1 font-bold" onClick={() => toggleSort("balance")}>
                          {sortLabel("balance", "Balance")}
                        </button>
                      </th>
                      <th>PO</th>
                      <th>Status</th>
                      <th>Assignee</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFiltered.map((inv) => {
                      const active = selectedId === inv.id && !previewWoId;
                      const overdue = invoiceBucket(inv, today) === "past_due";
                      const poBadge = poByInvoice[inv.id] ??
                        (inv.work_order_id ? poByWorkOrder[inv.work_order_id] : undefined);
                      const hasPo =
                        Boolean(inv.po_number) || Boolean(poBadge?.lastPoNumber) || (poBadge?.poCount ?? 0) > 0;
                      const hasReceipt = (poBadge?.receiptCount ?? 0) > 0;
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
                            {hasPo ? (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="badge badge-outline badge-xs font-mono max-w-[5.5rem] truncate">
                                  {inv.po_number || poBadge?.lastPoNumber || "PO"}
                                </span>
                                {hasReceipt ? (
                                  <span className="badge badge-info badge-xs gap-0.5" title="Receipt attached">
                                    <Paperclip className="h-2.5 w-2.5" />
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-xs opacity-40">—</span>
                            )}
                          </td>
                          <td>
                            <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                          </td>
                          <td className="max-w-[7rem] truncate text-xs">
                            {inv.assigned_to ? teamMap[inv.assigned_to] ?? "Unknown" : (
                              <span className="opacity-50">Unassigned</span>
                            )}
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
                poInfo={poByWorkOrder[previewWoId]}
                onCancel={() => {
                  setPreviewWoId(null);
                  setWoPreview(null);
                  setError(null);
                }}
                onCreateDraft={() => createInvoice("Draft")}
                onCreateReview={() => createInvoice("Needs Review")}
                onCreateSend={() => createInvoice("Sent")}
              />
            ) : selected ? (
              <InvoiceListPreview
                inv={selected}
                today={today}
                team={team}
                assigneeName={selected.assigned_to ? teamMap[selected.assigned_to] : null}
                poBadge={
                  poByInvoice[selected.id] ??
                  (selected.work_order_id ? poByWorkOrder[selected.work_order_id] : undefined)
                }
                busy={busy}
                onStatusChange={(status) => updateInvoiceWorkflow(selected.id, { status })}
                onAssignChange={(userId) => updateInvoiceWorkflow(selected.id, { assigned_to: userId })}
              />
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

function InvoiceListPreview({
  inv,
  today,
  team,
  assigneeName,
  poBadge,
  busy,
  onStatusChange,
  onAssignChange,
}: {
  inv: InvoiceRow;
  today: Date;
  team: TeamMember[];
  assigneeName: string | null;
  poBadge?: PoBadge;
  busy: boolean;
  onStatusChange: (status: string) => void;
  onAssignChange: (userId: string | null) => void;
}) {
  const overdueDays = daysPastDue(inv, today);
  const bucket = invoiceBucket(inv, today);
  const hasPo = Boolean(inv.po_number) || Boolean(poBadge?.lastPoNumber) || (poBadge?.poCount ?? 0) > 0;

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
          {assigneeName ? (
            <p className="mt-1 text-xs opacity-70">
              Assigned to <span className="font-medium">{assigneeName}</span>
            </p>
          ) : (
            <p className="mt-1 text-xs opacity-50">Unassigned</p>
          )}
          {hasPo ? (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
              <span className="badge badge-outline badge-sm font-mono">
                {inv.po_number || poBadge?.lastPoNumber || "PO on file"}
              </span>
              {(poBadge?.poCount ?? 0) > 1 ? (
                <span className="badge badge-ghost badge-sm">{poBadge!.poCount} POs</span>
              ) : null}
              {(poBadge?.receiptCount ?? 0) > 0 ? (
                <span className="badge badge-info badge-sm gap-1">
                  <Paperclip className="h-3 w-3" /> {poBadge!.receiptCount} receipt
                  {poBadge!.receiptCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-xs opacity-50">No PO / receipts yet</p>
          )}
        </div>
        <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
      </div>

      {!inv.equipment ? (
        <div className="alert alert-warning py-2 text-xs">
          <span>
            No equipment on this invoice — open the invoice and attach model / serial before customer review.
          </span>
        </div>
      ) : null}

      <div className="rounded-box border border-base-300 bg-base-200/30 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">Workflow</p>
        <InvoiceWorkflowControls
          status={inv.status}
          assignedTo={inv.assigned_to}
          team={team}
          busy={busy}
          compact
          onStatusChange={onStatusChange}
          onAssignChange={onAssignChange}
        />
      </div>

      {inv.work_order_id ? (
        <p className="text-sm">
          <span className="opacity-60">Job: </span>
          <Link href={`/work-orders/${inv.work_order_id}`} className="link link-primary">
            View job
          </Link>
        </p>
      ) : null}

      {inv.equipment ? (
        <div className="rounded-box bg-base-200/60 p-3 text-sm">
          <p className="text-xs opacity-60">Equipment</p>
          <p className="font-medium">{equipmentLabel(inv.equipment)}</p>
        </div>
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
  poInfo,
  onCancel,
  onCreateDraft,
  onCreateReview,
  onCreateSend,
}: {
  wo: WoRow;
  preview: InvoicePreview | null;
  busy: boolean;
  error: string | null;
  taxRate: number;
  poInfo?: PoBadge;
  onCancel: () => void;
  onCreateDraft: () => void;
  onCreateReview: () => void;
  onCreateSend: () => void;
}) {
  const missingEquipment = !wo.equipment_id && !wo.equipment;

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
        {wo.equipment ? (
          <div className="mt-2 rounded-box bg-base-200/60 p-2 text-xs">
            <p className="opacity-60">Equipment will attach to invoice</p>
            <p className="font-medium">{equipmentLabel(wo.equipment)}</p>
          </div>
        ) : (
          <div className="alert alert-warning mt-2 py-2 text-xs">
            <span>
              <strong>No equipment linked on this job.</strong> Attach model / serial / install date on the{" "}
              <Link href={`/work-orders/${wo.id}`} className="link font-medium">
                job
              </Link>{" "}
              first, or on the invoice after create.
            </span>
          </div>
        )}
        {(poInfo?.poCount ?? 0) > 0 ? (
          <p className="mt-2 flex flex-wrap items-center gap-1 text-xs">
            <span className="badge badge-outline badge-sm">
              {poInfo!.poCount} PO{poInfo!.poCount === 1 ? "" : "s"} from field
            </span>
            {(poInfo?.receiptCount ?? 0) > 0 ? (
              <span className="badge badge-info badge-sm gap-1">
                <Paperclip className="h-3 w-3" /> {poInfo!.receiptCount} receipt
                {poInfo!.receiptCount === 1 ? "" : "s"}
              </span>
            ) : null}
            <span className="opacity-60">will link to this invoice on create</span>
          </p>
        ) : null}
        <Link href={`/work-orders/${wo.id}`} className="link link-primary text-xs">
          Open job detail
        </Link>
      </div>

      {error ? <div className="alert alert-error text-sm">{error}</div> : null}

      {missingEquipment ? (
        <p className="text-xs opacity-60">
          Create is still allowed — billing can finish equipment after draft is saved.
        </p>
      ) : null}

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
            <button type="button" className="btn btn-outline btn-sm" onClick={onCreateReview} disabled={busy}>
              Needs review
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

