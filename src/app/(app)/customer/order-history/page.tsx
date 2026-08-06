"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatCard } from "@/components/ui";
import type { InvoicePdfCustomer } from "@/lib/invoices";
import {
  computeServiceHistoryStats,
  serviceHistoryFilterTab,
  type ServiceHistoryFilterTab,
  type ServiceHistoryWorkOrder,
} from "@/lib/invoices";
import type { ServiceHistoryRating } from "@/lib/service-ratings";
import { normalizeWorkOrderRating } from "@/lib/service-ratings";
import type { Profile } from "@/lib/types";
import { ServiceHistoryRow } from "./ServiceHistoryRow";

const FILTER_TABS: { id: ServiceHistoryFilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open_balance", label: "Unpaid Invoices" },
  { id: "completed", label: "Completed" },
  { id: "invoiced", label: "Invoiced" },
];

const SERVICE_HISTORY_SELECT = `
  *,
  equipment ( id, name, location ),
  invoices (
    id, invoice_number, invoice_date, due_date, status,
    labor_charges, parts_charges, recurring_service_charge,
    additional_charges, warranty_deductions, discounts, tax,
    invoice_total, amount_paid, remaining_balance, created_at
  ),
  work_order_service_ratings (
    id, work_order_id, overall_rating, technician_rating,
    timeliness_rating, quality_rating, comments, created_at
  )
`;

function CustomerOrderHistoryPageInner() {
  const searchParams = useSearchParams();
  const rateWorkOrderId = searchParams.get("rate");
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [customer, setCustomer] = useState<InvoicePdfCustomer | null>(null);
  const [workOrders, setWorkOrders] = useState<ServiceHistoryWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ServiceHistoryFilterTab>("all");

  const loadData = useCallback(async (customerId: string) => {
    const [{ data: wo }, { data: cust }] = await Promise.all([
      supabase
        .from("work_orders")
        .select(SERVICE_HISTORY_SELECT)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase
        .from("customers")
        .select("name, email, phone, city, state")
        .eq("id", customerId)
        .single(),
    ]);

    setWorkOrders((wo as ServiceHistoryWorkOrder[]) ?? []);
    if (cust) {
      setCustomer({
        name: cust.name,
        email: cust.email,
        phone: cust.phone,
        city: cust.city,
        state: cust.state,
      });
    }
  }, [supabase]);

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
      await loadData(p.customer_id);
      setLoading(false);
    })();
  }, [loadData, supabase]);

  const stats = useMemo(() => computeServiceHistoryStats(workOrders), [workOrders]);

  const filteredOrders = useMemo(
    () => workOrders.filter((wo) => serviceHistoryFilterTab(wo, filter)),
    [workOrders, filter],
  );

  function handleRated(workOrderId: string, rating: ServiceHistoryRating) {
    setWorkOrders((prev) =>
      prev.map((wo) =>
        wo.id === workOrderId
          ? { ...wo, work_order_service_ratings: [rating] }
          : wo,
      ),
    );
  }

  if (loading || !profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id || !customer) {
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
        title="Service History"
        description="Review past visits and download invoices when available."
      />

      {workOrders.length > 0 ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <StatCard label="Total visits" value={stats.totalVisits} hint="All service records" />
          <StatCard label="Completed" value={stats.completed} hint="Finished visits" />
        </div>
      ) : null}

      {workOrders.length === 0 ? (
        <EmptyState
          title="No service history"
          description="Your work orders will appear here after you submit a service request."
          action={
            <Link href="/customer/request-service" className="btn btn-primary btn-sm">
              Request Service
            </Link>
          }
        />
      ) : (
        <>
          <div className="tabs tabs-boxed mb-4 w-fit max-w-full flex-wrap">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`tab ${filter === tab.id ? "tab-active" : ""}`}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredOrders.length === 0 ? (
            <EmptyState
              title="No matching visits"
              description="Try another filter to see your service history."
              action={
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setFilter("all")}>
                  Show all visits
                </button>
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((wo) => (
                <ServiceHistoryRow
                  key={wo.id}
                  workOrder={wo}
                  customer={customer}
                  customerId={profile.customer_id!}
                  rating={normalizeWorkOrderRating(wo)}
                  autoOpenRate={wo.id === rateWorkOrderId}
                  onRated={(rating) => handleRated(wo.id, rating)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * This business faces customer communication gap risk when past service is hard to review.
 * Our app reduces the risk by giving customers a service history view with invoices and downloads.
 */
export default function CustomerOrderHistoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center opacity-60">Loading…</div>}>
      <CustomerOrderHistoryPageInner />
    </Suspense>
  );
}
