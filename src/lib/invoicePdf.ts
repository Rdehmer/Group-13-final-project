import { formatMoney } from "@/lib/calculations";
import {
  formatServiceDate,
  type InvoicePdfCustomer,
  type ServiceHistoryInvoice,
  type ServiceHistoryWorkOrder,
} from "@/lib/invoices";
import {
  isCoveredLine,
  type BillableLine,
} from "@/lib/billing";

function customerAddress(customer: InvoicePdfCustomer): string {
  const parts = [customer.city, customer.state].filter(Boolean);
  return parts.length ? parts.join(", ") : "";
}

type JsPdfDoc = {
  setFontSize: (n: number) => void;
  setFont: (family: string, style: string) => void;
  text: (text: string | string[], x: number, y: number, options?: { maxWidth?: number }) => void;
  splitTextToSize: (text: string, maxWidth: number) => string[];
  save: (filename: string) => void;
  output: (type: "blob") => Blob;
  lastAutoTable?: { finalY: number };
};

export type InvoicePdfOptions = {
  /** Detailed billable/covered lines from work order preview when available. */
  detailLines?: BillableLine[] | null;
  coverageNotes?: string | null;
};

function moneyCell(line: BillableLine): string {
  if (isCoveredLine(line) && Number(line.amount) === 0) {
    const list = line.listValue != null ? Number(line.listValue) : 0;
    return list > 0 ? `Included (list ${formatMoney(list)})` : "Included — no charge";
  }
  const amt = Number(line.amount);
  if (amt < 0) return `-${formatMoney(Math.abs(amt))}`;
  return formatMoney(amt);
}

function sectionForLine(line: BillableLine): "covered" | "billable" {
  return isCoveredLine(line) ? "covered" : "billable";
}

/** Client-only: builds an invoice PDF blob (jspdf loaded on demand). */
export async function buildInvoicePdfBlob(
  invoice: ServiceHistoryInvoice & { notes?: string | null },
  workOrder: ServiceHistoryWorkOrder,
  customer: InvoicePdfCustomer,
  options?: InvoicePdfOptions,
): Promise<Blob> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF() as unknown as JsPdfDoc;
  const margin = 14;
  let y = 20;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("EquipmentIQ", margin, y);

  y += 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Equipment Service Manager — Invoice", margin, y);

  y += 12;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(`Invoice ${invoice.invoice_number}`, margin, y);

  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Bill to: ${customer.name}`, margin, y);
  y += 5;
  const addr = customerAddress(customer);
  if (addr) {
    doc.text(addr, margin, y);
    y += 5;
  }
  if (customer.email) {
    doc.text(customer.email, margin, y);
    y += 5;
  }
  if (customer.phone) {
    doc.text(customer.phone, margin, y);
    y += 5;
  }

  y += 4;
  doc.text(`Invoice date: ${formatServiceDate(invoice.invoice_date)}`, margin, y);
  y += 5;
  doc.text(`Due date: ${formatServiceDate(invoice.due_date)}`, margin, y);
  y += 5;
  doc.text(`Status: ${invoice.status}`, margin, y);
  y += 5;
  doc.text(`Work order: ${workOrder.work_order_number}`, margin, y);
  y += 5;
  if (workOrder.equipment?.name) {
    doc.text(`Equipment: ${workOrder.equipment.name}`, margin, y);
    y += 5;
  }
  if (workOrder.work_order_type) {
    doc.text(`Service type: ${workOrder.work_order_type}`, margin, y);
    y += 5;
  }

  // Coverage legend
  y += 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(
    "This invoice separates work covered under PM agreements / warranties from billable out-of-scope repairs.",
    margin,
    y,
    { maxWidth: 180 },
  );
  y += 8;
  doc.setFont("helvetica", "normal");

  const detail = options?.detailLines?.filter((l) => l.kind !== "tax") ?? [];
  const body: [string, string, string][] = [];

  if (detail.length > 0) {
    const covered = detail.filter((l) => sectionForLine(l) === "covered");
    const billable = detail.filter((l) => sectionForLine(l) === "billable");

    if (covered.length) {
      body.push(["— COVERED (PM / agreement / warranty — not charged) —", "", ""]);
      for (const line of covered) {
        body.push([line.description, line.quantity != null ? String(line.quantity) : "", moneyCell(line)]);
      }
    }
    if (billable.length) {
      body.push(["— BILLABLE (out of scope / customer charged) —", "", ""]);
      for (const line of billable) {
        body.push([line.description, line.quantity != null ? String(line.quantity) : "", moneyCell(line)]);
      }
    }
  } else {
    // Fallback rollup with explicit labels
    const labor = Number(invoice.labor_charges ?? 0);
    const parts = Number(invoice.parts_charges ?? 0);
    const recurring = Number(invoice.recurring_service_charge ?? 0);
    const additional = Number(invoice.additional_charges ?? 0);
    const warranty = Number(invoice.warranty_deductions ?? 0);
    const discounts = Number(invoice.discounts ?? 0);
    const tax = Number(invoice.tax ?? 0);

    if (warranty > 0) {
      body.push([
        "Covered under warranty / PM (applied as deduction)",
        "",
        `-${formatMoney(warranty)}`,
      ]);
    }
    if (labor > 0) body.push(["Billable labor (out of scope / charged)", "", formatMoney(labor)]);
    if (parts > 0) body.push(["Billable parts (out of scope / charged)", "", formatMoney(parts)]);
    if (recurring > 0) body.push(["Recurring service / agreement fee", "", formatMoney(recurring)]);
    if (additional > 0) body.push(["Additional billable charges", "", formatMoney(additional)]);
    if (discounts > 0) body.push(["Discounts", "", `-${formatMoney(discounts)}`]);
    if (tax > 0) body.push(["Tax", "", formatMoney(tax)]);
    if (body.length === 0) {
      body.push(["Service charges", "", formatMoney(invoice.invoice_total)]);
    }
  }

  autoTable(doc as never, {
    startY: y,
    head: [["Description", "Qty", "Amount"]],
    body,
    theme: "striped",
    headStyles: { fillColor: [41, 65, 114] },
    margin: { left: margin, right: margin },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 18, halign: "right" },
      2: { cellWidth: 36, halign: "right" },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== "body") return;
      const label = String(data.row?.raw?.[0] ?? data.cell?.text?.[0] ?? "");
      if (label.startsWith("— COVERED") || label.startsWith("— BILLABLE")) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = label.startsWith("— COVERED") ? [232, 245, 233] : [255, 243, 224];
        data.cell.styles.textColor = [30, 42, 54];
      }
    },
  });

  let finalY = doc.lastAutoTable?.finalY ?? y + 40;

  // Tax row if detail path used
  if (detail.length > 0 && Number(invoice.tax) > 0) {
    finalY += 6;
    doc.setFontSize(10);
    doc.text(`Sales tax: ${formatMoney(invoice.tax)}`, margin, finalY);
    finalY += 2;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Total: ${formatMoney(invoice.invoice_total)}`, margin, finalY + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Amount paid: ${formatMoney(invoice.amount_paid)}`, margin, finalY + 16);
  doc.text(`Balance due: ${formatMoney(invoice.remaining_balance)}`, margin, finalY + 22);

  const notes = (options?.coverageNotes || invoice.notes || "").trim();
  if (notes) {
    let ny = finalY + 30;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Coverage notes", margin, ny);
    ny += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const wrapped = doc.splitTextToSize(notes.slice(0, 1800), 180);
    doc.text(wrapped, margin, ny);
  }

  return doc.output("blob");
}

export async function downloadInvoicePdf(
  invoice: ServiceHistoryInvoice & { notes?: string | null },
  workOrder: ServiceHistoryWorkOrder,
  customer: InvoicePdfCustomer,
  options?: InvoicePdfOptions,
): Promise<void> {
  const blob = await buildInvoicePdfBlob(invoice, workOrder, customer, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${invoice.invoice_number}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function invoicePdfToBase64(
  invoice: ServiceHistoryInvoice & { notes?: string | null },
  workOrder: ServiceHistoryWorkOrder,
  customer: InvoicePdfCustomer,
  options?: InvoicePdfOptions,
): Promise<string> {
  const blob = await buildInvoicePdfBlob(invoice, workOrder, customer, options);
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
