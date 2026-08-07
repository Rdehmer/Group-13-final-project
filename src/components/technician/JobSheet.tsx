"use client";

/**
 * My Day job sheet: header → Dispatch steps → Parts (In Progress only) → diagnostic notes.
 * Status changes use applyDispatchStatusTransition (same time/billing path as /dispatch).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Phone, Timer } from "lucide-react";
import { StatusBadge, statusTone } from "@/components/ui";
import { ProofOfCompletion } from "@/components/ProofOfCompletion";
import { VoiceDiagnosticNotes } from "@/components/technician/VoiceDiagnosticNotes";
import { TechPartsLogger } from "@/components/technician/TechPartsLogger";
import { PurchaseOrderPanel } from "@/components/PurchaseOrderPanel";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import {
  canPauseDispatch,
  dispatchStatusTone,
  getNextDispatchStatus,
  getPreviousDispatchStatus,
  isDispatchInProgress,
  normalizeDispatchStatus,
  type DispatchStatus,
} from "@/lib/dispatch-flow";
import {
  customerName,
  formatCustomerPhone,
  formatDiagnosticNotes,
  humanizeFieldError,
  isOutOfScope,
  jobAddress,
  jobPhone,
  jobTimeLabel,
  mapsDirectionsUrl,
  parseDiagnosticNotes,
  priorityBarClass,
  telHref,
  type FieldJob,
} from "@/lib/technician-field";
import { markWorkOrderOutsideContract, splitPartCharges } from "@/lib/coverage";
import type { Part, Profile, WorkOrderPart } from "@/lib/types";
import {
  applyDispatchStatusTransition,
  clockOutIfActive,
  timesheetHref,
  todayIso,
  markWorkOrderTimeReadyToBill,
  type DispatchFlowStatus,
} from "@/lib/timesheets";

type Props = {
  job: FieldJob;
  profile: Profile;
  catalogParts: Part[];
  usedParts: (WorkOrderPart & { parts?: Part | null })[];
  onBack: () => void;
  onRefresh: () => Promise<void>;
};

export function JobSheet({
  job,
  profile,
  catalogParts,
  usedParts,
  onBack,
  onRefresh,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCustomerPhone, setShowCustomerPhone] = useState(false);
  const [showProof, setShowProof] = useState(false);
  const [scopePending, setScopePending] = useState(false);
  const [pendingPart, setPendingPart] = useState<{ partId: string; quantity: number } | null>(
    null,
  );
  const diagnostics = parseDiagnosticNotes(job);
  const [notes, setNotes] = useState(diagnostics);

  const address = jobAddress(job);
  const phone = jobPhone(job);
  const dispatchStatus = job.dispatch_status ?? "Not Started";
  const current = normalizeDispatchStatus(dispatchStatus);
  const nextStatus = getNextDispatchStatus(dispatchStatus);
  const previousStatus = getPreviousDispatchStatus(dispatchStatus);
  const showPause = canPauseDispatch(dispatchStatus);
  const inProgress = isDispatchInProgress(dispatchStatus);
  const done = current === "Done" || ["Completed", "Closed"].includes(job.status);

  useEffect(() => {
    setNotes(parseDiagnosticNotes(job));
  }, [job.id, job.technician_notes, job.work_performed, job.equipment_condition]);

  async function runStatus(status: DispatchStatus) {
    if (busy || done) return;

    if (status === "Done") {
      setError(null);
      setMessage(null);
      setBusy(true);
      try {
        try {
          await clockOutIfActive(supabase, {
            profile,
            notes: "Dispatch → Done",
            skipWorkOrderDispatchUpdate: true,
          });
        } catch {
          /* best-effort */
        }
        setShowProof(true);
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await applyDispatchStatusTransition(supabase, {
        profile,
        workOrderId: job.id,
        workOrderNumber: job.work_order_number,
        nextStatus: status as DispatchFlowStatus,
      });
      await logActivity(supabase, {
        userId: profile.id,
        action: "dispatch_status_change",
        recordType: "work_order",
        recordId: job.id,
        previousValue: job.dispatch_status,
        newValue: result.dispatchStatus,
      });
      setMessage(result.message);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function onProofCompleted() {
    setShowProof(false);
    setBusy(true);
    setError(null);
    try {
      const { data: woBilling } = await supabase
        .from("work_orders")
        .select("billing_status")
        .eq("id", job.id)
        .maybeSingle();
      if ((woBilling as { billing_status?: string } | null)?.billing_status !== "Billed") {
        await supabase
          .from("work_orders")
          .update({ billing_status: "Unbilled", updated_at: new Date().toISOString() })
          .eq("id", job.id);
      }
      try {
        await markWorkOrderTimeReadyToBill(supabase, job.id, profile.id);
      } catch {
        /* best-effort — UI still keys off completed WO */
      }
      await logActivity(supabase, {
        userId: profile.id,
        action: "dispatch_status_change",
        recordType: "work_order",
        recordId: job.id,
        previousValue: job.dispatch_status,
        newValue: "Done",
      });
      setMessage(`${job.work_order_number} marked complete — available for billing.`);
      await onRefresh();
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function logPart(partId: string, quantity: number, options?: { acknowledgedOutOfScope?: boolean }) {
    if (!inProgress) {
      setError("Parts unlock when the job is In Progress.");
      return;
    }
    const part = catalogParts.find((p) => p.id === partId);
    if (!part) return;
    if (isOutOfScope(job, "part") && !options?.acknowledgedOutOfScope && !scopePending) {
      setPendingPart({ partId, quantity });
      setScopePending(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const forceBillable =
        Boolean(options?.acknowledgedOutOfScope) || isOutOfScope(job, "part");
      if (forceBillable && job.contract_id && !job.outside_contract) {
        await markWorkOrderOutsideContract(supabase, job.id, {
          reason: "Out-of-scope part used in field",
        });
      }
      const split = splitPartCharges({
        quantity,
        unitPrice: part.standard_customer_price,
        job: {
          contract_id: job.contract_id,
          warranty_coverage: job.warranty_coverage,
          outside_contract: forceBillable || job.outside_contract,
          under_expired_contract: job.under_expired_contract,
          work_order_type: job.work_order_type,
        },
        forceBillable,
      });
      const { error: insertError } = await supabase.from("work_order_parts").insert({
        work_order_id: job.id,
        part_id: partId,
        quantity_used: quantity,
        unit_cost: part.unit_cost,
        customer_price: part.standard_customer_price,
        warranty_covered_amount: split.warranty_covered_amount,
        billable_amount: split.billable_amount,
        invoiced: false,
        date_used: todayIso(),
      });
      if (insertError) throw new Error(insertError.message);
      await supabase
        .from("parts")
        .update({ quantity_on_hand: Math.max(0, part.quantity_on_hand - quantity) })
        .eq("id", partId);
      await logActivity(supabase, {
        userId: profile.id,
        action: "part_used",
        recordType: "work_order",
        recordId: job.id,
        newValue: `${part.name} x${quantity}${forceBillable ? " (out of scope)" : " (covered)"}`,
      });
      setScopePending(false);
      setPendingPart(null);
      setMessage(
        forceBillable
          ? `Logged ${quantity}× ${part.name} as billable (out of scope)`
          : `Logged ${quantity}× ${part.name} as covered (not charged)`,
      );
      await onRefresh();
    } catch (err) {
      setError(humanizeFieldError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    setBusy(true);
    setError(null);
    try {
      const payload = formatDiagnosticNotes(notes);
      const { error: updateError } = await supabase
        .from("work_orders")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      if (updateError) throw new Error(updateError.message);
      setMessage("Notes saved");
      await onRefresh();
    } catch (err) {
      setError(humanizeFieldError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-24">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm min-h-11 gap-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          My Day
        </button>
        <Link
          href={timesheetHref({ wo: job.id, tech: profile.id, week: todayIso() })}
          className="btn btn-ghost btn-sm min-h-11 gap-1 ml-auto"
        >
          <Timer className="h-4 w-4" />
          Timesheet
        </Link>
      </div>

      <header className="space-y-3 rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm">
        <div className={`h-1.5 w-full rounded-full ${priorityBarClass(job.priority)}`} aria-hidden />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide opacity-60">
            {job.work_order_number}
          </span>
          <StatusBadge label={job.priority} tone={statusTone(job.priority)} />
          <StatusBadge label={current} tone={dispatchStatusTone(current)} />
        </div>
        <h1 className="text-xl font-bold leading-tight">{customerName(job)}</h1>
        <p className="text-sm opacity-70">{jobTimeLabel(job)}</p>
        {address ? (
          <a
            href={mapsDirectionsUrl(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 text-sm text-primary"
          >
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{address}</span>
          </a>
        ) : null}
        {phone ? (
          showCustomerPhone ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
              <Phone className="h-4 w-4 shrink-0 text-primary" />
              <a href={telHref(phone)} className="font-semibold tabular-nums text-primary">
                {formatCustomerPhone(phone)}
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setShowCustomerPhone(false)}
              >
                Hide
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-sm min-h-11 gap-1"
              onClick={() => setShowCustomerPhone(true)}
            >
              <Phone className="h-4 w-4" />
              Call customer
            </button>
          )
        ) : null}
        <p className="text-sm leading-snug">
          {job.problem_description || job.requested_service || "No problem description"}
        </p>
      </header>

      {error ? (
        <div role="alert" className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      ) : null}
      {message ? (
        <div role="status" className="alert alert-success text-sm">
          <span>{message}</span>
        </div>
      ) : null}

      {scopePending ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-semibold">Out-of-scope part</p>
          <p className="mt-1 opacity-80">
            This part may not be covered by the contract. Continue to log it as used?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-warning btn-sm"
              disabled={busy || !pendingPart}
              onClick={() => {
                if (pendingPart) {
                  void logPart(pendingPart.partId, pendingPart.quantity, {
                    acknowledgedOutOfScope: true,
                  });
                }
              }}
            >
              Log as billable (out of scope)
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setScopePending(false);
                setPendingPart(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-base-300 bg-base-100 p-4" aria-labelledby="dispatch-steps-heading">
        <h2 id="dispatch-steps-heading" className="text-base font-semibold">
          Dispatch steps
        </h2>
        <p className="text-sm opacity-70">
          {done
            ? "Job complete"
            : nextStatus
              ? "Next step"
              : "Marked Done"}
        </p>
        <div className="flex flex-col gap-2">
          {done ? (
            <p className="rounded-box bg-success/10 px-3 py-2 text-sm font-medium text-success">
              Completed — available for billing.
            </p>
          ) : nextStatus ? (
            <button
              type="button"
              className="btn btn-primary min-h-14 text-base"
              disabled={busy}
              onClick={() => void runStatus(nextStatus)}
            >
              {current === "Paused"
                ? `Resume — ${nextStatus}`
                : nextStatus === "Done"
                  ? "Done — customer sign-off"
                  : nextStatus}
            </button>
          ) : (
            <p className="rounded-box bg-success/10 px-3 py-2 text-sm font-medium text-success">
              Marked Done.
            </p>
          )}

          {showPause && !done ? (
            <button
              type="button"
              className="btn btn-outline min-h-12"
              disabled={busy}
              onClick={() => void runStatus("Paused")}
            >
              Paused
            </button>
          ) : null}

          {previousStatus && !done ? (
            <button
              type="button"
              className="btn btn-ghost min-h-12 gap-2 border border-base-300"
              disabled={busy}
              onClick={() => void runStatus(previousStatus)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Go back to {previousStatus}
            </button>
          ) : !done && !previousStatus ? (
            <p className="text-xs opacity-60">Starts with En Route — no earlier status to undo.</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-base-300 bg-base-100 p-4" aria-labelledby="parts-heading">
        <h2 id="parts-heading" className="text-base font-semibold">
          Parts used
        </h2>
        {inProgress ? (
          <TechPartsLogger
            catalogParts={catalogParts}
            usedParts={usedParts}
            busy={busy}
            compact
            onLog={(partId, quantity) => void logPart(partId, quantity)}
          />
        ) : (
          <p className="text-sm opacity-60">Parts unlock when the job is In Progress.</p>
        )}
      </section>

      <section
        className="space-y-3 rounded-2xl border border-base-300 bg-base-100 p-4"
        aria-labelledby="po-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="po-heading" className="text-base font-semibold">
            Purchase orders
          </h3>
          <Link href={`/work-orders/${job.id}`} className="link link-hover text-xs">
            Open full job
          </Link>
        </div>
        <p className="text-xs opacity-60">
          Log field POs and receipts. When this job is invoiced, the PO number opens that invoice in Billing.
        </p>
        <PurchaseOrderPanel workOrderId={job.id} canEdit compact />
      </section>

      <section className="space-y-3 rounded-2xl border border-base-300 bg-base-100 p-4" aria-labelledby="notes-heading">
        <h2 id="notes-heading" className="text-base font-semibold">
          Diagnostic notes
        </h2>
        <VoiceDiagnosticNotes
          symptom={notes.symptom}
          cause={notes.cause}
          action={notes.action}
          onChange={setNotes}
          onSave={() => void saveNotes()}
          busy={busy || done}
        />
      </section>

      {showProof ? (
        <ProofOfCompletion
          jobId={job.id}
          technicianId={profile.id}
          requirement={job.completion_proof_requirement ?? "photo_or_signature"}
          onCancel={() => setShowProof(false)}
          onCompleted={() => void onProofCompleted()}
        />
      ) : null}
    </div>
  );
}
