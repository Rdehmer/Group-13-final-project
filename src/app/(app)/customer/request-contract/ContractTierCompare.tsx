"use client";

import { useEffect, useMemo, useState } from "react";
import { listContractTiersForUi, type ContractTierId } from "@/lib/contracts";
import { formatMoney } from "@/lib/calculations";
import {
  CAP_PROFILE_LABEL,
  formatCapSummaryLine,
  getIndustryCapProfile,
} from "@/lib/contract-cap-profiles";
import { loadCompanyCatalog } from "@/lib/company-catalog";
import { createClient } from "@/lib/supabase/client";
import {
  resolvePlan,
  midBandMidpointAssetValue,
  getPack,
  type ContractPlanCatalog,
  type ResolvedPlan,
} from "@/lib/contract-plans";
import {
  premiumForFeeOption,
  coverageCapsFromThresholds,
  AHS_SERVICE_FEE_EXPLAINER,
  NON_CONTRACT_TM_FOOTNOTE,
} from "@/lib/contract-pricing";

type Props = {
  recommendedTier: ContractTierId;
  packId: string;
};

type CompareColumn = {
  tierId: ContractTierId;
  tierName: string;
  tagline: string;
  resolved: ResolvedPlan | null;
  monthly125: number;
  monthly100: number;
  visits: number;
  frequency: string;
  labor: number;
  parts: number;
  perEquipmentCap: number;
  aggregateCap: number;
  maxUnits: number | null;
  sla: string;
  capSummary: string;
};

function buildColumn(
  packId: string,
  tierId: ContractTierId,
  tierName: string,
  tagline: string,
  assetValue: number,
  catalog: ContractPlanCatalog,
): CompareColumn {
  const resolved = resolvePlan(packId, tierId, assetValue, catalog);
  if (!resolved) {
    return {
      tierId,
      tierName,
      tagline,
      resolved: null,
      monthly125: 0,
      monthly100: 0,
      visits: 0,
      frequency: "—",
      labor: 0,
      parts: 0,
      perEquipmentCap: 0,
      aggregateCap: 0,
      maxUnits: null,
      sla: "—",
      capSummary: "—",
    };
  }

  const t = resolved.thresholds;
  const caps = coverageCapsFromThresholds(t, tierId, resolved.band.id, packId);

  return {
    tierId,
    tierName,
    tagline,
    resolved,
    monthly125: premiumForFeeOption(t, 125),
    monthly100: premiumForFeeOption(t, 100),
    visits: t.included_service_visits,
    frequency: t.service_frequency,
    labor: t.included_labor_hours,
    parts: t.included_replacement_parts,
    perEquipmentCap: caps.perEquipmentCap,
    aggregateCap: caps.aggregateCap,
    maxUnits: caps.maxUnits,
    sla: t.emergency_response_commitment,
    capSummary: formatCapSummaryLine({
      perEquipment: caps.perEquipmentCap,
      aggregate: caps.aggregateCap,
    }),
  };
}

export function ContractTierCompare({ recommendedTier, packId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [catalog, setCatalog] = useState<ContractPlanCatalog | null>(null);

  useEffect(() => {
    void (async () => {
      const { catalog: cat } = await loadCompanyCatalog(supabase);
      setCatalog(cat);
    })();
  }, [supabase]);

  const pack = catalog ? getPack(packId, catalog) : null;
  const capProfile = getIndustryCapProfile(packId);

  const columns = useMemo(() => {
    if (!catalog) return [];
    const p = getPack(packId, catalog);
    const assetValue = p ? midBandMidpointAssetValue(p) : 100_000;
    const tierList = listContractTiersForUi(packId);
    return tierList.map((tier) =>
      buildColumn(packId, tier.id, tier.name, tier.tagline, assetValue, catalog),
    );
  }, [packId, catalog]);

  const assetValue = pack ? midBandMidpointAssetValue(pack) : 100_000;

  if (!catalog) {
    return <p className="text-sm opacity-60">Loading plan comparison…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="badge badge-outline badge-sm">{pack?.name ?? "Industry"}</span>
        <span className="badge badge-ghost badge-sm">{CAP_PROFILE_LABEL[capProfile]} caps</span>
        <span className="opacity-60">Mid band reference · asset {formatMoney(assetValue)}</span>
      </div>
      <p className="text-xs opacity-70">{AHS_SERVICE_FEE_EXPLAINER}</p>
      <div className="overflow-x-auto rounded-box border border-base-300">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Feature</th>
              {columns.map((col) => (
                <th key={col.tierId} className="min-w-[9rem] text-center align-top">
                  <div className="font-semibold">{col.tierName}</div>
                  <div className="mt-0.5 text-xs font-normal leading-snug opacity-70">
                    {col.tagline}
                  </div>
                  {col.tierId === recommendedTier ? (
                    <span className="badge badge-primary badge-xs mt-1">Recommended</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Monthly premium @ $125/visit</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center font-medium tabular-nums">
                  {col.monthly125 > 0 ? `${formatMoney(col.monthly125)}/mo` : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>Monthly premium @ $100/visit</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center font-medium tabular-nums">
                  {col.monthly100 > 0 ? `${formatMoney(col.monthly100)}/mo` : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>Service fee options</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center text-xs">
                  $100 or $125 / visit
                </td>
              ))}
            </tr>
            <tr>
              <td>Equipment covered</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center">
                  {col.maxUnits != null && col.maxUnits > 0 ? `Up to ${col.maxUnits}` : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>Visits / year</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center">
                  {col.visits > 0 ? col.visits : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>Frequency</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center">
                  {col.frequency}
                </td>
              ))}
            </tr>
            <tr>
              <td>Labor hours</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center">
                  {col.labor > 0 ? col.labor : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>Parts allowance</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center">
                  {col.parts > 0 ? formatMoney(col.parts) : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>Corrective coverage</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center text-xs leading-snug">
                  {col.capSummary}
                </td>
              ))}
            </tr>
            <tr>
              <td>Per-equipment cap</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center text-xs tabular-nums">
                  {col.perEquipmentCap > 0 ? `${formatMoney(col.perEquipmentCap)}/yr` : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>Aggregate cap</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center text-xs tabular-nums">
                  {col.aggregateCap > 0 ? `${formatMoney(col.aggregateCap)}/yr` : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>Emergency SLA</td>
              {columns.map((col) => (
                <td key={col.tierId} className="text-center text-xs">
                  {col.sla}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs opacity-60">{NON_CONTRACT_TM_FOOTNOTE}</p>
    </div>
  );
}
