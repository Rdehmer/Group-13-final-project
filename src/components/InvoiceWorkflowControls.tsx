"use client";

import { isPaymentDrivenStatus, INVOICE_STATUSES } from "@/lib/billing";
import type { Profile } from "@/lib/types";

type TeamMember = Pick<Profile, "id" | "full_name" | "email" | "role">;

/**
 * Status + assignee controls for invoices (list preview and detail page).
 * Status auto-syncs from payments / balance (Paid · Partially Paid) while
 * remaining fully editable for manual workflow changes.
 */
export function InvoiceWorkflowControls({
  status,
  assignedTo,
  team,
  busy,
  onStatusChange,
  onAssignChange,
  compact,
  /** When true, show that AR auto-sync is active for this status. */
  autoHint = true,
}: {
  status: string;
  assignedTo: string | null | undefined;
  team: TeamMember[];
  busy?: boolean;
  onStatusChange: (status: string) => void;
  onAssignChange: (userId: string | null) => void;
  compact?: boolean;
  autoHint?: boolean;
}) {
  const paymentDriven = isPaymentDrivenStatus(status);
  const known = INVOICE_STATUSES.includes(status as (typeof INVOICE_STATUSES)[number]);

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
      <label className="form-control w-full">
        <span className="label-text mb-1 flex flex-wrap items-center gap-1.5 text-xs font-medium opacity-70">
          Status
          {paymentDriven ? (
            <span className="badge badge-success badge-xs font-normal normal-case">Auto · payments</span>
          ) : null}
        </span>
        <select
          className="select select-bordered select-sm w-full"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          disabled={busy}
          aria-describedby={autoHint ? "invoice-status-hint" : undefined}
        >
          {!known && status ? <option value={status}>{status}</option> : null}
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {autoHint && !compact ? (
          <span id="invoice-status-hint" className="mt-1 block text-[11px] leading-snug opacity-55">
            Updates automatically when you record payments or clear the balance. Change it anytime for
            workflow (Draft → Sent, On Hold, etc.).
          </span>
        ) : null}
      </label>
      <label className="form-control w-full">
        <span className="label-text mb-1 text-xs font-medium opacity-70">Assigned to</span>
        <select
          className="select select-bordered select-sm w-full"
          value={assignedTo ?? ""}
          onChange={(e) => onAssignChange(e.target.value || null)}
          disabled={busy}
        >
          <option value="">Unassigned</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name || m.email}
              {m.role ? ` (${m.role.replace("_", " ")})` : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
