"use client";

import Link from "next/link";
import { formatMoney } from "@/lib/calculations";
import {
  AHS_SERVICE_FEE_EXPLAINER,
  CONTRACT_SERVICE_FEE_FOOTNOTE,
  NON_CONTRACT_TM_FOOTNOTE,
  SERVICE_FEE_OPTIONS,
  pricingSummaryFromContract,
  pricingSummaryFromResolvedPlan,
  type ContractPricingSummaryData,
  type ServiceFeeOption,
} from "@/lib/contract-pricing";
import type { ServiceContract } from "@/lib/types";
import type { ResolvedPlan } from "@/lib/contract-plans";

type BaseProps = {
  compact?: boolean;
  className?: string;
};

type ContractProps = BaseProps & {
  variant: "contract";
  contract: Pick<
    ServiceContract,
    | "contract_price"
    | "billing_method"
    | "notes"
    | "included_service_visits"
    | "included_labor_hours"
    | "included_replacement_parts"
  >;
};

type ProspectProps = BaseProps & {
  variant: "prospect";
  resolved: ResolvedPlan;
  serviceFeeOption: ServiceFeeOption;
  onServiceFeeOptionChange?: (option: ServiceFeeOption) => void;
};

type HotProps = BaseProps & {
  variant: "hot";
};

type Props = ContractProps | ProspectProps | HotProps;

function CapsGrid({ summary, compact }: { summary: ContractPricingSummaryData; compact?: boolean }) {
  const { caps } = summary;
  return (
    <dl className={`grid gap-x-4 gap-y-2 ${compact ? "text-sm sm:grid-cols-2" : "sm:grid-cols-2"}`}>
      {caps.includedVisits > 0 ? (
        <>
          <dt className="opacity-70">Included visits</dt>
          <dd className="font-medium">{caps.includedVisits}/yr</dd>
        </>
      ) : null}
      {caps.includedLaborHours > 0 ? (
        <>
          <dt className="opacity-70">Included labor</dt>
          <dd className="font-medium">{caps.includedLaborHours} hrs/yr</dd>
        </>
      ) : null}
      {caps.partsAllowance > 0 ? (
        <>
          <dt className="opacity-70">Parts allowance</dt>
          <dd className="font-medium">{formatMoney(caps.partsAllowance)}/yr</dd>
        </>
      ) : null}
      {caps.perEquipmentCap > 0 ? (
        <>
          <dt className="opacity-70">Per-equipment cap</dt>
          <dd className="font-medium">{formatMoney(caps.perEquipmentCap)}/yr</dd>
        </>
      ) : null}
      {caps.aggregateCap > 0 ? (
        <>
          <dt className="opacity-70">Aggregate cap</dt>
          <dd className="font-medium">{formatMoney(caps.aggregateCap)}/yr</dd>
        </>
      ) : null}
      {caps.maxUnits != null && caps.maxUnits > 0 ? (
        <>
          <dt className="opacity-70">Equipment covered</dt>
          <dd className="font-medium">Up to {caps.maxUnits}</dd>
        </>
      ) : null}
    </dl>
  );
}

function FeeSelector({
  value,
  summary,
  onChange,
}: {
  value: ServiceFeeOption;
  summary: ContractPricingSummaryData;
  onChange?: (option: ServiceFeeOption) => void;
}) {
  return (
    <div className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3">
      <p className="text-sm font-medium">Service fee per visit</p>
      <p className="text-xs opacity-70">{AHS_SERVICE_FEE_EXPLAINER}</p>
      <div className="flex flex-wrap gap-2">
        {SERVICE_FEE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`btn btn-sm ${value === option ? "btn-primary" : "btn-outline"}`}
            onClick={() => onChange?.(option)}
            disabled={!onChange}
          >
            ${option}/visit
          </button>
        ))}
      </div>
      <p className="text-sm">
        Monthly premium:{" "}
        <span className="font-semibold tabular-nums">
          {formatMoney(
            value === 100 ? summary.monthlyPremiumAt100 : summary.monthlyPremiumAt125,
          )}
          /mo
        </span>
        <span className="ml-2 text-xs opacity-60">
          ({formatMoney(summary.annualPremium)}/yr at ${value} fee)
        </span>
      </p>
    </div>
  );
}

export function ContractPricingSummary(props: Props) {
  const { compact = false, className = "" } = props;

  if (props.variant === "hot") {
    return (
      <div className={`space-y-2 ${className}`}>
        <p className="text-sm font-semibold">Standard rates — labor + parts + tax</p>
        <p className="text-sm opacity-70">{NON_CONTRACT_TM_FOOTNOTE}</p>
        <Link href="/customer/request-contract" className="link link-primary text-sm">
          Save with a Gold, Silver, or Bronze plan
        </Link>
      </div>
    );
  }

  const summary: ContractPricingSummaryData =
    props.variant === "contract"
      ? pricingSummaryFromContract(props.contract)
      : pricingSummaryFromResolvedPlan(props.resolved, props.serviceFeeOption);

  const feeOption =
    props.variant === "prospect" ? props.serviceFeeOption : summary.serviceFeeOption;

  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <p className="text-xs uppercase tracking-wide opacity-60">Monthly premium</p>
        <p className={`font-bold tabular-nums ${compact ? "text-xl" : "text-2xl"}`}>
          {formatMoney(summary.monthlyPremium)}
          <span className="text-base font-normal opacity-70">/mo</span>
        </p>
        <p className="text-sm opacity-70">
          {formatMoney(summary.annualPremium)}/yr · {summary.billingMethod}
          {summary.industryLabel && summary.tierLabel
            ? ` · ${summary.industryLabel} · ${summary.tierLabel}`
            : summary.tierLabel
              ? ` · ${summary.tierLabel}`
              : summary.industryLabel
                ? ` · ${summary.industryLabel}`
                : null}
        </p>
      </div>

      {props.variant === "prospect" && props.onServiceFeeOptionChange ? (
        <FeeSelector
          value={feeOption}
          summary={summary}
          onChange={props.onServiceFeeOptionChange}
        />
      ) : (
        <dl className={`grid gap-2 text-sm ${compact ? "" : "sm:grid-cols-2"}`}>
          <div>
            <dt className="opacity-70">Service fee per visit</dt>
            <dd className="font-medium">${summary.serviceFeePerVisit}/visit</dd>
          </div>
          {props.variant === "prospect" ? (
            <div>
              <dt className="opacity-70">Alternate premium</dt>
              <dd className="font-medium">
                {formatMoney(summary.monthlyPremiumAt100)}/mo @ $100 or{" "}
                {formatMoney(summary.monthlyPremiumAt125)}/mo @ $125
              </dd>
            </div>
          ) : null}
        </dl>
      )}

      <CapsGrid summary={summary} compact={compact} />

      <p className="text-xs opacity-60">{CONTRACT_SERVICE_FEE_FOOTNOTE}</p>
      <p className="text-xs opacity-60">
        Work beyond coverage or outside your plan requires manager approval.{" "}
        {NON_CONTRACT_TM_FOOTNOTE}
      </p>
    </div>
  );
}

export function resolvePricingSummary(
  props: Props,
): ContractPricingSummaryData | null {
  if (props.variant === "hot") return null;
  if (props.variant === "contract") return pricingSummaryFromContract(props.contract);
  return pricingSummaryFromResolvedPlan(props.resolved, props.serviceFeeOption);
}
