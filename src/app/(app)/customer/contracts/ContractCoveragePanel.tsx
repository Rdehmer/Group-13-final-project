import { ContractPricingSummary } from "@/components/ContractPricingSummary";
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
  return (
    <div className="space-y-4">
      <ContractPricingSummary variant="contract" contract={contract} compact={compact} />
      {!compact ? (
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <DetailRow label="Visit frequency" value={contract.service_frequency} />
          <DetailRow label="Emergency response" value={contract.emergency_response_commitment} />
          <DetailRow label="Payment terms" value={contract.payment_terms} />
        </dl>
      ) : null}
    </div>
  );
}
