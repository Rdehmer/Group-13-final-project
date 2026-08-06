"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ChevronRight, MapPin, Phone, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, statusTone } from "@/components/ui";
import { JobSheet } from "@/components/technician/JobSheet";
import { createClient } from "@/lib/supabase/client";
import {
  customerName,
  humanizeFieldError,
  isOpenJob,
  jobAddress,
  jobPhone,
  jobTimeLabel,
  mapsDirectionsUrl,
  nextChecklistStep,
  partitionMyDay,
  priorityBarClass,
  telHref,
  todayIso,
  type FieldJob,
} from "@/lib/technician-field";
import {
  formatTimeOffLabel,
  timeOffCoversDay,
  type TimeOffRange,
} from "@/lib/time-off";
import type { Part, Profile, TechnicianLabor, WorkOrderPart } from "@/lib/types";

type TruckRow = {
  part_id: string;
  quantity_on_hand: number;
  parts?: Part | null;
};

const POLL_MS = 45_000;

function JobCard({
  job,
  cta,
  onOpen,
  onApprovedLeave,
}: {
  job: FieldJob;
  cta: string;
  onOpen: () => void;
  onApprovedLeave?: boolean;
}) {
  const address = jobAddress(job);
  const phone = jobPhone(job);

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-base-100 shadow-sm transition ${
        onApprovedLeave
          ? "border-warning/50 opacity-90"
          : "border-base-300 hover:border-primary/40"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <div className={`h-1.5 w-full ${priorityBarClass(job.priority)}`} aria-hidden />
        <div className="flex items-start gap-3 p-4 pb-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide opacity-60">
                {job.work_order_number}
              </span>
              <StatusBadge label={job.priority} tone={statusTone(job.priority)} />
              {onApprovedLeave ? (
                <span className="badge badge-warning badge-sm">On approved leave day</span>
              ) : null}
            </div>
            <p className="truncate text-lg font-bold leading-tight">{customerName(job)}</p>
            <p className="text-sm opacity-70">{jobTimeLabel(job)}</p>
            {address ? <p className="truncate text-sm opacity-60">{address}</p> : null}
            <p className="line-clamp-2 text-sm leading-snug">
              {job.problem_description || "No description"}
            </p>
            <p className="pt-1 text-sm font-semibold text-primary">{cta}</p>
          </div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 opacity-40" aria-hidden />
        </div>
      </button>
      {(address || phone) && (
        <div className="flex flex-wrap gap-2 border-t border-base-200 px-4 py-2">
          {phone ? (
            <a
              href={telHref(phone)}
              className="btn btn-outline btn-sm min-h-11 gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <Phone className="h-4 w-4" />
              Call
            </a>
          ) : null}
          {address ? (
            <a
              href={mapsDirectionsUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline btn-sm min-h-11 gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <MapPin className="h-4 w-4" />
              Directions
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}

function stepCta(job: FieldJob): string {
  const step = nextChecklistStep(job);
  if (step === "arrived") return "Start → Arrived";
  if (step === "working") return "Continue → In Progress";
  if (step === "complete") return "Finish → Sign-off";
  return "View job";
}

export function TechnicianMyDay({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOffRange[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [truckParts, setTruckParts] = useState<TruckRow[]>([]);
  const [catalogParts, setCatalogParts] = useState<Part[]>([]);
  const [usedParts, setUsedParts] = useState<(WorkOrderPart & { parts?: Part | null })[]>([]);
  const [laborRows, setLaborRows] = useState<TechnicianLabor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const loadJobs = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await supabase
      .from("work_orders")
      .select("*, customers(id, name, phone, service_address, city, state)")
      .eq("assigned_technician_id", profile.id)
      .not("status", "in", '("Canceled")')
      .order("scheduled_date", { ascending: true });

    if (loadError) {
      setError(humanizeFieldError(loadError.message));
      setJobs([]);
      return;
    }
    setJobs((data as FieldJob[]) ?? []);
  }, [profile.id, supabase]);

  const loadTimeOff = useCallback(async () => {
    const { data, error: qErr } = await supabase
      .from("time_off_requests")
      .select("id, technician_id, start_date, end_date, status, reason")
      .eq("technician_id", profile.id)
      .eq("status", "Approved");
    if (qErr) {
      // Table may be missing in some envs — don't block My Day
      setTimeOff([]);
      return;
    }
    setTimeOff((data as TimeOffRange[]) ?? []);
  }, [profile.id, supabase]);

  const loadTruck = useCallback(async () => {
    const { data } = await supabase
      .from("truck_inventory")
      .select("part_id, quantity_on_hand, parts(*)")
      .eq("technician_id", profile.id)
      .order("updated_at", { ascending: false });
    setTruckParts(
      ((data as unknown as TruckRow[]) ?? []).map((row) => ({
        ...row,
        parts: Array.isArray(row.parts) ? (row.parts[0] as Part | undefined) ?? null : row.parts ?? null,
      })),
    );
  }, [profile.id, supabase]);

  /** Same Parts catalog managers see (warehouse quantity_on_hand). */
  const loadCatalog = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("parts").select("*").order("name");
    if (loadError) {
      setCatalogParts([]);
      return;
    }
    const all = (data as Part[]) ?? [];
    const active = all.filter((p) => p.is_active === true || p.is_active == null);
    setCatalogParts(active.length > 0 ? active : all);
  }, [supabase]);

  const loadUsedParts = useCallback(
    async (jobId: string) => {
      const { data } = await supabase
        .from("work_order_parts")
        .select("*, parts(*)")
        .eq("work_order_id", jobId)
        .order("created_at", { ascending: false });
      setUsedParts((data as typeof usedParts) ?? []);
    },
    [supabase],
  );

  const loadLabor = useCallback(
    async (jobId: string) => {
      const { data } = await supabase
        .from("technician_labor")
        .select("*")
        .eq("work_order_id", jobId)
        .order("work_date", { ascending: false })
        .order("created_at", { ascending: false });
      setLaborRows((data as TechnicianLabor[]) ?? []);
    },
    [supabase],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([loadJobs(), loadTruck(), loadCatalog(), loadTimeOff()]);
    if (selectedId) {
      await Promise.all([loadUsedParts(selectedId), loadLabor(selectedId)]);
    }
    setLastSynced(new Date());
  }, [loadJobs, loadTruck, loadCatalog, loadTimeOff, loadUsedParts, loadLabor, selectedId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadJobs(), loadTruck(), loadCatalog(), loadTimeOff()]);
      if (!cancelled) {
        setLastSynced(new Date());
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadJobs, loadTruck, loadCatalog, loadTimeOff]);

  // Quiet poll while looking at the list (dispatch reassigns, new jobs).
  useEffect(() => {
    if (selectedId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshAll();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [selectedId, refreshAll]);

  useEffect(() => {
    if (selectedId) {
      void loadUsedParts(selectedId);
      void loadLabor(selectedId);
    } else {
      setUsedParts([]);
      setLaborRows([]);
    }
  }, [selectedId, loadUsedParts, loadLabor]);

  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) ?? null, [jobs, selectedId]);
  const { nowNext, later, closeout, upcoming } = useMemo(() => partitionMyDay(jobs), [jobs]);

  const today = todayIso();
  const leaveToday = useMemo(
    () => timeOff.filter((r) => timeOffCoversDay(r, today)),
    [timeOff, today],
  );
  const upcomingLeave = useMemo(
    () =>
      timeOff
        .filter((r) => r.end_date.slice(0, 10) >= today)
        .sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [timeOff, today],
  );

  const openWorking = useMemo(
    () =>
      jobs.filter(
        (j) =>
          isOpenJob(j) &&
          (j.dispatch_status === "Working" || (Boolean(j.started_at) && nextChecklistStep(j) === "complete")),
      ),
    [jobs],
  );

  function isOnLeaveDay(job: FieldJob): boolean {
    if (!job.scheduled_date) return false;
    return timeOff.some((r) => timeOffCoversDay(r, job.scheduled_date!.slice(0, 10)));
  }

  if (selected) {
    return (
      <JobSheet
        job={selected}
        profile={profile}
        catalogParts={catalogParts}
        truckParts={truckParts}
        usedParts={usedParts}
        laborRows={laborRows}
        otherOpenJobs={jobs.filter((j) => j.id !== selected.id && isOpenJob(j))}
        onBack={() => setSelectedId(null)}
        onRefresh={refreshAll}
      />
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader
        title="My Day"
        description={`${format(new Date(), "EEEE, MMM d")} — tap a job to work it`}
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm opacity-70">
          {nowNext.length + later.length} today · {upcoming.length} upcoming · {closeout.length} need closeout
          {lastSynced ? (
            <span className="opacity-50"> · updated {format(lastSynced, "h:mm a")}</span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Link href="/parts" className="btn btn-ghost btn-sm min-h-11">
            Parts
          </Link>
          <Link href="/dispatch" className="btn btn-ghost btn-sm min-h-11">
            Dispatch
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm min-h-11 gap-1"
            onClick={() => void refreshAll()}
            aria-label="Refresh jobs"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {leaveToday.length > 0 ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="status">
          <p className="font-semibold">You’re on approved time off today</p>
          <p className="mt-1 opacity-80">
            {leaveToday.map((r) => formatTimeOffLabel(r.start_date, r.end_date)).join(" · ")}
            {leaveToday[0]?.reason ? ` — ${leaveToday[0].reason}` : ""}. Jobs below still appear if
            dispatch left them scheduled; confirm with the office before driving.
          </p>
        </div>
      ) : upcomingLeave.length > 0 ? (
        <div className="rounded-2xl border border-base-300 bg-base-200/50 px-4 py-3 text-sm">
          <p className="font-medium">Upcoming approved leave</p>
          <ul className="mt-1 list-inside list-disc opacity-80">
            {upcomingLeave.slice(0, 3).map((r) => (
              <li key={r.id}>{formatTimeOffLabel(r.start_date, r.end_date)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {(closeout.length > 0 || openWorking.length > 0) && (
        <div className="rounded-2xl border border-error/30 bg-error/5 px-4 py-3 text-sm" role="status">
          <p className="font-semibold text-error">Before you log off</p>
          <ul className="mt-1 list-inside list-disc opacity-80">
            {openWorking.length > 0 ? (
              <li>
                {openWorking.length} job{openWorking.length === 1 ? "" : "s"} still in Working — clock
                out with Complete.
              </li>
            ) : null}
            {closeout.length > 0 ? (
              <li>
                {closeout.length} past job{closeout.length === 1 ? "" : "s"} need closeout / sign-off.
              </li>
            ) : null}
          </ul>
        </div>
      )}

      {error ? (
        <div className="rounded-xl bg-error/15 px-4 py-3 text-sm text-error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-28 w-full rounded-2xl" />
          <div className="skeleton h-28 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="now-next-heading">
            <h2 id="now-next-heading" className="text-sm font-bold uppercase tracking-wide opacity-60">
              Now / Next
            </h2>
            {nowNext.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-base-300 px-4 py-8 text-center text-sm opacity-60">
                No open jobs for today. Check closeouts below or wait for dispatch.
              </p>
            ) : (
              nowNext.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  cta={stepCta(job)}
                  onOpen={() => setSelectedId(job.id)}
                  onApprovedLeave={isOnLeaveDay(job)}
                />
              ))
            )}
          </section>

          {later.length > 0 ? (
            <section className="space-y-3" aria-labelledby="later-heading">
              <h2 id="later-heading" className="text-sm font-bold uppercase tracking-wide opacity-60">
                Later today
              </h2>
              {later.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  cta={stepCta(job)}
                  onOpen={() => setSelectedId(job.id)}
                  onApprovedLeave={isOnLeaveDay(job)}
                />
              ))}
            </section>
          ) : null}

          {upcoming.length > 0 ? (
            <section className="space-y-3" aria-labelledby="upcoming-heading">
              <h2 id="upcoming-heading" className="text-sm font-bold uppercase tracking-wide opacity-60">
                Upcoming
              </h2>
              {upcoming.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  cta={stepCta(job)}
                  onOpen={() => setSelectedId(job.id)}
                  onApprovedLeave={isOnLeaveDay(job)}
                />
              ))}
            </section>
          ) : null}

          {closeout.length > 0 ? (
            <section className="space-y-3" aria-labelledby="closeout-heading">
              <h2 id="closeout-heading" className="text-sm font-bold uppercase tracking-wide text-error">
                Needs closeout
              </h2>
              {closeout.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  cta="Close out past job"
                  onOpen={() => setSelectedId(job.id)}
                  onApprovedLeave={isOnLeaveDay(job)}
                />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
