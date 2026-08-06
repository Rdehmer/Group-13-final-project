/**
 * AHS-style contract pricing: monthly premium variants ($100 vs $125 service fee),
 * coverage caps, and T&M eligibility (hot customers + one-off repairs only).
 */

import { matchContractPlan, type PlanThresholds, type ResolvedPlan } from "@/lib/contract-plans";
import {
  getIndustryCapProfile,
  resolveCoverageCaps,
} from "@/lib/contract-cap-profiles";
import { formatMoney } from "@/lib/calculations";
import type { ServiceContract } from "@/lib/types";

export const SERVICE_FEE_OPTIONS = [100, 125] as const;
export type ServiceFeeOption = (typeof SERVICE_FEE_OPTIONS)[number];

export const DEFAULT_SERVICE_FEE_OPTION: ServiceFeeOption = 125;

export const SAME_BREAKDOWN_FEE_WINDOW_DAYS = 30;

export const AHS_SERVICE_FEE_EXPLAINER =
  "Choose $100/visit for a lower fee when you call, or $125/visit for a lower monthly premium.";

export const NON_CONTRACT_TM_FOOTNOTE =
  "Without a contract, service is billed time and materials at standard rates.";

export const CONTRACT_SERVICE_FEE_FOOTNOTE =
  "Non-refundable service fee per dispatch. Same breakdown within 30 days — one fee.";

export type CoverageCaps = {
  includedVisits: number;
  includedLaborHours: number;
  partsAllowance: number;
  perEquipmentCap: number;
  aggregateCap: number;
  maxUnits: number | null;
};

export type ContractPricingSummaryData = {
  monthlyPremium: number;
  annualPremium: number;
  serviceFeeOption: ServiceFeeOption;
  serviceFeePerVisit: number;
  monthlyPremiumAt100: number;
  monthlyPremiumAt125: number;
  premiumTradeoffPerMonth: number;
  billingMethod: string;
  caps: CoverageCaps;
  isContractPath: boolean;
  isTmPath: boolean;
  tierLabel: string | null;
  industryLabel: string | null;
};

export type TmEligibilityInput = {
  outsideContract?: boolean | null;
  hasActiveContract: boolean;
};

export type SameBreakdownInput = {
  equipmentId: string | null;
  problemDescription: string | null;
  completionDate: string | null;
  createdAt: string;
};

function parseServiceFeeOption(value: unknown): ServiceFeeOption | null {
  const n = Number(value);
  if (n === 100 || n === 125) return n;
  return null;
}

/** Parse key=value pairs from contract notes Extras line. */
export function parseExtrasFromNotes(notes: string | null | undefined): Record<string, string> {
  if (!notes) return {};
  const match = notes.match(/\[Extras:\s*([^\]]+)\]/i);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const part of match[1].split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

export function serviceFeeOptionFromContract(
  contract: Pick<ServiceContract, "notes" | "billing_method">,
): ServiceFeeOption {
  const extras = parseExtrasFromNotes(contract.notes);
  const fromNotes = parseServiceFeeOption(extras.service_fee_option);
  if (fromNotes) return fromNotes;
  const fromDefault = parseServiceFeeOption(extras.default_service_fee_option);
  if (fromDefault) return fromDefault;
  return DEFAULT_SERVICE_FEE_OPTION;
}

export function premiumForFeeOption(
  thresholds: Pick<
    PlanThresholds,
    "monthly_premium_at_100_fee" | "monthly_premium_at_125_fee" | "annual_price" | "extras"
  >,
  option: ServiceFeeOption,
): number {
  const at100 = thresholds.monthly_premium_at_100_fee;
  const at125 = thresholds.monthly_premium_at_125_fee;
  if (option === 100 && at100 != null && at100 > 0) return at100;
  if (option === 125 && at125 != null && at125 > 0) return at125;
  const fallback125 = at125 ?? Math.round(Number(thresholds.annual_price) / 12);
  const tradeoff = Number(thresholds.extras?.premium_tradeoff_per_month) || 25;
  return option === 100 ? fallback125 + tradeoff : fallback125;
}

export function annualPremiumFromMonthly(monthly: number): number {
  return Math.round(monthly * 12);
}

export function monthlyPremiumFromContract(
  contract: Pick<ServiceContract, "contract_price" | "billing_method" | "notes">,
): number {
  const feeOption = serviceFeeOptionFromContract(contract);
  const snapshot = matchContractPlan(contract.notes);
  if (snapshot) {
    const extras = parseExtrasFromNotes(contract.notes);
    const at100 = Number(extras.monthly_premium_at_100_fee);
    const at125 = Number(extras.monthly_premium_at_125_fee);
    if (feeOption === 100 && at100 > 0) return at100;
    if (feeOption === 125 && at125 > 0) return at125;
  }
  const annual = Number(contract.contract_price);
  if (annual <= 0) return 0;
  return Math.round((annual / 12) * 100) / 100;
}

export function annualPremiumFromContract(
  contract: Pick<ServiceContract, "contract_price" | "billing_method" | "notes">,
): number {
  const monthly = monthlyPremiumFromContract(contract);
  if (monthly > 0) return annualPremiumFromMonthly(monthly);
  return Number(contract.contract_price) || 0;
}

export function serviceFeePerVisit(
  contract: Pick<ServiceContract, "notes" | "billing_method">,
): ServiceFeeOption {
  return serviceFeeOptionFromContract(contract);
}

export function coverageCapsFromThresholds(
  thresholds: PlanThresholds,
  tierId?: string | null,
  bandId?: string,
  packId?: string | null,
): CoverageCaps {
  const tier = tierId ?? "silver";
  const caps = resolveCoverageCaps(tier, bandId ?? "mid", packId);
  return {
    includedVisits: thresholds.included_service_visits,
    includedLaborHours: thresholds.included_labor_hours,
    partsAllowance: thresholds.included_replacement_parts,
    perEquipmentCap: Math.round(
      Number(thresholds.extras.per_equipment_cap ?? caps.perEquipment),
    ),
    aggregateCap: Math.round(
      Number(thresholds.extras.aggregate_coverage_cap ?? caps.aggregate),
    ),
    maxUnits:
      thresholds.extras.max_units_covered != null
        ? Number(thresholds.extras.max_units_covered)
        : null,
  };
}

export function coverageCapsFromContract(
  contract: Pick<
    ServiceContract,
    | "notes"
    | "included_service_visits"
    | "included_labor_hours"
    | "included_replacement_parts"
  >,
): CoverageCaps {
  const extras = parseExtrasFromNotes(contract.notes);
  const snapshot = matchContractPlan(contract.notes);
  const packId = extras.industry_pack_id || snapshot?.packId || null;
  const tierId = snapshot?.tierId ?? null;
  const bandId = snapshot?.bandId ?? "mid";

  const storedPerEq = Number(extras.per_equipment_cap);
  const storedAgg = Number(extras.aggregate_coverage_cap);
  if (storedPerEq > 0 && storedAgg > 0) {
    return {
      includedVisits: contract.included_service_visits,
      includedLaborHours: contract.included_labor_hours,
      partsAllowance: contract.included_replacement_parts,
      perEquipmentCap: Math.round(storedPerEq),
      aggregateCap: Math.round(storedAgg),
      maxUnits: extras.max_units_covered ? Number(extras.max_units_covered) : null,
    };
  }

  if (tierId) {
    const caps = resolveCoverageCaps(tierId, bandId, packId);
    return {
      includedVisits: contract.included_service_visits,
      includedLaborHours: contract.included_labor_hours,
      partsAllowance: contract.included_replacement_parts,
      perEquipmentCap: caps.perEquipment,
      aggregateCap: caps.aggregate,
      maxUnits: extras.max_units_covered ? Number(extras.max_units_covered) : null,
    };
  }

  return {
    includedVisits: contract.included_service_visits,
    includedLaborHours: contract.included_labor_hours,
    partsAllowance: contract.included_replacement_parts,
    perEquipmentCap: 0,
    aggregateCap: 0,
    maxUnits: extras.max_units_covered ? Number(extras.max_units_covered) : null,
  };
}

export function formatMonthlyPremium(amount: number): string {
  if (amount <= 0) return "—";
  return `${formatMoney(amount)}/mo`;
}

export function premiumTradeoffLabel(option: ServiceFeeOption): string {
  if (option === 100) {
    return "$100/visit — lower fee per dispatch, higher monthly premium";
  }
  return "$125/visit — lower monthly premium, higher fee per dispatch";
}

export function isTmBillingEligible(input: TmEligibilityInput): boolean {
  if (input.outsideContract) return true;
  return !input.hasActiveContract;
}

export function isContractBillingPath(input: TmEligibilityInput): boolean {
  return !isTmBillingEligible(input);
}

function normalizeText(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function woDate(input: SameBreakdownInput): Date | null {
  const raw = input.completionDate || input.createdAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** AHS rule: same equipment + same issue within 30 days → one service fee. */
export function sameBreakdownFeeWaived(
  current: SameBreakdownInput,
  priorWorkOrders: SameBreakdownInput[],
  asOf = new Date(),
): boolean {
  if (!current.equipmentId) return false;
  const currentProblem = normalizeText(current.problemDescription);
  if (!currentProblem) return false;
  const currentWhen = woDate(current);
  if (!currentWhen) return false;

  for (const prior of priorWorkOrders) {
    if (prior.equipmentId !== current.equipmentId) continue;
    const priorProblem = normalizeText(prior.problemDescription);
    if (!priorProblem) continue;
    if (priorProblem !== currentProblem) continue;
    const priorWhen = woDate(prior);
    if (!priorWhen) continue;
    const diffMs = currentWhen.getTime() - priorWhen.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays >= 0 && diffDays <= SAME_BREAKDOWN_FEE_WINDOW_DAYS) return true;
  }
  return false;
}

export function suggestedContractServiceFee(
  contract: Pick<ServiceContract, "notes" | "billing_method">,
  waived: boolean,
): number {
  if (waived) return 0;
  return serviceFeePerVisit(contract);
}

export function buildPricingExtrasLine(
  thresholds: PlanThresholds,
  serviceFeeOption: ServiceFeeOption,
  packId?: string,
): string {
  const parts = [
    `service_fee_option=${serviceFeeOption}`,
    `monthly_premium_at_100_fee=${thresholds.monthly_premium_at_100_fee ?? premiumForFeeOption(thresholds, 100)}`,
    `monthly_premium_at_125_fee=${thresholds.monthly_premium_at_125_fee ?? premiumForFeeOption(thresholds, 125)}`,
    `aggregate_coverage_cap=${thresholds.extras.aggregate_coverage_cap ?? ""}`,
    `per_equipment_cap=${thresholds.extras.per_equipment_cap ?? ""}`,
    `premium_tradeoff_per_month=${thresholds.extras.premium_tradeoff_per_month ?? 25}`,
    `default_service_fee_option=${DEFAULT_SERVICE_FEE_OPTION}`,
  ];
  if (packId) {
    parts.push(`industry_pack_id=${packId}`);
    parts.push(`cap_profile=${getIndustryCapProfile(packId)}`);
  }
  if (thresholds.extras.max_units_covered != null) {
    parts.push(`max_units_covered=${String(thresholds.extras.max_units_covered)}`);
  }
  return `[Extras: ${parts.filter((p) => !p.endsWith("=")).join("; ")}]`;
}

export function pricingSummaryFromContract(
  contract: Pick<
    ServiceContract,
    | "contract_price"
    | "billing_method"
    | "notes"
    | "included_service_visits"
    | "included_labor_hours"
    | "included_replacement_parts"
  >,
  options?: { hasActiveContract?: boolean; outsideContract?: boolean },
): ContractPricingSummaryData {
  const snapshot = matchContractPlan(contract.notes);
  const extras = parseExtrasFromNotes(contract.notes);
  const feeOption = serviceFeeOptionFromContract(contract);
  const monthly125 =
    Number(extras.monthly_premium_at_125_fee) ||
    monthlyPremiumFromContract({ ...contract, notes: contract.notes });
  const tradeoff = Number(extras.premium_tradeoff_per_month) || 25;
  const monthly100 = Number(extras.monthly_premium_at_100_fee) || monthly125 + tradeoff;
  const monthly = feeOption === 100 ? monthly100 : monthly125;
  const tmPath = isTmBillingEligible({
    hasActiveContract: options?.hasActiveContract ?? true,
    outsideContract: options?.outsideContract,
  });

  return {
    monthlyPremium: monthly,
    annualPremium: annualPremiumFromMonthly(monthly),
    serviceFeeOption: feeOption,
    serviceFeePerVisit: feeOption,
    monthlyPremiumAt100: monthly100,
    monthlyPremiumAt125: monthly125,
    premiumTradeoffPerMonth: tradeoff,
    billingMethod: contract.billing_method,
    caps: coverageCapsFromContract(contract),
    isContractPath: !tmPath,
    isTmPath: tmPath,
    tierLabel: snapshot?.tierName ?? null,
    industryLabel: snapshot?.packName ?? null,
  };
}

export function pricingSummaryFromResolvedPlan(
  resolved: ResolvedPlan,
  serviceFeeOption: ServiceFeeOption = DEFAULT_SERVICE_FEE_OPTION,
): ContractPricingSummaryData {
  const t = resolved.thresholds;
  const monthly = premiumForFeeOption(t, serviceFeeOption);
  return {
    monthlyPremium: monthly,
    annualPremium: annualPremiumFromMonthly(monthly),
    serviceFeeOption,
    serviceFeePerVisit: serviceFeeOption,
    monthlyPremiumAt100: premiumForFeeOption(t, 100),
    monthlyPremiumAt125: premiumForFeeOption(t, 125),
    premiumTradeoffPerMonth: Number(t.extras.premium_tradeoff_per_month) || 25,
    billingMethod: t.billing_method,
    caps: coverageCapsFromThresholds(t, resolved.level.id, resolved.band.id, resolved.pack.id),
    isContractPath: true,
    isTmPath: false,
    tierLabel: resolved.level.name,
    industryLabel: resolved.pack.name,
  };
}
