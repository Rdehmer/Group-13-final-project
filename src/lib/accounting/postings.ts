/**
 * Build and post standard accounting journals (batch, deferred, tax, allowance, etc.).
 */

import { postJournal, journalsForSource, periodKeyFromDate, type JournalEntry } from "@/lib/accounting/ledger-local";
import type { AccountingBatch, Invoice, Payment, ServiceContract } from "@/lib/types";
import { deferredRevenueSchedule } from "@/lib/reports";

export function postBatchJournal(input: {
  batch: AccountingBatch;
  invoices: (Invoice & { lineAmount?: number })[];
  payments: (Payment & { lineAmount?: number })[];
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const existing = journalsForSource("batch", input.batch.id);
  if (existing) return { ok: true, journal: existing };

  const invTotal = input.invoices.reduce((s, i) => s + Number(i.lineAmount ?? i.invoice_total), 0);
  const payTotal = input.payments.reduce((s, p) => s + Number(p.lineAmount ?? p.payment_amount), 0);
  const taxTotal = input.invoices.reduce((s, i) => s + Number(i.tax ?? 0), 0);
  const labor = input.invoices.reduce((s, i) => s + Number(i.labor_charges), 0);
  const parts = input.invoices.reduce((s, i) => s + Number(i.parts_charges), 0);
  const recurring = input.invoices.reduce((s, i) => s + Number(i.recurring_service_charge), 0);
  const other = input.invoices.reduce((s, i) => s + Number(i.additional_charges), 0);
  const discounts = input.invoices.reduce((s, i) => s + Number(i.discounts) + Number(i.warranty_deductions), 0);
  const serviceRev = Math.max(0, invTotal - taxTotal);

  const lines: { accountCode: string; debit?: number; credit?: number; memo?: string }[] = [];

  if (invTotal > 0.005) {
    lines.push({ accountCode: "1100", debit: invTotal, memo: "AR from invoices" });
    // Split revenue when components available; else lump into 4400
    const componentSum = labor + parts + recurring + other - discounts;
    if (componentSum > 0.005 && Math.abs(componentSum - serviceRev) < 1) {
      if (labor > 0) lines.push({ accountCode: "4000", credit: labor, memo: "Labor revenue" });
      if (parts > 0) lines.push({ accountCode: "4100", credit: parts, memo: "Parts revenue" });
      if (recurring > 0) lines.push({ accountCode: "4200", credit: recurring, memo: "Recurring revenue" });
      if (other > 0) lines.push({ accountCode: "4300", credit: other, memo: "Other revenue" });
      if (discounts > 0) lines.push({ accountCode: "4900", debit: discounts, memo: "Discounts / warranty" });
    } else if (serviceRev > 0.005) {
      lines.push({ accountCode: "4400", credit: serviceRev, memo: "Service revenue" });
    }
    if (taxTotal > 0.005) {
      lines.push({ accountCode: "2100", credit: taxTotal, memo: "Sales tax payable" });
    }
  }

  if (payTotal > 0.005) {
    lines.push({ accountCode: "1050", debit: payTotal, memo: "Undeposited funds" });
    lines.push({ accountCode: "1100", credit: payTotal, memo: "AR applied" });
  }

  if (lines.length < 2) {
    return { ok: false, error: "Batch has no amounts to journal." };
  }

  return postJournal({
    entryDate: input.batch.batch_date,
    source: "batch",
    sourceId: input.batch.id,
    memo: `Batch ${input.batch.batch_number} — ${input.batch.name || input.batch.batch_type}`,
    userId: input.userId,
    lines,
  });
}

/** Recognize prepaid contract revenue for a calendar month (YYYY-MM). */
export function postDeferredRecognition(input: {
  period: string; // YYYY-MM
  contracts: (ServiceContract & { customers?: { name: string } })[];
  userId: string | null;
}): { ok: true; journal: JournalEntry; amount: number } | { ok: false; error: string } {
  const sourceId = `deferred:${input.period}`;
  const existing = journalsForSource("deferred", sourceId);
  if (existing) {
    const amt = 0;
    return { ok: true, journal: existing, amount: amt };
  }

  const asOf = `${input.period}-${new Date(Number(input.period.slice(0, 4)), Number(input.period.slice(5, 7)), 0).getDate()}`;
  const sched = deferredRevenueSchedule(input.contracts, asOf);
  let amount = 0;
  for (const row of sched.rows) {
    const m = row.schedule.find((x) => x.month === input.period);
    if (m) amount += m.recognized;
  }
  amount = Math.round(amount * 100) / 100;
  if (amount <= 0.005) {
    return { ok: false, error: `No deferred recognition amount for ${input.period}.` };
  }

  const result = postJournal({
    entryDate: asOf,
    source: "deferred",
    sourceId,
    memo: `Deferred revenue recognition ${input.period}`,
    userId: input.userId,
    lines: [
      { accountCode: "2200", debit: amount, memo: "Release deferred revenue" },
      { accountCode: "4200", credit: amount, memo: `Contract revenue ${input.period}` },
    ],
  });
  if (!result.ok) return result;
  return { ok: true, journal: result.journal, amount };
}

export function postTaxRemittance(input: {
  amount: number;
  remittanceDate: string;
  reference?: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (amount <= 0) return { ok: false, error: "Enter a remittance amount." };
  const sourceId = `tax:${input.remittanceDate}:${amount}`;
  return postJournal({
    entryDate: input.remittanceDate,
    source: "tax_remittance",
    sourceId,
    memo: `Sales tax remittance${input.reference ? ` — ${input.reference}` : ""}`,
    userId: input.userId,
    lines: [
      { accountCode: "2100", debit: amount, memo: "Sales tax payable" },
      { accountCode: "1000", credit: amount, memo: "Cash remitted" },
    ],
  });
}

export function postAllowance(input: {
  targetAllowance: number;
  currentAllowanceBalance: number;
  asOf: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry; expense: number } | { ok: false; error: string } {
  const expense = Math.round((input.targetAllowance - input.currentAllowanceBalance) * 100) / 100;
  if (Math.abs(expense) < 0.005) {
    return { ok: false, error: "Allowance already matches the target estimate." };
  }
  const sourceId = `allowance:${periodKeyFromDate(input.asOf)}`;
  const existing = journalsForSource("allowance", sourceId);
  if (existing) return { ok: true, journal: existing, expense: 0 };

  const lines =
    expense > 0
      ? [
          { accountCode: "6000", debit: expense, memo: "Bad debt expense" },
          { accountCode: "1150", credit: expense, memo: "Allowance for credit losses" },
        ]
      : [
          { accountCode: "1150", debit: Math.abs(expense), memo: "Reduce allowance" },
          { accountCode: "6000", credit: Math.abs(expense), memo: "Bad debt expense" },
        ];

  const result = postJournal({
    entryDate: input.asOf,
    source: "allowance",
    sourceId,
    memo: `CECL allowance adjustment ${periodKeyFromDate(input.asOf)}`,
    userId: input.userId,
    lines,
  });
  if (!result.ok) return result;
  return { ok: true, journal: result.journal, expense };
}

export function postWriteOff(input: {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  asOf: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (amount <= 0) return { ok: false, error: "Write-off amount required." };
  return postJournal({
    entryDate: input.asOf,
    source: "write_off",
    sourceId: `wo:${input.invoiceId}`,
    memo: `AR write-off ${input.invoiceNumber}`,
    userId: input.userId,
    lines: [
      { accountCode: "1150", debit: amount, memo: "Apply allowance" },
      { accountCode: "1100", credit: amount, memo: "Clear AR" },
    ],
  });
}

export function postCreditMemoJournal(input: {
  creditMemoId: string;
  creditMemoNumber: string;
  amount: number; // positive number = credit to customer
  tax: number;
  asOf: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  const tax = Math.round(Number(input.tax) * 100) / 100;
  const service = Math.max(0, amount - tax);
  return postJournal({
    entryDate: input.asOf,
    source: "credit_memo",
    sourceId: input.creditMemoId,
    memo: `Credit memo ${input.creditMemoNumber}`,
    userId: input.userId,
    lines: [
      { accountCode: "4400", debit: service, memo: "Revenue reversal" },
      ...(tax > 0 ? [{ accountCode: "2100", debit: tax, memo: "Tax reversal" }] : []),
      { accountCode: "1100", credit: amount, memo: "Reduce AR" },
    ],
  });
}

export function postPayrollAccrual(input: {
  amount: number;
  asOf: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (amount <= 0) return { ok: false, error: "Accrual amount required." };
  const sourceId = `payroll:${periodKeyFromDate(input.asOf)}`;
  const existing = journalsForSource("payroll_accrual", sourceId);
  if (existing) return { ok: true, journal: existing };
  return postJournal({
    entryDate: input.asOf,
    source: "payroll_accrual",
    sourceId,
    memo: `Payroll accrual ${periodKeyFromDate(input.asOf)}`,
    userId: input.userId,
    lines: [
      { accountCode: "6100", debit: amount, memo: "Payroll expense" },
      { accountCode: "2400", credit: amount, memo: "Accrued wages" },
    ],
  });
}

export function postApBill(input: {
  vendor: string;
  amount: number;
  asOf: string;
  billId: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (amount <= 0) return { ok: false, error: "Bill amount required." };
  return postJournal({
    entryDate: input.asOf,
    source: "ap_bill",
    sourceId: input.billId,
    memo: `AP bill — ${input.vendor}`,
    userId: input.userId,
    lines: [
      { accountCode: "5100", debit: amount, memo: "Parts / vendor COGS" },
      { accountCode: "2000", credit: amount, memo: "Accounts payable" },
    ],
  });
}

export function postApPayment(input: {
  vendor: string;
  amount: number;
  asOf: string;
  paymentId: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (amount <= 0) return { ok: false, error: "Payment amount required." };
  const existing = journalsForSource("ap_payment", input.paymentId);
  if (existing) return { ok: true, journal: existing };
  return postJournal({
    entryDate: input.asOf,
    source: "ap_payment",
    sourceId: input.paymentId,
    memo: `AP payment — ${input.vendor}`,
    userId: input.userId,
    lines: [
      { accountCode: "2000", debit: amount, memo: "Accounts payable" },
      { accountCode: "1000", credit: amount, memo: "Cash" },
    ],
  });
}

export function postDepositClearing(input: {
  amount: number;
  depositDate: string;
  method: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (amount <= 0) return { ok: false, error: "Deposit amount required." };
  const sourceId = `deposit:${input.depositDate}:${input.method}:${amount}`;
  return postJournal({
    entryDate: input.depositDate,
    source: "deposit",
    sourceId,
    memo: `Bank deposit — ${input.method}`,
    userId: input.userId,
    lines: [
      { accountCode: "1000", debit: amount, memo: "Cash in bank" },
      { accountCode: "1050", credit: amount, memo: "Clear undeposited funds" },
    ],
  });
}

export function postCogsForParts(input: {
  amount: number;
  asOf: string;
  workOrderId: string;
  /** Unique id for this parts usage line (avoids same-day collisions). */
  partsLineId?: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (amount <= 0) return { ok: false, error: "COGS amount required." };
  const sourceId =
    input.partsLineId != null && input.partsLineId !== ""
      ? `cogs-parts:${input.partsLineId}`
      : `cogs-parts:${input.workOrderId}:${input.asOf}:${amount}:${Date.now()}`;
  const existing = journalsForSource("cogs", sourceId);
  if (existing) return { ok: true, journal: existing };
  return postJournal({
    entryDate: input.asOf,
    source: "cogs",
    sourceId,
    memo: `COGS — Parts Expense (WO ${input.workOrderId})`,
    userId: input.userId,
    lines: [
      { accountCode: "5100", debit: amount, memo: "COGS — Parts Expense" },
      { accountCode: "1200", credit: amount, memo: "Inventory relief" },
    ],
  });
}

/** Accrue technician job cost: DR COGS — Labor Cost / CR Accrued Wages. */
export function postCogsForLabor(input: {
  amount: number;
  asOf: string;
  workOrderId: string;
  laborId: string;
  userId: string | null;
}): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (amount <= 0) return { ok: false, error: "Labor COGS amount required." };
  const sourceId = `cogs-labor:${input.laborId}`;
  const existing = journalsForSource("cogs", sourceId);
  if (existing) return { ok: true, journal: existing };
  return postJournal({
    entryDate: input.asOf,
    source: "cogs",
    sourceId,
    memo: `COGS — Labor Cost (WO ${input.workOrderId})`,
    userId: input.userId,
    lines: [
      { accountCode: "5000", debit: amount, memo: "COGS — Labor Cost" },
      { accountCode: "2400", credit: amount, memo: "Accrued wages payable" },
    ],
  });
}
