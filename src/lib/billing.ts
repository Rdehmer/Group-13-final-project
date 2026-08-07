import { invoiceSubtotal, invoiceTotal, remainingBalance } from "@/lib/calculations";
import type { Invoice, TechnicianLabor, WorkOrderPart } from "@/lib/types";

export type LineKind = "labor" | "parts" | "recurring" | "additional" | "warranty" | "discount" | "tax";

/** Whether a line is charged to the customer or covered under PM / contract / warranty. */
export type LineCoverage =
  | "billable"
  | "out_of_scope"
  | "covered_contract"
  | "covered_warranty"
  | "covered_pm";

export type BillableLine = {
  kind: LineKind;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  /** Customer charge section: covered (no charge / included) vs billable. */
  coverage?: LineCoverage;
  /** Retail / list value when amount is $0 under coverage (for transparency). */
  listValue?: number | null;
};

export type WorkOrderInvoiceContext = {
  work_order_type?: string | null;
  warranty_coverage?: string | null;
  outside_contract?: boolean | null;
  under_expired_contract?: boolean | null;
  contract_id?: string | null;
};

/** Invoice workflow + AR statuses (string values stored on invoices.status). */
export const INVOICE_STATUSES = [
  "Draft",
  "Needs Review",
  "Reviewed",
  "On Hold",
  "Sent",
  "Partially Paid",
  "Paid",
  "Disputed",
  "Canceled",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Queue tabs on the billing board. */
export type InvoiceQueueFilter =
  | "all"
  | "needs_review"
  | "on_hold"
  | "reviewed"
  | "draft"
  | "sent"
  | "past_due"
  | "paid"
  | "mine"
  | "unassigned";

export const INVOICE_QUEUE_TABS: { id: InvoiceQueueFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs Review" },
  { id: "on_hold", label: "On Hold" },
  { id: "reviewed", label: "Reviewed" },
  { id: "draft", label: "Draft" },
  { id: "sent", label: "Sent / Open" },
  { id: "past_due", label: "Past Due" },
  { id: "paid", label: "Paid" },
  { id: "mine", label: "Assigned to me" },
  { id: "unassigned", label: "Unassigned" },
];

export function normalizeInvoiceStatus(status: string): string {
  return (status || "").trim();
}

export function isUnsentInvoice(status: string): boolean {
  const s = normalizeInvoiceStatus(status).toLowerCase();
  return (
    s.includes("draft") ||
    s === "unsent" ||
    s.includes("needs review") ||
    s.includes("on hold") ||
    s === "reviewed"
  );
}

export function isTerminalInvoiceStatus(status: string): boolean {
  const s = normalizeInvoiceStatus(status).toLowerCase();
  return s.includes("canceled") || s.includes("void") || (s.includes("paid") && !s.includes("partial"));
}

/**
 * Derive invoice status from payments/balance while preserving workflow states
 * when no money has been applied. Used to auto-sync the status field after
 * payments, line total changes, and reloads. Manual dropdown still works —
 * call this only when reconciling system facts, not to block edits.
 */
export function suggestInvoiceStatus(inv: {
  status: string;
  amount_paid?: number | string | null;
  remaining_balance?: number | string | null;
}): string {
  const current = normalizeInvoiceStatus(inv.status) || "Draft";
  const lower = current.toLowerCase();
  if (lower.includes("canceled") || lower.includes("void")) return current;

  const paid = Number(inv.amount_paid) || 0;
  const bal = Number(inv.remaining_balance) || 0;

  // Fully settled
  if (bal <= 0.005) {
    if (paid > 0.005) return "Paid";
    // $0 open work — leave in workflow unless already AR-posting
    if (isUnsentInvoice(current) || lower.includes("disputed")) return current;
    return "Paid";
  }

  // Money on file with open balance
  if (paid > 0.005) {
    // Keep disputed open until fully paid
    if (lower.includes("disputed")) return current;
    return "Partially Paid";
  }

  // No payments: reclaim Paid/Partial if totals reopened balance
  if (lower === "paid" || lower.includes("partial")) {
    return isUnsentInvoice(current) ? "Draft" : "Sent";
  }

  return current;
}

/** True when status is expected to track payments (shows Auto in UI). */
export function isPaymentDrivenStatus(status: string): boolean {
  const s = normalizeInvoiceStatus(status).toLowerCase();
  return s === "paid" || s.includes("partial");
}

export function invoiceBucket(
  inv: Pick<Invoice, "status" | "due_date" | "remaining_balance">,
  today = new Date(),
):
  | "draft"
  | "needs_review"
  | "reviewed"
  | "on_hold"
  | "sent"
  | "open"
  | "past_due"
  | "paid"
  | "other" {
  const status = normalizeInvoiceStatus(inv.status).toLowerCase();
  if (status.includes("needs review")) return "needs_review";
  if (status.includes("on hold")) return "on_hold";
  if (status === "reviewed") return "reviewed";
  if (status.includes("draft") || status === "unsent") return "draft";
  if (status.includes("paid") && !status.includes("partial")) return "paid";
  if (status.includes("canceled") || status.includes("void") || status.includes("disputed")) return "other";
  const due = new Date(inv.due_date);
  const bal = Number(inv.remaining_balance);
  if (bal > 0 && due < today && !isUnsentInvoice(inv.status)) return "past_due";
  if (status.includes("sent") || status.includes("partial")) return "sent";
  if (bal > 0) return "open";
  return "other";
}

export function matchesInvoiceQueue(
  inv: Invoice,
  filter: InvoiceQueueFilter,
  today: Date,
  currentUserId: string | null,
): boolean {
  const bucket = invoiceBucket(inv, today);
  const assigned = (inv as Invoice & { assigned_to?: string | null }).assigned_to ?? null;

  switch (filter) {
    case "all":
      return true;
    case "needs_review":
      return bucket === "needs_review";
    case "on_hold":
      return bucket === "on_hold";
    case "reviewed":
      return bucket === "reviewed";
    case "draft":
      return isUnsentInvoice(inv.status);
    case "sent":
      return (
        (bucket === "sent" || bucket === "open" || bucket === "past_due") &&
        Number(inv.remaining_balance) > 0
      );
    case "past_due":
      return bucket === "past_due";
    case "paid":
      return bucket === "paid";
    case "mine":
      return Boolean(currentUserId && assigned === currentUserId);
    case "unassigned":
      return !assigned && !isTerminalInvoiceStatus(inv.status);
    default:
      return true;
  }
}

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
  /** Covered parts value ($); only deducted in money math when parts were billed at list. */
  warrantyDeductions: number;
  /** Full covered/list value shown for disclosure (may equal warrantyDeductions). */
  coveredValue: number;
  recurring: number;
  additional: number;
  discounts: number;
  subtotal: number;
  tax: number;
  total: number;
  laborLines: BillableLine[];
  partsLines: BillableLine[];
  /** All detail lines: covered first, then billable (for PDF / UI sectioning). */
  detailLines: BillableLine[];
  coverageSummary: string;
  /** Suggested invoice.notes body explaining PM / warranty vs out-of-scope. */
  coverageNotes: string;
};

export function sumLaborCharges(labor: TechnicianLabor[]): number {
  return laborEligibleForInvoice(labor).reduce(
    (s, l) =>
      s +
      Number(l.regular_hours) * Number(l.customer_billing_rate) +
      Number(l.overtime_hours) * Number(l.customer_billing_rate) * 1.5,
    0,
  );
}

/** Only unbilled, billable labor may become invoice charges (no silent re-bill). */
export function laborEligibleForInvoice(labor: TechnicianLabor[]): TechnicianLabor[] {
  return labor.filter((l) => {
    if (l.invoiced) return false;
    const bs = String(l.billable_status ?? "").toLowerCase();
    if (bs.includes("non") || bs.includes("non-billable") || bs === "nonbillable") return false;
    if (bs.includes("contract")) return false;
    const gated = (l as TechnicianLabor & { approval_gated?: boolean }).approval_gated;
    if (gated === true) return false;
    return true;
  });
}

/** Contract-included / non-billable labor — shown as covered, not charged. */
export function laborCoveredForInvoice(labor: TechnicianLabor[]): TechnicianLabor[] {
  return labor.filter((l) => {
    if (l.invoiced) return false;
    const bs = String(l.billable_status ?? "").toLowerCase();
    return bs.includes("contract") || bs.includes("non") || bs === "nonbillable";
  });
}

export function sumPartsCharges(parts: WorkOrderPart[]): number {
  return parts.reduce((s, p) => s + Number(p.billable_amount), 0);
}

export function sumWarrantyCovered(parts: WorkOrderPart[]): number {
  return parts.reduce((s, p) => s + Number(p.warranty_covered_amount), 0);
}

function partListTotal(p: WorkOrderPart): number {
  return Number(p.quantity_used) * Number(p.customer_price);
}

/**
 * Money-system warranty deduction for subtotal.
 * When billable_amount is already net of warranty (or exclusive billable vs covered),
 * do not subtract warranty again.
 */
export function warrantyMoneyDeduction(parts: WorkOrderPart[]): number {
  const covered = sumWarrantyCovered(parts);
  if (covered <= 0) return 0;
  const billable = sumPartsCharges(parts);
  const gross = parts.reduce((s, p) => s + partListTotal(p), 0);
  // Exclusive: billable + covered ≈ list → already split; no further deduction
  if (Math.abs(billable + covered - gross) < 0.05) return 0;
  // Netted: billable ≈ max(0, gross − covered)
  if (Math.abs(billable - Math.max(0, gross - covered)) < 0.05) return 0;
  // List price still in billable with separate warranty amount to deduct
  return covered;
}

function isPreventiveWorkOrder(ctx?: WorkOrderInvoiceContext | null): boolean {
  const t = (ctx?.work_order_type ?? "").toLowerCase();
  return t.includes("preventive") || t.includes("preventative") || t.includes("pm ");
}

function isWarrantyWorkOrder(ctx?: WorkOrderInvoiceContext | null): boolean {
  const t = (ctx?.work_order_type ?? "").toLowerCase();
  const cov = (ctx?.warranty_coverage ?? "").toLowerCase();
  return t.includes("warranty") || cov.includes("full") || cov === "parts and labor covered";
}

function coverageLabelForLabor(
  status: string | null | undefined,
  ctx?: WorkOrderInvoiceContext | null,
): LineCoverage {
  const bs = String(status ?? "").toLowerCase();
  if (bs.includes("contract") || isPreventiveWorkOrder(ctx)) return "covered_pm";
  if (bs.includes("non")) return "covered_contract";
  if (ctx?.outside_contract || ctx?.under_expired_contract || !ctx?.contract_id) return "out_of_scope";
  return "billable";
}

function coveragePrefix(coverage: LineCoverage): string {
  switch (coverage) {
    case "covered_pm":
      return "Covered — PM / agreement";
    case "covered_contract":
      return "Covered — contract included";
    case "covered_warranty":
      return "Covered — warranty";
    case "out_of_scope":
      return "Billable — out of scope";
    default:
      return "Billable";
  }
}

function laborHoursLine(
  l: TechnicianLabor,
  amount: number,
  coverage: LineCoverage,
): BillableLine {
  const reg = Number(l.regular_hours);
  const ot = Number(l.overtime_hours);
  const rate = Number(l.customer_billing_rate);
  const qty = reg + ot;
  const hoursPart = `${reg.toFixed(2)} hr reg${ot > 0 ? ` + ${ot.toFixed(2)} hr OT` : ""} @ ${rate.toFixed(2)}/hr`;
  const isCovered = coverage.startsWith("covered");
  return {
    kind: "labor",
    description: `${coveragePrefix(coverage)} · Labor — ${hoursPart}`,
    quantity: qty,
    unitPrice: rate,
    amount: isCovered ? 0 : amount,
    coverage,
    listValue: isCovered ? amount : null,
  };
}

function partCoverage(
  p: WorkOrderPart,
  ctx?: WorkOrderInvoiceContext | null,
): { billable: BillableLine | null; covered: BillableLine | null } {
  const qty = Number(p.quantity_used);
  const price = Number(p.customer_price);
  const billableAmt = Number(p.billable_amount);
  const warrantyAmt = Number(p.warranty_covered_amount);
  const list = partListTotal(p);
  const partName = `Part — qty ${qty}${price ? ` @ ${price.toFixed(2)}` : ""}`;

  const outside =
    Boolean(ctx?.outside_contract) ||
    Boolean(ctx?.under_expired_contract) ||
    !ctx?.contract_id ||
    (ctx?.warranty_coverage ?? "") === "Not Covered" ||
    (ctx?.warranty_coverage ?? "") === "Labor Covered";

  let covered: BillableLine | null = null;
  let billable: BillableLine | null = null;

  if (warrantyAmt > 0.005) {
    const cov: LineCoverage = isWarrantyWorkOrder(ctx) ? "covered_warranty" : "covered_pm";
    covered = {
      kind: "parts",
      description: `${coveragePrefix(cov)} · ${partName} (list ${list.toFixed(2)})`,
      quantity: qty,
      unitPrice: price,
      amount: 0,
      coverage: cov,
      listValue: warrantyAmt,
    };
  }

  if (billableAmt > 0.005) {
    const cov: LineCoverage =
      outside || warrantyAmt < list - 0.01 ? (outside ? "out_of_scope" : "billable") : "billable";
    // Split-line: partial billable after coverage
    const desc =
      warrantyAmt > 0.005
        ? `${coveragePrefix(cov)} · ${partName} (customer portion)`
        : `${coveragePrefix(cov)} · ${partName}`;
    billable = {
      kind: "parts",
      description: desc,
      quantity: qty,
      unitPrice: price,
      amount: billableAmt,
      coverage: cov,
      listValue: null,
    };
  } else if (warrantyAmt <= 0.005 && list > 0.005) {
    // Zero billable, no warranty flag — still show out-of-scope or covered $0
    const cov: LineCoverage = outside ? "out_of_scope" : "covered_pm";
    const line: BillableLine = {
      kind: "parts",
      description: `${coveragePrefix(cov)} · ${partName}`,
      quantity: qty,
      unitPrice: price,
      amount: outside ? list : 0,
      coverage: cov,
      listValue: outside ? null : list,
    };
    if (outside) billable = line;
    else covered = line;
  }

  return { billable, covered };
}

/** Build coverage section notes for invoice.notes / PDF footnotes. */
export function buildCoverageNotes(
  ctx: WorkOrderInvoiceContext | null | undefined,
  preview: Pick<InvoicePreview, "coveredValue" | "laborCharges" | "partsCharges" | "detailLines">,
): string {
  const lines: string[] = [];
  lines.push("COVERAGE SUMMARY");
  const type = ctx?.work_order_type?.trim() || "Service";
  lines.push(`Service type: ${type}`);
  if (ctx?.contract_id && !ctx.outside_contract && !ctx.under_expired_contract) {
    lines.push(
      isPreventiveWorkOrder(ctx)
        ? "Preventive maintenance / service agreement work is included at no additional charge where covered."
        : "In-contract covered work is shown as $0.00 (included under the maintenance agreement or warranty).",
    );
  }
  if (ctx?.outside_contract || ctx?.under_expired_contract || !ctx?.contract_id) {
    lines.push(
      "Out-of-scope / time-and-materials repairs are listed separately and are billable to the customer.",
    );
  }
  if (ctx?.warranty_coverage) {
    lines.push(`Work order warranty flag: ${ctx.warranty_coverage}`);
  }
  if (preview.coveredValue > 0) {
    lines.push(
      `Value covered under PM / warranty / agreement (not charged): $${preview.coveredValue.toFixed(2)}.`,
    );
  }
  const billableTotal = preview.laborCharges + preview.partsCharges;
  if (billableTotal > 0) {
    lines.push(`Billable out-of-scope and excess charges: $${billableTotal.toFixed(2)} before tax.`);
  }
  const coveredLines = preview.detailLines.filter((l) => (l.coverage ?? "").startsWith("covered"));
  const billableLines = preview.detailLines.filter(
    (l) => !(l.coverage ?? "billable").startsWith("covered") && l.kind !== "tax",
  );
  if (coveredLines.length) {
    lines.push("");
    lines.push("Covered (no charge):");
    for (const l of coveredLines.slice(0, 12)) {
      const val = l.listValue != null ? ` [list $${Number(l.listValue).toFixed(2)}]` : "";
      lines.push(`• ${l.description}${val}`);
    }
  }
  if (billableLines.length) {
    lines.push("");
    lines.push("Billable (customer charged):");
    for (const l of billableLines.slice(0, 12)) {
      if (l.amount === 0 && l.kind !== "labor" && l.kind !== "parts") continue;
      lines.push(`• ${l.description} — $${Number(l.amount).toFixed(2)}`);
    }
  }
  return lines.join("\n");
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
  ctx?: WorkOrderInvoiceContext | null,
): InvoicePreview {
  const billableLabor = laborEligibleForInvoice(labor);
  const coveredLabor = laborCoveredForInvoice(labor);
  const laborCharges = sumLaborCharges(labor);
  const partsCharges = sumPartsCharges(parts);
  const coveredPartsValue = sumWarrantyCovered(parts);
  const moneyWarranty = warrantyMoneyDeduction(parts);
  const recurring = extras?.recurring ?? 0;
  const additional = extras?.additional ?? 0;
  const discounts = extras?.discounts ?? 0;
  const subtotal = invoiceSubtotal({
    billableLabor: laborCharges,
    billableParts: partsCharges,
    recurring,
    additional,
    warrantyDeductions: moneyWarranty,
    discounts,
  });
  const tax = subtotal * taxRate;
  const total = invoiceTotal(subtotal, tax);

  const laborLines: BillableLine[] = [];

  for (const l of coveredLabor) {
    const reg = Number(l.regular_hours);
    const ot = Number(l.overtime_hours);
    const rate = Number(l.customer_billing_rate);
    const listAmt = reg * rate + ot * rate * 1.5;
    const coverage = coverageLabelForLabor(l.billable_status, ctx);
    laborLines.push(
      laborHoursLine(l, listAmt, coverage.startsWith("covered") ? coverage : "covered_contract"),
    );
  }

  for (const l of billableLabor) {
    const reg = Number(l.regular_hours);
    const ot = Number(l.overtime_hours);
    const rate = Number(l.customer_billing_rate);
    const amount = reg * rate + ot * rate * 1.5;
    const finalCov: LineCoverage =
      ctx?.outside_contract || ctx?.under_expired_contract || !ctx?.contract_id
        ? "out_of_scope"
        : "billable";
    laborLines.push(laborHoursLine(l, amount, finalCov));
  }

  const partsLines: BillableLine[] = [];
  for (const p of parts) {
    const { billable, covered } = partCoverage(p, ctx);
    if (covered) partsLines.push(covered);
    if (billable) partsLines.push(billable);
  }

  // Covered list value also includes $0 covered labor
  const coveredLaborList = laborLines
    .filter((l) => (l.coverage ?? "").startsWith("covered"))
    .reduce((s, l) => s + Number(l.listValue ?? 0), 0);
  const coveredValue = coveredPartsValue + coveredLaborList;

  const detailLines: BillableLine[] = [
    ...laborLines.filter((l) => (l.coverage ?? "").startsWith("covered")),
    ...partsLines.filter((l) => (l.coverage ?? "").startsWith("covered")),
    ...laborLines.filter((l) => !(l.coverage ?? "billable").startsWith("covered")),
    ...partsLines.filter((l) => !(l.coverage ?? "billable").startsWith("covered")),
  ];

  if (moneyWarranty > 0) {
    detailLines.push({
      kind: "warranty",
      description: "Warranty / coverage deduction (applied to list-priced materials)",
      quantity: null,
      unitPrice: null,
      amount: -moneyWarranty,
      coverage: "covered_warranty",
      listValue: moneyWarranty,
    });
  }

  if (recurring > 0) {
    detailLines.push({
      kind: "recurring",
      description: "Recurring service / agreement fee",
      quantity: null,
      unitPrice: null,
      amount: recurring,
      coverage: "billable",
    });
  }
  if (additional > 0) {
    detailLines.push({
      kind: "additional",
      description: "Additional billable charges",
      quantity: null,
      unitPrice: null,
      amount: additional,
      coverage: "billable",
    });
  }
  if (discounts > 0) {
    detailLines.push({
      kind: "discount",
      description: "Discounts",
      quantity: null,
      unitPrice: null,
      amount: -discounts,
      coverage: "billable",
    });
  }

  const draft: InvoicePreview = {
    laborCharges,
    partsCharges,
    // Money deduction only (avoids double-counting when parts.billable is already net)
    warrantyDeductions: moneyWarranty,
    coveredValue,
    recurring,
    additional,
    discounts,
    subtotal,
    tax,
    total,
    laborLines,
    partsLines,
    detailLines,
    coverageSummary: "",
    coverageNotes: "",
  };

  const typeBit = isPreventiveWorkOrder(ctx)
    ? "Preventive maintenance"
    : isWarrantyWorkOrder(ctx)
      ? "Warranty service"
      : ctx?.outside_contract || !ctx?.contract_id
        ? "Time & materials / out of scope"
        : "Service work";
  draft.coverageSummary =
    coveredValue > 0 || draft.detailLines.some((l) => (l.coverage ?? "").startsWith("covered"))
      ? `${typeBit}: covered items shown at $0; customer is charged only for billable out-of-scope lines.`
      : `${typeBit}: all listed charges are billable.`;
  draft.coverageNotes = buildCoverageNotes(ctx, draft);

  return draft;
}

export function linesFromStoredInvoice(inv: Invoice): BillableLine[] {
  const lines: BillableLine[] = [];
  if (Number(inv.labor_charges) > 0) {
    lines.push({
      kind: "labor",
      description: "Billable labor (out of scope / charged)",
      quantity: null,
      unitPrice: null,
      amount: Number(inv.labor_charges),
      coverage: "billable",
    });
  }
  if (Number(inv.parts_charges) > 0) {
    lines.push({
      kind: "parts",
      description: "Billable parts / materials (out of scope / charged)",
      quantity: null,
      unitPrice: null,
      amount: Number(inv.parts_charges),
      coverage: "billable",
    });
  }
  if (Number(inv.recurring_service_charge) > 0) {
    lines.push({
      kind: "recurring",
      description: "Recurring service / agreement fee",
      quantity: null,
      unitPrice: null,
      amount: Number(inv.recurring_service_charge),
      coverage: "billable",
    });
  }
  if (Number(inv.additional_charges) > 0) {
    lines.push({
      kind: "additional",
      description: "Additional billable charges",
      quantity: null,
      unitPrice: null,
      amount: Number(inv.additional_charges),
      coverage: "billable",
    });
  }
  if (Number(inv.warranty_deductions) > 0) {
    lines.push({
      kind: "warranty",
      description: "Warranty / PM coverage deduction",
      quantity: null,
      unitPrice: null,
      amount: -Number(inv.warranty_deductions),
      coverage: "covered_warranty",
      listValue: Number(inv.warranty_deductions),
    });
  }
  if (Number(inv.discounts) > 0) {
    lines.push({
      kind: "discount",
      description: "Discounts",
      quantity: null,
      unitPrice: null,
      amount: -Number(inv.discounts),
      coverage: "billable",
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

/** True when a line is covered (PM / warranty / contract) and not charged. */
export function isCoveredLine(line: Pick<BillableLine, "coverage" | "kind" | "amount">): boolean {
  if (line.kind === "warranty") return true;
  return (line.coverage ?? "").startsWith("covered");
}

export function daysPastDue(inv: Invoice, today = new Date()): number {
  const due = new Date(inv.due_date);
  return Math.floor((today.getTime() - due.getTime()) / 86400000);
}

/** YYYY-MM from an ISO/date string, or empty if invalid. */
export function monthKeyFromDate(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr.length < 7) return "";
  return dateStr.slice(0, 7);
}

/** Label like "August 2026" for a YYYY-MM key. */
export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

/** Unique YYYY-MM keys from date strings, newest first. */
export function collectMonthKeys(dates: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const d of dates) {
    const key = monthKeyFromDate(d);
    if (key) set.add(key);
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

/** All 12 calendar months for a year as YYYY-MM (January → December). */
export function calendarMonthsForYear(year = new Date().getFullYear()): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}
