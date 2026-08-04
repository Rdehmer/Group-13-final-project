/**
 * CONTROLS DOCUMENTATION
 * This business faces billing and profitability risk when costs or revenue are misstated.
 * Our app reduces the risk by centralizing formulas used across screens and invoices.
 */

export function laborCost(
  regularHours: number,
  overtimeHours: number,
  regularRate: number,
  overtimeRate: number,
): number {
  const rh = Math.max(0, regularHours);
  const oh = Math.max(0, overtimeHours);
  return rh * regularRate + oh * overtimeRate;
}

export function customerBillableAmount(input: {
  laborCharges: number;
  partsCharges: number;
  otherCharges: number;
  warrantyCovered: number;
  contractIncluded: number;
}): number {
  const raw =
    input.laborCharges +
    input.partsCharges +
    input.otherCharges -
    input.warrantyCovered -
    input.contractIncluded;
  return Math.max(0, raw);
}

export function invoiceSubtotal(input: {
  billableLabor: number;
  billableParts: number;
  recurring: number;
  additional: number;
  warrantyDeductions: number;
  discounts: number;
}): number {
  return Math.max(
    0,
    input.billableLabor +
      input.billableParts +
      input.recurring +
      input.additional -
      input.warrantyDeductions -
      input.discounts,
  );
}

export function invoiceTotal(subtotal: number, tax: number): number {
  return Math.max(0, subtotal + tax);
}

export function remainingBalance(total: number, amountPaid: number): number {
  return Math.max(0, total - amountPaid);
}

export function grossProfit(recognizedRevenue: number, directCost: number): number {
  return recognizedRevenue - directCost;
}

export function profitMargin(recognizedRevenue: number, profit: number): number | null {
  if (!recognizedRevenue || recognizedRevenue === 0) return null;
  return profit / recognizedRevenue;
}

export function formatMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}
