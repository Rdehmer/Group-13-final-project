"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  MapPin,
  Phone,
  Play,
  Timer,
} from "lucide-react";
import { StatusBadge, statusTone } from "@/components/ui";
import { ProofOfCompletion } from "@/components/ProofOfCompletion";
import { VoiceDiagnosticNotes } from "@/components/technician/VoiceDiagnosticNotes";
import { TechPartsLogger } from "@/components/technician/TechPartsLogger";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import {
  TIMESHEET_ACTIVITIES,
  customerName,
  formatDiagnosticNotes,
  formatElapsedLabel,
  formatLaborClock,
  formatTimesheetNotes,
  hoursFromTimeRange,
  humanizeFieldError,
  isOpenJob,
  isOutOfScope,
  jobAddress,
  formatCustomerPhone,
  jobPhone,
  jobTimeLabel,
  laborClockRange,
  mapsDirectionsUrl,
  nextChecklistStep,
  nextStepLabel,
  nowTimeInput,
  parseDiagnosticNotes,
  priorityBarClass,
  splitRegularOt,
  telHref,
  timesheetActivityLabel,
  toDbTime,
  todayIso,
  type FieldJob,
  type TimesheetActivity,
} from "@/lib/technician-field";
import type { Part, Profile, TechnicianLabor, TimeActivityType, TimeEntry, WorkOrderPart } from "@/lib/types";
import {
  clockIn,
  clockOut,
  createManualEntry,
  getActiveClock,
  isTimesheetMissingTable,
  localDateTimeToIso,
  ACTIVITY_TYPES,
} from "@/lib/timesheets";

type Props = {
  job: FieldJob;
  profile: Profile;
  /** Shared Parts catalog (managers / Parts tab). */
  catalogParts: Part[];
  usedParts: (WorkOrderPart & { parts?: Part | null })[];
  laborRows: TechnicianLabor[];
  /** Other open jobs (for dual Working warning). */
  otherOpenJobs?: FieldJob[];
  onBack: () => void;
  /** Switch to another assigned job without going home. */
  onSwitchJob?: (jobId: string) => void;
  onRefresh: () => Promise<void>;
};

function toLocalTime(iso: string): string {
  return format(new Date(iso), "HH:mm:ss");
}

function laborPayload(
  profile: Profile,
  job: FieldJob,
  fields: {
    work_date: string;
    start_time: string;
    end_time: string;
    regular_hours: number;
    overtime_hours: number;
    notes: string | null;
  },
) {
  const rate = profile.hourly_cost_rate ?? 45;
  const billing = profile.hourly_billing_rate ?? 95;
  return {
    work_order_id: job.id,
    technician_id: profile.id,
    work_date: fields.work_date,
    start_time: fields.start_time,
    end_time: fields.end_time,
    regular_hours: fields.regular_hours,
    overtime_hours: fields.overtime_hours,
    hourly_cost_rate: rate,
    overtime_cost_rate: rate * 1.5,
    customer_billing_rate: billing,
    billable_status: isOutOfScope(job, "labor") ? "Billable" : "Contract Included",
    notes: fields.notes,
  };
}

export function JobSheet({
  job,
  profile,
  catalogParts,
  usedParts,
  laborRows,
  otherOpenJobs = [],
  onBack,
  onSwitchJob,
  onRefresh,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCustomerPhone, setShowCustomerPhone] = useState(false);
  const [showProof, setShowProof] = useState(false);
  const [activeClock, setActiveClock] = useState<TimeEntry | null>(null);
  const [teActivity, setTeActivity] = useState<TimeActivityType>("regular_work");
  const address = jobAddress(job);
  const phone = jobPhone(job);
  const dualWorking = otherOpenJobs.filter(
    (j) =>
      isOpenJob(j) &&
      (j.dispatch_status === "Working" ||
        (Boolean(j.started_at) && nextChecklistStep(j) === "complete")),
  );
  const [scopePending, setScopePending] = useState<"part" | "labor" | "manual-labor" | null>(null);
  const [scopeAck, setScopeAck] = useState(false);
  const diagnostics = parseDiagnosticNotes(job);
  const [notes, setNotes] = useState(diagnostics);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [activity, setActivity] = useState<TimesheetActivity>("Working");
  const [laborDate, setLaborDate] = useState(job.scheduled_date || todayIso());
  const [laborStart, setLaborStart] = useState(() => nowTimeInput());
  const [laborEnd, setLaborEnd] = useState("");
  const [laborNotes, setLaborNotes] = useState("");
  const [elapsedTick, setElapsedTick] = useState(() => new Date());
  const [pendingPart, setPendingPart] = useState<{ partId: string; quantity: number } | null>(null);

  const step = nextChecklistStep(job);
  const workingOpen = Boolean(job.started_at) && step === "complete";
  const spanHours = laborEnd ? hoursFromTimeRange(laborStart, laborEnd) : null;

  const primary = nextStepLabel(step);

  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 4_500);
    return () => window.clearTimeout(id);
  }, [message]);

  useEffect(() => {
    // Reset local form noise when switching jobs
    setError(null);
    setMessage(null);
    setPendingPart(null);
    setScopePending(null);
    setScopeAck(false);
    setShowAddEntry(false);
    setShowProof(false);
    setShowCustomerPhone(false);
    setNotes(parseDiagnosticNotes(job));
    resetAddEntryForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally when job.id changes
  }, [job.id]);

  useEffect(() => {
    if (!workingOpen) return;
    const id = window.setInterval(() => setElapsedTick(new Date()), 1_000);
    return () => window.clearInterval(id);
  }, [workingOpen]);

  useEffect(() => {
    void (async () => {
      try {
        const row = await getActiveClock(supabase, profile.id);
        setActiveClock(row);
      } catch {
        setActiveClock(null);
      }
    })();
  }, [supabase, profile.id, job.id, job.started_at]);

  function resetAddEntryForm() {
    setActivity("Working");
    setLaborDate(job.scheduled_date || todayIso());
    setLaborStart(nowTimeInput());
    setLaborEnd("");
    setLaborNotes("");
  }

  async function markStep(action: "arrived" | "working") {
    setBusy(true);
    setError(null);
    setMessage(null);
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now, status: "In Progress" };

    if (action === "arrived") {
      updates.arrival_at = now;
      updates.dispatch_status = "Arrived";
      updates.dispatch_updated_at = now;
    } else {
      if (isOutOfScope(job, "labor") && !scopeAck) {
        setScopePending("labor");
        setBusy(false);
        return;
      }
      // ServiceTitan-style: Arrive/In Progress opens a Working timesheet (no row until Complete).
      updates.started_at = now;
      updates.paused_at = null;
      updates.dispatch_status = "Working";
      updates.dispatch_updated_at = now;
    }

    if (action === "working" && dualWorking.length > 0) {
      setMessage(
        `Note: you still have Working open on ${dualWorking.map((j) => j.work_order_number).join(", ")}. Complete those to keep timesheets accurate.`,
      );
    }

    const { error: updateError } = await supabase.from("work_orders").update(updates).eq("id", job.id);
    if (updateError) {
      setError(humanizeFieldError(updateError.message));
      setBusy(false);
      return;
    }

    if (action === "working") {
      try {
        const entry = await clockIn(supabase, {
          profile,
          workOrderId: job.id,
          activityType: teActivity,
          notes: "Field clock-in",
        });
        setActiveClock(entry);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Clock-in failed.";
        if (!isTimesheetMissingTable(msg)) {
          // WO still started; surface clock error so tech can resolve double-active
          setError(humanizeFieldError(msg));
          setBusy(false);
          await onRefresh();
          return;
        }
      }
    }

    await logActivity(supabase, {
      userId: profile.id,
      action: action === "arrived" ? "arrival" : "start",
      recordType: "work_order",
      recordId: job.id,
      newValue: String(updates.dispatch_status),
    });

    setScopePending(null);
    setScopeAck(false);
    setMessage(
      action === "arrived"
        ? "Arrived stamped."
        : dualWorking.length > 0
          ? `Clocked in / Working. Note: still open on ${dualWorking.map((j) => j.work_order_number).join(", ")}.`
          : "Currently clocked in — Complete or Clock out to finish.",
    );
    await onRefresh();
    setBusy(false);
  }

  async function logManualLabor(acknowledged: boolean) {
    if (!laborEnd) {
      setError("Enter an end time for this timesheet entry.");
      return;
    }
    if (spanHours == null) {
      setError("End time must be after start time.");
      return;
    }
    if (isOutOfScope(job, "labor") && !acknowledged) {
      setScopePending("manual-labor");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Map legacy field activities to time_entries categories
      const map: Record<TimesheetActivity, TimeActivityType> = {
        Working: "regular_work",
        Travel: "travel",
        "Meal Break": "break",
        Other: "admin_nonbillable",
      };
      await createManualEntry(supabase, {
        profile,
        workOrderId: job.id,
        entryDate: laborDate || todayIso(),
        clockInLocal: localDateTimeToIso(laborDate || todayIso(), laborStart),
        clockOutLocal: localDateTimeToIso(laborDate || todayIso(), laborEnd),
        activityType: map[activity] ?? "regular_work",
        notes: laborNotes || formatTimesheetNotes(activity, laborNotes),
        reason: "Manual entry from field Job Sheet",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save entry.";
      // Fallback to legacy technician_labor if table missing
      if (isTimesheetMissingTable(msg)) {
        const { regular_hours, overtime_hours } = splitRegularOt(spanHours);
        const { error: insertError } = await supabase.from("technician_labor").insert(
          laborPayload(profile, job, {
            work_date: laborDate || todayIso(),
            start_time: toDbTime(laborStart),
            end_time: toDbTime(laborEnd),
            regular_hours,
            overtime_hours,
            notes: formatTimesheetNotes(activity, laborNotes),
          }),
        );
        if (insertError) {
          setError(humanizeFieldError(insertError.message));
          setBusy(false);
          return;
        }
      } else {
        setError(humanizeFieldError(msg));
        setBusy(false);
        return;
      }
    }

    resetAddEntryForm();
    setShowAddEntry(false);
    setScopePending(null);
    setScopeAck(false);
    setMessage("Timesheet entry saved (pending approval if manual).");
    await onRefresh();
    setBusy(false);
  }

  async function logWarehousePart(
    partIdToLog: string,
    quantity: number,
    acknowledged: boolean,
  ) {
    const part = catalogParts.find((p) => p.id === partIdToLog);
    if (!part) {
      setError("Choose a part from the Parts catalog.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      setError("Enter a quantity of at least 1.");
      return;
    }
    if (part.quantity_on_hand < quantity) {
      setError(
        `Not enough warehouse stock for ${part.name} (on hand: ${part.quantity_on_hand}). Open Parts to request restock.`,
      );
      return;
    }
    if (isOutOfScope(job, "part") && !acknowledged) {
      setPendingPart({ partId: partIdToLog, quantity });
      setScopePending("part");
      return;
    }

    setBusy(true);
    setError(null);
    const billable = part.standard_customer_price * quantity;
    const { error: insertError } = await supabase.from("work_order_parts").insert({
      work_order_id: job.id,
      part_id: part.id,
      quantity_used: quantity,
      unit_cost: part.unit_cost,
      customer_price: part.standard_customer_price,
      warranty_covered_amount: 0,
      billable_amount: billable,
      invoiced: false,
      date_used: todayIso(),
    });
    if (insertError) {
      setError(humanizeFieldError(insertError.message));
      setBusy(false);
      return;
    }
    const { error: stockError } = await supabase
      .from("parts")
      .update({ quantity_on_hand: part.quantity_on_hand - quantity })
      .eq("id", part.id);
    if (stockError) {
      setError(
        humanizeFieldError(
          `Part logged but stock update failed: ${stockError.message}. Tell a manager to check inventory.`,
        ),
      );
      setBusy(false);
      await onRefresh();
      return;
    }

    await logActivity(supabase, {
      userId: profile.id,
      action: "part_used",
      recordType: "work_order",
      recordId: job.id,
      newValue: `${part.name} × ${quantity} (warehouse)`,
    });

    setPendingPart(null);
    setScopePending(null);
    setScopeAck(false);
    setMessage(`${part.name} × ${quantity} logged · warehouse ${part.quantity_on_hand - quantity} left`);
    await onRefresh();
    setBusy(false);
  }

  async function burnPart(acknowledged: boolean) {
    if (pendingPart) {
      await logWarehousePart(pendingPart.partId, pendingPart.quantity, acknowledged);
      return;
    }
  }

  async function saveNotes() {
    setBusy(true);
    setError(null);
    const payload = formatDiagnosticNotes(notes);
    const { error: updateError } = await supabase
      .from("work_orders")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    if (updateError) {
      setError(humanizeFieldError(updateError.message));
      setBusy(false);
      return;
    }
    setMessage("Diagnostic notes saved.");
    await onRefresh();
    setBusy(false);
  }

  async function finalizeWorkingLabor(): Promise<string | null> {
    if (!job.started_at) return null;
    const clock = laborClockRange(job.started_at);
    const split = splitRegularOt(clock.hours);
    const { error: insertError } = await supabase.from("technician_labor").insert(
      laborPayload(profile, job, {
        work_date: clock.work_date,
        start_time: clock.start_time,
        end_time: clock.end_time,
        regular_hours: split.regular_hours,
        overtime_hours: split.overtime_hours,
        notes: "Working",
      }),
    );
    if (insertError) return humanizeFieldError(insertError.message);

    // Clear open Working stamp so a second Complete does not re-insert the same window.
    const { error: clearError } = await supabase
      .from("work_orders")
      .update({
        started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return clearError ? humanizeFieldError(clearError.message) : null;
  }

  async function runComplete() {
    setBusy(true);
    setError(null);
    try {
      // Prefer modern time_entries clock-out
      const open = await getActiveClock(supabase, profile.id);
      if (open && open.work_order_id === job.id) {
        await clockOut(supabase, { profile, entryId: open.id });
        setActiveClock(null);
      } else if (job.started_at) {
        const laborErr = await finalizeWorkingLabor();
        if (laborErr) {
          setError(`Could not close Working timesheet: ${laborErr}`);
          setBusy(false);
          return;
        }
      } else {
        setError("Clock in (In Progress) before completing labor.");
        setBusy(false);
        return;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Clock-out failed.";
      if (isTimesheetMissingTable(msg) && job.started_at) {
        const laborErr = await finalizeWorkingLabor();
        if (laborErr) {
          setError(laborErr);
          setBusy(false);
          return;
        }
      } else {
        setError(humanizeFieldError(msg));
        setBusy(false);
        return;
      }
    }
    await onRefresh();
    setBusy(false);
    setShowProof(true);
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 pb-32">
      <button type="button" className="btn btn-ghost min-h-12 justify-start gap-2 px-1" onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />
        Back to My Day
      </button>

      <article className="overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
        <div className={`h-2 w-full ${priorityBarClass(job.priority)}`} aria-hidden />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{job.work_order_number}</p>
              <h2 className="text-xl font-bold leading-tight">{customerName(job)}</h2>
            </div>
            <StatusBadge label={job.status} tone={statusTone(job.status)} />
          </div>
          <p className="flex items-center gap-2 text-sm opacity-80">
            <Clock3 className="h-4 w-4 shrink-0" />
            {jobTimeLabel(job)}
          </p>
          {address ? (
            <p className="flex items-start gap-2 text-sm opacity-80">
              <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
              {address}
            </p>
          ) : null}
          {(phone || address) && (
            <div className="flex flex-wrap items-center gap-2">
              {phone ? (
                showCustomerPhone ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                    <Phone className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide opacity-60">Customer number</p>
                      <a
                        href={telHref(phone)}
                        className="block whitespace-nowrap text-base font-semibold tabular-nums tracking-wide text-primary underline-offset-2 hover:underline"
                      >
                        {formatCustomerPhone(phone)}
                      </a>
                    </div>
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
              {address ? (
                <a
                  href={mapsDirectionsUrl(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm min-h-11 gap-1"
                >
                  <MapPin className="h-4 w-4" />
                  Directions
                </a>
              ) : null}
            </div>
          )}
          <p className="text-base leading-snug">
            {job.problem_description || job.requested_service || "No problem description."}
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="badge badge-outline">{job.priority}</span>
            <span className="badge badge-ghost">{job.warranty_coverage || "Coverage unknown"}</span>
            {job.dispatch_status ? <span className="badge badge-ghost">{job.dispatch_status}</span> : null}
            {job.work_order_type ? <span className="badge badge-ghost">{job.work_order_type}</span> : null}
          </div>
        </div>
      </article>

      {(error || message) && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${error ? "bg-error/15 text-error" : "bg-success/15 text-success"}`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-2">
            <span>{error ?? message}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs shrink-0"
              onClick={() => {
                setError(null);
                setMessage(null);
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {dualWorking.length > 0 && step !== "done" ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="status">
          <p>
            Another job is still Working:{" "}
            <span className="font-semibold">
              {dualWorking.map((j) => j.work_order_number).join(", ")}
            </span>
            . Complete it first when you can so labor hours stay clean.
          </p>
          {onSwitchJob ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {dualWorking.slice(0, 3).map((j) => (
                <button
                  key={j.id}
                  type="button"
                  className="btn btn-warning btn-outline btn-xs"
                  onClick={() => onSwitchJob(j.id)}
                >
                  Switch to {j.work_order_number}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {scopePending ? (
        <div className="rounded-2xl border-2 border-warning bg-warning/10 p-4" role="alert">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="space-y-3">
              <p className="font-semibold">
                Warning: This {scopePending === "part" ? "part" : "labor"} exceeds contract scope. Customer
                e-signature required before installation.
              </p>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-warning mt-0.5"
                  checked={scopeAck}
                  onChange={(e) => setScopeAck(e.target.checked)}
                />
                <span>I confirmed with the customer and will capture sign-off before leaving.</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-warning min-h-12"
                  disabled={!scopeAck || busy}
                  onClick={() => {
                    if (scopePending === "part") void burnPart(true);
                    else if (scopePending === "manual-labor") void logManualLabor(true);
                    else void markStep("working");
                  }}
                >
                  Continue anyway
                </button>
                <button
                  type="button"
                  className="btn btn-ghost min-h-12"
                  onClick={() => {
                    setScopePending(null);
                    setScopeAck(false);
                    setPendingPart(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <section className="space-y-2" aria-labelledby="checklist-heading">
        <h3 id="checklist-heading" className="text-base font-semibold">
          Job checklist
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            className={`btn min-h-16 flex-col gap-1 ${job.arrival_at ? "btn-success" : step === "arrived" ? "btn-primary" : "btn-outline"}`}
            aria-pressed={Boolean(job.arrival_at)}
            disabled={busy || Boolean(job.arrival_at) || step !== "arrived"}
            onClick={() => void markStep("arrived")}
          >
            <MapPin className="h-5 w-5" />
            Arrived
          </button>
          <button
            type="button"
            className={`btn min-h-16 flex-col gap-1 ${job.started_at ? "btn-success" : step === "working" ? "btn-primary" : "btn-outline"}`}
            aria-pressed={Boolean(job.started_at)}
            disabled={busy || Boolean(job.started_at) || step !== "working"}
            onClick={() => void markStep("working")}
          >
            <Play className="h-5 w-5" />
            In Progress
          </button>
          <button
            type="button"
            className={`btn min-h-16 flex-col gap-1 ${step === "done" ? "btn-success" : step === "complete" ? "btn-primary" : "btn-outline"}`}
            aria-pressed={step === "done"}
            disabled={busy || step === "done" || step !== "complete"}
            onClick={() => void runComplete()}
          >
            <CheckCircle2 className="h-5 w-5" />
            Complete
          </button>
        </div>
        <p className="text-xs opacity-60" aria-live="polite">
          {step === "arrived" && "Tap Arrived when you reach the site."}
          {step === "working" && "Tap In Progress to start a Working timesheet (clock runs until Complete)."}
          {step === "complete" && "Tap Complete — customer must sign off with initials or a signature."}
          {step === "done" && "This job is closed out."}
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-base-300 bg-base-100 p-4" aria-labelledby="labor-heading">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            <h3 id="labor-heading" className="text-base font-semibold">
              Timesheet
            </h3>
          </div>
          {!showAddEntry ? (
            <button
              type="button"
              className="btn btn-outline btn-sm min-h-10"
              onClick={() => {
                resetAddEntryForm();
                setShowAddEntry(true);
              }}
            >
              Add Entry
            </button>
          ) : null}
        </div>

        {activeClock && activeClock.work_order_id === job.id ? (
          <div className="rounded-xl border border-success/50 bg-success/10 px-3 py-3" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-success">Currently Clocked In</p>
                <p className="text-lg font-semibold">
                  {ACTIVITY_TYPES.find((a) => a.value === activeClock.activity_type)?.label ?? "Work"}
                </p>
                <p className="text-sm opacity-70">
                  Since {activeClock.clock_in_at ? formatLaborClock(toLocalTime(activeClock.clock_in_at)) : "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl font-bold tabular-nums">
                  {activeClock.clock_in_at
                    ? formatElapsedLabel(activeClock.clock_in_at, elapsedTick)
                    : "—"}
                </p>
                <button
                  type="button"
                  className="btn btn-warning btn-sm mt-1"
                  disabled={busy}
                  onClick={() => void runComplete()}
                >
                  Clock out
                </button>
              </div>
            </div>
          </div>
        ) : workingOpen && job.started_at ? (
          <div className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-3" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Current activity</p>
                <p className="text-lg font-semibold">Working</p>
                <p className="text-sm opacity-70">
                  Started {formatLaborClock(toLocalTime(job.started_at))} · Complete to clock out
                </p>
              </div>
              <p className="font-mono text-2xl font-bold tabular-nums">
                {formatElapsedLabel(job.started_at, elapsedTick)}
              </p>
            </div>
          </div>
        ) : null}

        {step === "working" ? (
          <label className="form-control">
            <span className="label-text text-xs">Clock-in activity</span>
            <select
              className="select select-bordered select-sm"
              value={teActivity}
              onChange={(e) => setTeActivity(e.target.value as TimeActivityType)}
            >
              {ACTIVITY_TYPES.filter((a) => a.value !== "break").map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {laborRows.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {laborRows.map((row) => {
              const total = Number(row.regular_hours) + Number(row.overtime_hours);
              return (
                <li key={row.id} className="rounded-lg bg-base-200 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{timesheetActivityLabel(row.notes)}</span>
                    <span className="opacity-70">{row.work_date}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-80">
                    <span>
                      {formatLaborClock(row.start_time)} – {formatLaborClock(row.end_time)}
                    </span>
                    <span>{total.toFixed(2)} hr</span>
                    {Number(row.overtime_hours) > 0 ? (
                      <span>{Number(row.overtime_hours).toFixed(2)} OT</span>
                    ) : null}
                    <span className="badge badge-ghost badge-sm">{row.billable_status}</span>
                  </div>
                  {row.notes && timesheetActivityLabel(row.notes) !== row.notes ? (
                    <p className="mt-1 text-xs opacity-70">{row.notes.replace(/^[^—]+ — /, "")}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm opacity-60">
            No timesheet entries yet — tap In Progress to start Working, or Add Entry below.
          </p>
        )}

        {showAddEntry ? (
          <div className="space-y-4 border-t border-base-300 pt-3">
            <p className="text-sm font-semibold">Add Entry</p>

            <div className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium">Activity</span>
              <div
                className="grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label="Activity"
              >
                {TIMESHEET_ACTIVITIES.map((item) => {
                  const selected = activity === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`flex h-12 w-full items-center justify-center rounded-xl border text-sm font-semibold transition-colors ${
                        selected
                          ? "border-primary bg-primary text-primary-content"
                          : "border-base-300 bg-base-100 text-base-content hover:bg-base-200"
                      }`}
                      onClick={() => setActivity(item)}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium">Date</span>
              <input
                type="date"
                className="input input-bordered w-full min-h-12"
                value={laborDate}
                onChange={(e) => setLaborDate(e.target.value)}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-medium">Start time</span>
                <input
                  type="time"
                  className="input input-bordered w-full min-h-12"
                  value={laborStart}
                  onChange={(e) => setLaborStart(e.target.value)}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-medium">End time</span>
                <input
                  type="time"
                  className="input input-bordered w-full min-h-12"
                  value={laborEnd}
                  onChange={(e) => setLaborEnd(e.target.value)}
                />
              </label>
            </div>

            <p className="text-xs opacity-60" aria-live="polite">
              {!laborEnd
                ? "End time required to save a completed entry."
                : spanHours == null
                  ? "End time must be after start time."
                  : `Duration: ${spanHours.toFixed(2)} hours`}
            </p>

            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium">Memo (optional)</span>
              <textarea
                className="textarea textarea-bordered w-full min-h-16 text-base"
                value={laborNotes}
                onChange={(e) => setLaborNotes(e.target.value)}
                placeholder="Optional note for this activity"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary min-h-12 flex-1"
                disabled={busy || !laborEnd || spanHours == null}
                onClick={() => void logManualLabor(false)}
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-ghost min-h-12"
                disabled={busy}
                onClick={() => {
                  setShowAddEntry(false);
                  resetAddEntryForm();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-2xl border border-base-300 bg-base-100 p-4" aria-labelledby="parts-heading">
        <h3 id="parts-heading" className="sr-only">
          Parts
        </h3>
        <TechPartsLogger
          catalogParts={catalogParts}
          usedParts={usedParts}
          busy={busy}
          compact
          onLog={(partId, quantity) => logWarehousePart(partId, quantity, false)}
        />
      </section>

      <section className="rounded-2xl border border-base-300 bg-base-100 p-4">
        <VoiceDiagnosticNotes
          symptom={notes.symptom}
          cause={notes.cause}
          action={notes.action}
          onChange={setNotes}
          onSave={saveNotes}
          busy={busy}
        />
      </section>

      <nav
        className="rounded-2xl border border-base-300 bg-base-100 p-4"
        aria-label="Related areas"
      >
        <p className="mb-2 text-sm font-semibold">Related</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/parts" className="btn btn-outline btn-sm min-h-10">
            Parts catalog
          </Link>
          <Link href="/dispatch" className="btn btn-outline btn-sm min-h-10">
            Dispatch board
          </Link>
          <Link href="/time-off" className="btn btn-outline btn-sm min-h-10">
            Time off
          </Link>
        </div>
      </nav>

      {/* Thumb-friendly primary action */}
      {primary.action && !scopePending ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-base-300 bg-base-100/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-base-100/80 lg:pl-72">
          <div className="mx-auto flex max-w-xl gap-2">
            <button
              type="button"
              className="btn btn-ghost min-h-14 flex-none"
              onClick={onBack}
              disabled={busy}
            >
              Jobs
            </button>
            <button
              type="button"
              className="btn btn-primary min-h-14 flex-1 text-base"
              disabled={busy}
              onClick={() => {
                if (primary.action === "arrived") void markStep("arrived");
                else if (primary.action === "working") void markStep("working");
                else if (primary.action === "complete") void runComplete();
              }}
            >
              {busy ? "Saving…" : primary.label}
            </button>
          </div>
        </div>
      ) : null}

      {showProof ? (
        <ProofOfCompletion
          jobId={job.id}
          technicianId={profile.id}
          requirement={job.completion_proof_requirement ?? "photo_or_signature"}
          onCancel={() => setShowProof(false)}
          onCompleted={async () => {
            setShowProof(false);
            setMessage("Job completed with customer initials or signature on file.");
            await onRefresh();
            onBack();
          }}
        />
      ) : null}
    </div>
  );
}
