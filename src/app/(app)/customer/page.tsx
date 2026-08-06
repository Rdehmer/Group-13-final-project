"use client";

import { Suspense, useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, CreditCard, FilePlus2, Star, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";
import { useCustomerRatingGate } from "@/contexts/CustomerRatingGateContext";
import { shouldPromptForRating } from "@/lib/service-ratings";
import { parseCustomerContracts } from "@/lib/contracts";
import type { Profile, WorkOrder } from "@/lib/types";
import type { CustomerAddressFields } from "@/lib/customer-address";
import { formatCustomerAddress, hasCustomerAddress } from "@/lib/customer-address";
import { CustomerHomeLoading } from "@/components/customer/CustomerHomeLoading";
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

function HomePrimaryAction({
  href,
  title,
  description,
  icon,
  isGateActive,
  blockNavigation,
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  isGateActive: boolean;
  blockNavigation: (event: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <GatedDashboardLink
      href={href}
      isGateActive={isGateActive}
      blockNavigation={blockNavigation}
      className="flex min-h-[7.5rem] flex-col justify-between gap-4 rounded-2xl border border-primary/25 bg-primary px-5 py-5 text-primary-content shadow-md transition hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-xl bg-primary-content/15 p-2.5">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-content/75">
          Start here
        </span>
      </div>
      <div>
        <p className="font-display text-xl font-semibold leading-tight !text-white">{title}</p>
        <p className="mt-1 text-sm text-primary-content/80">{description}</p>
      </div>
    </GatedDashboardLink>
  );
}

function HomeSectionCard({
  title,
  description,
  icon,
  primaryAction,
  links,
  isGateActive,
  blockNavigation,
  footer,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  primaryAction?: { href: string; label: string };
  links: { href: string; label: string; hint?: string }[];
  isGateActive: boolean;
  blockNavigation: (event: MouseEvent<HTMLElement>) => void;
  footer?: ReactNode;
}) {
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-box bg-primary/10 p-2.5 text-primary">{icon}</div>
          <div>
            <h2 className="card-title text-base">{title}</h2>
            <p className="text-sm opacity-70">{description}</p>
          </div>
        </div>
        {primaryAction ? (
          <GatedDashboardLink
            href={primaryAction.href}
            isGateActive={isGateActive}
            blockNavigation={blockNavigation}
            className="btn btn-primary w-full sm:w-auto"
          >
            {primaryAction.label}
          </GatedDashboardLink>
        ) : null}
        <div className="flex flex-wrap gap-2" role="list" aria-label={`${title} links`}>
          {links.map((link) => (
            <GatedDashboardLink
              key={`${link.href}-${link.label}`}
              href={link.href}
              isGateActive={isGateActive}
              blockNavigation={blockNavigation}
              className="btn btn-sm btn-outline"
            >
              {link.label}
              {link.hint ? <span className="opacity-60"> · {link.hint}</span> : null}
            </GatedDashboardLink>
          ))}
        </div>
        {footer}
      </div>
    </div>
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

  if (!profile) return <CustomerHomeLoading />;

  if (!profile.customer_id) {
    return (
      <EmptyState
        title="No customer account linked"
        description="Contact EquipmentIQ to link your portal account."
      />
    );
  }

  const openRequests = workOrders.filter(
    (w) => !["Completed", "Closed", "Canceled"].includes(w.status),
  ).length;

  return (
    <div>
      <PageHeader
        title="Home"
        description={`Welcome, ${profile.full_name ?? profile.email}. Request a contract or service below.`}
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

      <section className="mb-6" aria-labelledby="home-primary-actions">
        <h2 id="home-primary-actions" className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] opacity-60">
          What do you need?
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <HomePrimaryAction
            href="/customer/request-contract"
            title="Request a contract"
            description="Choose coverage for your equipment and send a request to EquipmentIQ."
            icon={<FilePlus2 className="h-5 w-5" aria-hidden />}
            isGateActive={isGateActive}
            blockNavigation={blockNavigation}
          />
          <HomePrimaryAction
            href="/customer/request-service"
            title="Request service"
            description="Book a repair, maintenance visit, or other work order."
            icon={<Wrench className="h-5 w-5" aria-hidden />}
            isGateActive={isGateActive}
            blockNavigation={blockNavigation}
          />
        </div>
      </section>

      <div className="space-y-4">
        <HomeSectionCard
          title="Contracts"
          description="Agreements, equipment, and coverage"
          icon={<ClipboardList className="h-5 w-5" aria-hidden />}
          isGateActive={isGateActive}
          blockNavigation={blockNavigation}
          primaryAction={{ href: "/customer/request-contract", label: "Request a contract" }}
          links={[
            {
              href: "/customer/contracts",
              label: "My Contracts",
              hint: `${activeContractCount} active`,
            },
            {
              href: "/customer/equipment",
              label: "Equipment",
              hint: String(equipmentCount),
            },
          ]}
        />

        <HomeSectionCard
          title="Service"
          description="Book work and track jobs"
          icon={<Wrench className="h-5 w-5" aria-hidden />}
          isGateActive={isGateActive}
          blockNavigation={blockNavigation}
          primaryAction={{ href: "/customer/request-service", label: "Request service" }}
          links={[
            {
              href: "/customer/open-request",
              label: "Active requests",
              hint: String(openRequests),
            },
            {
              href: "/customer/order-history",
              label: "Service history",
              hint: String(workOrders.length),
            },
          ]}
        />

        <HomeSectionCard
          title="Billing & Account"
          description="Pay invoices and manage your profile"
          icon={<CreditCard className="h-5 w-5" aria-hidden />}
          isGateActive={isGateActive}
          blockNavigation={blockNavigation}
          links={[
            { href: "/customer/pay", label: "Payments" },
            { href: "/customer/account", label: "Account" },
          ]}
          footer={
            <p className="text-sm opacity-70">
              <span className="font-medium opacity-100">{customerName ?? "Your business"}</span>
              {" · "}
              {hasCustomerAddress(customerAddress)
                ? formatCustomerAddress(customerAddress)
                : "No service location on file yet."}
            </p>
          }
        />
      </div>
    </div>
  );
}

export default function CustomerDashboardPage() {
  return (
    <Suspense fallback={<CustomerHomeLoading />}>
      <CustomerDashboardPageInner />
    </Suspense>
  );
}
