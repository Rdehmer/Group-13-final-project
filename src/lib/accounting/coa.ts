/**
 * Ridley chart of accounts — used by journal postings and trial balance.
 * Codes are stable for CSV / QBO-style export.
 */

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "cogs" | "expense";

export type GlAccount = {
  code: string;
  name: string;
  type: AccountType;
  normal: "debit" | "credit";
};

export const CHART_OF_ACCOUNTS: GlAccount[] = [
  { code: "1000", name: "Cash", type: "asset", normal: "debit" },
  { code: "1050", name: "Undeposited Funds", type: "asset", normal: "debit" },
  { code: "1100", name: "Accounts Receivable", type: "asset", normal: "debit" },
  { code: "1150", name: "Allowance for Credit Losses", type: "asset", normal: "credit" },
  { code: "1200", name: "Inventory", type: "asset", normal: "debit" },
  { code: "1300", name: "Contract Asset (Unbilled)", type: "asset", normal: "debit" },
  { code: "1400", name: "Customer Deposits Asset Clearing", type: "asset", normal: "debit" },
  { code: "2000", name: "Accounts Payable", type: "liability", normal: "credit" },
  { code: "2100", name: "Sales Tax Payable", type: "liability", normal: "credit" },
  { code: "2200", name: "Deferred Revenue — Current", type: "liability", normal: "credit" },
  { code: "2250", name: "Deferred Revenue — Noncurrent", type: "liability", normal: "credit" },
  { code: "2300", name: "Customer Deposits", type: "liability", normal: "credit" },
  { code: "2400", name: "Accrued Wages Payable", type: "liability", normal: "credit" },
  { code: "3000", name: "Retained Earnings / Equity", type: "equity", normal: "credit" },
  { code: "4000", name: "Service Revenue — Labor", type: "revenue", normal: "credit" },
  { code: "4100", name: "Service Revenue — Parts", type: "revenue", normal: "credit" },
  { code: "4200", name: "Service Revenue — Recurring / Contract", type: "revenue", normal: "credit" },
  { code: "4300", name: "Service Revenue — Other", type: "revenue", normal: "credit" },
  { code: "4400", name: "Contract Revenue Recognized (ASC 606)", type: "revenue", normal: "credit" },
  { code: "4900", name: "Sales Discounts & Warranty Contra", type: "revenue", normal: "debit" },
  { code: "5000", name: "Cost of Services — Labor", type: "cogs", normal: "debit" },
  { code: "5100", name: "Cost of Services — Parts", type: "cogs", normal: "debit" },
  { code: "6000", name: "Bad Debt Expense", type: "expense", normal: "debit" },
  { code: "6100", name: "Payroll Expense (Accrual)", type: "expense", normal: "debit" },
];

export const ACCOUNT_BY_CODE = Object.fromEntries(CHART_OF_ACCOUNTS.map((a) => [a.code, a])) as Record<
  string,
  GlAccount
>;

export function accountName(code: string): string {
  return ACCOUNT_BY_CODE[code]?.name ?? code;
}
