"use client";

import { useEffect, useState } from "react";
import { Columns2 } from "lucide-react";
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
  const selectedTierDetails = tiers.find((t) => t.id === selectedTier) ?? tiers[0];

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
            Pick an industry and coverage level from the menus. Details update for your selection.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="form-control w-full">
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

          <label className="form-control w-full">
            <span className="label-text text-sm font-medium">Coverage level</span>
            <select
              className="select select-bordered w-full"
              value={selectedTier}
              onChange={(e) => onSelectTier(e.target.value as ContractTierId)}
            >
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                  {recommendedTier === tier.id ? " (recommended)" : ""}
                  {tier.recommended && recommendedTier !== tier.id ? " (popular)" : ""}
                </option>
              ))}
            </select>
            {selectedTierDetails ? (
              <span className="label-text-alt mt-1 opacity-70">{selectedTierDetails.tagline}</span>
            ) : null}
          </label>
        </div>

        <button
          type="button"
          className={`btn btn-lg w-full gap-2 sm:w-auto ${
            showCompare ? "btn-primary" : "btn-secondary"
          }`}
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

      {selectedTierDetails ? (
        <div
          className={`card bg-base-100 shadow ring-1 ring-base-300 ${
            selectedTierDetails.id === "gold" ? "border-t-4 border-warning" : ""
          }`}
        >
          <div className="card-body gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge badge-sm ${TIER_BADGE[selectedTierDetails.id]}`}>
                {selectedTierDetails.name}
              </span>
              {activePack ? (
                <span className="badge badge-sm badge-outline">{activePack.name}</span>
              ) : null}
              {recommendedTier === selectedTierDetails.id ? (
                <span className="badge badge-primary badge-sm">Recommended</span>
              ) : null}
            </div>
            <h3 className="font-bold">{selectedTierDetails.tagline}</h3>
            <ul className="space-y-1 text-sm opacity-80">
              {selectedTierDetails.coverages.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          </div>
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
