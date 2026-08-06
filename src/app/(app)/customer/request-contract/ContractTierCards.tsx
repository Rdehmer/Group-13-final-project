"use client";

import { useEffect, useState } from "react";
import {
  getContractTier,
  listContractTiersForUi,
  tierBadgeClass,
  type ContractTierId,
} from "@/lib/contracts";
import { listActivePacks, loadCatalog, type IndustryPack } from "@/lib/contract-plans";
import { ContractTierCompare } from "./ContractTierCompare";

type Props = {
  selectedPackId: string;
  selectedTier: ContractTierId;
  recommendedTier: ContractTierId;
  collapsed: boolean;
  onSelectPack: (packId: string) => void;
  onSelectTier: (tierId: ContractTierId) => void;
  onContinue: () => void;
  onChangePlan: () => void;
};

const TIER_BADGE: Record<ContractTierId, string> = {
  gold: "badge-warning",
  silver: "badge-ghost",
  bronze: "badge-neutral",
};

export function ContractTierCards({
  selectedPackId,
  selectedTier,
  recommendedTier,
  collapsed,
  onSelectPack,
  onSelectTier,
  onContinue,
  onChangePlan,
}: Props) {
  const [showCompare, setShowCompare] = useState(false);
  const [packs, setPacks] = useState<IndustryPack[]>([]);

  useEffect(() => {
    setPacks(listActivePacks(loadCatalog()));
  }, []);

  const activePack = packs.find((p) => p.id === selectedPackId) ?? packs[0];
  const activeTier = getContractTier(selectedTier, selectedPackId);
  const tiers = listContractTiersForUi(selectedPackId);

  if (collapsed) {
    return (
      <div className="mb-6 flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {activePack ? (
            <span className="badge badge-sm badge-outline">{activePack.name}</span>
          ) : null}
          <span className={`badge badge-sm ${tierBadgeClass(selectedTier)}`}>{activeTier.name}</span>
          <span className="text-sm font-medium">{activeTier.tagline}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onChangePlan}>
          Change plan
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 space-y-6">
      <div>
        <p className="mb-2 text-sm font-medium">What kind of coverage do you need?</p>
        <p className="mb-3 text-sm opacity-70">
          Choose your industry type first. Gold, Silver, and Bronze options update to match that
          industry.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((pack) => {
            const selected = selectedPackId === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                onClick={() => onSelectPack(pack.id)}
                className={`rounded-box border px-4 py-3 text-left transition ${
                  selected
                    ? "border-primary bg-primary/10 ring-2 ring-primary"
                    : "border-base-300 bg-base-100 hover:border-primary/40"
                }`}
              >
                <span className="font-semibold">{pack.name}</span>
                <span className="mt-1 block text-xs opacity-70">{pack.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-4 text-sm opacity-70">
          Choose a coverage level
          {activePack ? (
            <>
              {" "}
              for <span className="font-medium">{activePack.name}</span>
            </>
          ) : null}
          . Ridley will confirm final pricing before activation.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setShowCompare((v) => !v)}
          >
            {showCompare ? "Hide compare plans" : "Compare plans"}
          </button>
        </div>

        {showCompare ? (
          <div className="mb-4">
            <ContractTierCompare recommendedTier={recommendedTier} packId={selectedPackId} />
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          {tiers.map((tier) => {
            const selected = selectedTier === tier.id;
            const recommended = recommendedTier === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => onSelectTier(tier.id)}
                className={`card bg-base-100 text-left shadow transition-all hover:shadow-md ${
                  selected ? "ring-2 ring-primary" : "ring-1 ring-base-300"
                } ${tier.id === "gold" ? "border-t-4 border-warning" : ""}`}
              >
                <div className="card-body p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className={`badge badge-sm ${TIER_BADGE[tier.id]}`}>{tier.name}</span>
                      {recommended ? (
                        <span className="badge badge-primary badge-sm ml-2">Recommended</span>
                      ) : null}
                      {tier.recommended && !recommended ? (
                        <span className="badge badge-ghost badge-sm ml-2">Popular</span>
                      ) : null}
                    </div>
                    {selected ? (
                      <span className="badge badge-primary badge-sm">Selected</span>
                    ) : null}
                  </div>
                  <h3 className="mt-2 font-bold">{tier.tagline}</h3>
                  <ul className="mt-3 space-y-1 text-sm opacity-80">
                    {tier.coverages.slice(0, 5).map((c) => (
                      <li key={c}>• {c}</li>
                    ))}
                  </ul>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" className="btn btn-primary" onClick={onContinue}>
            Continue with {activePack?.name ?? "this"} {activeTier.name}
          </button>
        </div>
      </div>
    </div>
  );
}
