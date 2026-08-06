"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatCard } from "@/components/ui";
import {
  contractFilterTab,
  isExpiringSoon,
  parseCustomerContracts,
  type ContractFilterTab,
  type CustomerContract,
} from "@/lib/contracts";
import type { Profile } from "@/lib/types";
import { ContractCard } from "./ContractCard";

const FILTER_TABS: { id: ContractFilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending" },
  { id: "expired", label: "Expired" },
];

function CustomerContractsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contracts, setContracts] = useState<CustomerContract[]>([]);
  const [loading, setLoading] = useState(true);
  const highlightId = searchParams.get("highlight");
  const initialFilter = searchParams.get("filter");
  const [filter, setFilter] = useState<ContractFilterTab>(
    initialFilter === "active" || initialFilter === "pending" || initialFilter === "expired"
      ? initialFilter
      : highlightId
        ? "pending"
        : "all",
  );
  const [showSubmittedBanner, setShowSubmittedBanner] = useState(Boolean(highlightId));
  const highlightRef = useRef<HTMLElement>(null);
  const scrolledToHighlight = useRef(false);

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
      const { data: sc } = await supabase
        .from("service_contracts")
        .select(`
          *,
          contract_equipment (
            equipment ( id, name, category, location )
          )
        `)
        .eq("customer_id", p.customer_id)
        .order("created_at", { ascending: false });
      setContracts(parseCustomerContracts(sc ?? []));
      setLoading(false);
    })();
  }, [supabase]);

  useEffect(() => {
    if (highlightId) {
      setFilter("pending");
      setShowSubmittedBanner(true);
      scrolledToHighlight.current = false;
    }
  }, [highlightId]);

  const highlightedContract = useMemo(
    () => (highlightId ? contracts.find((c) => c.id === highlightId) ?? null : null),
    [contracts, highlightId],
  );

  const activeContracts = useMemo(
    () => contracts.filter((c) => contractFilterTab(c, "active")),
    [contracts],
  );
  const pendingContracts = useMemo(
    () => contracts.filter((c) => contractFilterTab(c, "pending")),
    [contracts],
  );
  const expiringSoonCount = useMemo(
    () => activeContracts.filter((c) => isExpiringSoon(c.end_date)).length,
    [activeContracts],
  );
  const coveredEquipmentCount = useMemo(
    () => new Set(activeContracts.flatMap((c) => c.equipment.map((eq) => eq.id))).size,
    [activeContracts],
  );
  const filteredContracts = useMemo(
    () => contracts.filter((c) => contractFilterTab(c, filter)),
    [contracts, filter],
  );

  useEffect(() => {
    if (loading || !highlightId || scrolledToHighlight.current) return;
    if (!filteredContracts.some((c) => c.id === highlightId)) return;

    const frame = requestAnimationFrame(() => {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      scrolledToHighlight.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [loading, highlightId, filteredContracts]);

  function dismissSubmittedBanner() {
    setShowSubmittedBanner(false);
    if (highlightId) {
      router.replace("/customer/contracts?filter=pending", { scroll: false });
    }
  }

  if (loading || !profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState title="No customer account linked" description="Contact Ridley Equipment Services to link your portal account." />
    );
  }

  return (
    <div>
      <PageHeader
        title="My Contracts"
        description="See what's covered, what's pending, and when agreements renew."
        actions={
          <Link href="/customer/request-contract" className="btn btn-primary btn-sm">
            Request Contract
          </Link>
        }
      />

      {showSubmittedBanner && highlightedContract ? (
        <div role="status" className="alert alert-success mb-6 shadow-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium">Contract request submitted</p>
            <p className="opacity-80">
              <span className="font-medium">{highlightedContract.name}</span> is pending Ridley&apos;s review.
              Pricing will be confirmed before activation.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismissSubmittedBanner}>
            Dismiss
          </button>
        </div>
      ) : null}

      {contracts.length === 0 ? (
        <EmptyState
          title="No contracts yet"
          description="Submit a contract request to start a new agreement. Choose Gold, Silver, or Bronze coverage on the request form."
          action={
            <Link href="/customer/request-contract" className="btn btn-primary btn-sm">
              Request Contract
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Active agreements"
              value={activeContracts.length}
              hint={`${coveredEquipmentCount} piece${coveredEquipmentCount === 1 ? "" : "s"} of equipment covered`}
            />
            <StatCard
              label="Pending approval"
              value={pendingContracts.length}
              hint={pendingContracts.length > 0 ? "Ridley is reviewing" : "No requests waiting"}
              danger={pendingContracts.length > 0}
            />
            <StatCard
              label="Expiring soon"
              value={expiringSoonCount}
              hint="Within 60 days"
              danger={expiringSoonCount > 0}
            />
          </div>

          <div role="tablist" className="tabs tabs-boxed mb-4 w-fit">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className={`tab ${filter === tab.id ? "tab-active" : ""}`}
                aria-selected={filter === tab.id}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredContracts.length === 0 ? (
            <EmptyState
              title={`No ${filter === "all" ? "" : filter} contracts`}
              description="Try another filter to see your agreements."
              action={
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setFilter("all")}>
                  Show all contracts
                </button>
              }
            />
          ) : (
            <div className="space-y-4">
              {filteredContracts.map((contract) => (
                <ContractCard
                  key={contract.id}
                  contract={contract}
                  highlighted={contract.id === highlightId}
                  highlightRef={contract.id === highlightId ? highlightRef : undefined}
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
 * This business faces customer communication gap risk when agreements are hard to find.
 * Our app reduces the risk by giving customers a clear contracts view in their portal.
 */
export default function CustomerContractsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center opacity-60">Loading…</div>}>
      <CustomerContractsPageInner />
    </Suspense>
  );
}
