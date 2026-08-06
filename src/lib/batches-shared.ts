/**
 * Shared pure helpers for remote + local batch storage (no browser/server APIs).
 */

import type { AccountingBatchType } from "@/lib/types";

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

export function nextBatchNumberSync(prefix: "INVB" | "PAYB" | "MIXB" = "INVB"): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${t.slice(-5)}${r}`;
}
