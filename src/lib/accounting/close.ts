/**
 * Month-end close checklist + pack export helpers.
 */

import { listJournals, getPeriod, ensurePeriod, trialBalance, type PeriodStatus } from "@/lib/accounting/ledger-local";
import { deferredRevenueSchedule, arAgingSummary, openInvoicesAt, type InvoiceWithCustomer } from "@/lib/reports";
import { earnedRevenueFromCompletions, contractAssetRollforward } from "@/lib/accounting/earned-revenue";
import { localListBatches } from "@/lib/batches-local";
import type { Invoice, Payment, ServiceContract, WorkOrder, Part, WorkOrderPart, TechnicianLabor } from "@/lib/types";

export type CloseCheckItem = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export function buildCloseChecklist(input: {
  period: string; // YYYY-MM
  invoices: InvoiceWithCustomer[];
  payments: Payment[];
  contracts: (ServiceContract & { customers?: { name: string } })[];
  jobs: WorkOrder[];
  parts: Part[];
  partsUsed: WorkOrderPart[];
  labor: TechnicianLabor[];
}): CloseCheckItem[] {
  const period = input.period;
  ensurePeriod(period);
  const periodEnd = `${period}-${new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()}`;
  const periodStart = `${period}-01`;
  const items: CloseCheckItem[] = [];

  const openBatches = localListBatches().filter(
    (b) => b.status === "Open" && b.batch_date.slice(0, 7) <= period,
  );
  items.push({
    id: "batches",
    label: "Post open accounting batches",
    status: openBatches.length === 0 ? "pass" : "fail",
    detail:
      openBatches.length === 0
        ? "No open batches through period."
        : `${openBatches.length} open batch(es) still editable.`,
  });

  const deferredJe = listJournals().find(
    (j) => j.status === "Posted" && j.source === "deferred" && j.source_id === `deferred:${period}`,
  );
  const deferredAmt = deferredRevenueSchedule(input.contracts, periodEnd);
  let monthDeferred = 0;
  for (const row of deferredAmt.rows) {
    const m = row.schedule.find((x) => x.month === period);
    if (m) monthDeferred += m.recognized;
  }
  items.push({
    id: "deferred",
    label: "Post deferred revenue recognition",
    status: monthDeferred <= 0.005 ? "pass" : deferredJe ? "pass" : "fail",
    detail:
      monthDeferred <= 0.005
        ? "No prepaid recognition this month."
        : deferredJe
          ? `Posted ${deferredJe.entry_number} (sched. $${monthDeferred.toFixed(2)}).`
          : `$${monthDeferred.toFixed(2)} scheduled — not posted yet.`,
  });

  const unbilled = earnedRevenueFromCompletions(input.jobs, input.invoices, {
    start: periodStart,
    end: periodEnd,
  }).filter((r) => !r.billed);
  items.push({
    id: "unbilled",
    label: "Review unbilled completions (contract assets)",
    status: unbilled.length === 0 ? "pass" : "warn",
    detail:
      unbilled.length === 0
        ? "No unbilled completed jobs in period."
        : `${unbilled.length} completed job(s) still unbilled ($${unbilled.reduce((s, r) => s + r.amount, 0).toFixed(2)}).`,
  });

  const open = openInvoicesAt(input.invoices, new Date(periodEnd + "T12:00:00"));
  const aging = arAgingSummary(open);
  items.push({
    id: "ar",
    label: "Review A/R aging & allowance",
    status: aging.totals.d90 > 0 ? "warn" : "pass",
    detail: `Gross AR $${aging.gross.toFixed(2)}; 90+ $${aging.totals.d90.toFixed(2)}; allowance est. $${aging.allowance.toFixed(2)}.`,
  });

  const allowanceJe = listJournals().find(
    (j) => j.status === "Posted" && j.source === "allowance" && j.source_id === `allowance:${period}`,
  );
  items.push({
    id: "allowance",
    label: "Post CECL allowance adjustment",
    status: allowanceJe || aging.allowance < 0.005 ? "pass" : "warn",
    detail: allowanceJe
      ? `Posted ${allowanceJe.entry_number}.`
      : aging.allowance < 0.005
        ? "No allowance indicated."
        : `Target allowance $${aging.allowance.toFixed(2)} — post if adopting the estimate.`,
  });

  const taxOnBooks = input.invoices
    .filter((i) => (i.invoice_date || "") <= periodEnd)
    .reduce((s, i) => s + Number(i.tax), 0);
  const taxRemitted = listJournals()
    .filter((j) => j.status === "Posted" && j.source === "tax_remittance" && j.entry_date <= periodEnd)
    .length;
  items.push({
    id: "tax",
    label: "Sales tax remittance",
    status: taxOnBooks < 0.005 || taxRemitted > 0 ? "pass" : "warn",
    detail:
      taxOnBooks < 0.005
        ? "No tax billed."
        : taxRemitted > 0
          ? `${taxRemitted} remittance journal(s) on file.`
          : "Tax payable outstanding — record remittance when filed.",
  });

  const deposits = listJournals().filter(
    (j) => j.status === "Posted" && j.source === "deposit" && j.entry_date.slice(0, 7) === period,
  );
  const payBatches = localListBatches().filter(
    (b) => b.batch_type !== "invoice" && b.status !== "Open" && b.batch_date.slice(0, 7) === period,
  );
  items.push({
    id: "deposits",
    label: "Clear undeposited funds to bank",
    status: payBatches.length === 0 || deposits.length > 0 ? "pass" : "warn",
    detail:
      payBatches.length === 0
        ? "No payment batches this period."
        : deposits.length > 0
          ? `${deposits.length} bank deposit clearing JE(s).`
          : `${payBatches.length} payment batch(es) — clear undeposited funds when deposited.`,
  });

  const periodRow = getPeriod(period);
  items.push({
    id: "lock",
    label: "Lock accounting period",
    status: periodRow?.status === "Closed" ? "pass" : periodRow?.status === "Soft Closed" ? "warn" : "fail",
    detail: `Period status: ${periodRow?.status ?? "Open"}.`,
  });

  return items;
}

export function monthEndPackCsv(input: {
  period: string;
  invoices: InvoiceWithCustomer[];
  payments: Payment[];
  contracts: (ServiceContract & { customers?: { name: string } })[];
  jobs: WorkOrder[];
}): string {
  const periodEnd = `${input.period}-${new Date(Number(input.period.slice(0, 4)), Number(input.period.slice(5, 7)), 0).getDate()}`;
  const tb = trialBalance(periodEnd);
  const deferred = deferredRevenueSchedule(input.contracts, periodEnd);
  const asset = contractAssetRollforward(input.jobs, input.invoices, periodEnd);
  const open = openInvoicesAt(input.invoices, new Date(periodEnd + "T12:00:00"));
  const aging = arAgingSummary(open);
  const checks = buildCloseChecklist({
    period: input.period,
    invoices: input.invoices,
    payments: input.payments,
    contracts: input.contracts,
    jobs: input.jobs,
    parts: [],
    partsUsed: [],
    labor: [],
  });

  const lines: string[] = [];
  const push = (cols: (string | number)[]) => {
    lines.push(
      cols
        .map((c) => {
          const s = String(c ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
  };

  push(["Ridley Equipment Services — Month-end pack", input.period]);
  push([]);
  push(["Section", "Trial balance"]);
  push(["Account", "Name", "Debit", "Credit", "Balance"]);
  for (const r of tb.rows) push([r.accountCode, r.accountName, r.debit, r.credit, r.balance]);
  push(["TOTAL", "", tb.totalDebit, tb.totalCredit, ""]);
  push([]);
  push(["Section", "Deferred revenue"]);
  push(["Total deferred", deferred.totalDeferred]);
  push(["Current", deferred.totalCurrent]);
  push(["Noncurrent", deferred.totalNoncurrent]);
  push([]);
  push(["Section", "Contract asset rollforward"]);
  push(["Beginning", asset.beginning]);
  push(["Earned unbilled", asset.earnedUnbilled]);
  push(["Billed", asset.billed]);
  push(["Ending", asset.ending]);
  push([]);
  push(["Section", "AR aging"]);
  push(["Gross", aging.gross]);
  push(["Allowance", aging.allowance]);
  push(["Net", aging.net]);
  push([]);
  push(["Section", "Close checklist"]);
  push(["Item", "Status", "Detail"]);
  for (const c of checks) push([c.label, c.status, c.detail]);

  return lines.join("\n");
}

export type { PeriodStatus };
