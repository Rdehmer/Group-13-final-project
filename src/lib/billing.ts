import { invoiceSubtotal, invoiceTotal, remainingBalance } from "@/lib/calculations";
import type { Invoice, TechnicianLabor, WorkOrderPart } from "@/lib/types";

export type LineKind = "labor" | "parts" | "recurring" | "additional" | "warranty" | "discount" | "tax";

export type BillableLine = {
  kind: LineKind;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
};

/** Editable line before save (id is client-only). */
export type EditableInvoiceLine = {
  id: string;
  kind: Exclude<LineKind, "tax">;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

export const EDITABLE_LINE_KINDS: { value: EditableInvoiceLine["kind"]; label: string }[] = [
  { value: "labor", label: "Labor" },
  { value: "parts", label: "Parts / materials" },
  { value: "recurring", label: "Recurring service" },
  { value: "additional", label: "Additional charge" },
  { value: "warranty", label: "Warranty deduction" },
  { value: "discount", label: "Discount" },
];

export function isUnsentInvoice(status: string): boolean {
  const s = (status || "").toLowerCase();
  return s.includes("draft") || s === "unsent";
}

export function newEditableLine(
  kind: EditableInvoiceLine["kind"] = "additional",
  partial?: Partial<Omit<EditableInvoiceLine, "id">>,
): EditableInvoiceLine {
  const defaults: Record<EditableInvoiceLine["kind"], string> = {
    labor: "Labor charges",
    parts: "Parts / materials",
    recurring: "Recurring service charge",
    additional: "Additional charge",
    warranty: "Warranty deduction",
    discount: "Discount",
  };
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    description: partial?.description ?? defaults[kind],
    quantity: partial?.quantity ?? "",
    unitPrice: partial?.unitPrice ?? "",
    amount: partial?.amount ?? "0",
  };
}

export function billableToEditable(lines: BillableLine[]): EditableInvoiceLine[] {
  return lines
    .filter((l) => l.kind !== "tax")
    .map((l) =>
      newEditableLine(l.kind as EditableInvoiceLine["kind"], {
        description: l.description,
        quantity: l.quantity != null ? String(l.quantity) : "",
        unitPrice: l.unitPrice != null ? String(l.unitPrice) : "",
        amount:
          l.kind === "warranty" || l.kind === "discount"
            ? String(Math.abs(Number(l.amount)))
            : String(l.amount),
      }),
    );
}

export function invoiceToEditableLines(inv: Invoice): EditableInvoiceLine[] {
  const lines = linesFromStoredInvoice(inv).filter((l) => l.kind !== "tax");
  if (lines.length === 0) {
    return [
      newEditableLine("labor", { amount: "0" }),
      newEditableLine("parts", { amount: "0" }),
    ];
  }
  return billableToEditable(lines);
}

export function recomputeLineAmount(line: EditableInvoiceLine): string {
  const qty = Number(line.quantity);
  const rate = Number(line.unitPrice);
  if (line.quantity !== "" && line.unitPrice !== "" && !Number.isNaN(qty) && !Number.isNaN(rate)) {
    return (qty * rate).toFixed(2);
  }
  return line.amount;
}

export function rollupEditableLines(
  lines: EditableInvoiceLine[],
  taxRate: number,
  amountPaid = 0,
): {
  labor_charges: number;
  parts_charges: number;
  recurring_service_charge: number;
  additional_charges: number;
  warranty_deductions: number;
  discounts: number;
  subtotal: number;
  tax: number;
  invoice_total: number;
  remaining_balance: number;
} {
  let labor = 0;
  let parts = 0;
  let recurring = 0;
  let additional = 0;
  let warranty = 0;
  let discounts = 0;

  for (const line of lines) {
    const raw = Math.max(0, Number(recomputeLineAmount(line)) || 0);
    switch (line.kind) {
      case "labor":
        labor += raw;
        break;
      case "parts":
        parts += raw;
        break;
      case "recurring":
        recurring += raw;
        break;
      case "additional":
        additional += raw;
        break;
      case "warranty":
        warranty += raw;
        break;
      case "discount":
        discounts += raw;
        break;
    }
  }

  const subtotal = invoiceSubtotal({
    billableLabor: labor,
    billableParts: parts,
    recurring,
    additional,
    warrantyDeductions: warranty,
    discounts,
  });
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  const total = invoiceTotal(subtotal, tax);
  const paid = Math.max(0, amountPaid);

  return {
    labor_charges: labor,
    parts_charges: parts,
    recurring_service_charge: recurring,
    additional_charges: additional,
    warranty_deductions: warranty,
    discounts,
    subtotal,
    tax,
    invoice_total: total,
    remaining_balance: remainingBalance(total, paid),
  };
}

export type InvoicePreview = {
  laborCharges: number;
  partsCharges: number;
  warrantyDeductions: number;
  recurring: number;
  additional: number;
  discounts: number;
  subtotal: number;
  tax: number;
  total: number;
  laborLines: BillableLine[];
  partsLines: BillableLine[];
};

export function sumLaborCharges(labor: TechnicianLabor[]): number {
  return labor.reduce(
    (s, l) =>
      s +
      Number(l.regular_hours) * Number(l.customer_billing_rate) +
      Number(l.overtime_hours) * Number(l.customer_billing_rate) * 1.5,
    0,
  );
}

export function sumPartsCharges(parts: WorkOrderPart[]): number {
  return parts.reduce((s, p) => s + Number(p.billable_amount), 0);
}

export function sumWarrantyCovered(parts: WorkOrderPart[]): number {
  return parts.reduce((s, p) => s + Number(p.warranty_covered_amount), 0);
}

export function buildWorkOrderPreview(
  labor: TechnicianLabor[],
  parts: WorkOrderPart[],
  taxRate: number,
  extras?: {
    recurring?: number;
    additional?: number;
    discounts?: number;
  },
): InvoicePreview {
  const laborCharges = sumLaborCharges(labor);
  const partsCharges = sumPartsCharges(parts);
  const warrantyDeductions = sumWarrantyCovered(parts);
  const recurring = extras?.recurring ?? 0;
  const additional = extras?.additional ?? 0;
  const discounts = extras?.discounts ?? 0;
  const subtotal = invoiceSubtotal({
    billableLabor: laborCharges,
    billableParts: partsCharges,
    recurring,
    additional,
    warrantyDeductions,
    discounts,
  });
  const tax = subtotal * taxRate;
  const total = invoiceTotal(subtotal, tax);

  const laborLines: BillableLine[] = labor.map((l) => {
    const reg = Number(l.regular_hours);
    const ot = Number(l.overtime_hours);
    const rate = Number(l.customer_billing_rate);
    const amount = reg * rate + ot * rate * 1.5;
    return {
      kind: "labor",
      description: `Labor — ${reg.toFixed(2)} hr reg${ot > 0 ? ` + ${ot.toFixed(2)} hr OT` : ""} @ ${rate.toFixed(2)}/hr`,
      quantity: reg + ot,
      unitPrice: rate,
      amount,
    };
  });

  const partsLines: BillableLine[] = parts.map((p) => ({
    kind: "parts",
    description: `Part used — qty ${Number(p.quantity_used)}`,
    quantity: Number(p.quantity_used),
    unitPrice: Number(p.customer_price),
    amount: Number(p.billable_amount),
  }));

  return {
    laborCharges,
    partsCharges,
    warrantyDeductions,
    recurring,
    additional,
    discounts,
    subtotal,
    tax,
    total,
    laborLines,
    partsLines,
  };
}

export function linesFromStoredInvoice(inv: Invoice): BillableLine[] {
  const lines: BillableLine[] = [];
  if (Number(inv.labor_charges) > 0) {
    lines.push({
      kind: "labor",
      description: "Labor charges",
      quantity: null,
      unitPrice: null,
      amount: Number(inv.labor_charges),
    });
  }
  if (Number(inv.parts_charges) > 0) {
    lines.push({
      kind: "parts",
      description: "Parts / materials",
      quantity: null,
      unitPrice: null,
      amount: Number(inv.parts_charges),
    });
  }
  if (Number(inv.recurring_service_charge) > 0) {
    lines.push({
      kind: "recurring",
      description: "Recurring service charge",
      quantity: null,
      unitPrice: null,
      amount: Number(inv.recurring_service_charge),
    });
  }
  if (Number(inv.additional_charges) > 0) {
    lines.push({
      kind: "additional",
      description: "Additional charges",
      quantity: null,
      unitPrice: null,
      amount: Number(inv.additional_charges),
    });
  }
  if (Number(inv.warranty_deductions) > 0) {
    lines.push({
      kind: "warranty",
      description: "Warranty deductions",
      quantity: null,
      unitPrice: null,
      amount: -Number(inv.warranty_deductions),
    });
  }
  if (Number(inv.discounts) > 0) {
    lines.push({
      kind: "discount",
      description: "Discounts",
      quantity: null,
      unitPrice: null,
      amount: -Number(inv.discounts),
    });
  }
  if (Number(inv.tax) > 0) {
    lines.push({
      kind: "tax",
      description: "Sales tax",
      quantity: null,
      unitPrice: null,
      amount: Number(inv.tax),
    });
  }
  return lines;
}

export function invoiceBucket(
  inv: Invoice,
  today = new Date(),
): "draft" | "sent" | "open" | "past_due" | "paid" | "other" {
  const status = (inv.status || "").toLowerCase();
  if (status.includes("draft") || status === "unsent") return "draft";
  if (status.includes("paid") && !status.includes("partial")) return "paid";
  if (status.includes("canceled") || status.includes("void") || status.includes("disputed")) return "other";
  const due = new Date(inv.due_date);
  const bal = Number(inv.remaining_balance);
  if (bal > 0 && due < today && !status.includes("draft")) return "past_due";
  if (status.includes("sent") || status.includes("partial")) return "sent";
  if (bal > 0) return "open";
  return "other";
}

export function daysPastDue(inv: Invoice, today = new Date()): number {
  const due = new Date(inv.due_date);
  return Math.floor((today.getTime() - due.getTime()) / 86400000);
}
