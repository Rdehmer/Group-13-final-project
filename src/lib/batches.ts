/**
 * ServiceTitan-style accounting batch helpers.
 *
 * Lifecycle: Open (add/remove) → Posted (locked for review integrity) → Exported (GL handoff).
 * Invoices and payments may each appear in at most one batch.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountingBatch,
  AccountingBatchStatus,
  AccountingBatchType,
  Invoice,
  Payment,
} from "@/lib/types";

export const BATCH_STATUSES: AccountingBatchStatus[] = ["Open", "Posted", "Exported"];

export const BATCH_STATUS_HINT: Record<AccountingBatchStatus, string> = {
  Open: "Editable — add or remove transactions",
  Posted: "Locked — ready for export to accounting",
  Exported: "Handed off — journal entry exported",
};

/** Invoices eligible to enter an accounting batch (customer-facing / finalized). */
export function isBatchableInvoiceStatus(status: string): boolean {
  const s = (status || "").toLowerCase().trim();
  if (!s) return false;
  const blocked = ["draft", "canceled", "cancelled", "void", "needs review", "on hold", "unsent"];
  if (blocked.some((x) => s === x || s.includes(x))) return false;
  return true;
}

export function nextBatchNumber(prefix: "INVB" | "PAYB" | "MIXB" = "INVB"): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${t.slice(-5)}${r}`;
}

export function batchTypeFromCounts(invoiceCount: number, paymentCount: number): AccountingBatchType {
  if (invoiceCount > 0 && paymentCount > 0) return "mixed";
  if (paymentCount > 0) return "payment";
  return "invoice";
}

export function batchPrefix(type: AccountingBatchType): "INVB" | "PAYB" | "MIXB" {
  if (type === "payment") return "PAYB";
  if (type === "mixed") return "MIXB";
  return "INVB";
}

export function defaultBatchName(opts: {
  type: AccountingBatchType;
  date: string;
  paymentMethod?: string | null;
}): string {
  const d = opts.date;
  if (opts.type === "payment") {
    return opts.paymentMethod ? `${opts.paymentMethod} payments · ${d}` : `Payment deposit · ${d}`;
  }
  if (opts.type === "mixed") return `Mixed close · ${d}`;
  return `Invoice batch · ${d}`;
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

/** Detect missing tables / RLS for friendly setup UI. */
export function isSchemaError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table") ||
    m.includes("could not find the relationship") ||
    m.includes("accounting_batches") && m.includes("not find") ||
    (m.includes("relation") && m.includes("does not exist")) ||
    m.includes("pgrst205") ||
    m.includes("42p01")
  );
}

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
  supabase: SupabaseClient,
  statusFilter?: AccountingBatchStatus | "all",
): Promise<{ data: BatchWithMeta[]; error: string | null }> {
  let q = supabase
    .from("accounting_batches")
    .select("*")
    .order("batch_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (statusFilter && statusFilter !== "all") {
    q = q.eq("status", statusFilter);
  }
  const { data, error } = await q;
  if (error) {
    return { data: [], error: error.message };
  }
  return { data: (data as BatchWithMeta[]) ?? [], error: null };
}

export async function getBatch(
  supabase: SupabaseClient,
  id: string,
): Promise<{ batch: AccountingBatch | null; error: string | null }> {
  const { data, error } = await supabase.from("accounting_batches").select("*").eq("id", id).maybeSingle();
  if (error) return { batch: null, error: error.message };
  return { batch: (data as AccountingBatch) ?? null, error: null };
}

/** Invoice IDs already sitting in any batch. */
export async function batchedInvoiceIds(supabase: SupabaseClient): Promise<{ ids: Set<string>; error: string | null }> {
  const { data, error } = await supabase.from("accounting_batch_invoices").select("invoice_id");
  if (error) return { ids: new Set(), error: error.message };
  return { ids: new Set((data ?? []).map((r: { invoice_id: string }) => r.invoice_id)), error: null };
}

export async function batchedPaymentIds(supabase: SupabaseClient): Promise<{ ids: Set<string>; error: string | null }> {
  const { data, error } = await supabase.from("accounting_batch_payments").select("payment_id");
  if (error) return { ids: new Set(), error: error.message };
  return { ids: new Set((data ?? []).map((r: { payment_id: string }) => r.payment_id)), error: null };
}

export async function loadUnbatchedInvoices(
  supabase: SupabaseClient,
): Promise<{ data: InvoiceForBatch[]; error: string | null }> {
  const { ids: inBatch, error: batchErr } = await batchedInvoiceIds(supabase);
  if (batchErr) return { data: [], error: batchErr };

  const { data, error } = await selectInvoices(supabase);
  if (error) return { data: [], error: error.message };

  const rows = data.filter((i) => isBatchableInvoiceStatus(i.status) && !inBatch.has(i.id));
  return { data: rows, error: null };
}

export async function loadUnbatchedPayments(
  supabase: SupabaseClient,
): Promise<{ data: PaymentForBatch[]; error: string | null }> {
  const { ids: inBatch, error: batchErr } = await batchedPaymentIds(supabase);
  if (batchErr) return { data: [], error: batchErr };

  const { data, error } = await selectPayments(supabase);
  if (error) return { data: [], error: error.message };

  const rows = data.filter((p) => !inBatch.has(p.id));
  return { data: rows, error: null };
}

export async function loadBatchDetail(supabase: SupabaseClient, batchId: string) {
  const empty = {
    batch: null as AccountingBatch | null,
    invoices: [] as (InvoiceForBatch & { lineId: string; lineAmount: number })[],
    payments: [] as (PaymentForBatch & { lineId: string; lineAmount: number })[],
    error: null as string | null,
  };

  const { batch, error: batchError } = await getBatch(supabase, batchId);
  if (batchError || !batch) {
    return { ...empty, error: batchError ?? "Batch not found" };
  }

  const [{ data: invLines, error: invLineErr }, { data: payLines, error: payLineErr }] = await Promise.all([
    supabase.from("accounting_batch_invoices").select("id, invoice_id, amount").eq("batch_id", batchId),
    supabase.from("accounting_batch_payments").select("id, payment_id, amount").eq("batch_id", batchId),
  ]);

  if (invLineErr) return { ...empty, batch, error: invLineErr.message };
  if (payLineErr) return { ...empty, batch, error: payLineErr.message };

  const invIds = (invLines ?? []).map((l: { invoice_id: string }) => l.invoice_id);
  const payIds = (payLines ?? []).map((l: { payment_id: string }) => l.payment_id);

  let invoices: (InvoiceForBatch & { lineId: string; lineAmount: number })[] = [];
  let payments: (PaymentForBatch & { lineId: string; lineAmount: number })[] = [];

  if (invIds.length) {
    const { data, error } = await selectInvoices(supabase, invIds);
    if (error) return { batch, invoices: [], payments: [], error: error.message };
    const map = new Map(data.map((i) => [i.id, i]));
    invoices = (invLines ?? [])
      .map((l: { id: string; invoice_id: string; amount: number }) => {
        const inv = map.get(l.invoice_id);
        if (!inv) return null;
        return { ...inv, lineId: l.id, lineAmount: Number(l.amount) };
      })
      .filter(Boolean) as (InvoiceForBatch & { lineId: string; lineAmount: number })[];
  }

  if (payIds.length) {
    const { data, error } = await selectPayments(supabase, payIds);
    if (error) return { batch, invoices, payments: [], error: error.message };
    const map = new Map(data.map((p) => [p.id, p]));
    payments = (payLines ?? [])
      .map((l: { id: string; payment_id: string; amount: number }) => {
        const p = map.get(l.payment_id);
        if (!p) return null;
        return { ...p, lineId: l.id, lineAmount: Number(l.amount) };
      })
      .filter(Boolean) as (PaymentForBatch & { lineId: string; lineAmount: number })[];
  }

  // Keep header totals in sync with actual lines (self-heal stale counts)
  const liveInvTotal = invoices.reduce((s, i) => s + Number(i.lineAmount), 0);
  const livePayTotal = payments.reduce((s, p) => s + Number(p.lineAmount), 0);
  if (
    invoices.length !== batch.invoice_count ||
    payments.length !== batch.payment_count ||
    Math.abs(liveInvTotal - Number(batch.invoice_total)) > 0.02 ||
    Math.abs(livePayTotal - Number(batch.payment_total)) > 0.02
  ) {
    await recountBatch(supabase, batchId);
    const refreshed = await getBatch(supabase, batchId);
    return {
      batch: refreshed.batch ?? batch,
      invoices,
      payments,
      error: null as string | null,
    };
  }

  return { batch, invoices, payments, error: null as string | null };
}

async function recountBatch(supabase: SupabaseClient, batchId: string) {
  const [{ data: invs }, { data: pays }] = await Promise.all([
    supabase.from("accounting_batch_invoices").select("amount").eq("batch_id", batchId),
    supabase.from("accounting_batch_payments").select("amount").eq("batch_id", batchId),
  ]);
  const invoice_count = invs?.length ?? 0;
  const payment_count = pays?.length ?? 0;
  const invoice_total = (invs ?? []).reduce((s, r: { amount: number }) => s + Number(r.amount), 0);
  const payment_total = (pays ?? []).reduce((s, r: { amount: number }) => s + Number(r.amount), 0);
  const batch_type = batchTypeFromCounts(invoice_count, payment_count);
  await supabase
    .from("accounting_batches")
    .update({
      invoice_count,
      payment_count,
      invoice_total,
      payment_total,
      batch_type,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);
  return { invoice_count, payment_count, invoice_total, payment_total, batch_type };
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

  const [biRes, bpRes] = await Promise.all([batchedInvoiceIds(supabase), batchedPaymentIds(supabase)]);
  if (biRes.error) return { batch: null, error: biRes.error };
  if (bpRes.error) return { batch: null, error: bpRes.error };
  if (invIds.some((id) => biRes.ids.has(id))) {
    return { batch: null, error: "One or more invoices are already in a batch." };
  }
  if (payIds.some((id) => bpRes.ids.has(id))) {
    return { batch: null, error: "One or more payments are already in a batch." };
  }

  let invoiceRows: { id: string; invoice_total: number }[] = [];
  let paymentRows: { id: string; payment_amount: number; payment_method: string | null }[] = [];

  if (invIds.length) {
    const { data, error } = await supabase.from("invoices").select("id, invoice_total, status").in("id", invIds);
    if (error) return { batch: null, error: error.message };
    const loaded = data ?? [];
    const notBatchable = loaded.filter((r: { status: string }) => !isBatchableInvoiceStatus(r.status));
    if (notBatchable.length) {
      return { batch: null, error: "Some invoices are still Draft / On Hold and cannot be batched." };
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

  const type = batchTypeFromCounts(invoiceRows.length, paymentRows.length);
  const method =
    input.paymentMethod ||
    (type === "payment" && paymentRows.length
      ? paymentRows.every((p) => p.payment_method === paymentRows[0].payment_method)
        ? paymentRows[0].payment_method
        : "Mixed"
      : null);

  const batch_number = nextBatchNumber(batchPrefix(type));
  const name =
    input.name?.trim() ||
    defaultBatchName({ type, date: input.batchDate, paymentMethod: method });

  const invoice_total = invoiceRows.reduce((s, r) => s + r.invoice_total, 0);
  const payment_total = paymentRows.reduce((s, r) => s + r.payment_amount, 0);

  const { data: batch, error: createError } = await supabase
    .from("accounting_batches")
    .insert({
      batch_number,
      batch_type: type,
      name,
      status: "Open",
      batch_date: input.batchDate,
      payment_method: method,
      notes: input.notes?.trim() || null,
      invoice_total,
      payment_total,
      invoice_count: invoiceRows.length,
      payment_count: paymentRows.length,
      created_by: input.userId,
    })
    .select("*")
    .single();

  if (createError || !batch) {
    return { batch: null, error: createError?.message ?? "Could not create batch" };
  }

  if (invoiceRows.length) {
    const { error } = await supabase.from("accounting_batch_invoices").insert(
      invoiceRows.map((r) => ({
        batch_id: batch.id,
        invoice_id: r.id,
        amount: r.invoice_total,
      })),
    );
    if (error) {
      await supabase.from("accounting_batches").delete().eq("id", batch.id);
      return { batch: null, error: error.message };
    }
  }

  if (paymentRows.length) {
    const { error } = await supabase.from("accounting_batch_payments").insert(
      paymentRows.map((r) => ({
        batch_id: batch.id,
        payment_id: r.id,
        amount: r.payment_amount,
      })),
    );
    if (error) {
      // Cascade removes invoice lines with the header
      await supabase.from("accounting_batches").delete().eq("id", batch.id);
      return { batch: null, error: error.message };
    }
  }

  return { batch: batch as AccountingBatch, error: null };
}

export async function addInvoicesToBatch(
  supabase: SupabaseClient,
  batchId: string,
  invoiceIds: string[],
) {
  const { batch, error } = await getBatch(supabase, batchId);
  if (error || !batch) return { error: error ?? "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };

  const { ids: bi, error: biErr } = await batchedInvoiceIds(supabase);
  if (biErr) return { error: biErr };
  const fresh = invoiceIds.filter((id) => !bi.has(id));
  if (!fresh.length) return { error: "All selected invoices are already batched." };

  const { data, error: loadError } = await supabase
    .from("invoices")
    .select("id, invoice_total, status")
    .in("id", fresh);
  if (loadError) return { error: loadError.message };
  const usable = (data ?? []).filter((r: { status: string }) => isBatchableInvoiceStatus(r.status));
  if (!usable.length) return { error: "Selected invoices are not ready to batch." };

  const { error: insError } = await supabase.from("accounting_batch_invoices").insert(
    usable.map((r: { id: string; invoice_total: number }) => ({
      batch_id: batchId,
      invoice_id: r.id,
      amount: Number(r.invoice_total),
    })),
  );
  if (insError) return { error: insError.message };
  await recountBatch(supabase, batchId);
  return { error: null };
}

export async function addPaymentsToBatch(
  supabase: SupabaseClient,
  batchId: string,
  paymentIds: string[],
) {
  const { batch, error } = await getBatch(supabase, batchId);
  if (error || !batch) return { error: error ?? "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };

  const { ids: bp, error: bpErr } = await batchedPaymentIds(supabase);
  if (bpErr) return { error: bpErr };
  const fresh = paymentIds.filter((id) => !bp.has(id));
  if (!fresh.length) return { error: "All selected payments are already batched." };

  const { data, error: loadError } = await supabase
    .from("payments")
    .select("id, payment_amount")
    .in("id", fresh);
  if (loadError) return { error: loadError.message };
  if (!data?.length) return { error: "Payments could not be loaded." };

  const { error: insError } = await supabase.from("accounting_batch_payments").insert(
    data.map((r: { id: string; payment_amount: number }) => ({
      batch_id: batchId,
      payment_id: r.id,
      amount: Number(r.payment_amount),
    })),
  );
  if (insError) return { error: insError.message };
  await recountBatch(supabase, batchId);
  return { error: null };
}

export async function removeInvoiceLine(supabase: SupabaseClient, batchId: string, lineId: string) {
  const { batch, error } = await getBatch(supabase, batchId);
  if (error || !batch) return { error: error ?? "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };
  const { error: delError } = await supabase
    .from("accounting_batch_invoices")
    .delete()
    .eq("id", lineId)
    .eq("batch_id", batchId);
  if (delError) return { error: delError.message };
  await recountBatch(supabase, batchId);
  return { error: null };
}

export async function removePaymentLine(supabase: SupabaseClient, batchId: string, lineId: string) {
  const { batch, error } = await getBatch(supabase, batchId);
  if (error || !batch) return { error: error ?? "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be edited." };
  const { error: delError } = await supabase
    .from("accounting_batch_payments")
    .delete()
    .eq("id", lineId)
    .eq("batch_id", batchId);
  if (delError) return { error: delError.message };
  await recountBatch(supabase, batchId);
  return { error: null };
}

export async function postBatch(supabase: SupabaseClient, batchId: string, userId: string | null) {
  const { batch, error } = await getBatch(supabase, batchId);
  if (error || !batch) return { error: error ?? "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be posted." };

  // Recount from lines so stale header cannot allow empty posts
  const counts = await recountBatch(supabase, batchId);
  if (counts.invoice_count + counts.payment_count === 0) {
    return { error: "Add at least one transaction before posting." };
  }

  const { error: upError } = await supabase
    .from("accounting_batches")
    .update({
      status: "Posted",
      posted_by: userId,
      posted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId)
    .eq("status", "Open");
  return { error: upError?.message ?? null };
}

export async function unpostBatch(supabase: SupabaseClient, batchId: string) {
  const { batch, error } = await getBatch(supabase, batchId);
  if (error || !batch) return { error: error ?? "Batch not found" };
  if (batch.status === "Exported") {
    return { error: "Exported batches cannot be unposted." };
  }
  if (batch.status !== "Posted") return { error: "Only posted batches can be unposted." };
  const { error: upError } = await supabase
    .from("accounting_batches")
    .update({
      status: "Open",
      posted_by: null,
      posted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId)
    .eq("status", "Posted");
  return { error: upError?.message ?? null };
}

export async function exportBatch(supabase: SupabaseClient, batchId: string, userId: string | null) {
  const { batch, error } = await getBatch(supabase, batchId);
  if (error || !batch) return { error: error ?? "Batch not found" };
  if (batch.status === "Open") return { error: "Post the batch before exporting." };
  if (batch.status === "Exported") return { error: null };
  const { error: upError } = await supabase
    .from("accounting_batches")
    .update({
      status: "Exported",
      exported_by: userId,
      exported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId)
    .eq("status", "Posted");
  return { error: upError?.message ?? null };
}

export async function deleteEmptyOpenBatch(supabase: SupabaseClient, batchId: string) {
  const { batch, error } = await getBatch(supabase, batchId);
  if (error || !batch) return { error: error ?? "Batch not found" };
  if (batch.status !== "Open") return { error: "Only open batches can be deleted." };

  const counts = await recountBatch(supabase, batchId);
  if (counts.invoice_count + counts.payment_count > 0) {
    return { error: "Remove all transactions before deleting the batch." };
  }
  const { error: delError } = await supabase.from("accounting_batches").delete().eq("id", batchId).eq("status", "Open");
  return { error: delError?.message ?? null };
}

export function exportBatchCsv(
  batch: AccountingBatch,
  invoices: (InvoiceForBatch & { lineAmount: number })[],
  payments: (PaymentForBatch & { lineAmount: number })[],
) {
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines: string[] = [
    ["Type", "Number", "Date", "Customer", "Reference", "Method", "Amount", "Batch", "Batch date"].join(","),
  ];
  for (const inv of invoices) {
    lines.push(
      [
        "Invoice",
        inv.invoice_number,
        inv.invoice_date,
        inv.customers?.name ?? "",
        inv.work_orders?.work_order_number ?? "",
        "",
        inv.lineAmount,
        batch.batch_number,
        batch.batch_date,
      ]
        .map(escape)
        .join(","),
    );
  }
  for (const p of payments) {
    lines.push(
      [
        "Payment",
        p.payment_number,
        p.payment_date,
        p.customers?.name ?? "",
        p.invoices?.invoice_number ?? p.reference_number ?? "",
        p.payment_method,
        p.lineAmount,
        batch.batch_number,
        batch.batch_date,
      ]
        .map(escape)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${batch.batch_number}_export.csv`;
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

/** True when payment_date is on or before asOf, or missing (treated as eligible). */
export function paymentOnOrBefore(paymentDate: string | null | undefined, asOf: string): boolean {
  if (!paymentDate) return true;
  return paymentDate.slice(0, 10) <= asOf;
}

export function invoiceOnOrBefore(invoiceDate: string | null | undefined, asOf: string): boolean {
  if (!invoiceDate) return false;
  return invoiceDate.slice(0, 10) <= asOf;
}
