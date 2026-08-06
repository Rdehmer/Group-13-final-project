"use client";

/**
 * Technician My Day home — ServiceTitan-style field queue.
 * List of assigned jobs with time-off awareness; opens JobSheet for work.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  CalendarDays,
  CalendarOff,
  ChevronRight,
  MapPin,
  Package,
  Phone,
  Radio,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, statusTone } from "@/components/ui";
import { JobSheet } from "@/components/technician/JobSheet";
import { createClient } from "@/lib/supabase/client";
import {
  customerName,
  firstNameFromProfile,
  greetForTime,
  humanizeFieldError,
  isActivelyWorking,
  isOpenJob,
  jobAddress,
  jobPhone,
  jobTimeLabel,
  mapsDirectionsUrl,
  nextChecklistStep,
  partitionMyDay,
  priorityBarClass,
  relativeScheduleHint,
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

const POLL_MS = 45_000;

function JobCard({
  job,
  cta,
  onOpen,
  onApprovedLeave,
  emphasized,
}: {
  job: FieldJob;
  cta: string;
  onOpen: () => void;
  onApprovedLeave?: boolean;
  emphasized?: boolean;
}) {
  const address = jobAddress(job);
  const phone = jobPhone(job);
  const active = isActivelyWorking(job);
  const hint = relativeScheduleHint(job);
  const step = nextChecklistStep(job);

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-base-100 shadow-sm transition ${
        onApprovedLeave
          ? "border-warning/50 opacity-90"
          : active || emphasized
            ? "border-primary ring-1 ring-primary/30"
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
              {active ? <span className="badge badge-primary badge-sm">Active</span> : null}
              {hint && !active ? (
                <span className="badge badge-ghost badge-sm">{hint}</span>
              ) : null}
              {job.dispatch_status && !active ? (
                <span className="badge badge-outline badge-sm">{job.dispatch_status}</span>
              ) : null}
              {onApprovedLeave ? (
                <span className="badge badge-warning badge-sm">Leave day</span>
              ) : null}
            </div>
            <p className="truncate text-lg font-bold leading-tight">{customerName(job)}</p>
            <p className="text-sm opacity-70">{jobTimeLabel(job)}</p>
            {address ? <p className="truncate text-sm opacity-60">{address}</p> : null}
            <p className="line-clamp-2 text-sm leading-snug">
              {job.problem_description || job.requested_service || "No description"}
            </p>
            <p className="pt-1 text-sm font-semibold text-primary">
              {cta}
              {step === "complete" ? " · timesheet running" : ""}
            </p>
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

function Section({
  id,
  title,
  tone,
  children,
  count,
}: {
  id: string;
  title: string;
  tone?: "error" | "default";
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <h2
        id={id}
        className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wide ${
          tone === "error" ? "text-error" : "opacity-60"
        }`}
      >
        {title}
        {count != null && count > 0 ? (
          <span className={`badge badge-sm ${tone === "error" ? "badge-error" : "badge-ghost"}`}>
            {count}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

export function TechnicianMyDay({ profile }: { profile: Profile }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const jobFromUrl = searchParams.get("job");

  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOffRange[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(jobFromUrl);
  const [catalogParts, setCatalogParts] = useState<Part[]>([]);
  const [usedParts, setUsedParts] = useState<(WorkOrderPart & { parts?: Part | null })[]>([]);
  const [laborRows, setLaborRows] = useState<TechnicianLabor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [, startTransition] = useTransition();

  const setJobSelection = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (id) params.set("job", id);
        else params.delete("job");
        const q = params.toString();
        router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams, startTransition],
  );

  // Sync URL → selection (browser back, deep link)
  useEffect(() => {
    if (jobFromUrl !== selectedId) {
      setSelectedId(jobFromUrl);
    }
    // Only react to URL changes, not local selectedId to avoid loops when we wrote the URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobFromUrl]);

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
      setTimeOff([]);
      return;
    }
    setTimeOff((data as TimeOffRange[]) ?? []);
  }, [profile.id, supabase]);

  const loadCatalog = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("parts").select("*").order("name");
    if (loadError) {
      setCatalogParts([]);
      return;
    }
    const all = (data as Part[]) ?? [];
    const active = all.filter((p) => p.is_active === true || p.is_active == null);
    // In-stock first, then name for fast field picking
    const sorted = [...(active.length > 0 ? active : all)].sort((a, b) => {
      const as = a.quantity_on_hand > 0 ? 0 : 1;
      const bs = b.quantity_on_hand > 0 ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.name.localeCompare(b.name);
    });
    setCatalogParts(sorted);
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
    setRefreshing(true);
    await Promise.all([loadJobs(), loadCatalog(), loadTimeOff()]);
    if (selectedId) {
      await Promise.all([loadUsedParts(selectedId), loadLabor(selectedId)]);
    }
    setLastSynced(new Date());
    setRefreshing(false);
  }, [loadJobs, loadCatalog, loadTimeOff, loadUsedParts, loadLabor, selectedId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadJobs(), loadCatalog(), loadTimeOff()]);
      if (!cancelled) {
        setLastSynced(new Date());
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadJobs, loadCatalog, loadTimeOff]);

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

  const openWorking = useMemo(() => jobs.filter((j) => isActivelyWorking(j)), [jobs]);

  function isOnLeaveDay(job: FieldJob): boolean {
    if (!job.scheduled_date) return false;
    return timeOff.some((r) => timeOffCoversDay(r, job.scheduled_date!.slice(0, 10)));
  }

  const greet = `${greetForTime()}, ${firstNameFromProfile(profile.full_name, profile.email)}`;
  const openToday = nowNext.length + later.length;

  // URL job id but not in list (reassigned) — clear quietly after load
  useEffect(() => {
    if (!loading && selectedId && !selected && jobs.length >= 0) {
      const stillLoadingJobs = false;
      if (!stillLoadingJobs && !jobs.some((j) => j.id === selectedId)) {
        setJobSelection(null);
      }
    }
  }, [loading, selectedId, selected, jobs, setJobSelection]);

  if (selected) {
    return (
      <JobSheet
        job={selected}
        profile={profile}
        catalogParts={catalogParts}
        usedParts={usedParts}
        laborRows={laborRows}
        otherOpenJobs={jobs.filter((j) => j.id !== selected.id && isOpenJob(j))}
        onBack={() => setJobSelection(null)}
        onSwitchJob={(id) => setJobSelection(id)}
        onRefresh={refreshAll}
      />
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-8">
      <PageHeader
        title="My Day"
        description={`${greet} · ${format(new Date(), "EEEE, MMM d")}`}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm opacity-70">
          <span className="font-medium text-base-content">{openToday}</span> today
          {" · "}
          <span className="font-medium text-base-content">{upcoming.length}</span> upcoming
          {closeout.length > 0 ? (
            <>
              {" · "}
              <span className="font-medium text-error">{closeout.length} closeout</span>
            </>
          ) : null}
          {lastSynced ? (
            <span className="opacity-50"> · {format(lastSynced, "h:mm a")}</span>
          ) : null}
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-11 gap-1"
          onClick={() => void refreshAll()}
          disabled={refreshing || loading}
          aria-label="Refresh jobs"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link href="/parts" className="btn btn-outline btn-sm min-h-12 flex-col gap-0.5 text-xs">
          <Package className="h-4 w-4" />
          Parts
        </Link>
        <Link href="/scheduling" className="btn btn-outline btn-sm min-h-12 flex-col gap-0.5 text-xs">
          <CalendarDays className="h-4 w-4" />
          Hours
        </Link>
        <Link href="/time-off" className="btn btn-outline btn-sm min-h-12 flex-col gap-0.5 text-xs">
          <CalendarOff className="h-4 w-4" />
          Time off
        </Link>
        <Link href="/dispatch" className="btn btn-outline btn-sm min-h-12 flex-col gap-0.5 text-xs">
          <Radio className="h-4 w-4" />
          Dispatch
        </Link>
      </div>

      {leaveToday.length > 0 ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="status">
          <p className="font-semibold">You’re on approved time off today</p>
          <p className="mt-1 opacity-80">
            {leaveToday.map((r) => formatTimeOffLabel(r.start_date, r.end_date)).join(" · ")}
            {leaveToday[0]?.reason ? ` — ${leaveToday[0].reason}` : ""}. Confirm with the office
            before driving to any job still on this list.
          </p>
          <Link href="/time-off" className="btn btn-ghost btn-xs mt-2">
            View leave requests
          </Link>
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
                {openWorking.length} job{openWorking.length === 1 ? "" : "s"} still{" "}
                <strong>Working</strong> — open and tap Complete.
                {openWorking[0] ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="link link-primary"
                      onClick={() => setJobSelection(openWorking[0]!.id)}
                    >
                      Open {openWorking[0]!.work_order_number}
                    </button>
                  </>
                ) : null}
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
          <p>{error}</p>
          <button type="button" className="btn btn-error btn-outline btn-xs mt-2" onClick={() => void refreshAll()}>
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading jobs">
          <div className="skeleton h-28 w-full rounded-2xl" />
          <div className="skeleton h-28 w-full rounded-2xl" />
          <div className="skeleton h-20 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          <Section id="now-next-heading" title="Now / Next" count={nowNext.length}>
            {nowNext.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-base-300 px-4 py-10 text-center">
                <p className="text-base font-semibold">Nothing open for today</p>
                <p className="mt-1 text-sm opacity-60">
                  {upcoming.length > 0
                    ? "Your next jobs are under Upcoming."
                    : closeout.length > 0
                      ? "Finish jobs under Needs closeout."
                      : "Wait for dispatch — pull to refresh."}
                </p>
              </div>
            ) : (
              nowNext.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  cta={stepCta(job)}
                  onOpen={() => setJobSelection(job.id)}
                  onApprovedLeave={isOnLeaveDay(job)}
                  emphasized={isActivelyWorking(job)}
                />
              ))
            )}
          </Section>

          {later.length > 0 ? (
            <Section id="later-heading" title="Later today" count={later.length}>
              {later.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  cta={stepCta(job)}
                  onOpen={() => setJobSelection(job.id)}
                  onApprovedLeave={isOnLeaveDay(job)}
                />
              ))}
            </Section>
          ) : null}

          {upcoming.length > 0 ? (
            <Section id="upcoming-heading" title="Upcoming" count={upcoming.length}>
              {upcoming.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  cta={stepCta(job)}
                  onOpen={() => setJobSelection(job.id)}
                  onApprovedLeave={isOnLeaveDay(job)}
                />
              ))}
            </Section>
          ) : null}

          {closeout.length > 0 ? (
            <Section id="closeout-heading" title="Needs closeout" tone="error" count={closeout.length}>
              {closeout.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  cta="Close out past job"
                  onOpen={() => setJobSelection(job.id)}
                  onApprovedLeave={isOnLeaveDay(job)}
                />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}
