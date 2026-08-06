/**
 * Accounting batches — Open → Posted → Exported.
 * Stored in the browser (localStorage). Invoices/payments still load from Supabase.
 * No cloud batch tables required.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountingBatch,
  AccountingBatchStatus,
  Invoice,
  Payment,
} from "@/lib/types";
import {
  batchPrefix,
  batchTypeFromCounts,
  defaultBatchName,
  nextBatchNumberSync,
} from "@/lib/batches-shared";
import * as local from "@/lib/batches-local";

export { batchPrefix, batchTypeFromCounts, defaultBatchName, nextBatchNumberSync };

export const BATCH_STATUSES: AccountingBatchStatus[] = ["Open", "Posted", "Exported"];

export const BATCH_STATUS_HINT: Record<AccountingBatchStatus, string> = {
  Open: "Editable — add or remove transactions",
  Posted: "Locked — ready for export to accounting",
  Exported: "Handed off — journal entry exported",
};

export function isSchemaError(_message?: string | null): boolean {
  return false;
}

export function isUsingLocalBatchStore(): boolean {
  return true;
}

export async function detectBatchStorageMode(_supabase?: SupabaseClient): Promise<"local"> {
  return "local";
}

/** Finalized / collectible invoices only. */
export function isBatchableInvoiceStatus(status: string): boolean {
  const s = (status || "").toLowerCase().trim();
  if (!s) return false;
  const blocked = [
    "draft",
    "canceled",
    "cancelled",
    "void",
    "needs review",
    "reviewed",
    "on hold",
    "unsent",
    "disputed",
  ];
  if (blocked.some((x) => s === x || s.includes(x))) return false;
  return true;
}

export function isOpenArInvoice(inv: Pick<Invoice, "status" | "remaining_balance">): boolean {
  return isBatchableInvoiceStatus(inv.status) && Number(inv.remaining_balance) > 0.005;
}

export function isPaidInvoice(inv: Pick<Invoice, "status" | "remaining_balance">): boolean {
  if (!isBatchableInvoiceStatus(inv.status)) return false;
  return Number(inv.remaining_balance) <= 0.005 || (inv.status || "").toLowerCase().includes("paid");
}

export async function nextBatchNumber(
  _supabase: SupabaseClient,
  prefix: "INVB" | "PAYB" | "MIXB" = "INVB",
): Promise<string> {
  return nextBatchNumberSync(prefix);
}

export type BatchWithMeta = AccountingBatch & {
  creator?: { full_name: string | null } | null;
  poster?: { full_name: string | null } | null;
};

export type InvoiceForBatch = Invoice & {
  customers?: { name: string } | null;
  work_orders?: { work_order_number: string } | null;
};

export type PaymentForBatch = Payment & {
  customers?: { name: string } | null;
  invoices?: { invoice_number: string } | null;
};

async function selectInvoices(supabase: SupabaseClient, ids?: string[]) {
  const rich = "*, customers(name), work_orders(work_order_number)";
  const plain = "*";
  let q = supabase.from("invoices").select(rich).not("status", "eq", "Canceled");
  if (ids?.length) q = supabase.from("invoices").select(rich).in("id", ids);
  else q = q.order("invoice_date", { ascending: false });

  let { data, error } = await q;
  if (error && (error.message.includes("relationship") || error.message.includes("embed"))) {
    let q2 = supabase.from("invoices").select(plain).not("status", "eq", "Canceled");
    if (ids?.length) q2 = supabase.from("invoices").select(plain).in("id", ids);
    else q2 = q2.order("invoice_date", { ascending: false });
    ({ data, error } = await q2);
  }
  return { data: (data as InvoiceForBatch[] | null) ?? [], error };
}

async function selectPayments(supabase: SupabaseClient, ids?: string[]) {
  const rich = "*, customers(name), invoices(invoice_number)";
  const plain = "*";
  let q = supabase.from("payments").select(rich).order("payment_date", { ascending: false });
  if (ids?.length) q = supabase.from("payments").select(rich).in("id", ids);

  let { data, error } = await q;
  if (error && (error.message.includes("relationship") || error.message.includes("embed"))) {
    let q2 = supabase.from("payments").select(plain).order("payment_date", { ascending: false });
    if (ids?.length) q2 = supabase.from("payments").select(plain).in("id", ids);
    ({ data, error } = await q2);
  }
  return { data: (data as PaymentForBatch[] | null) ?? [], error };
}

export async function listBatches(
  _supabase: SupabaseClient,
  statusFilter?: AccountingBatchStatus | "all",
): Promise<{ data: BatchWithMeta[]; error: string | null }> {
  let data = local.localListBatches() as BatchWithMeta[];
  if (statusFilter && statusFilter !== "all") data = data.filter((b) => b.status === statusFilter);
  return { data, error: null };
}

export async function getBatch(
  _supabase: SupabaseClient,
  id: string,
): Promise<{ batch: AccountingBatch | null; error: string | null }> {
  return { batch: local.localGetBatch(id), error: null };
}

export async function batchedInvoiceIds(
  _supabase: SupabaseClient,
): Promise<{ ids: Set<string>; error: string | null }> {
  return { ids: local.localBatchedInvoiceIds(), error: null };
}

export async function batchedPaymentIds(
  _supabase: SupabaseClient,
): Promise<{ ids: Set<string>; error: string | null }> {
  return { ids: local.localBatchedPaymentIds(), error: null };
}

export async function loadUnbatchedInvoices(
  supabase: SupabaseClient,
): Promise<{ data: InvoiceForBatch[]; error: string | null }> {
  const { ids: inBatch } = await batchedInvoiceIds(supabase);
  const { data, error } = await selectInvoices(supabase);
  if (error) return { data: [], error: error.message };
  return {
    data: data.filter((i) => isBatchableInvoiceStatus(i.status) && !inBatch.has(i.id)),
    error: null,
  };
}

export async function loadUnbatchedPayments(
  supabase: SupabaseClient,
): Promise<{ data: PaymentForBatch[]; error: string | null }> {
  const { ids: inBatch } = await batchedPaymentIds(supabase);
  const { data, error } = await selectPayments(supabase);
  if (error) return { data: [], error: error.message };
  return { data: data.filter((p) => !inBatch.has(p.id)), error: null };
}

export async function loadBatchDetail(supabase: SupabaseClient, batchId: string) {
  const empty = {
    batch: null as AccountingBatch | null,
    invoices: [] as (InvoiceForBatch & { lineId: string; lineAmount: number })[],
    payments: [] as (PaymentForBatch & { lineId: string; lineAmount: number })[],
    error: null as string | null,
  };

  const batch = local.localGetBatch(batchId);
  if (!batch) return { ...empty, error: "Batch not found" };

  const invLines = local.localListInvoiceLines(batchId);
  const payLines = local.localListPaymentLines(batchId);
  const invIds = invLines.map((l) => l.invoice_id);
  const payIds = payLines.map((l) => l.payment_id);

  let invoices: (InvoiceForBatch & { lineId: string; lineAmount: number })[] = [];
  let payments: (PaymentForBatch & { lineId: string; lineAmount: number })[] = [];

  if (invIds.length) {
    const { data, error } = await selectInvoices(supabase, invIds);
    if (error) return { batch, invoices: [], payments: [], error: error.message };
    const map = new Map(data.map((i) => [i.id, i]));
    invoices = invLines
      .map((l) => {
        const inv = map.get(l.invoice_id);
        if (!inv) {
          return {
            id: l.invoice_id,
            invoice_number: "Invoice",
            invoice_date: "",
            status: "Sent",
            invoice_total: l.amount,
            remaining_balance: 0,
            amount_paid: 0,
            tax: 0,
            customers: null,
            work_orders: null,
            lineId: l.id,
            lineAmount: Number(l.amount),
          } as InvoiceForBatch & { lineId: string; lineAmount: number };
        }
        return { ...inv, lineId: l.id, lineAmount: Number(l.amount) };
      })
      .filter(Boolean) as (InvoiceForBatch & { lineId: string; lineAmount: number })[];
  }

  if (payIds.length) {
    const { data, error } = await selectPayments(supabase, payIds);
    if (error) return { batch, invoices, payments: [], error: error.message };
    const map = new Map(data.map((p) => [p.id, p]));
    payments = payLines
      .map((l) => {
        const p = map.get(l.payment_id);
        if (!p) {
          return {
            id: l.payment_id,
            payment_number: "Payment",
            payment_date: "",
            payment_method: "",
            payment_amount: l.amount,
            customers: null,
            invoices: null,
            lineId: l.id,
            lineAmount: Number(l.amount),
          } as PaymentForBatch & { lineId: string; lineAmount: number };
        }
        return { ...p, lineId: l.id, lineAmount: Number(l.amount) };
      })
      .filter(Boolean) as (PaymentForBatch & { lineId: string; lineAmount: number })[];
  }

  return { batch, invoices, payments, error: null as string | null };
}

export type CreateBatchInput = {
  batchDate: string;
  name?: string;
  notes?: string;
  paymentMethod?: string | null;
  invoiceIds: string[];
  paymentIds: string[];
  userId: string | null;
};

export async function createBatch(supabase: SupabaseClient, input: CreateBatchInput) {
  const invIds = [...new Set(input.invoiceIds.filter(Boolean))];
  const payIds = [...new Set(input.paymentIds.filter(Boolean))];
  if (invIds.length === 0 && payIds.length === 0) {
    return { batch: null, error: "Select at least one invoice or payment." };
  }

  const usedInv = local.localBatchedInvoiceIds();
  const usedPay = local.localBatchedPaymentIds();
  if (invIds.some((id) => usedInv.has(id))) {
    return { batch: null, error: "One or more invoices are already in a batch." };
  }
  if (payIds.some((id) => usedPay.has(id))) {
    return { batch: null, error: "One or more payments are already in a batch." };
  }

  let invoiceRows: { id: string; invoice_total: number }[] = [];
  let paymentRows: { id: string; payment_amount: number; payment_method: string | null }[] = [];

  if (invIds.length) {
    const { data, error } = await supabase.from("invoices").select("id, invoice_total, status").in("id", invIds);
    if (error) return { batch: null, error: error.message };
    const loaded = data ?? [];
    if (loaded.filter((r: { status: string }) => !isBatchableInvoiceStatus(r.status)).length) {
      return { batch: null, error: "Some invoices cannot be batched (draft / hold / canceled)." };
    }
    invoiceRows = loaded.map((r: { id: string; invoice_total: number }) => ({
      id: r.id,
      invoice_total: Number(r.invoice_total),
    }));
    if (invoiceRows.length !== invIds.length) {
      return { batch: null, error: "Some invoices could not be loaded." };
    }
  }

  if (payIds.length) {
    const { data, error } = await supabase
      .from("payments")
      .select("id, payment_amount, payment_method")
      .in("id", payIds);
    if (error) return { batch: null, error: error.message };
    paymentRows = (data ?? []).map((r: { id: string; payment_amount: number; payment_method: string }) => ({
      id: r.id,
      payment_amount: Number(r.payment_amount),
      payment_method: r.payment_method,
    }));
    if (paymentRows.length !== payIds.length) {
      return { batch: null, error: "Some payments could not be loaded." };
    }
  }

  return local.localCreateBatch({
    batchDate: input.batchDate,
    name: input.name,
    notes: input.notes,
    paymentMethod: input.paymentMethod,
    invoiceRows,
    paymentRows,
    userId: input.userId,
  });
}

export async function addInvoicesToBatch(supabase: SupabaseClient, batchId: string, invoiceIds: string[]) {
  const batch = local.localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };

  const used = local.localBatchedInvoiceIds();
  const fresh = invoiceIds.filter((id) => !used.has(id));
  if (!fresh.length) return { error: "All selected invoices are already batched." };

  const { data, error: loadError } = await supabase
    .from("invoices")
    .select("id, invoice_total, status")
    .in("id", fresh);
  if (loadError) return { error: loadError.message };
  const usable = (data ?? []).filter((r: { status: string }) => isBatchableInvoiceStatus(r.status));
  if (!usable.length) return { error: "Selected invoices are not ready to batch." };

  return local.localAddInvoices(
    batchId,
    usable.map((r: { id: string; invoice_total: number }) => ({
      id: r.id,
      invoice_total: Number(r.invoice_total),
    })),
  );
}

export async function addPaymentsToBatch(supabase: SupabaseClient, batchId: string, paymentIds: string[]) {
  const batch = local.localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };

  const used = local.localBatchedPaymentIds();
  const fresh = paymentIds.filter((id) => !used.has(id));
  if (!fresh.length) return { error: "All selected payments are already batched." };

  const { data, error: loadError } = await supabase.from("payments").select("id, payment_amount").in("id", fresh);
  if (loadError) return { error: loadError.message };
  if (!data?.length) return { error: "Payments could not be loaded." };

  return local.localAddPayments(
    batchId,
    data.map((r: { id: string; payment_amount: number }) => ({
      id: r.id,
      payment_amount: Number(r.payment_amount),
    })),
  );
}

export async function removeInvoiceLine(_supabase: SupabaseClient, batchId: string, lineId: string) {
  return local.localRemoveInvoiceLine(batchId, lineId);
}

export async function removePaymentLine(_supabase: SupabaseClient, batchId: string, lineId: string) {
  return local.localRemovePaymentLine(batchId, lineId);
}

export async function postBatch(_supabase: SupabaseClient, batchId: string, userId: string | null) {
  const batch = local.localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be posted." };
  if (batch.invoice_count + batch.payment_count === 0) {
    return { error: "Add at least one transaction before posting." };
  }

  const detail = await loadBatchDetail(_supabase, batchId);
  if (detail.error) return { error: detail.error };

  const { postBatchJournal } = await import("@/lib/accounting/postings");
  const je = postBatchJournal({
    batch,
    invoices: detail.invoices,
    payments: detail.payments,
    userId,
  });
  if (!je.ok) {
    if (!je.error.includes("Already posted")) {
      return { error: `Journal failed: ${je.error}` };
    }
  }

  return local.localSetStatus(batchId, "Posted", {
    posted_by: userId,
    posted_at: new Date().toISOString(),
  });
}

export async function unpostBatch(_supabase: SupabaseClient, batchId: string) {
  const batch = local.localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status === "Exported") return { error: "Exported batches cannot be unposted." };
  if (batch.status !== "Posted") return { error: "Only posted batches can be unposted." };
  return local.localSetStatus(batchId, "Open", { posted_by: null, posted_at: null });
}

export async function exportBatch(_supabase: SupabaseClient, batchId: string, userId: string | null) {
  const batch = local.localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status === "Open") return { error: "Post the batch before exporting." };
  if (batch.status === "Exported") return { error: null };
  return local.localSetStatus(batchId, "Exported", {
    exported_by: userId,
    exported_at: new Date().toISOString(),
  });
}

export async function unexportBatch(_supabase: SupabaseClient, batchId: string) {
  const batch = local.localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status !== "Exported") return { error: "Only exported batches can be returned to Posted." };
  return local.localSetStatus(batchId, "Posted", { exported_by: null, exported_at: null });
}

export async function deleteEmptyOpenBatch(_supabase: SupabaseClient, batchId: string) {
  return local.localDeleteEmptyOpenBatch(batchId);
}

export async function postBatches(
  supabase: SupabaseClient,
  batchIds: string[],
  userId: string | null,
): Promise<{ posted: number; errors: string[] }> {
  let posted = 0;
  const errors: string[] = [];
  for (const id of batchIds) {
    const r = await postBatch(supabase, id, userId);
    if (r.error) errors.push(r.error);
    else posted += 1;
  }
  return { posted, errors };
}

export type BatchLookup = {
  batchId: string;
  batchNumber: string;
  status: AccountingBatchStatus;
};

export async function loadInvoiceBatchMap(
  _supabase: SupabaseClient,
): Promise<{ map: Map<string, BatchLookup>; error: string | null }> {
  return { map: local.localInvoiceBatchMap(), error: null };
}

export async function loadPaymentBatchMap(
  _supabase: SupabaseClient,
): Promise<{ map: Map<string, BatchLookup>; error: string | null }> {
  return { map: local.localPaymentBatchMap(), error: null };
}

export function exportBatchCsv(
  batch: AccountingBatch,
  invoices: (InvoiceForBatch & { lineAmount: number })[],
  payments: (PaymentForBatch & { lineAmount: number })[],
) {
  downloadCsv(
    `${batch.batch_number}_transactions.csv`,
    ["Type", "Number", "Date", "Customer", "Reference", "Method", "Debit", "Credit", "Amount", "Batch", "Batch date", "Status"],
    [
      ...invoices.map((inv) => [
        "Invoice",
        inv.invoice_number,
        inv.invoice_date,
        inv.customers?.name ?? "",
        inv.work_orders?.work_order_number ?? "",
        "",
        inv.lineAmount,
        "",
        inv.lineAmount,
        batch.batch_number,
        batch.batch_date,
        inv.status,
      ]),
      ...payments.map((p) => [
        "Payment",
        p.payment_number,
        p.payment_date,
        p.customers?.name ?? "",
        p.invoices?.invoice_number ?? p.reference_number ?? "",
        p.payment_method,
        "",
        p.lineAmount,
        p.lineAmount,
        batch.batch_number,
        batch.batch_date,
        p.payment_method,
      ]),
    ],
  );
}

export function exportBatchJournalCsv(
  batch: AccountingBatch,
  invoices: (InvoiceForBatch & { lineAmount: number })[],
  payments: (PaymentForBatch & { lineAmount: number })[],
) {
  const invTotal = invoices.reduce((s, i) => s + Number(i.lineAmount), 0);
  const payTotal = payments.reduce((s, p) => s + Number(p.lineAmount), 0);
  const taxTotal = invoices.reduce((s, i) => s + Number(i.tax ?? 0), 0);
  const serviceRev = invTotal - taxTotal;
  const rows: (string | number)[][] = [
    ["Journal", "Account", "Memo", "Debit", "Credit", "Batch", "Date"],
    ["AR", "Accounts Receivable", `Invoices ${batch.batch_number}`, invTotal, 0, batch.batch_number, batch.batch_date],
    [
      "REV",
      "Service Revenue",
      `Recognized sales ${batch.batch_number}`,
      0,
      Math.max(0, serviceRev),
      batch.batch_number,
      batch.batch_date,
    ],
  ];
  if (taxTotal > 0.005) {
    rows.push(["TAX", "Sales Tax Payable", `Tax on ${batch.batch_number}`, 0, taxTotal, batch.batch_number, batch.batch_date]);
  }
  if (payTotal > 0.005) {
    rows.push([
      "CASH",
      "Undeposited Funds / Cash",
      `Collections ${batch.batch_number}`,
      payTotal,
      0,
      batch.batch_number,
      batch.batch_date,
    ]);
    rows.push([
      "AR",
      "Accounts Receivable",
      `Apply payments ${batch.batch_number}`,
      0,
      payTotal,
      batch.batch_number,
      batch.batch_date,
    ]);
  }
  downloadCsv(`${batch.batch_number}_journal.csv`, rows[0] as string[], rows.slice(1));
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function groupPaymentsByMethod(payments: PaymentForBatch[]) {
  const map = new Map<string, PaymentForBatch[]>();
  for (const p of payments) {
    const m = (p.payment_method || "Other").trim() || "Other";
    const list = map.get(m) ?? [];
    list.push(p);
    map.set(m, list);
  }
  return Array.from(map.entries())
    .map(([method, rows]) => ({
      method,
      rows,
      total: rows.reduce((s, r) => s + Number(r.payment_amount), 0),
      count: rows.length,
    }))
    .sort((a, b) => b.total - a.total);
}

export function paymentOnOrBefore(paymentDate: string | null | undefined, asOf: string): boolean {
  if (!paymentDate) return true;
  return paymentDate.slice(0, 10) <= asOf;
}

export function invoiceOnOrBefore(invoiceDate: string | null | undefined, asOf: string): boolean {
  if (!invoiceDate) return false;
  return invoiceDate.slice(0, 10) <= asOf;
}

export type UnbatchedInvoiceBucket = "all" | "open_ar" | "paid";

export function filterUnbatchedInvoices(
  invoices: InvoiceForBatch[],
  bucket: UnbatchedInvoiceBucket,
): InvoiceForBatch[] {
  if (bucket === "open_ar") return invoices.filter(isOpenArInvoice);
  if (bucket === "paid") return invoices.filter(isPaidInvoice);
  return invoices;
}
