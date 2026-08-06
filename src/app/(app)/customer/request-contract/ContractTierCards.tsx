"use client";

import { useEffect, useMemo, useState } from "react";
import { Columns2 } from "lucide-react";
import {
  getContractTier,
  listContractTiersForUi,
  tierBadgeClass,
  type ContractTierId,
} from "@/lib/contracts";
import { formatMoney } from "@/lib/calculations";
import {
  listActivePacks,
  loadCatalog,
  midBandMidpointAssetValue,
  resolvePlan,
  type IndustryPack,
} from "@/lib/contract-plans";
import { premiumForFeeOption } from "@/lib/contract-pricing";
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
  const assetValue = useMemo(() => {
    if (!activePack) return 100_000;
    return midBandMidpointAssetValue(activePack);
  }, [activePack]);

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
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-sm font-medium">What kind of coverage do you need?</p>
          <p className="text-sm opacity-70">
            Choose your industry, then pick Gold, Silver, or Bronze. All three plans are shown below.
          </p>
        </div>

        <label className="form-control w-full max-w-md">
          <span className="label-text text-sm font-medium">Industry</span>
          <select
            className="select select-bordered w-full"
            value={selectedPackId}
            onChange={(e) => onSelectPack(e.target.value)}
          >
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name}
              </option>
            ))}
          </select>
          {activePack ? (
            <span className="label-text-alt mt-1 opacity-70">{activePack.description}</span>
          ) : null}
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {tiers.map((tier) => {
          const resolved = resolvePlan(selectedPackId, tier.id, assetValue, loadCatalog());
          const monthly125 = resolved
            ? premiumForFeeOption(resolved.thresholds, 125)
            : 0;
          const monthly100 = resolved
            ? premiumForFeeOption(resolved.thresholds, 100)
            : 0;
          const selected = selectedTier === tier.id;

          return (
            <button
              key={tier.id}
              type="button"
              className={`card bg-base-100 text-left shadow transition hover:shadow-md ${
                selected ? "ring-2 ring-primary" : "ring-1 ring-base-300"
              } ${tier.id === "gold" ? "border-t-4 border-warning" : ""}`}
              onClick={() => onSelectTier(tier.id)}
              aria-pressed={selected}
            >
              <div className="card-body gap-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge badge-sm ${TIER_BADGE[tier.id]}`}>{tier.name}</span>
                  {recommendedTier === tier.id ? (
                    <span className="badge badge-primary badge-sm">Recommended</span>
                  ) : null}
                  {tier.recommended && recommendedTier !== tier.id ? (
                    <span className="badge badge-outline badge-sm">Popular</span>
                  ) : null}
                </div>
                <h3 className="font-bold leading-snug">{tier.tagline}</h3>
                {monthly125 > 0 ? (
                  <p className="text-sm">
                    <span className="font-semibold tabular-nums">{formatMoney(monthly125)}/mo</span>
                    <span className="opacity-70"> @ $125/visit</span>
                    <span className="block text-xs opacity-60">
                      or {formatMoney(monthly100)}/mo @ $100/visit
                    </span>
                  </p>
                ) : null}
                <ul className="space-y-1 text-sm opacity-80">
                  {tier.coverages.slice(0, 6).map((c) => (
                    <li key={c}>• {c}</li>
                  ))}
                </ul>
                {selected ? (
                  <span className="text-xs font-medium text-primary">Selected</span>
                ) : (
                  <span className="text-xs opacity-60">Select {tier.name}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`btn gap-2 ${showCompare ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setShowCompare((v) => !v)}
          aria-expanded={showCompare}
        >
          <Columns2 className="h-5 w-5" />
          {showCompare ? "Hide plan comparison" : "Compare Gold, Silver & Bronze"}
        </button>
      </div>

      {showCompare ? (
        <div className="rounded-box border-2 border-secondary/40 bg-secondary/5 p-4">
          <p className="mb-3 text-sm font-semibold">
            Side-by-side for {activePack?.name ?? "this industry"}
          </p>
          <ContractTierCompare recommendedTier={recommendedTier} packId={selectedPackId} />
        </div>
      ) : null}

      <div className="flex justify-end">
        <button type="button" className="btn btn-primary" onClick={onContinue}>
          Continue with {activePack?.name ?? "this"} {activeTier.name}
        </button>
      </div>
    </div>
  );
}
