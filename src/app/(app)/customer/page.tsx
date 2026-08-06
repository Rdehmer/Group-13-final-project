"use client";

import { Suspense, useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Star, UserCircle, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatCard } from "@/components/ui";
import { useCustomerRatingGate } from "@/contexts/CustomerRatingGateContext";
import { shouldPromptForRating } from "@/lib/service-ratings";
import { parseCustomerContracts } from "@/lib/contracts";
import type { Profile, WorkOrder } from "@/lib/types";
import type { CustomerAddressFields } from "@/lib/customer-address";
import { formatCustomerAddress, hasCustomerAddress } from "@/lib/customer-address";
import { emptyBusinessLocationAddress } from "./BusinessLocationCard";

function GatedDashboardLink({
  href,
  isGateActive,
  blockNavigation,
  className,
  children,
}: {
  href: string;
  isGateActive: boolean;
  blockNavigation: (event: MouseEvent<HTMLElement>) => void;
  className?: string;
  children: ReactNode;
}) {
  if (isGateActive) {
    return (
      <span
        role="link"
        aria-disabled="true"
        className={`${className ?? ""} pointer-events-none cursor-not-allowed opacity-50`.trim()}
        onClick={blockNavigation}
      >
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function CustomerDashboardPageInner() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectEquipmentId = searchParams.get("equipment_id");
  const { isGateActive, pendingCount, activeWorkOrder, blockNavigation } = useCustomerRatingGate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipmentCount, setEquipmentCount] = useState(0);
  const [contractCount, setContractCount] = useState(0);
  const [activeContractCount, setActiveContractCount] = useState(0);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [customerAddress, setCustomerAddress] = useState<CustomerAddressFields>(
    emptyBusinessLocationAddress(),
  );

  const loadData = useCallback(async (customerId: string) => {
    const [{ count: eqCount }, { data: wo }, { data: sc }, { data: customer }] = await Promise.all([
      supabase.from("equipment").select("*", { count: "exact", head: true }).eq("customer_id", customerId),
      supabase.from("work_orders").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }),
      supabase
        .from("service_contracts")
        .select(`
          *,
          contract_equipment (
            equipment ( id, name, category, location )
          )
        `)
        .eq("customer_id", customerId),
      supabase
        .from("customers")
        .select("name, service_address, billing_address, city, state, zip_code")
        .eq("id", customerId)
        .single(),
    ]);

    setEquipmentCount(eqCount ?? 0);
    setWorkOrders((wo as WorkOrder[]) ?? []);
    const parsedContracts = parseCustomerContracts(sc ?? []);
    setContractCount(parsedContracts.length);
    setActiveContractCount(parsedContracts.filter((c) => c.status === "Active").length);
    if (customer) {
      setCustomerName(customer.name ?? null);
      setCustomerAddress({
        service_address: customer.service_address,
        billing_address: customer.billing_address,
        city: customer.city,
        state: customer.state,
        zip_code: customer.zip_code,
      });
    }
  }, [supabase]);

  useEffect(() => {
    if (preselectEquipmentId && !isGateActive) {
      router.replace(`/customer/request-service?equipment_id=${preselectEquipmentId}`);
    }
  }, [isGateActive, preselectEquipmentId, router]);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) return;
      await loadData(p.customer_id);
    })();
  }, [loadData, supabase]);

  if (!profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState
        title="No customer account linked"
        description="Contact Ridley Equipment Services to link your portal account."
      />
    );
  }

  const openRequests = workOrders.filter(
    (w) => !["Completed", "Closed", "Canceled"].includes(w.status),
  ).length;

  const linkClassName =
    "block rounded-box transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div>
      <PageHeader
        title="Home"
        description={`Welcome, ${profile.full_name ?? profile.email}. Your account overview and quick links.`}
      />

      {isGateActive && activeWorkOrder && shouldPromptForRating(activeWorkOrder) ? (
        <div role="status" className="alert alert-warning mb-6 shadow-sm">
          <Star className="h-5 w-5 shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium">Rate your recent service</p>
            <p className="opacity-80">
              <span className="font-medium">{activeWorkOrder.work_order_number}</span>
              {activeWorkOrder.equipment?.name ? ` · ${activeWorkOrder.equipment.name}` : ""} was completed.
              Please submit your feedback to continue using the portal.
              {pendingCount > 1 ? ` ${pendingCount} visits awaiting feedback.` : ""}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GatedDashboardLink
          href="/customer/contracts"
          isGateActive={isGateActive}
          blockNavigation={blockNavigation}
          className={linkClassName}
        >
          <StatCard
            label="My Contracts"
            value={contractCount}
            hint={`${activeContractCount} active · View →`}
          />
        </GatedDashboardLink>
        <GatedDashboardLink
          href="/customer/equipment"
          isGateActive={isGateActive}
          blockNavigation={blockNavigation}
          className={linkClassName}
        >
          <StatCard label="My Equipment" value={equipmentCount} hint="View & register →" />
        </GatedDashboardLink>
        <GatedDashboardLink
          href="/customer/open-request"
          isGateActive={isGateActive}
          blockNavigation={blockNavigation}
          className={linkClassName}
        >
          <StatCard label="Active Service" value={openRequests} hint="View status & stage →" />
        </GatedDashboardLink>
        <GatedDashboardLink
          href="/customer/order-history"
          isGateActive={isGateActive}
          blockNavigation={blockNavigation}
          className={linkClassName}
        >
          <StatCard label="Service History" value={workOrders.length} hint="View history →" />
        </GatedDashboardLink>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="card bg-base-100 shadow">
          <div className="card-body gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-box bg-primary/10 p-2.5 text-primary">
                <Wrench className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <h2 className="card-title text-base">Request Service</h2>
                <p className="text-sm opacity-70">
                  Schedule a repair, follow-up, routine check, or emergency visit.
                </p>
              </div>
            </div>
            {isGateActive ? (
              <span
                role="link"
                aria-disabled="true"
                className="btn btn-primary btn-sm w-fit pointer-events-none cursor-not-allowed opacity-50"
                onClick={blockNavigation}
              >
                Start a service request
              </span>
            ) : (
              <Link href="/customer/request-service" className="btn btn-primary btn-sm w-fit">
                Start a service request
              </Link>
            )}
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-box bg-primary/10 p-2.5 text-primary">
                <UserCircle className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="card-title text-base">Account information</h2>
                <p className="text-sm font-medium">{customerName ?? "Your business"}</p>
                <p className="mt-1 text-sm opacity-70 line-clamp-2">
                  {hasCustomerAddress(customerAddress)
                    ? formatCustomerAddress(customerAddress)
                    : "No service location on file yet."}
                </p>
              </div>
            </div>
            {isGateActive ? (
              <span
                role="link"
                aria-disabled="true"
                className="btn btn-outline btn-sm w-fit pointer-events-none cursor-not-allowed opacity-50"
                onClick={blockNavigation}
              >
                View account information
              </span>
            ) : (
              <Link href="/customer/account" className="btn btn-outline btn-sm w-fit">
                View account information →
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CustomerDashboardPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center opacity-60">Loading…</div>}>
      <CustomerDashboardPageInner />
    </Suspense>
  );
}
