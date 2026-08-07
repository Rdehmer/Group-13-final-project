"use client";

/**
 * Vendor portal jobs — work orders assigned to this portal vendor.
 * Same dispatch + automatic job time as technicians (En Route starts time;
 * Done clocks out). No separate day clock-in.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { JobSheet } from "@/components/technician/JobSheet";
import { createClient } from "@/lib/supabase/client";
import {
  customerName,
  jobAddress,
  jobTimeLabel,
  priorityBarClass,
  type FieldJob,
} from "@/lib/technician-field";
import { normalizeDispatchStatus } from "@/lib/dispatch-flow";
import type { Part, Profile, WorkOrderPart } from "@/lib/types";

export default function VendorJobsPage() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalogParts, setCatalogParts] = useState<Part[]>([]);
  const [usedParts, setUsedParts] = useState<(WorkOrderPart & { parts?: Part | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      setJobs([]);
      setLoading(false);
      return;
    }

    const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    const me = prof as Profile | null;
    setProfile(me);

    if (!me || me.role !== "vendor" || !me.vendor_id) {
      setJobs([]);
      setError(
        !me
          ? "Profile not found."
          : me.role !== "vendor"
            ? "This page is for vendor accounts."
            : "Your account is not linked to a vendor profile.",
      );
      setLoading(false);
      return;
    }

    const [{ data: rows, error: woErr }, { data: parts }] = await Promise.all([
      supabase
        .from("work_orders")
        .select(
          "*, customers(id, name, phone, service_address, city, state), equipment(id, name, model, serial_number)",
        )
        .eq("assigned_vendor_id", me.vendor_id)
        .eq("vendor_assignment_status", "Accepted")
        .not("status", "in", '("Closed","Canceled")')
        .order("scheduled_date", { ascending: true, nullsFirst: false }),
      supabase.from("parts").select("*").eq("is_active", true).order("name"),
    ]);

    if (woErr) setError(woErr.message);
    setJobs((rows as FieldJob[]) ?? []);
    setCatalogParts((parts as Part[]) ?? []);
    setLoading(false);
  }, [supabase]);

  const loadUsedParts = useCallback(
    async (jobId: string) => {
      const { data } = await supabase
        .from("work_order_parts")
        .select("*, parts(*)")
        .eq("work_order_id", jobId);
      setUsedParts((data as (WorkOrderPart & { parts?: Part | null })[]) ?? []);
    },
    [supabase],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const jobId = searchParams.get("job");
    if (jobId && jobs.some((j) => j.id === jobId)) {
      setSelectedId(jobId);
    }
  }, [searchParams, jobs]);

  useEffect(() => {
    if (selectedId) void loadUsedParts(selectedId);
    else setUsedParts([]);
  }, [selectedId, loadUsedParts]);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  async function refreshSelected() {
    await load();
    if (selectedId) await loadUsedParts(selectedId);
  }

  if (loading) {
    return <p className="p-8 text-center text-sm opacity-50">Loading vendor jobs…</p>;
  }

  if (profile && profile.role !== "vendor") {
    return (
      <p className="p-8 text-center text-sm opacity-60">
        This page is for vendor logins. Use a vendor account to view assigned jobs.
      </p>
    );
  }

  if (selected && profile) {
    return (
      <JobSheet
        job={selected}
        profile={profile}
        catalogParts={catalogParts}
        usedParts={usedParts}
        mode="vendor"
        onBack={() => setSelectedId(null)}
        onRefresh={refreshSelected}
      />
    );
  }

  const openJobs = jobs.filter((j) => !["Completed", "Closed", "Canceled"].includes(j.status));
  const doneJobs = jobs.filter((j) => j.status === "Completed" || j.status === "Ready for Review");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description="Accepted work orders only. Dispatch steps track billable time automatically — En Route starts the clock, finishing the job stops it."
        actions={
          <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        }
      />

      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      ) : null}

      {!jobs.length ? (
        <EmptyState
          title="No assigned jobs"
          description="When a service manager assigns a work order to your vendor company, it will show up here."
        />
      ) : (
        <div className="space-y-6">
          {openJobs.length ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">Active</h2>
              <ul className="space-y-3">
                {openJobs.map((job) => {
                  const dispatch = normalizeDispatchStatus(job.dispatch_status ?? "Not Started");
                  const address = jobAddress(job);
                  return (
                    <li key={job.id}>
                      <button
                        type="button"
                        className="w-full overflow-hidden rounded-2xl border border-base-300 bg-base-100 text-left shadow-sm transition hover:border-primary/40"
                        onClick={() => setSelectedId(job.id)}
                      >
                        <div className={`h-1.5 w-full ${priorityBarClass(job.priority)}`} aria-hidden />
                        <div className="flex items-start gap-3 p-4">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wide opacity-60">
                                {job.work_order_number}
                              </span>
                              <StatusBadge label={job.priority} tone={statusTone(job.priority)} />
                              <StatusBadge label={dispatch} tone={statusTone(dispatch)} />
                            </div>
                            <p className="font-semibold leading-tight">{customerName(job)}</p>
                            <p className="text-sm opacity-70">{jobTimeLabel(job)}</p>
                            {address ? <p className="truncate text-sm opacity-60">{address}</p> : null}
                            <p className="line-clamp-2 text-sm opacity-80">
                              {job.problem_description || job.requested_service || "No description"}
                            </p>
                          </div>
                          <ChevronRight className="mt-1 h-5 w-5 shrink-0 opacity-40" />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {doneJobs.length ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
                Ready / completed
              </h2>
              <ul className="space-y-2">
                {doneJobs.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-left text-sm"
                      onClick={() => setSelectedId(job.id)}
                    >
                      <span>
                        <span className="font-medium">{job.work_order_number}</span>
                        <span className="opacity-60"> · {customerName(job)}</span>
                      </span>
                      <StatusBadge label={job.status} tone={statusTone(job.status)} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <p className="text-center text-xs opacity-50">
        <Link href="/vendor" className="link link-hover">
          Back to Vendor Home
        </Link>
      </p>
    </div>
  );
}
