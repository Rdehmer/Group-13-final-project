"use client";

import { INVOICE_STATUSES } from "@/lib/billing";
import type { Profile } from "@/lib/types";

type TeamMember = Pick<Profile, "id" | "full_name" | "email" | "role">;

/**
 * Status + assignee controls for invoices (list preview and detail page).
 */
export function InvoiceWorkflowControls({
  status,
  assignedTo,
  team,
  busy,
  onStatusChange,
  onAssignChange,
  compact,
}: {
  status: string;
  assignedTo: string | null | undefined;
  team: TeamMember[];
  busy?: boolean;
  onStatusChange: (status: string) => void;
  onAssignChange: (userId: string | null) => void;
  compact?: boolean;
}) {
  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
      <label className="form-control w-full">
        <span className="label-text mb-1 text-xs font-medium opacity-70">Status</span>
        <select
          className="select select-bordered select-sm w-full"
          value={INVOICE_STATUSES.includes(status as (typeof INVOICE_STATUSES)[number]) ? status : status}
          onChange={(e) => onStatusChange(e.target.value)}
          disabled={busy}
        >
          {!INVOICE_STATUSES.includes(status as (typeof INVOICE_STATUSES)[number]) && status ? (
            <option value={status}>{status}</option>
          ) : null}
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
