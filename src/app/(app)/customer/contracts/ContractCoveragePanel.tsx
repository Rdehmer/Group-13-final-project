import { formatMoney } from "@/lib/calculations";
import type { CustomerContract } from "@/lib/contracts";

type Props = {
  contract: CustomerContract;
  compact?: boolean;
};

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <>
      <dt className="opacity-70">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </>
  );
}

export function ContractCoveragePanel({ contract, compact = false }: Props) {
  const partsAllowance =
    contract.included_replacement_parts > 0
      ? formatMoney(contract.included_replacement_parts)
      : null;

  return (
    <dl className={`grid gap-x-4 gap-y-2 ${compact ? "text-sm sm:grid-cols-2" : "sm:grid-cols-2"}`}>
      <DetailRow label="Included visits" value={contract.included_service_visits || null} />
      <DetailRow label="Visit frequency" value={contract.service_frequency} />
      <DetailRow label="Included labor hours" value={contract.included_labor_hours || null} />
      <DetailRow label="Parts allowance" value={partsAllowance} />
      <DetailRow label="Emergency response" value={contract.emergency_response_commitment} />
      {!compact ? (
        <>
          <DetailRow label="Billing method" value={contract.billing_method} />
          <DetailRow label="Payment terms" value={contract.payment_terms} />
          {contract.contract_price > 0 ? (
            <DetailRow label="Contract price" value={formatMoney(contract.contract_price)} />
          ) : null}
        </>
      ) : null}
    </dl>
  );
}
