import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney } from "@/lib/calculations";
import { formatServiceDate } from "@/lib/invoices";
import type { ServiceHistoryInvoice, ServiceHistoryWorkOrder } from "@/lib/invoices";

export type InvoicePdfCustomer = {
  name: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
};

function customerAddress(customer: InvoicePdfCustomer): string {
  const parts = [customer.city, customer.state].filter(Boolean);
  return parts.length ? parts.join(", ") : "";
}

export function downloadInvoicePdf(
  invoice: ServiceHistoryInvoice,
  workOrder: ServiceHistoryWorkOrder,
  customer: InvoicePdfCustomer,
): void {
  const doc = new jsPDF();
  const margin = 14;
  let y = 20;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Ridley Equipment Services", margin, y);

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
  }

  const lineItems: [string, string][] = [];
  const labor = Number(invoice.labor_charges ?? 0);
  const parts = Number(invoice.parts_charges ?? 0);
  const recurring = Number(invoice.recurring_service_charge ?? 0);
  const additional = Number(invoice.additional_charges ?? 0);
  const warranty = Number(invoice.warranty_deductions ?? 0);
  const discounts = Number(invoice.discounts ?? 0);
  const tax = Number(invoice.tax ?? 0);

  if (labor > 0) lineItems.push(["Labor", formatMoney(labor)]);
  if (parts > 0) lineItems.push(["Parts", formatMoney(parts)]);
  if (recurring > 0) lineItems.push(["Recurring service", formatMoney(recurring)]);
  if (additional > 0) lineItems.push(["Additional charges", formatMoney(additional)]);
  if (warranty > 0) lineItems.push(["Warranty deductions", `-${formatMoney(warranty)}`]);
  if (discounts > 0) lineItems.push(["Discounts", `-${formatMoney(discounts)}`]);
  if (tax > 0) lineItems.push(["Tax", formatMoney(tax)]);

  if (lineItems.length === 0) {
    lineItems.push(["Service charges", formatMoney(invoice.invoice_total)]);
  }

  autoTable(doc, {
    startY: y + 8,
    head: [["Description", "Amount"]],
    body: lineItems,
    theme: "striped",
    headStyles: { fillColor: [41, 65, 114] },
    margin: { left: margin, right: margin },
  });

  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40;

  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${formatMoney(invoice.invoice_total)}`, margin, finalY + 10);
  doc.setFont("helvetica", "normal");
  doc.text(`Amount paid: ${formatMoney(invoice.amount_paid)}`, margin, finalY + 16);
  doc.text(`Balance due: ${formatMoney(invoice.remaining_balance)}`, margin, finalY + 22);

  doc.save(`${invoice.invoice_number}.pdf`);
}
