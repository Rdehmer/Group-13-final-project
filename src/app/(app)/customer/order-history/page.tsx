"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Profile, WorkOrder } from "@/lib/types";

/**
 * This business faces customer communication gap risk when past service is hard to review.
 * Our app reduces the risk by giving customers a dedicated order history view.
 */
export default function CustomerOrderHistoryPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) {
        setLoading(false);
        return;
      }
      const { data: wo } = await supabase
        .from("work_orders")
        .select("*")
        .eq("customer_id", p.customer_id)
        .order("created_at", { ascending: false });
      setWorkOrders((wo as WorkOrder[]) ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading || !profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState title="No customer account linked" description="Contact Ridley Equipment Services to link your portal account." />
    );
  }

  return (
    <div>
      <PageHeader
        title="Service History"
        description="Past and current service work orders for your account."
        actions={
          <Link href="/customer" className="btn btn-outline btn-sm">
            Request Service
          </Link>
        }
      />

      {workOrders.length === 0 ? (
        <EmptyState
          title="No service history"
          description="Your work orders will appear here after you submit a service request."
          action={
            <Link href="/customer" className="btn btn-primary btn-sm">
              Request Service
            </Link>
          }
        />
      ) : (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>WO #</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Scheduled</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.map((wo) => (
                    <tr key={wo.id}>
                      <td>{wo.work_order_number}</td>
                      <td>{wo.work_order_type}</td>
                      <td><StatusBadge label={wo.status} tone={statusTone(wo.status)} /></td>
                      <td>{wo.scheduled_date ?? "Pending"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
