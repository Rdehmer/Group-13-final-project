"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Download } from "lucide-react";
import {
  endOfMonth,
  endOfQuarter,
  format,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney, grossProfit, profitMargin, formatPct } from "@/lib/calculations";
import type { Invoice, Payment, WorkOrder } from "@/lib/types";

type InvoiceRow = Invoice & {
  customers?: { id: string; name: string } | null;
  work_orders?: { work_order_number: string; status: string } | null;
};

type PaymentRow = Payment & {
  customers?: { id: string; name: string } | null;
  invoices?: { invoice_number: string } | null;
};

type WorkOrderRow = WorkOrder & { customers?: { id: string; name: string } | null };

type DatePreset = "all" | "month" | "quarter" | "ytd" | "custom";

type RecognitionRow = {
  id: string;
  workOrderNumber: string;
  customerId: string | null;
  customerName: string;
  completionDate: string;
  billingStatus: string;
  recognizedAmount: number;
  invoiceNumber: string | null;
  source: "Invoice" | "Estimate on completion";
};

const COMPLETED = new Set(["Completed", "Closed"]);
const NON_RECOGNIZED_INVOICE = new Set(["Draft", "Canceled"]);

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter((v) => v.trim() !== ""))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function inDateRange(
  dateStr: string | null | undefined,
  preset: DatePreset,
  customStart: string,
  customEnd: string,
  today: Date,
): boolean {
  if (preset === "all") return true;
  if (!dateStr || dateStr === "—") return false;
  let date: Date;
  try {
    date = parseISO(dateStr);
  } catch {
    return false;
  }
  if (Number.isNaN(date.getTime())) return false;

  if (preset === "month") {
    return isWithinInterval(date, { start: startOfMonth(today), end: endOfMonth(today) });
  }
  if (preset === "quarter") {
    return isWithinInterval(date, { start: startOfQuarter(today), end: endOfQuarter(today) });
  }
  if (preset === "ytd") {
    return isWithinInterval(date, { start: startOfYear(today), end: today });
  }
  if (preset === "custom") {
    if (!customStart || !customEnd) return true;
    return isWithinInterval(date, { start: parseISO(customStart), end: parseISO(customEnd) });
  }
  return true;
}

function agingBucket(dueDate: string, today: Date): "current" | "d30" | "d60" | "d90" {
  const due = parseISO(dueDate);
  const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
  if (days <= 0) return "current";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  return "d90";
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function JumpStatCard({
  label,
  value,
  hint,
  targetId,
  danger,
}: {
  label: string;
  value: string | number;
  hint?: string;
  targetId: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
      aria-label={`Jump to ${label} details`}
      className={`stat w-full rounded-box bg-base-100 text-left shadow transition-colors duration-150
        cursor-pointer hover:bg-base-200/70 hover:ring-1 hover:ring-primary/30
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
        ${danger ? "border border-error/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="stat-title">{label}</div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </div>
      <div className={`stat-value text-2xl ${danger ? "text-error" : ""}`}>{value}</div>
      {hint ? <div className="stat-desc">{hint}</div> : null}
      <div className="stat-desc mt-1 text-primary/80">View details</div>
    </button>
  );
}

function ColumnFilterSelect({
  label,
  value,
  options,
  sortKey,
  activeSort,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  sortKey: string;
  activeSort: { column: string; direction: "asc" | "desc" };
  onChange: (value: string) => void;
}) {
  const sortingThis = activeSort.column === sortKey;
  return (
    <select
      className="select select-bordered select-xs w-full min-w-0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`Filter or sort ${label}`}
    >
      <option value="">All</option>
      <option value="__sort_asc">
        Sort A–Z{sortingThis && activeSort.direction === "asc" ? " ✓" : ""}
      </option>
      <option value="__sort_desc">
        Sort Z–A{sortingThis && activeSort.direction === "desc" ? " ✓" : ""}
      </option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

/**
 * This business faces unclear cash-to-completion linkage risk.
 * Our app reduces the risk by recognizing revenue on completed work and listing the supporting invoices and payments.
 */
export function InvoiceCashReport() {
  const supabase = createClient();
  const today = useMemo(() => new Date(), []);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customStart, setCustomStart] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(today, "yyyy-MM-dd"));

  const [recFilters, setRecFilters] = useState({
    wo: "",
    customer: "",
    completed: "",
    billing: "",
    source: "",
    invoice: "",
  });
  const [recSort, setRecSort] = useState<{ column: keyof typeof recFilters; direction: "asc" | "desc" }>({
    column: "wo",
    direction: "asc",
  });

  const [invFilters, setInvFilters] = useState({
    number: "",
    customer: "",
    date: "",
    wo: "",
    status: "",
  });
  const [invSort, setInvSort] = useState<{ column: keyof typeof invFilters; direction: "asc" | "desc" }>({
    column: "number",
    direction: "asc",
  });

  const [payFilters, setPayFilters] = useState({
    number: "",
    customer: "",
    date: "",
    method: "",
    invoice: "",
  });
  const [paySort, setPaySort] = useState<{ column: keyof typeof payFilters; direction: "asc" | "desc" }>({
    column: "date",
    direction: "desc",
  });

  const [arFilters, setArFilters] = useState({
    number: "",
    customer: "",
    due: "",
    status: "",
    aging: "",
  });
  const [arSort, setArSort] = useState<{ column: keyof typeof arFilters; direction: "asc" | "desc" }>({
    column: "due",
    direction: "asc",
  });

  useEffect(() => {
    (async () => {
      const [{ data: inv }, { data: pay }, { data: wo }] = await Promise.all([
        supabase
          .from("invoices")
          .select("*, customers(id, name), work_orders(work_order_number, status)")
          .order("invoice_date", { ascending: false }),
        supabase
          .from("payments")
          .select("*, customers(id, name), invoices(invoice_number)")
          .order("payment_date", { ascending: false }),
        supabase
          .from("work_orders")
          .select("*, customers(id, name)")
          .order("completion_date", { ascending: false }),
      ]);
      setInvoices((inv as InvoiceRow[]) ?? []);
      setPayments((pay as PaymentRow[]) ?? []);
      setWorkOrders((wo as WorkOrderRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const laborCostAssumption = 45;
  const avgHoursPerWo = 2.5;

  const completedWorkOrders = useMemo(
    () => workOrders.filter((w) => COMPLETED.has(w.status)),
    [workOrders],
  );

  const invoicesByWorkOrder = useMemo(() => {
    const map = new Map<string, InvoiceRow>();
    for (const inv of invoices) {
      if (!inv.work_order_id || NON_RECOGNIZED_INVOICE.has(inv.status)) continue;
      const existing = map.get(inv.work_order_id);
      if (!existing || Number(inv.invoice_total) > Number(existing.invoice_total)) {
        map.set(inv.work_order_id, inv);
      }
    }
    return map;
  }, [invoices]);

  const recognitionRowsAll = useMemo((): RecognitionRow[] => {
    return completedWorkOrders.map((wo) => {
      const invoice = invoicesByWorkOrder.get(wo.id) ?? null;
      const estimated =
        Number(wo.estimated_total_cost ?? 0) ||
        Number(wo.estimated_parts_cost ?? 0) + Number(wo.estimated_labor_hours ?? 0) * 95;
      const recognizedAmount = invoice ? Number(invoice.invoice_total) : estimated;
      return {
        id: wo.id,
        workOrderNumber: wo.work_order_number,
        customerId: wo.customers?.id ?? null,
        customerName: wo.customers?.name ?? "—",
        completionDate: wo.completion_date ?? "—",
        billingStatus: wo.billing_status,
        recognizedAmount,
        invoiceNumber: invoice?.invoice_number ?? null,
        source: invoice ? ("Invoice" as const) : ("Estimate on completion" as const),
      };
    });
  }, [completedWorkOrders, invoicesByWorkOrder]);

  const recognitionRowsDated = useMemo(
    () =>
      recognitionRowsAll.filter((r) =>
        inDateRange(r.completionDate === "—" ? null : r.completionDate, datePreset, customStart, customEnd, today),
      ),
    [recognitionRowsAll, datePreset, customStart, customEnd, today],
  );

  const recognitionRows = useMemo(() => {
    const rows = recognitionRowsDated.filter((r) => {
      if (recFilters.wo && r.workOrderNumber !== recFilters.wo) return false;
      if (recFilters.customer && r.customerName !== recFilters.customer) return false;
      if (recFilters.completed && r.completionDate !== recFilters.completed) return false;
      if (recFilters.billing && r.billingStatus !== recFilters.billing) return false;
      if (recFilters.source && r.source !== recFilters.source) return false;
      if (recFilters.invoice && (r.invoiceNumber ?? "") !== recFilters.invoice) return false;
      return true;
    });
    const valueFor = (r: RecognitionRow) => {
      switch (recSort.column) {
        case "customer":
          return r.customerName;
        case "completed":
          return r.completionDate;
        case "billing":
          return r.billingStatus;
        case "source":
          return r.source;
        case "invoice":
          return r.invoiceNumber ?? "";
        case "wo":
        default:
          return r.workOrderNumber;
      }
    };
    return [...rows].sort((a, b) => {
      const cmp = valueFor(a).localeCompare(valueFor(b), undefined, { sensitivity: "base" });
      return recSort.direction === "asc" ? cmp : -cmp;
    });
  }, [recognitionRowsDated, recFilters, recSort]);

  const paymentsDated = useMemo(
    () =>
      payments.filter((p) =>
        inDateRange(p.payment_date, datePreset, customStart, customEnd, today),
      ),
    [payments, datePreset, customStart, customEnd, today],
  );

  const paymentsFiltered = useMemo(() => {
    const rows = paymentsDated.filter((p) => {
      if (payFilters.number && p.payment_number !== payFilters.number) return false;
      if (payFilters.customer && (p.customers?.name ?? "") !== payFilters.customer) return false;
      if (payFilters.date && p.payment_date !== payFilters.date) return false;
      if (payFilters.method && p.payment_method !== payFilters.method) return false;
      if (payFilters.invoice && (p.invoices?.invoice_number ?? "") !== payFilters.invoice) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      let av = "";
      let bv = "";
      switch (paySort.column) {
        case "customer":
          av = a.customers?.name ?? "";
          bv = b.customers?.name ?? "";
          break;
        case "date":
          av = a.payment_date;
          bv = b.payment_date;
          break;
        case "method":
          av = a.payment_method;
          bv = b.payment_method;
          break;
        case "invoice":
          av = a.invoices?.invoice_number ?? "";
          bv = b.invoices?.invoice_number ?? "";
          break;
        case "number":
        default:
          av = a.payment_number;
          bv = b.payment_number;
      }
      const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      return paySort.direction === "asc" ? cmp : -cmp;
    });
  }, [paymentsDated, payFilters, paySort]);

  const openArInvoicesAll = useMemo(
    () =>
      invoices.filter(
        (i) => !NON_RECOGNIZED_INVOICE.has(i.status) && Number(i.remaining_balance) > 0,
      ),
    [invoices],
  );

  const openArInvoicesDated = useMemo(
    () =>
      openArInvoicesAll.filter((i) =>
        inDateRange(i.due_date, datePreset, customStart, customEnd, today),
      ),
    [openArInvoicesAll, datePreset, customStart, customEnd, today],
  );

  const openArRows = useMemo(() => {
    const rows = openArInvoicesDated
      .map((inv) => ({
        ...inv,
        aging: agingBucket(inv.due_date, today),
        agingLabel:
          agingBucket(inv.due_date, today) === "current"
            ? "Current"
            : agingBucket(inv.due_date, today) === "d30"
              ? "1–30 days"
              : agingBucket(inv.due_date, today) === "d60"
                ? "31–60 days"
                : "61+ days",
      }))
      .filter((inv) => {
        if (arFilters.number && inv.invoice_number !== arFilters.number) return false;
        if (arFilters.customer && (inv.customers?.name ?? "") !== arFilters.customer) return false;
        if (arFilters.due && inv.due_date !== arFilters.due) return false;
        if (arFilters.status && inv.status !== arFilters.status) return false;
        if (arFilters.aging && inv.agingLabel !== arFilters.aging) return false;
        return true;
      });

    return [...rows].sort((a, b) => {
      let av = "";
      let bv = "";
      switch (arSort.column) {
        case "customer":
          av = a.customers?.name ?? "";
          bv = b.customers?.name ?? "";
          break;
        case "due":
          av = a.due_date;
          bv = b.due_date;
          break;
        case "status":
          av = a.status;
          bv = b.status;
          break;
        case "aging":
          av = a.agingLabel;
          bv = b.agingLabel;
          break;
        case "number":
        default:
          av = a.invoice_number;
          bv = b.invoice_number;
      }
      const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      return arSort.direction === "asc" ? cmp : -cmp;
    });
  }, [openArInvoicesDated, arFilters, arSort, today]);

  const recognizedInvoicesDated = useMemo(() => {
    return invoices.filter((i) => {
      if (NON_RECOGNIZED_INVOICE.has(i.status)) return false;
      if (i.work_order_id) {
        const wo = workOrders.find((w) => w.id === i.work_order_id);
        if (wo && !COMPLETED.has(wo.status)) return false;
      }
      return inDateRange(i.invoice_date, datePreset, customStart, customEnd, today);
    });
  }, [invoices, workOrders, datePreset, customStart, customEnd, today]);

  const recognizedInvoicesFiltered = useMemo(() => {
    const rows = recognizedInvoicesDated.filter((inv) => {
      if (invFilters.number && inv.invoice_number !== invFilters.number) return false;
      if (invFilters.customer && (inv.customers?.name ?? "") !== invFilters.customer) return false;
      if (invFilters.date && inv.invoice_date !== invFilters.date) return false;
      if (invFilters.wo && (inv.work_orders?.work_order_number ?? "") !== invFilters.wo) return false;
      if (invFilters.status && inv.status !== invFilters.status) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      let av = "";
      let bv = "";
      switch (invSort.column) {
        case "customer":
          av = a.customers?.name ?? "";
          bv = b.customers?.name ?? "";
          break;
        case "date":
          av = a.invoice_date;
          bv = b.invoice_date;
          break;
        case "wo":
          av = a.work_orders?.work_order_number ?? "";
          bv = b.work_orders?.work_order_number ?? "";
          break;
        case "status":
          av = a.status;
          bv = b.status;
          break;
        case "number":
        default:
          av = a.invoice_number;
          bv = b.invoice_number;
      }
      const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      return invSort.direction === "asc" ? cmp : -cmp;
    });
  }, [recognizedInvoicesDated, invFilters, invSort]);

  const completionRecognizedRevenue = recognitionRows.reduce((s, r) => s + r.recognizedAmount, 0);
  const cashCollected = paymentsFiltered.reduce((s, p) => s + Number(p.payment_amount), 0);
  const openAr = openArRows.reduce((s, i) => s + Number(i.remaining_balance), 0);
  const unbilledCompleted = recognitionRows.filter((r) => !r.invoiceNumber);
  const unbilledTotal = unbilledCompleted.reduce((s, r) => s + r.recognizedAmount, 0);
  const completedWoCount = recognitionRows.length;
  const estDirectLabor = completedWoCount * avgHoursPerWo * laborCostAssumption;
  const estPartsCost = recognizedInvoicesFiltered.reduce((s, i) => s + Number(i.parts_charges) * 0.6, 0);
  const invoiceDirectCost = estDirectLabor + estPartsCost;
  const invoiceProfit = grossProfit(completionRecognizedRevenue, invoiceDirectCost);
  const invoiceMargin = profitMargin(completionRecognizedRevenue, invoiceProfit);

  const agingTotals = useMemo(() => {
    const totals = { current: 0, d30: 0, d60: 0, d90: 0 };
    for (const inv of openArRows) {
      totals[inv.aging] += Number(inv.remaining_balance);
    }
    return totals;
  }, [openArRows]);

  function onRecFilter(column: keyof typeof recFilters, value: string) {
    if (value === "__sort_asc") {
      setRecSort({ column, direction: "asc" });
      return;
    }
    if (value === "__sort_desc") {
      setRecSort({ column, direction: "desc" });
      return;
    }
    setRecFilters((prev) => ({ ...prev, [column]: value }));
  }

  function onInvFilter(column: keyof typeof invFilters, value: string) {
    if (value === "__sort_asc") {
      setInvSort({ column, direction: "asc" });
      return;
    }
    if (value === "__sort_desc") {
      setInvSort({ column, direction: "desc" });
      return;
    }
    setInvFilters((prev) => ({ ...prev, [column]: value }));
  }

  function onPayFilter(column: keyof typeof payFilters, value: string) {
    if (value === "__sort_asc") {
      setPaySort({ column, direction: "asc" });
      return;
    }
    if (value === "__sort_desc") {
      setPaySort({ column, direction: "desc" });
      return;
    }
    setPayFilters((prev) => ({ ...prev, [column]: value }));
  }

  function onArFilter(column: keyof typeof arFilters, value: string) {
    if (value === "__sort_asc") {
      setArSort({ column, direction: "asc" });
      return;
    }
    if (value === "__sort_desc") {
      setArSort({ column, direction: "desc" });
      return;
    }
    setArFilters((prev) => ({ ...prev, [column]: value }));
  }

  function exportRecognition() {
    downloadCsv(
      `revenue-recognition-${format(today, "yyyy-MM-dd")}.csv`,
      ["WO #", "Customer", "Completed", "Billing", "Source", "Invoice", "Recognized"],
      recognitionRows.map((r) => [
        r.workOrderNumber,
        r.customerName,
        r.completionDate,
        r.billingStatus,
        r.source,
        r.invoiceNumber ?? "",
        r.recognizedAmount,
      ]),
    );
  }

  function exportAr() {
    downloadCsv(
      `open-ar-${format(today, "yyyy-MM-dd")}.csv`,
      ["Invoice #", "Customer", "Due", "Total", "Paid", "Balance", "Aging", "Status"],
      openArRows.map((inv) => [
        inv.invoice_number,
        inv.customers?.name ?? "",
        inv.due_date,
        inv.invoice_total,
        inv.amount_paid,
        inv.remaining_balance,
        inv.agingLabel,
        inv.status,
      ]),
    );
  }

  function exportAll() {
    exportRecognition();
    exportAr();
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  const recOptions = {
    wo: uniqueSorted(recognitionRowsDated.map((r) => r.workOrderNumber)),
    customer: uniqueSorted(recognitionRowsDated.map((r) => r.customerName)),
    completed: uniqueSorted(recognitionRowsDated.map((r) => r.completionDate).filter((d) => d !== "—")),
    billing: uniqueSorted(recognitionRowsDated.map((r) => r.billingStatus)),
    source: uniqueSorted(recognitionRowsDated.map((r) => r.source)),
    invoice: uniqueSorted(recognitionRowsDated.map((r) => r.invoiceNumber ?? "")),
  };

  const invOptions = {
    number: uniqueSorted(recognizedInvoicesDated.map((i) => i.invoice_number)),
    customer: uniqueSorted(recognizedInvoicesDated.map((i) => i.customers?.name ?? "")),
    date: uniqueSorted(recognizedInvoicesDated.map((i) => i.invoice_date)),
    wo: uniqueSorted(recognizedInvoicesDated.map((i) => i.work_orders?.work_order_number ?? "")),
    status: uniqueSorted(recognizedInvoicesDated.map((i) => i.status)),
  };

  const payOptions = {
    number: uniqueSorted(paymentsDated.map((p) => p.payment_number)),
    customer: uniqueSorted(paymentsDated.map((p) => p.customers?.name ?? "")),
    date: uniqueSorted(paymentsDated.map((p) => p.payment_date)),
    method: uniqueSorted(paymentsDated.map((p) => p.payment_method)),
    invoice: uniqueSorted(paymentsDated.map((p) => p.invoices?.invoice_number ?? "")),
  };

  const arOptions = {
    number: uniqueSorted(openArInvoicesDated.map((i) => i.invoice_number)),
    customer: uniqueSorted(openArInvoicesDated.map((i) => i.customers?.name ?? "")),
    due: uniqueSorted(openArInvoicesDated.map((i) => i.due_date)),
    status: uniqueSorted(openArInvoicesDated.map((i) => i.status)),
    aging: ["Current", "1–30 days", "31–60 days", "61+ days"],
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-box bg-base-100 p-4 text-sm shadow">
        <div>
          <p className="mb-1 font-semibold">Date range</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All time"],
                ["month", "This month"],
                ["quarter", "This quarter"],
                ["ytd", "YTD"],
                ["custom", "Custom"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`btn btn-xs ${datePreset === key ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setDatePreset(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {datePreset === "custom" ? (
          <div className="flex flex-wrap gap-2">
            <label className="form-control">
              <span className="label-text text-xs">From</span>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">To</span>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        <button type="button" className="btn btn-outline btn-sm gap-1" onClick={exportAll}>
          <Download className="h-4 w-4" aria-hidden />
          Export CSV
        </button>
      </div>

      <div className="mb-4 rounded-box bg-base-100 p-4 text-sm shadow">
        <p className="font-semibold">Revenue recognition policy</p>
        <ul className="mt-2 list-inside list-disc opacity-80">
          <li>
            ASC 606: revenue is earned when a work order is <strong>Completed</strong> or{" "}
            <strong>Closed</strong> (performance obligation satisfied)
          </li>
          <li>If invoiced, earned amount = invoice total (excluding Draft/Canceled/Credit Memo)</li>
          <li>
            If completed but unbilled, earned amount = estimated total (contract asset until billed)
          </li>
          <li>Prepaid / annual contracts earn ratably — see Deferred Revenue Schedule & Period Close</li>
          <li>Cash collected = recorded customer payments; open AR = remaining invoice balances</li>
        </ul>
      </div>

      <div className="mb-2 text-sm font-medium opacity-70">Invoice & cash summary</div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <JumpStatCard
          label="Recognized Revenue"
          value={formatMoney(completionRecognizedRevenue)}
          hint="On completed work orders"
          targetId="section-recognition"
        />
        <JumpStatCard
          label="Cash Collected"
          value={formatMoney(cashCollected)}
          hint="From payments"
          targetId="section-payments"
        />
        <JumpStatCard
          label="Open AR"
          value={formatMoney(openAr)}
          hint="Unpaid invoice balances"
          targetId="section-ar"
          danger={openAr > 0}
        />
        <JumpStatCard
          label="Invoice Est. Gross Margin"
          value={formatPct(invoiceMargin)}
          hint={`Profit ${formatMoney(invoiceProfit)}`}
          targetId="section-invoices"
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Link
          href="/work-orders?filter=unbilled"
          className="stat rounded-box bg-base-100 shadow transition-colors hover:bg-base-200/70 hover:ring-1 hover:ring-primary/30"
          aria-label="View unbilled completed work orders"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="stat-title">Unbilled completed</div>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 opacity-50" aria-hidden />
          </div>
          <div className="stat-value text-2xl">{formatMoney(unbilledTotal)}</div>
          <div className="stat-desc">
            {unbilledCompleted.length} completed WO(s) without invoice — open work orders
          </div>
        </Link>
        <JumpStatCard
          label="Completed work orders"
          value={completedWoCount}
          hint="In selected date range"
          targetId="section-recognition"
        />
      </div>

      <div className="mb-2 text-sm font-medium opacity-70">Open AR aging</div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <JumpStatCard
          label="Current"
          value={formatMoney(agingTotals.current)}
          hint="Not yet due"
          targetId="section-ar"
        />
        <JumpStatCard label="1–30 days" value={formatMoney(agingTotals.d30)} targetId="section-ar" />
        <JumpStatCard label="31–60 days" value={formatMoney(agingTotals.d60)} targetId="section-ar" />
        <JumpStatCard
          label="61+ days"
          value={formatMoney(agingTotals.d90)}
          danger={agingTotals.d90 > 0}
          targetId="section-ar"
        />
      </div>

      <div id="section-recognition" className="mt-6 scroll-mt-4 card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="card-title text-base">Revenue recognition by completed work</h2>
              <p className="text-sm opacity-70">
                Each row attributes recognized revenue to a completed work order.
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={exportRecognition}>
              <Download className="h-4 w-4" aria-hidden />
              Export
            </button>
          </div>
          {recognitionRows.length === 0 ? (
            <EmptyState
              title="No completed work orders"
              description="Complete work orders to recognize revenue, or widen the date range."
            />
          ) : (
            <DualHorizontalScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th>WO #</th>
                    <th>Customer</th>
                    <th>Completed</th>
                    <th>Billing</th>
                    <th>Source</th>
                    <th>Invoice</th>
                    <th>Recognized</th>
                  </tr>
                  <tr className="bg-base-200/50">
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="WO #"
                        value={recFilters.wo}
                        options={recOptions.wo}
                        sortKey="wo"
                        activeSort={recSort}
                        onChange={(v) => onRecFilter("wo", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="customer"
                        value={recFilters.customer}
                        options={recOptions.customer}
                        sortKey="customer"
                        activeSort={recSort}
                        onChange={(v) => onRecFilter("customer", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="completed"
                        value={recFilters.completed}
                        options={recOptions.completed}
                        sortKey="completed"
                        activeSort={recSort}
                        onChange={(v) => onRecFilter("completed", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="billing"
                        value={recFilters.billing}
                        options={recOptions.billing}
                        sortKey="billing"
                        activeSort={recSort}
                        onChange={(v) => onRecFilter("billing", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="source"
                        value={recFilters.source}
                        options={recOptions.source}
                        sortKey="source"
                        activeSort={recSort}
                        onChange={(v) => onRecFilter("source", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="invoice"
                        value={recFilters.invoice}
                        options={recOptions.invoice}
                        sortKey="invoice"
                        activeSort={recSort}
                        onChange={(v) => onRecFilter("invoice", v)}
                      />
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recognitionRows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/work-orders/${r.id}`} className="link link-primary font-medium">
                          {r.workOrderNumber}
                        </Link>
                      </td>
                      <td>
                        {r.customerId ? (
                          <Link href={`/customers/${r.customerId}`} className="link link-primary">
                            {r.customerName}
                          </Link>
                        ) : (
                          r.customerName
                        )}
                      </td>
                      <td>{r.completionDate}</td>
                      <td>
                        <StatusBadge label={r.billingStatus} tone={statusTone(r.billingStatus)} />
                      </td>
                      <td>{r.source}</td>
                      <td>
                        {r.invoiceNumber ? (
                          <Link
                            href={`/billing?invoice=${encodeURIComponent(r.invoiceNumber)}`}
                            className="link link-primary"
                          >
                            {r.invoiceNumber}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="font-medium">{formatMoney(r.recognizedAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-base-300 font-semibold">
                    <td colSpan={6}>Total recognized</td>
                    <td>{formatMoney(completionRecognizedRevenue)}</td>
                  </tr>
                </tfoot>
              </table>
            </DualHorizontalScroll>
          )}
        </div>
      </div>

      <div id="section-invoices" className="mt-6 scroll-mt-4 card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">Invoices (recognized work)</h2>
          <p className="text-sm opacity-70">
            Invoices tied to completed work, or recurring invoices without a canceled/draft status.
          </p>
          {recognizedInvoicesFiltered.length === 0 ? (
            <EmptyState title="No recognized invoices" description="Invoices will appear here." />
          ) : (
            <DualHorizontalScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Work order</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                  <tr className="bg-base-200/50">
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="invoice #"
                        value={invFilters.number}
                        options={invOptions.number}
                        sortKey="number"
                        activeSort={invSort}
                        onChange={(v) => onInvFilter("number", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="customer"
                        value={invFilters.customer}
                        options={invOptions.customer}
                        sortKey="customer"
                        activeSort={invSort}
                        onChange={(v) => onInvFilter("customer", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="date"
                        value={invFilters.date}
                        options={invOptions.date}
                        sortKey="date"
                        activeSort={invSort}
                        onChange={(v) => onInvFilter("date", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="work order"
                        value={invFilters.wo}
                        options={invOptions.wo}
                        sortKey="wo"
                        activeSort={invSort}
                        onChange={(v) => onInvFilter("wo", v)}
                      />
                    </th>
                    <th />
                    <th />
                    <th />
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="status"
                        value={invFilters.status}
                        options={invOptions.status}
                        sortKey="status"
                        activeSort={invSort}
                        onChange={(v) => onInvFilter("status", v)}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recognizedInvoicesFiltered.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <Link
                          href={`/billing?invoice=${encodeURIComponent(inv.invoice_number)}`}
                          className="link link-primary font-medium"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td>
                        {inv.customers?.id ? (
                          <Link href={`/customers/${inv.customers.id}`} className="link link-primary">
                            {inv.customers.name}
                          </Link>
                        ) : (
                          (inv.customers?.name ?? "—")
                        )}
                      </td>
                      <td>{inv.invoice_date}</td>
                      <td>
                        {inv.work_order_id && inv.work_orders?.work_order_number ? (
                          <Link
                            href={`/work-orders/${inv.work_order_id}`}
                            className="link link-primary"
                          >
                            {inv.work_orders.work_order_number}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{formatMoney(inv.invoice_total)}</td>
                      <td>{formatMoney(inv.amount_paid)}</td>
                      <td>{formatMoney(inv.remaining_balance)}</td>
                      <td>
                        <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DualHorizontalScroll>
          )}
        </div>
      </div>

      <div id="section-payments" className="mt-6 scroll-mt-4 card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">Cash collected (payments)</h2>
          <p className="text-sm opacity-70">Payments that make up Cash Collected.</p>
          {paymentsFiltered.length === 0 ? (
            <EmptyState title="No payments" description="Recorded payments will appear here." />
          ) : (
            <DualHorizontalScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th>Payment #</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                  </tr>
                  <tr className="bg-base-200/50">
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="payment #"
                        value={payFilters.number}
                        options={payOptions.number}
                        sortKey="number"
                        activeSort={paySort}
                        onChange={(v) => onPayFilter("number", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="customer"
                        value={payFilters.customer}
                        options={payOptions.customer}
                        sortKey="customer"
                        activeSort={paySort}
                        onChange={(v) => onPayFilter("customer", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="date"
                        value={payFilters.date}
                        options={payOptions.date}
                        sortKey="date"
                        activeSort={paySort}
                        onChange={(v) => onPayFilter("date", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="method"
                        value={payFilters.method}
                        options={payOptions.method}
                        sortKey="method"
                        activeSort={paySort}
                        onChange={(v) => onPayFilter("method", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="invoice"
                        value={payFilters.invoice}
                        options={payOptions.invoice}
                        sortKey="invoice"
                        activeSort={paySort}
                        onChange={(v) => onPayFilter("invoice", v)}
                      />
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {paymentsFiltered.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.payment_number}</td>
                      <td>
                        {p.customers?.id ? (
                          <Link href={`/customers/${p.customers.id}`} className="link link-primary">
                            {p.customers.name}
                          </Link>
                        ) : (
                          (p.customers?.name ?? "—")
                        )}
                      </td>
                      <td>{p.payment_date}</td>
                      <td>{p.payment_method}</td>
                      <td>
                        {p.invoices?.invoice_number ? (
                          <Link
                            href={`/billing?invoice=${encodeURIComponent(p.invoices.invoice_number)}`}
                            className="link link-primary"
                          >
                            {p.invoices.invoice_number}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{formatMoney(p.payment_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-base-300 font-semibold">
                    <td colSpan={5}>Total cash collected</td>
                    <td>{formatMoney(cashCollected)}</td>
                  </tr>
                </tfoot>
              </table>
            </DualHorizontalScroll>
          )}
        </div>
      </div>

      <div id="section-ar" className="mt-6 scroll-mt-4 card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="card-title text-base">Open AR detail</h2>
              <p className="text-sm opacity-70">
                Invoices with remaining balance that make up Open AR.
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={exportAr}>
              <Download className="h-4 w-4" aria-hidden />
              Export
            </button>
          </div>
          {openArRows.length === 0 ? (
            <EmptyState title="No open AR" description="Unpaid invoices will appear here." />
          ) : (
            <DualHorizontalScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    <th>Due</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Aging</th>
                    <th>Status</th>
                  </tr>
                  <tr className="bg-base-200/50">
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="invoice #"
                        value={arFilters.number}
                        options={arOptions.number}
                        sortKey="number"
                        activeSort={arSort}
                        onChange={(v) => onArFilter("number", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="customer"
                        value={arFilters.customer}
                        options={arOptions.customer}
                        sortKey="customer"
                        activeSort={arSort}
                        onChange={(v) => onArFilter("customer", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="due"
                        value={arFilters.due}
                        options={arOptions.due}
                        sortKey="due"
                        activeSort={arSort}
                        onChange={(v) => onArFilter("due", v)}
                      />
                    </th>
                    <th />
                    <th />
                    <th />
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="aging"
                        value={arFilters.aging}
                        options={arOptions.aging}
                        sortKey="aging"
                        activeSort={arSort}
                        onChange={(v) => onArFilter("aging", v)}
                      />
                    </th>
                    <th className="font-normal">
                      <ColumnFilterSelect
                        label="status"
                        value={arFilters.status}
                        options={arOptions.status}
                        sortKey="status"
                        activeSort={arSort}
                        onChange={(v) => onArFilter("status", v)}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {openArRows.map((inv) => (
                    <tr key={inv.id} className={inv.aging === "d90" ? "bg-error/10" : ""}>
                      <td>
                        <Link
                          href={`/billing?invoice=${encodeURIComponent(inv.invoice_number)}`}
                          className="link link-primary font-medium"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td>
                        {inv.customers?.id ? (
                          <Link href={`/customers/${inv.customers.id}`} className="link link-primary">
                            {inv.customers.name}
                          </Link>
                        ) : (
                          (inv.customers?.name ?? "—")
                        )}
                      </td>
                      <td>{inv.due_date}</td>
                      <td>{formatMoney(inv.invoice_total)}</td>
                      <td>{formatMoney(inv.amount_paid)}</td>
                      <td className="font-medium">{formatMoney(inv.remaining_balance)}</td>
                      <td>
                        <StatusBadge
                          label={inv.agingLabel}
                          tone={
                            inv.aging === "d90"
                              ? "error"
                              : inv.aging === "d60"
                                ? "warning"
                                : inv.aging === "d30"
                                  ? "info"
                                  : "success"
                          }
                        />
                      </td>
                      <td>
                        <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-base-300 font-semibold">
                    <td colSpan={5}>Total open AR</td>
                    <td>{formatMoney(openAr)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </DualHorizontalScroll>
          )}
        </div>
      </div>
    </>
  );
}
