"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronRight, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, statusTone } from "@/components/ui";
import { JobSheet } from "@/components/technician/JobSheet";
import { createClient } from "@/lib/supabase/client";
import {
  customerName,
  jobAddress,
  jobTimeLabel,
  nextChecklistStep,
  partitionMyDay,
  priorityBarClass,
  type FieldJob,
} from "@/lib/technician-field";
import type { Part, Profile, TechnicianLabor, WorkOrderPart } from "@/lib/types";

type TruckRow = {
  part_id: string;
  quantity_on_hand: number;
  parts?: Part | null;
};

function JobCard({
  job,
  cta,
  onOpen,
}: {
  job: FieldJob;
  cta: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full overflow-hidden rounded-2xl border border-base-300 bg-base-100 text-left shadow-sm transition hover:border-primary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className={`h-1.5 w-full ${priorityBarClass(job.priority)}`} aria-hidden />
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide opacity-60">{job.work_order_number}</span>
            <StatusBadge label={job.priority} tone={statusTone(job.priority)} />
          </div>
          <p className="truncate text-lg font-bold leading-tight">{customerName(job)}</p>
          <p className="text-sm opacity-70">{jobTimeLabel(job)}</p>
          {jobAddress(job) ? <p className="truncate text-sm opacity-60">{jobAddress(job)}</p> : null}
          <p className="line-clamp-2 text-sm leading-snug">{job.problem_description || "No description"}</p>
          <p className="pt-1 text-sm font-semibold text-primary">{cta}</p>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 opacity-40" aria-hidden />
      </div>
    </button>
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [truckParts, setTruckParts] = useState<TruckRow[]>([]);
  const [usedParts, setUsedParts] = useState<(WorkOrderPart & { parts?: Part | null })[]>([]);
  const [laborRows, setLaborRows] = useState<TechnicianLabor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await supabase
      .from("work_orders")
      .select("*, customers(id, name, service_address, city, state)")
      .eq("assigned_technician_id", profile.id)
      .not("status", "in", '("Canceled")')
      .order("scheduled_date", { ascending: true });

    if (loadError) {
      setError(loadError.message);
      setJobs([]);
      return;
    }
    setJobs((data as FieldJob[]) ?? []);
  }, [profile.id, supabase]);

  const loadTruck = useCallback(async () => {
    const { data } = await supabase
      .from("truck_inventory")
      .select("part_id, quantity_on_hand, parts(*)")
      .eq("technician_id", profile.id)
      .order("updated_at", { ascending: false });
    setTruckParts(((data as unknown as TruckRow[]) ?? []).map((row) => ({
      ...row,
      parts: Array.isArray(row.parts) ? (row.parts[0] as Part | undefined) ?? null : row.parts ?? null,
    })));
  }, [profile.id, supabase]);

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
    await Promise.all([loadJobs(), loadTruck()]);
    if (selectedId) {
      await Promise.all([loadUsedParts(selectedId), loadLabor(selectedId)]);
    }
  }, [loadJobs, loadTruck, loadUsedParts, loadLabor, selectedId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadJobs(), loadTruck()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadJobs, loadTruck]);

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

  if (selected) {
    return (
      <JobSheet
        job={selected}
        profile={profile}
        truckParts={truckParts}
        usedParts={usedParts}
        laborRows={laborRows}
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
        </p>
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
                <JobCard key={job.id} job={job} cta={stepCta(job)} onOpen={() => setSelectedId(job.id)} />
              ))
            )}
          </section>

          {later.length > 0 ? (
            <section className="space-y-3" aria-labelledby="later-heading">
              <h2 id="later-heading" className="text-sm font-bold uppercase tracking-wide opacity-60">
                Later today
              </h2>
              {later.map((job) => (
                <JobCard key={job.id} job={job} cta={stepCta(job)} onOpen={() => setSelectedId(job.id)} />
              ))}
            </section>
          ) : null}

          {upcoming.length > 0 ? (
            <section className="space-y-3" aria-labelledby="upcoming-heading">
              <h2 id="upcoming-heading" className="text-sm font-bold uppercase tracking-wide opacity-60">
                Upcoming
              </h2>
              {upcoming.map((job) => (
                <JobCard key={job.id} job={job} cta={stepCta(job)} onOpen={() => setSelectedId(job.id)} />
              ))}
            </section>
          ) : null}

          {closeout.length > 0 ? (
            <section className="space-y-3" aria-labelledby="closeout-heading">
              <h2 id="closeout-heading" className="text-sm font-bold uppercase tracking-wide text-error">
                Needs closeout
              </h2>
              {closeout.map((job) => (
                <JobCard key={job.id} job={job} cta="Close out past job" onOpen={() => setSelectedId(job.id)} />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
