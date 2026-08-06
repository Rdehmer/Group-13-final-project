"use client";

import type { ReactNode } from "react";
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
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
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
  if (!open) return null;

  const canSend = subject.trim().length > 0 && body.trim().length > 0;
  const messageRows = Math.max(10, body.split("\n").length + 1);

  return (
    <dialog className="modal modal-open" aria-labelledby="new-message-title">
      <div className="modal-box flex max-h-[92vh] w-full max-w-4xl flex-col border border-base-300 p-0 shadow-xl">
        <div className="border-b border-base-200 px-6 py-5 sm:px-8">
          <div className="flex items-start gap-3">
            <div className="rounded-box bg-primary/10 p-2.5 text-primary">
              <MessageSquarePlus className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="new-message-title" className="text-xl font-semibold tracking-tight">
                New message
              </h3>
              <p className="mt-1 max-w-prose text-sm leading-relaxed opacity-70">
                Send a message to Ridley Equipment Services. We typically respond within one business
                day.
              </p>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6 sm:px-8">
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

          <div className="grid gap-6 sm:grid-cols-2">
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
            hint={
              body.trim().startsWith("Hi Ridley team,")
                ? "Draft started for you — edit before sending."
                : undefined
            }
          >
            <textarea
              id="inbox-new-body"
              className="textarea textarea-bordered min-h-[18rem] w-full resize-y text-base leading-relaxed"
              rows={messageRows}
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              placeholder="Describe your question or what you need from our team…"
            />
          </Field>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-base-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-8">
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
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}
