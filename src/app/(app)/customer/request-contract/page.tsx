"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ContractRequestForm } from "@/app/(app)/customer/request-contract/ContractRequestForm";
import { ContractTierCards } from "@/app/(app)/customer/request-contract/ContractTierCards";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatCard } from "@/components/ui";
import {
  contractFilterTab,
  loadContractDraft,
  parseCustomerContracts,
  suggestTier,
  type ContractTierId,
  type CustomerContract,
} from "@/lib/contracts";
import {
  DEFAULT_CUSTOMER_PACK_ID,
  listActivePacks,
  loadCatalog,
} from "@/lib/contract-plans";
import type { Equipment, Profile } from "@/lib/types";

export default function RequestContractPage() {
  const supabase = createClient();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [customerName, setCustomerName] = useState("Customer");
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [contracts, setContracts] = useState<CustomerContract[]>([]);
  const [selectedPackId, setSelectedPackId] = useState(DEFAULT_CUSTOMER_PACK_ID);
  const [selectedTier, setSelectedTier] = useState<ContractTierId>("silver");
  const [tiersCollapsed, setTiersCollapsed] = useState(false);
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

      const [{ data: sc }, { data: eq }, { data: customer }] = await Promise.all([
        supabase
          .from("service_contracts")
          .select(`
            *,
            contract_equipment (
              equipment ( id, name, category, location )
            )
          `)
          .eq("customer_id", p.customer_id)
          .order("created_at", { ascending: false }),
        supabase.from("equipment").select("*").eq("customer_id", p.customer_id).order("name"),
        supabase.from("customers").select("name").eq("id", p.customer_id).single(),
      ]);

      setCustomerName((customer as { name?: string } | null)?.name?.trim() || "Customer");

      const equipmentList = (eq as Equipment[]) ?? [];
      setEquipment(equipmentList);

      const parsed = parseCustomerContracts(sc ?? []);
      setContracts(parsed);

      const packs = listActivePacks(loadCatalog());
      const draft = loadContractDraft(p.customer_id);
      const activeContractCount = parsed.filter((c) => contractFilterTab(c, "active")).length;
      const recommended = suggestTier(equipmentList.length, activeContractCount > 0);

      const draftPack =
        draft?.packId && packs.some((x) => x.id === draft.packId)
          ? draft.packId
          : packs[0]?.id ?? DEFAULT_CUSTOMER_PACK_ID;
      setSelectedPackId(draftPack);

      if (draft?.tierId) {
        setSelectedTier(draft.tierId);
        setTiersCollapsed(true);
      } else {
        setSelectedTier(recommended);
      }

      setLoading(false);
    })();
  }, [supabase]);

  const activeCount = useMemo(
    () => contracts.filter((c) => contractFilterTab(c, "active")).length,
    [contracts],
  );
  const pendingCount = useMemo(
    () => contracts.filter((c) => contractFilterTab(c, "pending")).length,
    [contracts],
  );
  const recommendedTier = useMemo(
    () => suggestTier(equipment.length, activeCount > 0),
    [equipment.length, activeCount],
  );

  if (loading || !profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState title="No customer account linked" description="Contact Ridley Equipment Services to link your portal account." />
    );
  }

  return (
    <div>
      <PageHeader
        title="Request a Service Contract"
        description="Choose your industry and coverage level, tell us what to protect, and submit for Ridley's review—pricing confirmed before activation."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Link href="/customer/contracts" className="block rounded-box transition hover:opacity-90">
          <StatCard label="Active contracts" value={activeCount} hint="View agreements →" />
        </Link>
        <Link href="/customer/contracts?filter=pending" className="block rounded-box transition hover:opacity-90">
          <StatCard
            label="Pending requests"
            value={pendingCount}
            hint={pendingCount > 0 ? "Awaiting review" : "None waiting"}
            danger={pendingCount > 0}
          />
        </Link>
        <StatCard label="Equipment on file" value={equipment.length} hint="Units to cover" />
      </div>

      <ContractTierCards
        selectedPackId={selectedPackId}
        selectedTier={selectedTier}
        recommendedTier={recommendedTier}
        collapsed={tiersCollapsed}
        onSelectPack={(packId) => {
          setSelectedPackId(packId);
          setTiersCollapsed(false);
        }}
        onSelectTier={(tierId) => {
          setSelectedTier(tierId);
        }}
        onContinue={() => setTiersCollapsed(true)}
        onChangePlan={() => setTiersCollapsed(false)}
      />

      {tiersCollapsed ? (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <ContractRequestForm
              supabase={supabase}
              customerId={profile.customer_id}
              customerName={customerName}
              equipment={equipment}
              activeContracts={contracts}
              selectedTier={selectedTier}
              selectedPackId={selectedPackId}
              onSuccess={({ id }) => {
                router.push(`/customer/contracts?filter=pending&highlight=${id}`);
              }}
              onEquipmentAdded={(item) => {
                setEquipment((prev) =>
                  prev.some((e) => e.id === item.id)
                    ? prev
                    : [...prev, item].sort((a, b) => a.name.localeCompare(b.name)),
                );
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
