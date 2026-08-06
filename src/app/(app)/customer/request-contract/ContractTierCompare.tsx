"use client";

import { listContractTiersForUi, type ContractTierId } from "@/lib/contracts";

type Props = {
  recommendedTier: ContractTierId;
  packId: string;
};

export function ContractTierCompare({ recommendedTier, packId }: Props) {
  const tiers = listContractTiersForUi(packId);
  return (
    <div className="overflow-x-auto rounded-box border border-base-300">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Feature</th>
            {tiers.map((tier) => (
              <th key={tier.id} className="text-center">
                {tier.name}
                {tier.id === recommendedTier ? (
                  <span className="badge badge-primary badge-xs ml-1">Recommended</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Visits / year</td>
            {tiers.map((tier) => (
              <td key={tier.id} className="text-center">
                {tier.formDefaults.included_service_visits ?? "—"}
              </td>
            ))}
          </tr>
          <tr>
            <td>Frequency</td>
            {tiers.map((tier) => (
              <td key={tier.id} className="text-center">
                {tier.formDefaults.service_frequency ?? "—"}
              </td>
            ))}
          </tr>
          <tr>
            <td>Labor hours</td>
            {tiers.map((tier) => (
              <td key={tier.id} className="text-center">
                {tier.formDefaults.included_labor_hours ?? "—"}
              </td>
            ))}
          </tr>
          <tr>
            <td>Parts allowance</td>
            {tiers.map((tier) => (
              <td key={tier.id} className="text-center">
                {tier.formDefaults.included_replacement_parts
                  ? `$${Number(tier.formDefaults.included_replacement_parts).toLocaleString()}`
                  : "—"}
              </td>
            ))}
          </tr>
          <tr>
            <td>Emergency SLA</td>
            {tiers.map((tier) => (
              <td key={tier.id} className="text-center text-xs">
                {tier.formDefaults.emergency_response_commitment ?? "—"}
              </td>
            ))}
          </tr>
          <tr>
            <td>From (Mid band)</td>
            {tiers.map((tier) => {
              const priceLine = tier.coverages.find((c) => c.startsWith("From $"));
              return (
                <td key={tier.id} className="text-center text-xs">
                  {priceLine?.replace(/\s*\([^)]*final price set by Ridley\)/, "") ?? "—"}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
