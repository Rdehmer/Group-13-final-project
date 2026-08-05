"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Equipment, Profile, WorkOrder } from "@/lib/types";

/** Customer-facing stages for tracking where a service request sits in the process. */
const REQUEST_STAGES = [
  { key: "Requested", label: "Submitted" },
  { key: "Awaiting Approval", label: "Under Review" },
  { key: "Scheduled", label: "Scheduled" },
  { key: "Assigned", label: "Technician Assigned" },
  { key: "In Progress", label: "In Progress" },
  { key: "Waiting on Parts", label: "Waiting on Parts" },
  { key: "Ready for Review", label: "Ready for Review" },
  { key: "Completed", label: "Completed" },
] as const;

function stageIndex(status: string): number {
  if (status === "Closed") return REQUEST_STAGES.length - 1;
  if (status === "Canceled") return -1;
  const idx = REQUEST_STAGES.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

function stageLabel(status: string): string {
  if (status === "Canceled") return "Canceled";
  if (status === "Closed") return "Completed";
  return REQUEST_STAGES.find((s) => s.key === status)?.label ?? status;
}

type OpenWorkOrder = WorkOrder & {
  equipment?: Pick<Equipment, "id" | "name"> | null;
};

/**
 * This business faces customer communication gap risk when service status is opaque.
 * Our app reduces the risk by showing customers request status and process stage.
 */
export default function OpenRequestPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workOrders, setWorkOrders] = useState<OpenWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) {
        setLoading(false);
        return;
      }
      const { data: wo } = await supabase
        .from("work_orders")
        .select("*, equipment(id, name)")
        .eq("customer_id", p.customer_id)
        .not("status", "in", '("Completed","Closed","Canceled")')
        .order("created_at", { ascending: false });
      setWorkOrders((wo as OpenWorkOrder[]) ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading || !profile) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  if (!profile.customer_id) {
    return (
      <EmptyState
        title="No customer account linked"
        description="Contact Ridley Equipment Services to link your portal account."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Open Request"
        description="Track the status of your service requests and see where each one is in the process."
        actions={
          <Link href="/customer" className="btn btn-outline btn-sm">
            Submit new request
          </Link>
        }
      />

      {workOrders.length === 0 ? (
        <EmptyState
          title="No open requests"
          description="When you submit a service request, its status and stage will appear here."
          action={
            <Link href="/customer" className="btn btn-primary btn-sm">
              Go to My Portal
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {workOrders.map((wo) => {
            const current = stageIndex(wo.status);
            return (
              <article key={wo.id} className="card bg-base-100 shadow">
                <div className="card-body gap-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="card-title text-base">{wo.work_order_number}</h2>
                      <p className="mt-1 text-sm opacity-70">
                        {wo.work_order_type}
                        {wo.equipment?.name ? ` · ${wo.equipment.name}` : ""}
                      </p>
                      <p className="mt-2 text-sm">
                        {wo.problem_description ?? wo.requested_service ?? "No description provided"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                      <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                    </div>
                  </div>

                  <div className="rounded-box bg-base-200/60 p-4">
                    <p className="mb-3 text-sm font-medium">
                      Current stage: <span className="text-primary">{stageLabel(wo.status)}</span>
                      {wo.scheduled_date ? (
                        <span className="ml-2 font-normal opacity-70">
                          · Scheduled {wo.scheduled_date}
                        </span>
                      ) : null}
                    </p>
                    <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-1">
                      {REQUEST_STAGES.map((stage, idx) => {
                          const done = current > idx;
                          const active = current === idx;
                          return (
                            <li
                              key={stage.key}
                              className={`rounded-box px-3 py-2 text-xs sm:flex-1 sm:min-w-[7rem] ${
                                active
                                  ? "bg-primary text-primary-content font-semibold"
                                  : done
                                    ? "bg-success/20 text-success"
                                    : "bg-base-100 opacity-50"
                              }`}
                            >
                              {stage.label}
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
