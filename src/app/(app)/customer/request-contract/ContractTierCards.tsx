"use client";

import { CONTRACT_TIERS, type ContractTierId } from "@/lib/contracts";

type Props = {
  selectedTier: ContractTierId;
  onSelectTier: (tierId: ContractTierId) => void;
};

const TIER_BADGE: Record<ContractTierId, string> = {
  gold: "badge-warning",
  silver: "badge-ghost",
  bronze: "badge-neutral",
};

export function ContractTierCards({ selectedTier, onSelectTier }: Props) {
  return (
    <div className="mb-6">
      <p className="mb-4 text-sm opacity-70">
        Choose a coverage level. Ridley will confirm final pricing before activation.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {CONTRACT_TIERS.map((tier) => {
          const selected = selectedTier === tier.id;
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
                    {tier.recommended ? (
                      <span className="badge badge-primary badge-sm ml-2">Recommended</span>
                    ) : null}
                  </div>
                  {selected ? (
                    <span className="badge badge-primary badge-sm">Selected</span>
                  ) : null}
                </div>
                <h3 className="mt-2 text-lg font-semibold">{tier.tagline}</h3>
                <ul className="mt-3 space-y-1.5 text-sm opacity-80">
                  {tier.coverages.map((item) => (
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
    </div>
  );
}
