"use client";

/**
 * ServiceTitan-style invoice email composer.
 * Full compose surface: To / Cc / Subject / Body / attachment + Send.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Mail,
  Paperclip,
  Send,
  X,
} from "lucide-react";

export type EmailInvoiceRecipient = {
  kind: "customer" | "service_vendor";
  label: string;
  defaultTo: string;
  hint?: string;
  available: boolean;
};

export type EmailInvoiceSendPayload = {
  recipients: Array<{ kind: "customer" | "service_vendor"; to: string }>;
  subject: string;
  message: string;
  cc?: string;
};

type Props = {
  open: boolean;
  invoiceNumber: string;
  customerName: string;
  /** Optional balance/due for ST-style body defaults */
  balanceDue?: number | null;
  dueDate?: string | null;
  recipients: EmailInvoiceRecipient[];
  busy: boolean;
  error: string | null;
  success?: string | null;
  onClose: () => void;
  onSend: (payload: EmailInvoiceSendPayload) => void;
};

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function EmailInvoiceModal({
  open,
  invoiceNumber,
  customerName,
  balanceDue,
  dueDate,
  recipients,
  busy,
  error,
  success,
  onClose,
  onSend,
}: Props) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const customer = recipients.find((r) => r.kind === "customer");
  const vendor = recipients.find((r) => r.kind === "service_vendor");

  const defaultBody = useMemo(() => {
    const bal = money(balanceDue);
    const lines = [
      `Hello,`,
      ``,
      `Please find invoice ${invoiceNumber} for ${customerName} attached as a PDF.`,
    ];
    if (bal) lines.push(``, `Balance due: ${bal}${dueDate ? ` (due ${dueDate})` : ""}.`);
    lines.push(
      ``,
      `You can reply to this email or contact our office with any questions.`,
      ``,
      `Thank you,`,
      `EquipmentIQ Billing`,
    );
    return lines.join("\n");
  }, [invoiceNumber, customerName, balanceDue, dueDate]);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    setSubject(`Invoice ${invoiceNumber} from EquipmentIQ — ${customerName}`);
    setMessage(defaultBody);
    // Prefer customer email; fall back to vendor if only that is available
    const primary =
      (customer?.available && customer.defaultTo) ||
      (vendor?.available && vendor.defaultTo) ||
      customer?.defaultTo ||
      "";
    setTo(primary);
    setCc("");
  }, [open, invoiceNumber, customerName, defaultBody, customer, vendor]);

  if (!open) return null;

  function parseEmails(value: string): string[] {
    return value
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const tos = parseEmails(to);
    if (tos.length === 0) {
      setLocalError("Enter at least one recipient in To.");
      return;
    }
    for (const addr of tos) {
      if (!isValidEmail(addr)) {
        setLocalError(`Invalid email: ${addr}`);
        return;
      }
    }
    if (!subject.trim()) {
      setLocalError("Subject is required.");
      return;
    }

    // Map free-form To addresses to recipient kinds for the API
    // Prefer matching known customer/vendor addresses; extra To addresses go as customer.
    const list: EmailInvoiceSendPayload["recipients"] = [];
    const customerEmail = customer?.defaultTo?.trim().toLowerCase() ?? "";
    const vendorEmail = vendor?.defaultTo?.trim().toLowerCase() ?? "";

    for (const addr of tos) {
      const lower = addr.toLowerCase();
      if (vendorEmail && lower === vendorEmail && vendor?.available) {
        list.push({ kind: "service_vendor", to: addr });
      } else {
        list.push({ kind: "customer", to: addr });
      }
    }

    // If user typed only vendor and vendor available - already handled
    // Deduplicate by to+kind
    const seen = new Set<string>();
    const unique = list.filter((r) => {
      const k = `${r.kind}:${r.to.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    onSend({
      recipients: unique,
      subject: subject.trim(),
      message: message.trim(),
      cc: cc.trim() || undefined,
    });
  }

  function fillCustomer() {
    if (customer?.defaultTo) setTo(customer.defaultTo);
  }
  function fillVendor() {
    if (vendor?.defaultTo) setTo(vendor.defaultTo);
  }

  return (
    <dialog className="modal modal-open" open>
      <div className="modal-box flex max-h-[min(94dvh,52rem)] w-full max-w-3xl flex-col overflow-hidden p-0">
        {/* ST-style header bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-base-300 bg-secondary px-4 py-3 text-secondary-content sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Mail className="h-5 w-5 shrink-0 opacity-90" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70">
                Email invoice
              </p>
              <h3 className="truncate text-base font-bold leading-tight sm:text-lg">
                {invoiceNumber}
                <span className="font-normal opacity-80"> · {customerName}</span>
              </h3>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle text-secondary-content"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h4 className="text-lg font-bold">Email sent</h4>
            <p className="max-w-md text-sm opacity-70">{success}</p>
            <button type="button" className="btn btn-primary btn-sm mt-2" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
              {(error || localError) ? (
                <div className="alert alert-error m-4 rounded-lg py-2 text-sm">
                  {localError || error}
                </div>
              ) : null}

              {/* Quick recipient chips (ServiceTitan-style shortcuts) */}
              <div className="flex flex-wrap gap-2 border-b border-base-200 px-4 py-2.5 sm:px-5">
                <span className="self-center text-[11px] font-semibold uppercase tracking-wide opacity-45">
                  Quick To
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-xs gap-1"
                  disabled={!customer?.defaultTo || busy}
                  onClick={fillCustomer}
                  title={customer?.defaultTo || "No customer email on file"}
                >
                  Customer
                  {customer?.defaultTo ? (
                    <span className="opacity-60 max-w-[8rem] truncate">{customer.defaultTo}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-xs gap-1"
                  disabled={!vendor?.available || !vendor.defaultTo || busy}
                  onClick={fillVendor}
                  title={
                    !vendor?.available
                      ? vendor?.hint || "No service vendor"
                      : vendor.defaultTo || "No vendor email"
                  }
                >
                  Service vendor
                </button>
              </div>

              <label className="flex items-center gap-3 border-b border-base-200 px-4 py-2.5 sm:px-5">
                <span className="w-12 shrink-0 text-xs font-bold uppercase opacity-50">To</span>
                <input
                  type="text"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="customer@email.com"
                  disabled={busy}
                  autoFocus
                  required
                />
              </label>

              <label className="flex items-center gap-3 border-b border-base-200 px-4 py-2.5 sm:px-5">
                <span className="w-12 shrink-0 text-xs font-bold uppercase opacity-50">Cc</span>
                <input
                  type="text"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="Optional"
                  disabled={busy}
                />
              </label>

              <label className="flex items-center gap-3 border-b border-base-200 px-4 py-2.5 sm:px-5">
                <span className="w-12 shrink-0 text-xs font-bold uppercase opacity-50">Subject</span>
                <input
                  type="text"
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={busy}
                  required
                />
              </label>

              <div className="border-b border-base-200 px-4 py-2.5 sm:px-5">
                <div className="flex items-start gap-3 rounded-lg border border-dashed border-base-300 bg-base-200/40 px-3 py-2.5">
                  <Paperclip className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <FileText className="h-4 w-4 opacity-60" />
                      {invoiceNumber}.pdf
                    </p>
                    <p className="text-xs opacity-55">
                      Invoice PDF will be attached automatically when you send.
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-4 py-3 sm:px-5">
                <textarea
                  className="min-h-[12rem] w-full resize-y bg-transparent text-sm leading-relaxed outline-none"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy}
                  placeholder="Write your message…"
                  rows={10}
                />
              </div>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-base-300 bg-base-200/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary gap-2" disabled={busy}>
                {busy ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send email
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" disabled={busy} onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}
