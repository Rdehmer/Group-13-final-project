import Link from "next/link";
import {
  CONTRACT_TYPE_HELP,
  contractStatusMessage,
  formatContractTerm,
  formatCoverageSummary,
  formatEquipmentPreview,
  formatRenewalNote,
  inferContractTier,
  isExpiringSoon,
  tierBadgeClass,
  type CustomerContract,
} from "@/lib/contracts";
import { StatusBadge, statusTone } from "@/components/ui";

type Props = {
  contract: CustomerContract;
};

export function ContractCard({ contract }: Props) {
  const tier = inferContractTier(contract.name);
  const renewal = formatRenewalNote(contract.renewal_option);
  const expiringSoon = contract.status.toLowerCase() === "active" && isExpiringSoon(contract.end_date);
  const isActive = contract.status.toLowerCase() === "active" || contract.status.toLowerCase() === "renewed";
  const typeHelp = CONTRACT_TYPE_HELP[contract.contract_type];

  return (
    <article className="card bg-base-100 shadow">
      <div className="card-body gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="card-title text-base">{contract.name}</h2>
              {tier ? (
                <span className={`badge badge-sm ${tierBadgeClass(tier)}`}>
                  {tier.charAt(0).toUpperCase() + tier.slice(1)}
                </span>
              ) : null}
              {expiringSoon ? <span className="badge badge-sm badge-warning">Expiring soon</span> : null}
            </div>
            <p className="mt-1 text-sm opacity-70">{contract.contract_type}</p>
            {typeHelp ? <p className="mt-1 text-xs opacity-60">{typeHelp}</p> : null}
          </div>
          <StatusBadge label={contract.status} tone={statusTone(contract.status)} />
        </div>

        <div className="rounded-box bg-base-200/60 p-4 text-sm">
          <p className="font-medium">{formatCoverageSummary(contract)}</p>
          <p className="mt-2 opacity-70">
            {formatContractTerm(contract.start_date, contract.end_date)}
            {renewal ? ` · ${renewal}` : ""}
          </p>
          <p className="mt-2 opacity-70">
            <span className="font-medium opacity-100">Covered equipment: </span>
            {formatEquipmentPreview(contract.equipment)}
          </p>
        </div>

        <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm opacity-80">
          {contractStatusMessage(contract.status)}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href={`/customer/contracts/${contract.id}`} className="btn btn-primary btn-sm">
            View details
          </Link>
          {isActive ? (
            <Link href="/customer" className="btn btn-outline btn-sm">
              Request service
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
