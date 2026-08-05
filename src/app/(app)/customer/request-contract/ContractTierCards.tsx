"use client";

import { useState } from "react";
import {
  CONTRACT_TIERS,
  getContractTier,
  tierBadgeClass,
  type ContractTierId,
} from "@/lib/contracts";
import { ContractTierCompare } from "./ContractTierCompare";

type Props = {
  selectedTier: ContractTierId;
  recommendedTier: ContractTierId;
  collapsed: boolean;
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
  selectedTier,
  recommendedTier,
  collapsed,
  onSelectTier,
  onContinue,
  onChangePlan,
}: Props) {
  const [showCompare, setShowCompare] = useState(false);
  const activeTier = getContractTier(selectedTier);

  if (collapsed) {
    return (
      <div className="mb-6 flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
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
    <div className="mb-6">
      <p className="mb-4 text-sm opacity-70">
        Choose a coverage level. Ridley will confirm final pricing before activation.
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
          <ContractTierCompare recommendedTier={recommendedTier} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {CONTRACT_TIERS.map((tier) => {
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
                <h3 className="mt-2 text-lg font-semibold">{tier.tagline}</h3>
                <ul className="mt-3 space-y-1.5 text-sm opacity-80">
                  {tier.coverages.slice(0, 6).map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-primary">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" className="btn btn-primary btn-sm" onClick={onContinue}>
          Continue with {activeTier.name}
        </button>
      </div>
    </div>
  );
}
