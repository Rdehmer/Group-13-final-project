/**
 * Browser local store for accounting batches when Supabase tables
 * are not installed yet. Data is per-origin; replace by running
 * supabase/migrations/20260805_accounting_batches.sql.
 */

import type {
  AccountingBatch,
  AccountingBatchStatus,
  AccountingBatchType,
} from "@/lib/types";
import {
  batchPrefix,
  batchTypeFromCounts,
  defaultBatchName,
  nextBatchNumberSync,
} from "@/lib/batches-shared";

const KEY_BATCHES = "ridley_accounting_batches_v1";
const KEY_INV = "ridley_accounting_batch_invoices_v1";
const KEY_PAY = "ridley_accounting_batch_payments_v1";

export type LocalBatchInvoiceLine = {
  id: string;
  batch_id: string;
  invoice_id: string;
  amount: number;
  added_at: string;
};

export type LocalBatchPaymentLine = {
  id: string;
  batch_id: string;
  payment_id: string;
  amount: number;
  added_at: string;
};

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function localListBatches(): AccountingBatch[] {
  return readJson<AccountingBatch[]>(KEY_BATCHES, []).sort((a, b) => {
    const d = (b.batch_date || "").localeCompare(a.batch_date || "");
    if (d !== 0) return d;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

export function localGetBatch(id: string): AccountingBatch | null {
  return localListBatches().find((b) => b.id === id) ?? null;
}

function saveBatches(rows: AccountingBatch[]) {
  writeJson(KEY_BATCHES, rows);
}

function invLines(): LocalBatchInvoiceLine[] {
  return readJson(KEY_INV, []);
}

function payLines(): LocalBatchPaymentLine[] {
  return readJson(KEY_PAY, []);
}

function saveInvLines(rows: LocalBatchInvoiceLine[]) {
  writeJson(KEY_INV, rows);
}

function savePayLines(rows: LocalBatchPaymentLine[]) {
  writeJson(KEY_PAY, rows);
}

export function localBatchedInvoiceIds(): Set<string> {
  return new Set(invLines().map((l) => l.invoice_id));
}

export function localBatchedPaymentIds(): Set<string> {
  return new Set(payLines().map((l) => l.payment_id));
}

export function localListInvoiceLines(batchId: string): LocalBatchInvoiceLine[] {
  return invLines().filter((l) => l.batch_id === batchId);
}

export function localListPaymentLines(batchId: string): LocalBatchPaymentLine[] {
  return payLines().filter((l) => l.batch_id === batchId);
}

function recount(batchId: string): AccountingBatch | null {
  const batches = localListBatches();
  const idx = batches.findIndex((b) => b.id === batchId);
  if (idx < 0) return null;
  const invs = localListInvoiceLines(batchId);
  const pays = localListPaymentLines(batchId);
  const invoice_count = invs.length;
  const payment_count = pays.length;
  const invoice_total = invs.reduce((s, r) => s + Number(r.amount), 0);
  const payment_total = pays.reduce((s, r) => s + Number(r.amount), 0);
  const batch_type = batchTypeFromCounts(invoice_count, payment_count);
  const next: AccountingBatch = {
    ...batches[idx],
    invoice_count,
    payment_count,
    invoice_total,
    payment_total,
    batch_type,
    updated_at: new Date().toISOString(),
  };
  batches[idx] = next;
  saveBatches(batches);
  return next;
}

export function localCreateBatch(input: {
  batchDate: string;
  name?: string;
  notes?: string;
  paymentMethod?: string | null;
  invoiceRows: { id: string; invoice_total: number }[];
  paymentRows: { id: string; payment_amount: number; payment_method: string | null }[];
  userId: string | null;
}): { batch: AccountingBatch | null; error: string | null } {
  const invIds = input.invoiceRows.map((r) => r.id);
  const payIds = input.paymentRows.map((r) => r.id);
  const usedInv = localBatchedInvoiceIds();
  const usedPay = localBatchedPaymentIds();
  if (invIds.some((id) => usedInv.has(id))) {
    return { batch: null, error: "One or more invoices are already in a batch." };
  }
  if (payIds.some((id) => usedPay.has(id))) {
    return { batch: null, error: "One or more payments are already in a batch." };
  }
  if (!invIds.length && !payIds.length) {
    return { batch: null, error: "Select at least one invoice or payment." };
  }

  const type = batchTypeFromCounts(invIds.length, payIds.length);
  const method =
    input.paymentMethod ||
    (type === "payment" && input.paymentRows.length
      ? input.paymentRows.every((p) => p.payment_method === input.paymentRows[0].payment_method)
        ? input.paymentRows[0].payment_method
        : "Mixed"
      : null);

  const now = new Date().toISOString();
  const batch: AccountingBatch = {
    id: uid(),
    batch_number: nextBatchNumberSync(batchPrefix(type)),
    batch_type: type,
    name: input.name?.trim() || defaultBatchName({ type, date: input.batchDate, paymentMethod: method }),
    status: "Open",
    batch_date: input.batchDate,
    payment_method: method,
    notes: input.notes?.trim() || null,
    invoice_total: input.invoiceRows.reduce((s, r) => s + r.invoice_total, 0),
    payment_total: input.paymentRows.reduce((s, r) => s + r.payment_amount, 0),
    invoice_count: invIds.length,
    payment_count: payIds.length,
    created_by: input.userId,
    posted_by: null,
    posted_at: null,
    exported_by: null,
    exported_at: null,
    created_at: now,
    updated_at: now,
  };

  saveBatches([batch, ...localListBatches()]);
  if (input.invoiceRows.length) {
    saveInvLines([
      ...invLines(),
      ...input.invoiceRows.map((r) => ({
        id: uid(),
        batch_id: batch.id,
        invoice_id: r.id,
        amount: r.invoice_total,
        added_at: now,
      })),
    ]);
  }
  if (input.paymentRows.length) {
    savePayLines([
      ...payLines(),
      ...input.paymentRows.map((r) => ({
        id: uid(),
        batch_id: batch.id,
        payment_id: r.id,
        amount: r.payment_amount,
        added_at: now,
      })),
    ]);
  }
  return { batch, error: null };
}

export function localAddInvoices(batchId: string, rows: { id: string; invoice_total: number }[]) {
  const batch = localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };
  const used = localBatchedInvoiceIds();
  const fresh = rows.filter((r) => !used.has(r.id));
  if (!fresh.length) return { error: "All selected invoices are already batched." };
  const now = new Date().toISOString();
  saveInvLines([
    ...invLines(),
    ...fresh.map((r) => ({
      id: uid(),
      batch_id: batchId,
      invoice_id: r.id,
      amount: Number(r.invoice_total),
      added_at: now,
    })),
  ]);
  recount(batchId);
  return { error: null };
}

export function localAddPayments(batchId: string, rows: { id: string; payment_amount: number }[]) {
  const batch = localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };
  const used = localBatchedPaymentIds();
  const fresh = rows.filter((r) => !used.has(r.id));
  if (!fresh.length) return { error: "All selected payments are already batched." };
  const now = new Date().toISOString();
  savePayLines([
    ...payLines(),
    ...fresh.map((r) => ({
      id: uid(),
      batch_id: batchId,
      payment_id: r.id,
      amount: Number(r.payment_amount),
      added_at: now,
    })),
  ]);
  recount(batchId);
  return { error: null };
}

export function localRemoveInvoiceLine(batchId: string, lineId: string) {
  const batch = localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };
  saveInvLines(invLines().filter((l) => !(l.id === lineId && l.batch_id === batchId)));
  recount(batchId);
  return { error: null };
}

export function localRemovePaymentLine(batchId: string, lineId: string) {
  const batch = localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };
  savePayLines(payLines().filter((l) => !(l.id === lineId && l.batch_id === batchId)));
  recount(batchId);
  return { error: null };
}

export function localSetStatus(
  batchId: string,
  status: AccountingBatchStatus,
  fields: Partial<AccountingBatch>,
) {
  const batches = localListBatches();
  const idx = batches.findIndex((b) => b.id === batchId);
  if (idx < 0) return { error: "Batch not found" };
  batches[idx] = {
    ...batches[idx],
    ...fields,
    status,
    updated_at: new Date().toISOString(),
  };
  saveBatches(batches);
  return { error: null };
}

export function localDeleteEmptyOpenBatch(batchId: string) {
  const batch = localGetBatch(batchId);
  if (!batch) return { error: "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be deleted." };
  if (batch.invoice_count + batch.payment_count > 0) {
    return { error: "Remove all transactions before deleting the batch." };
  }
  saveBatches(localListBatches().filter((b) => b.id !== batchId));
  return { error: null };
}

export function localInvoiceBatchMap(): Map<
  string,
  { batchId: string; batchNumber: string; status: AccountingBatchStatus }
> {
  const map = new Map<string, { batchId: string; batchNumber: string; status: AccountingBatchStatus }>();
  const byId = new Map(localListBatches().map((b) => [b.id, b]));
  for (const l of invLines()) {
    const b = byId.get(l.batch_id);
    if (!b) continue;
    map.set(l.invoice_id, { batchId: b.id, batchNumber: b.batch_number, status: b.status });
  }
  return map;
}

export function localPaymentBatchMap(): Map<
  string,
  { batchId: string; batchNumber: string; status: AccountingBatchStatus }
> {
  const map = new Map<string, { batchId: string; batchNumber: string; status: AccountingBatchStatus }>();
  const byId = new Map(localListBatches().map((b) => [b.id, b]));
  for (const l of payLines()) {
    const b = byId.get(l.batch_id);
    if (!b) continue;
    map.set(l.payment_id, { batchId: b.id, batchNumber: b.batch_number, status: b.status });
  }
  return map;
}
