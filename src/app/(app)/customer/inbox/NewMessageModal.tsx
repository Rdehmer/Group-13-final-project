"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus } from "lucide-react";
import { INBOX_CATEGORIES, type InboxCategory, type WorkOrderOption } from "./inbox-types";

type Props = {
  open: boolean;
  busy: boolean;
  workOrders: WorkOrderOption[];
  subject: string;
  category: InboxCategory;
  workOrderId: string;
  body: string;
  onSubjectChange: (value: string) => void;
  onCategoryChange: (value: InboxCategory) => void;
  onWorkOrderIdChange: (value: string) => void;
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

export function NewMessageModal({
  open,
  busy,
  workOrders,
  subject,
  category,
  workOrderId,
  body,
  onSubjectChange,
  onCategoryChange,
  onWorkOrderIdChange,
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
      aria-labelledby="new-message-title"
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
              <h3 id="new-message-title" className="text-xl font-semibold tracking-tight">
                New message
              </h3>
              <p className="mt-1 text-sm leading-relaxed opacity-70">
                Send a message to EquipmentIQ. We typically respond within one business
                day.
              </p>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-6 py-5">
          <Field id="inbox-new-subject" label="Subject" required>
            <input
              id="inbox-new-subject"
              className="input input-bordered w-full"
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              placeholder="e.g. Question about my invoice"
              maxLength={120}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="inbox-new-category" label="Category">
              <select
                id="inbox-new-category"
                className="select select-bordered w-full"
                value={category}
                onChange={(e) => onCategoryChange(e.target.value as InboxCategory)}
              >
                {INBOX_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>

            {workOrders.length > 0 ? (
              <Field
                id="inbox-new-work-order"
                label="Related job"
                hint="Link a service request so our team has full context."
              >
                <select
                  id="inbox-new-work-order"
                  className="select select-bordered w-full"
                  value={workOrderId}
                  onChange={(e) => onWorkOrderIdChange(e.target.value)}
                >
                  <option value="">None</option>
                  {workOrders.map((wo) => (
                    <option key={wo.id} value={wo.id}>
                      {wo.work_order_number} · {wo.work_order_type}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>

          <Field
            id="inbox-new-body"
            label="Message"
            required
            className="flex min-h-0 flex-1 flex-col"
            hint={
              body.trim().startsWith("Hi EquipmentIQ team,")
                ? "Draft started for you — edit before sending."
                : undefined
            }
          >
            <textarea
              id="inbox-new-body"
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
