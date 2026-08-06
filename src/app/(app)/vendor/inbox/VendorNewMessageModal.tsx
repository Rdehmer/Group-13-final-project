"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus } from "lucide-react";
import {
  VENDOR_INBOX_CATEGORIES,
  type VendorInboxCategory,
  type VendorSupplyOrderOption,
  type VendorWorkItemOption,
} from "./vendor-inbox-types";

type Props = {
  open: boolean;
  busy: boolean;
  workItems: VendorWorkItemOption[];
  supplyOrders: VendorSupplyOrderOption[];
  subject: string;
  category: VendorInboxCategory;
  workItemId: string;
  supplyOrderId: string;
  body: string;
  onSubjectChange: (value: string) => void;
  onCategoryChange: (value: VendorInboxCategory) => void;
  onWorkItemIdChange: (value: string) => void;
  onSupplyOrderIdChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

function Field({
  id,
  label,
  required,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className="block text-sm font-medium text-base-content">
        {label}
        {required ? <span className="text-error"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs leading-relaxed opacity-60">{hint}</p> : null}
    </div>
  );
}

export function VendorNewMessageModal({
  open,
  busy,
  workItems,
  supplyOrders,
  subject,
  category,
  workItemId,
  supplyOrderId,
  body,
  onSubjectChange,
  onCategoryChange,
  onWorkItemIdChange,
  onSupplyOrderIdChange,
  onBodyChange,
  onClose,
  onSubmit,
}: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

  if (!open || !mounted) return null;

  const canSend = subject.trim().length > 0 && body.trim().length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-new-message-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div className="customer-inbox-message-modal relative z-10 flex flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl">
        <div className="shrink-0 border-b border-base-200 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-box bg-primary/10 p-2.5 text-primary">
              <MessageSquarePlus className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="vendor-new-message-title" className="text-xl font-semibold tracking-tight">
                New message
              </h3>
              <p className="mt-1 text-sm leading-relaxed opacity-70">
                Send a message to EquipmentIQ about work, supplies, or billing.
              </p>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-6 py-5">
          <Field id="vendor-inbox-new-subject" label="Subject" required>
            <input
              id="vendor-inbox-new-subject"
              className="input input-bordered w-full"
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              placeholder="e.g. Question about a supply order"
              maxLength={120}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="vendor-inbox-new-category" label="Category">
              <select
                id="vendor-inbox-new-category"
                className="select select-bordered w-full"
                value={category}
                onChange={(e) => onCategoryChange(e.target.value as VendorInboxCategory)}
              >
                {VENDOR_INBOX_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>

            {workItems.length > 0 ? (
              <Field
                id="vendor-inbox-new-work-item"
                label="Related work item"
                hint="Link a work assignment for context."
              >
                <select
                  id="vendor-inbox-new-work-item"
                  className="select select-bordered w-full"
                  value={workItemId}
                  onChange={(e) => onWorkItemIdChange(e.target.value)}
                >
                  <option value="">None</option>
                  {workItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title} · {item.status}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>

          {supplyOrders.length > 0 ? (
            <Field
              id="vendor-inbox-new-supply-order"
              label="Related supply order"
              hint="Link a parts or supplies order for context."
            >
              <select
                id="vendor-inbox-new-supply-order"
                className="select select-bordered w-full"
                value={supplyOrderId}
                onChange={(e) => onSupplyOrderIdChange(e.target.value)}
              >
                <option value="">None</option>
                {supplyOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.item_name} · {order.status}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field id="vendor-inbox-new-body" label="Message" required className="flex min-h-0 flex-1 flex-col">
            <textarea
              id="vendor-inbox-new-body"
              className="textarea textarea-bordered min-h-[12rem] flex-1 w-full resize-none overflow-y-auto text-base leading-relaxed"
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              placeholder="Describe your question or what you need from our team…"
            />
          </Field>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-base-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary min-w-[9rem]"
            disabled={busy || !canSend}
            onClick={onSubmit}
          >
            {busy ? <span className="loading loading-spinner loading-sm" /> : "Send message"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
