"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatServiceDate } from "@/lib/invoices";
import {
  buildWorkOrderStageDates,
  CUSTOMER_REQUEST_STAGES,
  customerRequestStageIndex,
  customerRequestStageLabel,
  type WorkOrderStatusActivity,
} from "@/lib/work-order-status";
import type { Equipment, Profile, WorkOrder } from "@/lib/types";

type OpenWorkOrder = WorkOrder & {
  equipment?: Pick<Equipment, "id" | "name"> | null;
};

function OpenRequestPageInner() {
  const searchParams = useSearchParams();
  const supabase = createClient();
  const highlightId = searchParams.get("highlight");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workOrders, setWorkOrders] = useState<OpenWorkOrder[]>([]);
  const [statusActivities, setStatusActivities] = useState<
    Record<string, WorkOrderStatusActivity[]>
  >({});
  const [loading, setLoading] = useState(true);
  const highlightRef = useRef<HTMLDivElement>(null);
  const scrolledToHighlight = useRef(false);

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
      const orders = (wo as OpenWorkOrder[]) ?? [];
      setWorkOrders(orders);

      if (orders.length > 0) {
        const { data: logs, error } = await supabase
          .from("activity_logs")
          .select("record_id, action, new_value, created_at")
          .eq("record_type", "work_order")
          .eq("action", "status_change")
          .in(
            "record_id",
            orders.map((order) => order.id),
          )
          .order("created_at", { ascending: true });

        if (!error && logs) {
          const byWorkOrder: Record<string, WorkOrderStatusActivity[]> = {};
          for (const row of logs) {
            if (!row.record_id) continue;
            const bucket = byWorkOrder[row.record_id] ?? [];
            bucket.push({
              action: row.action,
              new_value: row.new_value,
              created_at: row.created_at,
            });
            byWorkOrder[row.record_id] = bucket;
          }
          setStatusActivities(byWorkOrder);
        }
      }

      setLoading(false);
    })();
  }, [supabase]);

  useEffect(() => {
    if (highlightId) {
      scrolledToHighlight.current = false;
    }
  }, [highlightId]);

  useEffect(() => {
    if (loading || !highlightId || scrolledToHighlight.current) return;
    if (!workOrders.some((wo) => wo.id === highlightId)) return;

    const frame = requestAnimationFrame(() => {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      scrolledToHighlight.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [loading, highlightId, workOrders]);

  if (loading || !profile) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  if (!profile.customer_id) {
    return (
      <EmptyState
        title="No customer account linked"
        description="Contact EquipmentIQ to link your portal account."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Active Service"
        description="Track the status of your service requests and see where each one is in the process."
        actions={
          <Link href="/customer/request-service" className="btn btn-outline btn-sm">
            Submit New Request
          </Link>
        }
      />

      {workOrders.length === 0 ? (
        <EmptyState
          title="No active service"
          description="When you submit a service request, its status and stage will appear here."
          action={
            <Link href="/customer/request-service" className="btn btn-primary btn-sm">
              Request Service
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {workOrders.map((wo) => {
            const highlighted = wo.id === highlightId;
            const current = customerRequestStageIndex(wo);
            const stageDates = buildWorkOrderStageDates(wo, statusActivities[wo.id] ?? []);
            return (
              <div
                key={wo.id}
                ref={highlighted ? highlightRef : undefined}
                className={highlighted ? "customer-request-highlight-wrap" : undefined}
              >
                <article className="card bg-base-100 shadow">
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
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium">
                        Current stage: <span className="text-primary">{customerRequestStageLabel(wo)}</span>
                        {wo.scheduled_date ? (
                          <span className="ml-2 font-normal opacity-70">
                            · Scheduled {wo.scheduled_date}
                          </span>
                        ) : null}
                      </p>
                      <Link
                        href={`/customer/inbox?work_order_id=${wo.id}`}
                        className="btn btn-outline btn-xs gap-1 sm:btn-sm"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Follow Up
                      </Link>
                    </div>
                    <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-1">
                      {CUSTOMER_REQUEST_STAGES.map((stage, idx) => {
                        const done = current > idx;
                        const active = current === idx;
                        const stageDate =
                          done || active ? stageDates[stage.key] : undefined;
                        return (
                          <li
                            key={stage.key}
                            className={`rounded-box px-3 py-2 text-xs sm:min-w-[7rem] sm:flex-1 ${
                              active
                                ? "bg-primary font-semibold text-primary-content"
                                : done
                                  ? "bg-success/20 text-success"
                                  : "bg-base-100 opacity-50"
                            }`}
                          >
                            {stage.label}
                            {stageDate ? (
                              <span
                                className={`mt-0.5 block text-[10px] font-normal ${
                                  active ? "opacity-90" : "opacity-70"
                                }`}
                              >
                                {formatServiceDate(stageDate)}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </article>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * This business faces customer communication gap risk when service status is opaque.
 * Our app reduces the risk by showing customers request status and process stage.
 */
export default function OpenRequestPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center opacity-60">Loading…</div>}>
      <OpenRequestPageInner />
    </Suspense>
  );
}
