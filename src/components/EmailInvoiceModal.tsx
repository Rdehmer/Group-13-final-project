"use client";

/**
 * Modal to email an invoice PDF to the customer and/or linked service vendor.
 */

import { useEffect, useState } from "react";
import { Mail, X } from "lucide-react";
import { FormRow } from "@/components/PageHeader";

export type EmailInvoiceRecipient = {
  kind: "customer" | "service_vendor";
  label: string;
  defaultTo: string;
  hint?: string;
  available: boolean;
};

type Props = {
  open: boolean;
  invoiceNumber: string;
  customerName: string;
  recipients: EmailInvoiceRecipient[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSend: (payload: {
    recipients: Array<{ kind: "customer" | "service_vendor"; to: string }>;
    subject: string;
    message: string;
  }) => void;
};

export function EmailInvoiceModal({
  open,
  invoiceNumber,
  customerName,
  recipients,
  busy,
  error,
  onClose,
  onSend,
}: Props) {
  const [subject, setSubject] = useState(`Invoice ${invoiceNumber} — ${customerName}`);
  const [message, setMessage] = useState(
    `Please find invoice ${invoiceNumber} attached as a PDF.`,
  );
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [toByKind, setToByKind] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setSubject(`Invoice ${invoiceNumber} — ${customerName}`);
    setMessage(`Please find invoice ${invoiceNumber} attached as a PDF.`);
    const nextSelected: Record<string, boolean> = {};
    const nextTo: Record<string, string> = {};
    for (const r of recipients) {
      nextSelected[r.kind] = r.available && Boolean(r.defaultTo);
      nextTo[r.kind] = r.defaultTo;
    }
    setSelected(nextSelected);
    setToByKind(nextTo);
  }, [open, invoiceNumber, customerName, recipients]);

  if (!open) return null;

  function submit() {
    const list = recipients
      .filter((r) => selected[r.kind])
      .map((r) => ({
        kind: r.kind,
        to: (toByKind[r.kind] ?? "").trim(),
      }));
    onSend({ recipients: list, subject: subject.trim(), message: message.trim() });
  }

  const anySelected = recipients.some((r) => selected[r.kind]);

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-bold text-lg">
              <Mail className="h-5 w-5" /> Email invoice
            </h3>
            <p className="text-sm opacity-70">
              Send {invoiceNumber} as a PDF to the customer and/or service vendor.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? <div className="alert alert-error mb-3 text-sm">{error}</div> : null}

        <div className="space-y-3">
          {recipients.map((r) => (
            <div key={r.kind} className="rounded-box border border-base-300 p-3">
              <label className="label cursor-pointer justify-start gap-3 py-0">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={Boolean(selected[r.kind])}
                  disabled={!r.available}
                  onChange={(e) =>
                    setSelected((prev) => ({ ...prev, [r.kind]: e.target.checked }))
                  }
                />
                <span className="label-text font-medium">{r.label}</span>
              </label>
              {!r.available ? (
                <p className="mt-1 text-xs text-warning">{r.hint ?? "Not available for this invoice."}</p>
              ) : (
                <FormRow label="To">
                  <input
                    type="email"
                    className="input input-bordered input-sm w-full"
                    value={toByKind[r.kind] ?? ""}
                    disabled={!selected[r.kind]}
                    onChange={(e) =>
                      setToByKind((prev) => ({ ...prev, [r.kind]: e.target.value }))
                    }
                    placeholder="name@example.com"
                  />
                </FormRow>
              )}
              {r.available && !r.defaultTo ? (
                <p className="mt-1 text-xs opacity-60">No saved email — enter one above.</p>
              ) : null}
            </div>
          ))}

          <FormRow label="Subject">
            <input
              className="input input-bordered input-sm w-full"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </FormRow>
          <FormRow label="Message">
            <textarea
              className="textarea textarea-bordered w-full text-sm"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </FormRow>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary gap-1"
            disabled={busy || !anySelected || !subject.trim()}
            onClick={submit}
          >
            {busy ? <span className="loading loading-spinner loading-sm" /> : <Mail className="h-4 w-4" />}
            Send email
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop" aria-label="Close" onClick={onClose} />
    </div>
  );
}
