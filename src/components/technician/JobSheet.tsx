"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MapPin,
  Package,
  Phone,
  Play,
  Timer,
} from "lucide-react";
import { StatusBadge, statusTone } from "@/components/ui";
import { ProofOfCompletion } from "@/components/ProofOfCompletion";
import { VoiceDiagnosticNotes } from "@/components/technician/VoiceDiagnosticNotes";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import {
  TIMESHEET_ACTIVITIES,
  customerName,
  formatDiagnosticNotes,
  formatElapsedLabel,
  formatLaborClock,
  formatTimesheetNotes,
  hoursBetween,
  hoursFromTimeRange,
  humanizeFieldError,
  isOpenJob,
  isOutOfScope,
  jobAddress,
  jobPhone,
  jobTimeLabel,
  mapsDirectionsUrl,
  nextChecklistStep,
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
import type { Part, Profile, TechnicianLabor, WorkOrderPart } from "@/lib/types";

type TruckRow = {
  part_id: string;
  quantity_on_hand: number;
  parts?: Part | null;
};

type PartSource = "warehouse" | "truck";

type Props = {
  job: FieldJob;
  profile: Profile;
  /** Shared Parts catalog (managers / Parts tab). */
  catalogParts: Part[];
  truckParts: TruckRow[];
  usedParts: (WorkOrderPart & { parts?: Part | null })[];
  laborRows: TechnicianLabor[];
  /** Other open jobs (for dual Working warning). */
  otherOpenJobs?: FieldJob[];
  onBack: () => void;
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
  truckParts,
  usedParts,
  laborRows,
  otherOpenJobs = [],
  onBack,
  onRefresh,
}: Props) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showProof, setShowProof] = useState(false);
  const address = jobAddress(job);
  const phone = jobPhone(job);
  const dualWorking = otherOpenJobs.filter(
    (j) =>
      isOpenJob(j) &&
      (j.dispatch_status === "Working" ||
        (Boolean(j.started_at) && nextChecklistStep(j) === "complete")),
  );
  const [partSource, setPartSource] = useState<PartSource>("warehouse");
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("1");
  const [partSearch, setPartSearch] = useState("");
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

  const step = nextChecklistStep(job);
  const workingOpen = Boolean(job.started_at) && step === "complete";
  const spanHours = laborEnd ? hoursFromTimeRange(laborStart, laborEnd) : null;

  const truckQtyByPart = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of truckParts) {
      map.set(row.part_id, row.quantity_on_hand);
    }
    return map;
  }, [truckParts]);

  const filteredTruck = useMemo(() => {
    const q = partSearch.trim().toLowerCase();
    return truckParts
      .filter((row) => row.quantity_on_hand > 0 && row.parts)
      .filter((row) => {
        if (!q) return true;
        const p = row.parts!;
        return (
          p.name.toLowerCase().includes(q) ||
          p.part_number.toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q)
        );
      });
  }, [truckParts, partSearch]);

  const filteredCatalog = useMemo(() => {
    const q = partSearch.trim().toLowerCase();
    return catalogParts.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.part_number.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [catalogParts, partSearch]);

  useEffect(() => {
    setPartId("");
  }, [partSource]);

  useEffect(() => {
    if (!workingOpen) return;
    const id = window.setInterval(() => setElapsedTick(new Date()), 1_000);
    return () => window.clearInterval(id);
  }, [workingOpen]);

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
          ? `Working started. Note: still open on ${dualWorking.map((j) => j.work_order_number).join(", ")}.`
          : "Working timesheet started — Complete clocks you out.",
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

    const { regular_hours, overtime_hours } = splitRegularOt(spanHours);

    setBusy(true);
    setError(null);
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

    resetAddEntryForm();
    setShowAddEntry(false);
    setScopePending(null);
    setScopeAck(false);
    setMessage("Timesheet entry saved.");
    await onRefresh();
    setBusy(false);
  }

  async function logWarehousePart(acknowledged: boolean) {
    const part = catalogParts.find((p) => p.id === partId);
    if (!part) {
      setError("Choose a part from the Parts catalog.");
      return;
    }
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity < 1) {
      setError("Enter a quantity of at least 1.");
      return;
    }
    if (part.quantity_on_hand < quantity) {
      setError(
        `Not enough warehouse stock for ${part.name} (on hand: ${part.quantity_on_hand}). Check Parts or use truck stock.`,
      );
      return;
    }
    if (isOutOfScope(job, "part") && !acknowledged) {
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

    setPartId("");
    setQty("1");
    setScopePending(null);
    setScopeAck(false);
    setMessage(`${part.name} logged from warehouse stock — same catalog as Parts.`);
    await onRefresh();
    setBusy(false);
  }

  async function logTruckPart(acknowledged: boolean) {
    if (!partId) {
      setError("Choose a truck part first.");
      return;
    }
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity < 1) {
      setError("Enter a quantity of at least 1.");
      return;
    }

    if (isOutOfScope(job, "part") && !acknowledged) {
      setScopePending("part");
      return;
    }

    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("use_truck_part_on_work_order", {
      p_work_order_id: job.id,
      p_part_id: partId,
      p_quantity: quantity,
      p_scope_acknowledged: acknowledged,
    });

    if (rpcError) {
      if (rpcError.message.includes("OUT_OF_SCOPE")) {
        setScopePending("part");
      } else {
        setError(humanizeFieldError(rpcError.message));
      }
      setBusy(false);
      return;
    }

    setPartId("");
    setQty("1");
    setScopePending(null);
    setScopeAck(false);
    setMessage("Part burned from your truck inventory.");
    await onRefresh();
    setBusy(false);
  }

  async function burnPart(acknowledged: boolean) {
    if (partSource === "truck") {
      await logTruckPart(acknowledged);
    } else {
      await logWarehousePart(acknowledged);
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

  async function finalizeWorkingLabor() {
    if (!job.started_at) return;
    const now = new Date().toISOString();
    const hours = hoursBetween(job.started_at, now);
    const split = splitRegularOt(hours);
    await supabase.from("technician_labor").insert(
      laborPayload(profile, job, {
        work_date: todayIso(),
        start_time: toLocalTime(job.started_at),
        end_time: toLocalTime(now),
        regular_hours: split.regular_hours,
        overtime_hours: split.overtime_hours,
        notes: "Working",
      }),
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 pb-28">
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
            <div className="flex flex-wrap gap-2">
              {phone ? (
                <a href={telHref(phone)} className="btn btn-outline btn-sm min-h-11 gap-1">
                  <Phone className="h-4 w-4" />
                  Call customer
                </a>
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
          </div>
        </div>
      </article>

      {(error || message) && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${error ? "bg-error/15 text-error" : "bg-success/15 text-success"}`}
          role="status"
          aria-live="polite"
        >
          {error ?? message}
        </div>
      )}

      {dualWorking.length > 0 && step !== "done" ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="status">
          Another job is still Working:{" "}
          <span className="font-semibold">
            {dualWorking.map((j) => j.work_order_number).join(", ")}
          </span>
          . Complete it first when you can so labor hours stay clean.
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
            onClick={() => {
              void (async () => {
                setBusy(true);
                await finalizeWorkingLabor();
                await onRefresh();
                setBusy(false);
                setShowProof(true);
              })();
            }}
          >
            <CheckCircle2 className="h-5 w-5" />
            Complete
          </button>
        </div>
        <p className="text-xs opacity-60" aria-live="polite">
          {step === "arrived" && "Tap Arrived when you reach the site."}
          {step === "working" && "Tap In Progress to start a Working timesheet (clock runs until Complete)."}
          {step === "complete" && "Tap Complete to clock out Working and capture customer sign-off."}
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

        {workingOpen && job.started_at ? (
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
          <div className="space-y-3 border-t border-base-300 pt-3">
            <p className="text-sm font-semibold">Add Entry</p>
            <label className="form-control">
              <span className="label-text font-medium">Activity</span>
              <select
                className="select select-bordered min-h-12"
                value={activity}
                onChange={(e) => setActivity(e.target.value as TimesheetActivity)}
              >
                {TIMESHEET_ACTIVITIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text font-medium">Date</span>
              <input
                type="date"
                className="input input-bordered min-h-12"
                value={laborDate}
                onChange={(e) => setLaborDate(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="form-control">
                <span className="label-text font-medium">Start time</span>
                <input
                  type="time"
                  className="input input-bordered min-h-12"
                  value={laborStart}
                  onChange={(e) => setLaborStart(e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text font-medium">End time</span>
                <input
                  type="time"
                  className="input input-bordered min-h-12"
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
            <label className="form-control">
              <span className="label-text font-medium">Memo (optional)</span>
              <textarea
                className="textarea textarea-bordered min-h-16 text-base"
                value={laborNotes}
                onChange={(e) => setLaborNotes(e.target.value)}
                placeholder="Optional note for this activity"
              />
            </label>
            <div className="flex flex-wrap gap-2">
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
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 shrink-0" />
            <div>
              <h3 id="parts-heading" className="text-base font-semibold">
                Parts
              </h3>
              <p className="text-xs opacity-70">
                Same inventory managers see under Parts — logging updates job usage and stock.
              </p>
            </div>
          </div>
          <Link href="/parts" className="btn btn-ghost btn-sm min-h-10 gap-1">
            Open Parts
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Part source">
          <button
            type="button"
            role="tab"
            aria-selected={partSource === "warehouse"}
            className={`btn btn-sm min-h-11 ${partSource === "warehouse" ? "btn-primary" : "btn-outline"}`}
            onClick={() => setPartSource("warehouse")}
          >
            Warehouse catalog
            <span className="badge badge-ghost badge-sm">{catalogParts.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={partSource === "truck"}
            className={`btn btn-sm min-h-11 ${partSource === "truck" ? "btn-primary" : "btn-outline"}`}
            onClick={() => setPartSource("truck")}
          >
            My truck
            <span className="badge badge-ghost badge-sm">
              {truckParts.filter((r) => r.quantity_on_hand > 0).length}
            </span>
          </button>
        </div>

        <input
          className="input input-bordered min-h-12 w-full"
          placeholder={
            partSource === "warehouse" ? "Search Parts catalog…" : "Search truck stock…"
          }
          value={partSearch}
          onChange={(e) => setPartSearch(e.target.value)}
          aria-label="Search parts"
        />
        <select
          className="select select-bordered min-h-12 w-full"
          value={partId}
          onChange={(e) => setPartId(e.target.value)}
          aria-label={partSource === "warehouse" ? "Warehouse part" : "Truck part"}
        >
          <option value="">
            {partSource === "warehouse"
              ? catalogParts.length === 0
                ? "No parts loaded — open Parts tab"
                : "Select part…"
              : "Select truck part…"}
          </option>
          {partSource === "warehouse"
            ? filteredCatalog.map((p) => {
                const truckQty = truckQtyByPart.get(p.id);
                return (
                  <option key={p.id} value={p.id} disabled={p.quantity_on_hand <= 0}>
                    {p.part_number} — {p.name} (whse {p.quantity_on_hand}
                    {truckQty != null && truckQty > 0 ? ` · truck ${truckQty}` : ""})
                  </option>
                );
              })
            : filteredTruck.map((row) => (
                <option key={row.part_id} value={row.part_id}>
                  {row.parts?.part_number} — {row.parts?.name} (qty {row.quantity_on_hand})
                </option>
              ))}
        </select>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            className="input input-bordered min-h-12 w-24"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-label="Quantity used"
          />
          <button
            type="button"
            className="btn btn-secondary min-h-12 flex-1"
            disabled={
              busy ||
              !partId ||
              (partSource === "warehouse" && catalogParts.length === 0)
            }
            onClick={() => void burnPart(false)}
          >
            Log part used
          </button>
        </div>
        {usedParts.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {usedParts.map((row) => (
              <li key={row.id} className="flex justify-between gap-2 rounded-lg bg-base-200 px-3 py-2">
                <span>
                  {row.parts?.name ?? "Part"} × {row.quantity_used}
                </span>
                <span className="opacity-60">{row.date_used}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm opacity-60">No parts logged on this job yet.</p>
        )}
        {partSource === "warehouse" && catalogParts.length === 0 ? (
          <p className="text-sm opacity-60">
            Catalog empty or blocked. Open{" "}
            <Link href="/parts" className="link link-primary">
              Parts
            </Link>{" "}
            or ask a manager — My Day uses the same list.
          </p>
        ) : null}
        {partSource === "truck" && filteredTruck.length === 0 ? (
          <p className="text-sm opacity-60">
            No matching truck stock. Use Warehouse catalog above, or restock from{" "}
            <Link href="/parts" className="link link-primary">
              Parts
            </Link>
            .
          </p>
        ) : null}
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
          <Link href="/technician" className="btn btn-outline btn-sm min-h-10">
            My Day list
          </Link>
        </div>
      </nav>

      {showProof ? (
        <ProofOfCompletion
          jobId={job.id}
          technicianId={profile.id}
          requirement={job.completion_proof_requirement ?? "photo_or_signature"}
          onCancel={() => setShowProof(false)}
          onCompleted={async () => {
            setShowProof(false);
            setMessage("Job completed with customer sign-off.");
            await onRefresh();
            onBack();
          }}
        />
      ) : null}
    </div>
  );
}
