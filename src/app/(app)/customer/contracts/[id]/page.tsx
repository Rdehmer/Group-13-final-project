"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import {
  CONTRACT_TYPE_HELP,
  contractStatusMessage,
  daysUntilEnd,
  formatContractTerm,
  formatRenewalNote,
  inferContractTier,
  isExpiringSoon,
  formatContractDisplayName,
  parseCustomerContracts,
  tierBadgeClass,
  type CustomerContract,
} from "@/lib/contracts";
import type { Invoice, Profile } from "@/lib/types";
import { ContractCoveragePanel } from "../ContractCoveragePanel";
import {
  formatStandingDetail,
  getContractPaymentStanding,
  resolvedDeductible,
  standingBadgeClass,
} from "@/lib/contract-billing";

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-3">
        <h2 className="card-title text-base">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function WhatsNextPanel({ contract }: { contract: CustomerContract }) {
  const status = contract.status.toLowerCase();
  const expiringSoon = status === "active" && isExpiringSoon(contract.end_date);
  const daysLeft = daysUntilEnd(contract.end_date);

  if (status.includes("pending") || status === "draft") {
    return (
      <SectionCard title="What's next">
        <ul className="steps steps-vertical w-full sm:steps-horizontal">
          <li className="step step-primary">Submitted</li>
          <li className="step step-primary">EquipmentIQ review</li>
          <li className="step">Activation</li>
        </ul>
        <p className="text-sm opacity-70">{contractStatusMessage(contract.status)}</p>
      </SectionCard>
    );
  }

  if (expiringSoon && daysLeft !== null) {
    return (
      <SectionCard title="What's next">
        <p className="text-sm">
          This agreement expires in <span className="font-semibold">{daysLeft} days</span>.
          {formatRenewalNote(contract.renewal_option)?.includes("Auto")
            ? " It is set to auto-renew unless you contact EquipmentIQ."
            : " Contact EquipmentIQ to discuss renewal."}
        </p>
      </SectionCard>
    );
  }

  if (status.includes("expired")) {
    return (
      <SectionCard title="What's next">
        <p className="text-sm opacity-70">{contractStatusMessage(contract.status)}</p>
        <Link href="/customer/request-contract" className="btn btn-primary btn-sm w-fit">
          Request Contract
        </Link>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="What's next">
      <p className="text-sm opacity-70">{contractStatusMessage(contract.status)}</p>
      {(status === "active" || status === "renewed") ? (
        <Link href="/customer/request-service" className="btn btn-outline btn-sm w-fit">
          Request service
        </Link>
      ) : null}
    </SectionCard>
  );
}

export default function CustomerContractDetailPage() {
  const params = useParams<{ id: string }>();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contract, setContract] = useState<CustomerContract | null>(null);
  const [standingInvoices, setStandingInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) {
        setLoading(false);
        return;
      }
      const { data: sc } = await supabase
        .from("service_contracts")
        .select(`
          *,
          contract_equipment (
            equipment ( id, name, category, location )
          )
        `)
        .eq("id", params.id)
        .eq("customer_id", p.customer_id)
        .maybeSingle();
      if (!sc) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setContract(parseCustomerContracts([sc])[0] ?? null);
      const { data: inv } = await supabase
        .from("invoices")
        .select("*")
        .eq("contract_id", params.id)
        .is("work_order_id", null)
        .gt("recurring_service_charge", 0);
      setStandingInvoices((inv as Invoice[]) ?? []);
      setLoading(false);
    })();
  }, [params.id, supabase]);

  if (loading || !profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState title="No customer account linked" description="Contact EquipmentIQ to link your portal account." />
    );
  }

  if (notFound || !contract) {
    return (
      <EmptyState
        title="Contract not found"
        description="This agreement doesn't exist or isn't linked to your account."
        action={
          <Link href="/customer/contracts" className="btn btn-primary btn-sm">
            Back to My Contracts
          </Link>
        }
      />
    );
  }

  const tier = inferContractTier(contract.name);
  const displayName = formatContractDisplayName(contract.name, contract.status);
  const renewal = formatRenewalNote(contract.renewal_option);
  const typeHelp = CONTRACT_TYPE_HELP[contract.contract_type];
  const isActive = contract.status.toLowerCase() === "active" || contract.status.toLowerCase() === "renewed";
  const standing = getContractPaymentStanding(contract, standingInvoices);
  const deductible = resolvedDeductible(contract);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customer/contracts" className="link link-hover text-sm">
          ← My Contracts
        </Link>
      </div>

      <PageHeader
        title={displayName}
        description={typeHelp ?? contract.contract_type}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/customer/request-contract" className="btn btn-primary btn-sm">
              Request Contract
            </Link>
            {isActive ? (
              <Link href="/customer/request-service" className="btn btn-outline btn-sm">
                Request service
              </Link>
            ) : null}
          </div>
        }
      />

      <SectionCard title="Overview">
        <div className="flex flex-wrap items-center gap-2">
          {tier ? (
            <span className={`badge badge-sm ${tierBadgeClass(tier)}`}>
              {tier.charAt(0).toUpperCase() + tier.slice(1)}
            </span>
          ) : null}
          <StatusBadge label={contract.status} tone={statusTone(contract.status)} />
          {standing.id !== "not_monthly" ? (
            <span className={`badge badge-sm ${standingBadgeClass(standing.id)}`}>
              {standing.label}
            </span>
          ) : null}
          {isExpiringSoon(contract.end_date) && contract.status.toLowerCase() === "active" ? (
            <span className="badge badge-sm badge-warning">Expiring soon</span>
          ) : null}
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="opacity-70">Agreement type</dt>
            <dd className="font-medium">{contract.contract_type}</dd>
          </div>
          <div>
            <dt className="opacity-70">Term</dt>
            <dd className="font-medium">{formatContractTerm(contract.start_date, contract.end_date)}</dd>
          </div>
          {renewal ? (
            <div>
              <dt className="opacity-70">Renewal</dt>
              <dd className="font-medium">{renewal}</dd>
            </div>
          ) : null}
        </dl>
      </SectionCard>

      <SectionCard title="Coverage & pricing">
        <ContractCoveragePanel contract={contract} />
      </SectionCard>

      <SectionCard title="Covered equipment">
        {contract.equipment.length === 0 ? (
          <p className="text-sm opacity-70">No equipment listed on this agreement.</p>
        ) : (
          <ul className="space-y-2">
            {contract.equipment.map((eq) => (
              <li key={eq.id} className="rounded-box bg-base-200 p-3 text-sm">
                <p className="font-medium">{eq.name}</p>
                <p className="opacity-60">
                  {[eq.category, eq.location].filter(Boolean).join(" · ") || "No details on file"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {standing.id !== "not_monthly" ? (
        <SectionCard title="Payment status">
          <div className="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge badge-sm ${standingBadgeClass(standing.id)}`}>
                {standing.label}
              </span>
              <span className="opacity-70">{formatStandingDetail(standing)}</span>
            </div>
            {deductible > 0 ? (
              <p className="mt-2 text-sm opacity-70">Deductible: {formatMoney(deductible)}</p>
            ) : null}
            {standing.id === "payment_due" || standing.id === "past_due" ? (
              <Link href="/customer/pay" className="btn btn-primary btn-sm mt-3">
                Pay now
              </Link>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {(contract.warranty_terms ||
        contract.cancellation_terms ||
        contract.approval_requirements ||
        contract.notes) ? (
        <SectionCard title="Terms and notes">
          <dl className="space-y-3 text-sm">
            {contract.warranty_terms ? (
              <div>
                <dt className="opacity-70">Warranty</dt>
                <dd>{contract.warranty_terms}</dd>
              </div>
            ) : null}
            {contract.cancellation_terms ? (
              <div>
                <dt className="opacity-70">Cancellation</dt>
                <dd>{contract.cancellation_terms}</dd>
              </div>
            ) : null}
            {contract.approval_requirements ? (
              <div>
                <dt className="opacity-70">Approval requirements</dt>
                <dd>{contract.approval_requirements}</dd>
              </div>
            ) : null}
            {contract.notes ? (
              <div>
                <dt className="opacity-70">Notes</dt>
                <dd>{contract.notes}</dd>
              </div>
            ) : null}
          </dl>
        </SectionCard>
      ) : null}

      <WhatsNextPanel contract={contract} />
    </div>
  );
}
