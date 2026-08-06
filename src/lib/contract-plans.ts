/**
 * Industry × Gold/Silver/Bronze × asset-value-band contract plan catalog.
 * Stored in localStorage (ridley_contract_plans_v2); no Supabase table required.
 */

import {
  formatCapSummaryLine,
  getIndustryCapProfile,
  resolveCoverageCaps,
} from "@/lib/contract-cap-profiles";

export const CONTRACT_PLANS_STORAGE_KEY = "ridley_contract_plans_v2";
const CONTRACT_PLANS_STORAGE_KEY_V1 = "ridley_contract_plans_v1";

export type ServiceLevelId = "gold" | "silver" | "bronze";

/** Minimal tier shape for customer request UI (mirrors contracts.ts ContractTier). */
export type CatalogDrivenTier = {
  id: ServiceLevelId;
  name: string;
  tagline: string;
  coverages: string[];
  recommended?: boolean;
  formDefaults: Partial<{
    contract_type: string;
    renewal_option: string;
    included_service_visits: string;
    service_frequency: string;
    included_labor_hours: string;
    included_replacement_parts: string;
    emergency_response_commitment: string;
    billing_method: string;
    payment_terms: string;
    approval_requirements: string;
  }>;
};

export type PlanThresholds = {
  annual_price: number;
  /** Monthly premium when member selects $125/visit service fee (AHS default). */
  monthly_premium_at_125_fee?: number;
  /** Monthly premium when member selects $100/visit service fee. */
  monthly_premium_at_100_fee?: number;
  contract_type: string;
  included_service_visits: number;
  service_frequency: string;
  included_labor_hours: number;
  included_replacement_parts: number;
  emergency_response_commitment: string;
  billing_method: string;
  payment_terms: string;
  renewal_option: string;
  approval_requirements: string;
  /** Free-form extras (travel radius, deductible, etc.) */
  extras: Record<string, string | number | boolean>;
};

export type AssetValueBand = {
  id: string;
  label: string;
  /** Inclusive minimum covered asset value (USD). */
  min_asset_value: number;
  /** Exclusive maximum; null = no upper bound. */
  max_asset_value: number | null;
  thresholds: PlanThresholds;
};

export type ServiceLevelPlan = {
  id: ServiceLevelId;
  name: string;
  tagline: string;
  coverages: string[];
  recommended?: boolean;
  bands: AssetValueBand[];
};

export type IndustryPack = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  sort_order: number;
  levels: ServiceLevelPlan[];
};

export type ContractPlanCatalog = {
  version: number;
  packs: IndustryPack[];
  updated_at: string;
};

export type ManagerContractFormFields = {
  name?: string;
  contract_type: string;
  billing_method: string;
  contract_price: string;
  monthly_amount?: string;
  deductible?: string;
  included_service_visits: string;
  included_labor_hours: string;
  included_replacement_parts?: string;
  service_frequency?: string;
  emergency_response_commitment?: string;
  payment_terms?: string;
  renewal_option?: string;
  approval_requirements?: string;
  notes?: string;
};

export type ResolvedPlan = {
  pack: IndustryPack;
  level: ServiceLevelPlan;
  band: AssetValueBand;
  thresholds: PlanThresholds;
  assetValue: number;
};

export type PlanSnapshot = {
  packId: string;
  packName: string;
  tierId: ServiceLevelId;
  tierName: string;
  bandId: string;
  bandLabel: string;
  assetValue: number;
  extras: Record<string, string | number | boolean>;
};

type BandBoundSet = {
  low: { min: number; max: number };
  mid: { min: number; max: number };
  high: { min: number; max: number | null };
};

type TierUnitCounts = { bronze: number; silver: number; gold: number };

type CoverageBuilder = (ctx: {
  units: number;
  visits: number;
  labor: number;
  parts: number;
  sla: string;
}) => string[];

const PLAN_TAG_RE =
  /\[Plan:\s*([^·]+)·\s*([^·]+)·\s*([^·]+)·\s*asset\s*\$([0-9,]+(?:\.\d+)?)\]/i;
const EXTRAS_TAG_RE = /\[Extras:\s*[^\]]*\]/gi;

const CATALOG_VERSION = 4;

function bandScaleForEnrich(bandId: "low" | "mid" | "high"): number {
  if (bandId === "low") return 0.7;
  if (bandId === "high") return 1.5;
  return 1;
}

function enrichPlanThresholds(
  t: PlanThresholds,
  tier: ServiceLevelId,
  bandId: "low" | "mid" | "high",
  packId: string,
): PlanThresholds {
  const scale = bandScaleForEnrich(bandId);
  const caps = resolveCoverageCaps(tier, bandId, packId);
  const monthly125 = t.monthly_premium_at_125_fee ?? Math.round(Number(t.annual_price) / 12);
  const tradeoff = Math.round(Number(t.extras.premium_tradeoff_per_month) || 25 * scale);
  const monthly100 = t.monthly_premium_at_100_fee ?? monthly125 + tradeoff;
  const { deductible: _d, service_fee_per_visit: _s, ...restExtras } = t.extras;

  let parts = t.included_replacement_parts;
  if (tier === "bronze" && parts <= 0 && bandId === "mid") {
    parts = Math.round(caps.partsMid * scale);
  }

  return {
    ...t,
    annual_price: monthly125 * 12,
    monthly_premium_at_125_fee: monthly125,
    monthly_premium_at_100_fee: monthly100,
    included_replacement_parts: parts,
    billing_method: "Monthly Recurring Charge",
    extras: {
      ...restExtras,
      aggregate_coverage_cap: Math.round(
        Number(restExtras.aggregate_coverage_cap ?? caps.aggregate * scale),
      ),
      per_equipment_cap: Math.round(
        Number(restExtras.per_equipment_cap ?? caps.perEquipment * scale),
      ),
      premium_tradeoff_per_month: tradeoff,
      default_service_fee_option: 125,
    },
  };
}

export function buildPricingExtrasLine(
  thresholds: PlanThresholds,
  serviceFeeOption: 100 | 125,
  packId?: string,
): string {
  const at100 = thresholds.monthly_premium_at_100_fee ?? 0;
  const at125 = thresholds.monthly_premium_at_125_fee ?? Math.round(thresholds.annual_price / 12);
  const parts = [
    `service_fee_option=${serviceFeeOption}`,
    `monthly_premium_at_100_fee=${at100}`,
    `monthly_premium_at_125_fee=${at125}`,
    `aggregate_coverage_cap=${String(thresholds.extras.aggregate_coverage_cap ?? "")}`,
    `per_equipment_cap=${String(thresholds.extras.per_equipment_cap ?? "")}`,
    `premium_tradeoff_per_month=${String(thresholds.extras.premium_tradeoff_per_month ?? 25)}`,
    `default_service_fee_option=125`,
  ];
  if (packId) {
    parts.push(`industry_pack_id=${packId}`);
    parts.push(`cap_profile=${getIndustryCapProfile(packId)}`);
  }
  if (thresholds.extras.max_units_covered != null) {
    parts.push(`max_units_covered=${String(thresholds.extras.max_units_covered)}`);
  }
  return `[Extras: ${parts.join("; ")}]`;
}

function thr(
  annual: number,
  visits: number,
  labor: number,
  parts: number,
  freq: string,
  sla: string,
  billing: string,
  contractType: string,
  renewal: string,
  approval: string,
  extras: Record<string, string | number | boolean> = {},
): PlanThresholds {
  return {
    annual_price: annual,
    contract_type: contractType,
    included_service_visits: visits,
    service_frequency: freq,
    included_labor_hours: labor,
    included_replacement_parts: parts,
    emergency_response_commitment: sla,
    billing_method: billing,
    payment_terms: "Net 30",
    renewal_option: renewal,
    approval_requirements: approval,
    extras,
  };
}

/** Scale Mid unit baseline: Low ≈ 60%, High ≈ 180%. */
function scaleUnits(midUnits: number, band: "low" | "mid" | "high"): number {
  if (band === "low") return Math.max(1, Math.round(midUnits * 0.6));
  if (band === "high") return Math.round(midUnits * 1.8);
  return midUnits;
}

function withUnits(
  base: PlanThresholds,
  midUnits: number,
  band: "low" | "mid" | "high",
): PlanThresholds {
  return {
    ...base,
    extras: {
      ...base.extras,
      max_units_covered: scaleUnits(midUnits, band),
    },
  };
}

function bandsFor(
  low: PlanThresholds,
  mid: PlanThresholds,
  high: PlanThresholds,
  bounds: BandBoundSet,
  tier: ServiceLevelId,
  packId: string,
): AssetValueBand[] {
  return [
    {
      id: "low",
      label: "Low",
      min_asset_value: bounds.low.min,
      max_asset_value: bounds.low.max,
      thresholds: enrichPlanThresholds(low, tier, "low", packId),
    },
    {
      id: "mid",
      label: "Mid",
      min_asset_value: bounds.mid.min,
      max_asset_value: bounds.mid.max,
      thresholds: enrichPlanThresholds(mid, tier, "mid", packId),
    },
    {
      id: "high",
      label: "High",
      min_asset_value: bounds.high.min,
      max_asset_value: bounds.high.max,
      thresholds: enrichPlanThresholds(high, tier, "high", packId),
    },
  ];
}

function normalizeCatalog(catalog: ContractPlanCatalog): ContractPlanCatalog {
  return {
    ...catalog,
    packs: catalog.packs.map((pack) => ({
      ...pack,
      levels: pack.levels.map((level) => ({
        ...level,
        bands: level.bands.map((band) => ({
          ...band,
          thresholds: enrichPlanThresholds(
            band.thresholds,
            level.id,
            band.id as "low" | "mid" | "high",
            pack.id,
          ),
        })),
      })),
    })),
  };
}

function unitsLine(n: number): string {
  return `Up to ${n} pieces of equipment covered`;
}

function partsLine(parts: number): string {
  return parts > 0
    ? `$${parts.toLocaleString("en-US")} parts allowance`
    : "No included parts allowance";
}

function laborLine(labor: number): string {
  return `${labor} included labor hours`;
}

function visitsLine(visits: number, detail: string): string {
  return `${visits} scheduled visits per year — ${detail}`;
}

function slaLine(sla: string): string {
  return `${sla} emergency response`;
}

const warehouseGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly PM on refrigeration, docks, and coolers"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Priority emergency for cold-chain / temperature loss",
  "After-hours coverage and OEM coordination",
  "Corrective repairs within allowance",
];

const warehouseSilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly PM on refrigeration and dock equipment"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Limited corrective hours within allowance",
  "Standard business-hours dispatch",
];

const warehouseBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "semi-annual dock and cooler inspections"),
  laborLine(labor),
  "Filters and basic checks included; covered repairs within plan caps",
  slaLine(sla),
  "Covered repairs within plan caps",
];

const shippingGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly material-handling fleet PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Priority downtime response for terminal sites",
  "Travel radius coverage for multi-dock yards",
  "Hydraulic, battery, and dock-leveler service included within allowance",
];

const shippingSilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly MH equipment PM with hydraulic/filter service"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Limited corrective work within allowance",
  "Forklift and dock safety checks each visit",
];

const shippingBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "forklift and dock safety inspection schedule"),
  laborLine(labor),
  "Repairs within plan coverage caps",
  slaLine(sla),
  "Essential inspections only — no included parts",
];

const farmGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly in-season PM on cooling and milk systems"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Emergency SLA for livestock/dairy cooling loss",
  "Seasonal peak months prioritized (see extras)",
  "After-hours support during peak production",
];

const farmSilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly PM timed to production cycles"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Limited emergency coverage for cooling loss",
  "Pre-peak readiness checks included",
];

const farmBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "seasonal pre-peak inspection (cooling/milk)"),
  laborLine(labor),
  "In-season repairs within plan coverage caps",
  slaLine(sla),
  "Essential inspections only",
];

const agricultureGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly packing/processing line PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Priority response for packing/plant stoppage",
  "Higher parts allowance for line-critical components",
  "Sanitation-adjacent equipment checks each visit",
];

const agricultureSilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly sanitation-adjacent equipment PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Limited downtime repair within allowance",
  "Standard business-hours dispatch",
];

const agricultureBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "annual/semi-annual line inspection"),
  laborLine(labor),
  "Covered repairs within plan caps",
  slaLine(sla),
  "Essential inspections only — no included parts",
];

const homeWarrantyGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly HVAC and appliance coverage"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Next-day emergency dispatch for covered systems",
  "$100 or $125 service fee per covered visit (your choice at signup)",
  "Filter changes and seasonal tune-ups included",
];

const homeWarrantySilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "semi-annual HVAC and filter visits"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Small parts allowance for wear items",
  "Business-hours dispatch for covered calls",
];

const homeWarrantyBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "annual HVAC tune-up"),
  laborLine(labor),
  "No included parts — billed separately",
  slaLine(sla),
  "Emergency calls within plan coverage caps",
];

const foodserviceGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly critical-path PM (walk-ins, ice machines, ovens)"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "4–8 hour emergency for cooler / ice loss",
  "After-hours kitchen support",
  "Walk-in, reach-in, and ice machine focus",
];

const foodserviceSilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly walk-in, ice, and oven PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Limited emergency coverage for cooler loss",
  "Kitchen equipment cleaning and calibration checks",
];

const foodserviceBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "semi-annual kitchen equipment check"),
  laborLine(labor),
  "Repairs within plan coverage caps",
  slaLine(sla),
  "Essential inspections only — no included parts",
];

const retailGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly refrigerated case and store HVAC PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Priority response for open-case temperature alarms",
  "Case, freezer, and HVAC coordination",
  "After-hours coverage for critical cold cases",
];

const retailSilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly refrigerated case and store HVAC PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Limited corrective hours within allowance",
  "Case temperature verification each visit",
];

const retailBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "semi-annual case and HVAC inspection"),
  laborLine(labor),
  "Repairs within plan coverage caps",
  slaLine(sla),
  "Essential inspections only",
];

const healthcareGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly calibrated-equipment PM with audit-ready notes"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Tight emergency SLA with after-hours coverage",
  "Documented service records for compliance",
  "Higher labor allocation for critical lab gear",
];

const healthcareSilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly calibrated-equipment PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Documented service records each visit",
  "Compliance checklist included",
];

const healthcareBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "scheduled inspection with compliance checklist"),
  laborLine(labor),
  "Covered repairs within plan caps",
  slaLine(sla),
  "Inspection-only — no included parts",
];

const manufacturingGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly critical-line production equipment PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Priority production-down response",
  "Larger parts and labor allowance for line-critical assets",
  "OEM coordination for major components",
];

const manufacturingSilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly critical-asset PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Limited breakdown hours within allowance",
  "Standard business-hours dispatch",
];

const manufacturingBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "semi-annual production equipment inspection"),
  laborLine(labor),
  "Breakdowns within plan coverage caps",
  slaLine(sla),
  "Essential inspections only",
];

const fleetGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly mobile-unit PM with wider travel radius"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Priority dispatch for downed mobile units",
  "On-site service within expanded travel radius",
  "Chassis, refrigeration, and generator checks as applicable",
];

const fleetSilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly PM with travel within radius"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Limited corrective work within allowance",
  "Mobile unit safety and readiness checks",
];

const fleetBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "semi-annual mobile unit inspection"),
  laborLine(labor),
  "Repairs within plan coverage caps",
  slaLine(sla),
  "Essential inspections only — travel extras may apply",
];

const propertyGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly multi-site PM cadence across portfolio"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Higher unit caps for multi-site portfolios",
  "Portfolio reporting and site-rotation schedule",
  "Priority dispatch for critical-site outages",
];

const propertySilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "quarterly PM shared across sites"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Rotating site coverage within visit allotment",
  "Limited corrective hours within allowance",
];

const propertyBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "rotating site inspection across portfolio"),
  laborLine(labor),
  "Covered repairs within plan caps",
  slaLine(sla),
  "Few visits per year shared across sites",
];

const standbyGold: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "monthly exercise, load-bank readiness, and PM"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Fast emergency response for generator/UPS failure",
  "Fuel system and transfer-switch checks (see extras)",
  "Documented exercise and load-test results",
];

const standbySilver: CoverageBuilder = ({ units, visits, labor, parts, sla }) => [
  unitsLine(units),
  visitsLine(visits, "semi-annual generator/UPS PM with exercise tests"),
  laborLine(labor),
  partsLine(parts),
  slaLine(sla),
  "Start and transfer checks each visit",
  "Limited corrective hours within allowance",
];

const standbyBronze: CoverageBuilder = ({ units, visits, labor, sla }) => [
  unitsLine(units),
  visitsLine(visits, "annual load-bank / start test"),
  laborLine(labor),
  "Repairs within plan coverage caps",
  slaLine(sla),
  "Inspection and test only — no included parts",
];

function coverageWithCapLine(
  base: string[],
  tier: ServiceLevelId,
  packId: string,
): string[] {
  const caps = resolveCoverageCaps(tier, "mid", packId);
  return [...base, formatCapSummaryLine(caps)];
}

function makeLevels(opts: {
  packId: string;
  bounds: BandBoundSet;
  units: TierUnitCounts;
  taglines: { gold: string; silver: string; bronze: string };
  coverages: {
    gold: CoverageBuilder;
    silver: CoverageBuilder;
    bronze: CoverageBuilder;
  };
  gold: { low: PlanThresholds; mid: PlanThresholds; high: PlanThresholds };
  silver: { low: PlanThresholds; mid: PlanThresholds; high: PlanThresholds };
  bronze: { low: PlanThresholds; mid: PlanThresholds; high: PlanThresholds };
}): ServiceLevelPlan[] {
  const goldMid = withUnits(opts.gold.mid, opts.units.gold, "mid");
  const silverMid = withUnits(opts.silver.mid, opts.units.silver, "mid");
  const bronzeMid = withUnits(opts.bronze.mid, opts.units.bronze, "mid");

  return [
    {
      id: "gold",
      name: "Gold",
      tagline: opts.taglines.gold,
      recommended: true,
      coverages: coverageWithCapLine(
        opts.coverages.gold({
          units: opts.units.gold,
          visits: goldMid.included_service_visits,
          labor: goldMid.included_labor_hours,
          parts: goldMid.included_replacement_parts,
          sla: goldMid.emergency_response_commitment,
        }),
        "gold",
        opts.packId,
      ),
      bands: bandsFor(
        withUnits(opts.gold.low, opts.units.gold, "low"),
        goldMid,
        withUnits(opts.gold.high, opts.units.gold, "high"),
        opts.bounds,
        "gold",
        opts.packId,
      ),
    },
    {
      id: "silver",
      name: "Silver",
      tagline: opts.taglines.silver,
      coverages: coverageWithCapLine(
        opts.coverages.silver({
          units: opts.units.silver,
          visits: silverMid.included_service_visits,
          labor: silverMid.included_labor_hours,
          parts: silverMid.included_replacement_parts,
          sla: silverMid.emergency_response_commitment,
        }),
        "silver",
        opts.packId,
      ),
      bands: bandsFor(
        withUnits(opts.silver.low, opts.units.silver, "low"),
        silverMid,
        withUnits(opts.silver.high, opts.units.silver, "high"),
        opts.bounds,
        "silver",
        opts.packId,
      ),
    },
    {
      id: "bronze",
      name: "Bronze",
      tagline: opts.taglines.bronze,
      coverages: coverageWithCapLine(
        opts.coverages.bronze({
          units: opts.units.bronze,
          visits: bronzeMid.included_service_visits,
          labor: bronzeMid.included_labor_hours,
          parts: bronzeMid.included_replacement_parts,
          sla: bronzeMid.emergency_response_commitment,
        }),
        "bronze",
        opts.packId,
      ),
      bands: bandsFor(
        withUnits(opts.bronze.low, opts.units.bronze, "low"),
        bronzeMid,
        withUnits(opts.bronze.high, opts.units.bronze, "high"),
        opts.bounds,
        "bronze",
        opts.packId,
      ),
    },
  ];
}

const BOUNDS = {
  home_warranty: {
    low: { min: 0, max: 25_000 },
    mid: { min: 25_000, max: 75_000 },
    high: { min: 75_000, max: null },
  },
  foodservice: {
    low: { min: 0, max: 40_000 },
    mid: { min: 40_000, max: 150_000 },
    high: { min: 150_000, max: null },
  },
  retail_grocery: {
    low: { min: 0, max: 75_000 },
    mid: { min: 75_000, max: 300_000 },
    high: { min: 300_000, max: null },
  },
  farm: {
    low: { min: 0, max: 60_000 },
    mid: { min: 60_000, max: 200_000 },
    high: { min: 200_000, max: null },
  },
  agriculture: {
    low: { min: 0, max: 100_000 },
    mid: { min: 100_000, max: 400_000 },
    high: { min: 400_000, max: null },
  },
  warehouse: {
    low: { min: 0, max: 50_000 },
    mid: { min: 50_000, max: 250_000 },
    high: { min: 250_000, max: null },
  },
  shipping: {
    low: { min: 0, max: 80_000 },
    mid: { min: 80_000, max: 350_000 },
    high: { min: 350_000, max: null },
  },
  fleet: {
    low: { min: 0, max: 75_000 },
    mid: { min: 75_000, max: 300_000 },
    high: { min: 300_000, max: null },
  },
  property_multisite: {
    low: { min: 0, max: 100_000 },
    mid: { min: 100_000, max: 500_000 },
    high: { min: 500_000, max: null },
  },
  healthcare: {
    low: { min: 0, max: 100_000 },
    mid: { min: 100_000, max: 500_000 },
    high: { min: 500_000, max: null },
  },
  manufacturing: {
    low: { min: 0, max: 150_000 },
    mid: { min: 150_000, max: 750_000 },
    high: { min: 750_000, max: null },
  },
  standby_power: {
    low: { min: 0, max: 50_000 },
    mid: { min: 50_000, max: 250_000 },
    high: { min: 250_000, max: null },
  },
  custom_industry: {
    low: { min: 0, max: 50_000 },
    mid: { min: 50_000, max: 250_000 },
    high: { min: 250_000, max: null },
  },
} as const satisfies Record<string, BandBoundSet>;

/** Seeded industry packs — 13 verticals with per-industry asset bands and unit caps. */
export function buildSeedCatalog(): ContractPlanCatalog {
  const packs: IndustryPack[] = [
    {
      id: "warehouse",
      name: "Warehouse",
      description: "Cold storage, distribution, and industrial warehouse equipment.",
      active: true,
      sort_order: 10,
      levels: makeLevels({
        packId: "warehouse",
        bounds: BOUNDS.warehouse,
        units: { bronze: 8, silver: 20, gold: 40 },
        taglines: {
          gold: "Full cold-chain and dock uptime protection",
          silver: "Quarterly refrigeration and dock PM",
          bronze: "Essential dock and cooler inspections",
        },
        coverages: {
          gold: warehouseGold,
          silver: warehouseSilver,
          bronze: warehouseBronze,
        },
        gold: {
          low: thr(8400, 12, 36, 1500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 40, deductible: 0, waiting_period_days: 14 }),
          mid: thr(12000, 12, 48, 2500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 50, deductible: 0, waiting_period_days: 14 }),
          high: thr(18600, 12, 72, 4000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 75, deductible: 250, waiting_period_days: 14 }),
        },
        silver: {
          low: thr(3600, 4, 12, 500, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 40, deductible: 100, waiting_period_days: 30 }),
          mid: thr(5400, 4, 16, 800, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 50, deductible: 150, waiting_period_days: 30 }),
          high: thr(7800, 4, 24, 1200, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 60, deductible: 250, waiting_period_days: 30 }),
        },
        bronze: {
          low: thr(1200, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 30, deductible: 250, waiting_period_days: 30 }),
          mid: thr(1800, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 40, deductible: 250, waiting_period_days: 30 }),
          high: thr(2700, 2, 8, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 500, waiting_period_days: 30 }),
        },
      }),
    },
    {
      id: "shipping",
      name: "Shipping",
      description: "Ports, freight terminals, and logistics material-handling fleets.",
      active: true,
      sort_order: 20,
      levels: makeLevels({
        packId: "shipping",
        bounds: BOUNDS.shipping,
        units: { bronze: 8, silver: 18, gold: 35 },
        taglines: {
          gold: "Keep terminals and MH fleets moving",
          silver: "Quarterly forklift and dock PM",
          bronze: "Safety inspections for docks and lifts",
        },
        coverages: {
          gold: shippingGold,
          silver: shippingSilver,
          bronze: shippingBronze,
        },
        gold: {
          low: thr(9600, 12, 40, 2000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 60, deductible: 0, waiting_period_days: 7 }),
          mid: thr(14400, 12, 56, 3200, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 80, deductible: 0, waiting_period_days: 7 }),
          high: thr(22000, 12, 80, 5000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 100, deductible: 500, waiting_period_days: 7 }),
        },
        silver: {
          low: thr(4200, 4, 14, 600, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 50, deductible: 150, waiting_period_days: 14 }),
          mid: thr(6600, 4, 20, 1000, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 70, deductible: 200, waiting_period_days: 14 }),
          high: thr(9600, 6, 28, 1500, "Bi-Monthly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 90, deductible: 300, waiting_period_days: 14 }),
        },
        bronze: {
          low: thr(1500, 2, 4, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 40, deductible: 300, waiting_period_days: 30 }),
          mid: thr(2400, 2, 6, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 400, waiting_period_days: 30 }),
          high: thr(3600, 3, 8, 0, "Quarterly", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 60, deductible: 500, waiting_period_days: 30 }),
        },
      }),
    },
    {
      id: "farm",
      name: "Farm",
      description: "Dairy, livestock, and mixed-farm refrigeration and processing gear.",
      active: true,
      sort_order: 30,
      levels: makeLevels({
        packId: "farm",
        bounds: BOUNDS.farm,
        units: { bronze: 5, silver: 12, gold: 22 },
        taglines: {
          gold: "Protect livestock and dairy cooling year-round",
          silver: "Production-timed farm equipment PM",
          bronze: "Pre-peak cooling and milk system checks",
        },
        coverages: {
          gold: farmGold,
          silver: farmSilver,
          bronze: farmBronze,
        },
        gold: {
          low: thr(7200, 8, 32, 1200, "Monthly", "8 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 75, deductible: 100, waiting_period_days: 21, seasonal_peak_months: "Apr-Oct" }),
          mid: thr(10800, 10, 40, 2000, "Monthly", "8 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 90, deductible: 150, waiting_period_days: 21, seasonal_peak_months: "Apr-Oct" }),
          high: thr(16200, 12, 56, 3000, "Monthly", "4 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 120, deductible: 250, waiting_period_days: 14, seasonal_peak_months: "Apr-Oct" }),
        },
        silver: {
          low: thr(3000, 3, 10, 400, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $400", { travel_radius_miles: 60, deductible: 200, waiting_period_days: 30, seasonal_peak_months: "Apr-Oct" }),
          mid: thr(4500, 4, 14, 600, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $400", { travel_radius_miles: 80, deductible: 250, waiting_period_days: 30, seasonal_peak_months: "Apr-Oct" }),
          high: thr(6600, 4, 20, 900, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $400", { travel_radius_miles: 100, deductible: 350, waiting_period_days: 30, seasonal_peak_months: "Apr-Oct" }),
        },
        bronze: {
          low: thr(900, 2, 3, 0, "Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 300, waiting_period_days: 45, seasonal_peak_months: "Apr-Oct" }),
          mid: thr(1500, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 60, deductible: 350, waiting_period_days: 45, seasonal_peak_months: "Apr-Oct" }),
          high: thr(2200, 2, 6, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 75, deductible: 500, waiting_period_days: 45, seasonal_peak_months: "Apr-Oct" }),
        },
      }),
    },
    {
      id: "agriculture",
      name: "Agriculture",
      description: "Grain, produce packing, and agri-processing plant equipment.",
      active: true,
      sort_order: 40,
      levels: makeLevels({
        packId: "agriculture",
        bounds: BOUNDS.agriculture,
        units: { bronze: 6, silver: 15, gold: 30 },
        taglines: {
          gold: "Keep packing and processing lines running",
          silver: "Quarterly plant and packing equipment PM",
          bronze: "Line inspection for agri-processing gear",
        },
        coverages: {
          gold: agricultureGold,
          silver: agricultureSilver,
          bronze: agricultureBronze,
        },
        gold: {
          low: thr(7800, 10, 36, 1400, "Monthly", "8 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 80, deductible: 100, waiting_period_days: 21 }),
          mid: thr(11500, 12, 44, 2200, "Monthly", "4 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 100, deductible: 150, waiting_period_days: 14 }),
          high: thr(17500, 12, 64, 3500, "Monthly", "4 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 125, deductible: 300, waiting_period_days: 14 }),
        },
        silver: {
          low: thr(3300, 3, 12, 450, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 70, deductible: 200, waiting_period_days: 30 }),
          mid: thr(5100, 4, 16, 700, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 90, deductible: 250, waiting_period_days: 30 }),
          high: thr(7500, 4, 22, 1100, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 110, deductible: 400, waiting_period_days: 30 }),
        },
        bronze: {
          low: thr(1100, 2, 3, 0, "Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 55, deductible: 300, waiting_period_days: 45 }),
          mid: thr(1700, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 70, deductible: 400, waiting_period_days: 45 }),
          high: thr(2500, 2, 6, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 85, deductible: 500, waiting_period_days: 45 }),
        },
      }),
    },
    {
      id: "home_warranty",
      name: "Home Warranty",
      description: "Residential and light-commercial HVAC / appliance service agreements.",
      active: true,
      sort_order: 50,
      levels: makeLevels({
        packId: "home_warranty",
        bounds: BOUNDS.home_warranty,
        units: { bronze: 3, silver: 6, gold: 10 },
        taglines: {
          gold: "Quarterly HVAC and appliance coverage",
          silver: "Semi-annual HVAC tune-ups with parts help",
          bronze: "Annual HVAC tune-up essentials",
        },
        coverages: {
          gold: homeWarrantyGold,
          silver: homeWarrantySilver,
          bronze: homeWarrantyBronze,
        },
        gold: {
          low: thr(2800, 4, 12, 500, "Quarterly", "Next business day", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 30, deductible: 75, waiting_period_days: 30 }),
          mid: thr(4200, 4, 18, 800, "Quarterly", "Next business day", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 40, deductible: 100, waiting_period_days: 30 }),
          high: thr(6400, 6, 24, 1200, "Bi-Monthly", "8 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 50, deductible: 150, waiting_period_days: 21 }),
        },
        silver: {
          low: thr(1400, 2, 6, 200, "Semi-Annual", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Customer approval for extras over $300", { travel_radius_miles: 25, deductible: 100, waiting_period_days: 45 }),
          mid: thr(2200, 2, 8, 350, "Semi-Annual", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Customer approval for extras over $300", { travel_radius_miles: 35, deductible: 125, waiting_period_days: 45 }),
          high: thr(3200, 3, 12, 500, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Customer approval for extras over $300", { travel_radius_miles: 45, deductible: 175, waiting_period_days: 30 }),
        },
        bronze: {
          low: thr(600, 1, 2, 0, "Annual", "Standard (best effort)", "Per-Service Charge", "Emergency Repair Plan", "No renewal", "Customer approval required before dispatch", { travel_radius_miles: 20, deductible: 150, waiting_period_days: 60 }),
          mid: thr(900, 1, 3, 0, "Annual", "Standard (best effort)", "Per-Service Charge", "Emergency Repair Plan", "Manual renewal", "Customer approval required before dispatch", { travel_radius_miles: 25, deductible: 200, waiting_period_days: 60 }),
          high: thr(1400, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Emergency Repair Plan", "Manual renewal", "Customer approval required before dispatch", { travel_radius_miles: 35, deductible: 250, waiting_period_days: 45 }),
        },
      }),
    },
    {
      id: "foodservice",
      name: "Foodservice",
      description: "Restaurant, kitchen, walk-in, and ice-machine service agreements.",
      active: true,
      sort_order: 60,
      levels: makeLevels({
        packId: "foodservice",
        bounds: BOUNDS.foodservice,
        units: { bronze: 6, silver: 12, gold: 20 },
        taglines: {
          gold: "Protect walk-ins and kitchen uptime",
          silver: "Quarterly walk-in, ice, and oven PM",
          bronze: "Semi-annual kitchen equipment checks",
        },
        coverages: {
          gold: foodserviceGold,
          silver: foodserviceSilver,
          bronze: foodserviceBronze,
        },
        gold: {
          low: thr(7200, 10, 32, 1400, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 35, deductible: 0, waiting_period_days: 14 }),
          mid: thr(10800, 12, 40, 2200, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 45, deductible: 0, waiting_period_days: 14 }),
          high: thr(16200, 12, 56, 3500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 60, deductible: 200, waiting_period_days: 7 }),
        },
        silver: {
          low: thr(3200, 4, 12, 450, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 30, deductible: 100, waiting_period_days: 21 }),
          mid: thr(4800, 4, 16, 700, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 40, deductible: 150, waiting_period_days: 21 }),
          high: thr(7200, 4, 22, 1100, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 50, deductible: 250, waiting_period_days: 14 }),
        },
        bronze: {
          low: thr(1100, 2, 4, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 25, deductible: 200, waiting_period_days: 30 }),
          mid: thr(1600, 2, 4, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 35, deductible: 250, waiting_period_days: 30 }),
          high: thr(2400, 2, 6, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 45, deductible: 350, waiting_period_days: 30 }),
        },
      }),
    },
    {
      id: "retail_grocery",
      name: "Retail / Grocery",
      description: "Grocery cases, open display refrigeration, and store HVAC.",
      active: true,
      sort_order: 70,
      levels: makeLevels({
        packId: "retail_grocery",
        bounds: BOUNDS.retail_grocery,
        units: { bronze: 8, silver: 18, gold: 35 },
        taglines: {
          gold: "Priority protection for cold cases and HVAC",
          silver: "Quarterly case and store HVAC PM",
          bronze: "Semi-annual case and HVAC inspections",
        },
        coverages: {
          gold: retailGold,
          silver: retailSilver,
          bronze: retailBronze,
        },
        gold: {
          low: thr(9000, 10, 40, 1800, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 40, deductible: 0, waiting_period_days: 14 }),
          mid: thr(13500, 12, 52, 2800, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 55, deductible: 0, waiting_period_days: 14 }),
          high: thr(21000, 12, 72, 4500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 75, deductible: 300, waiting_period_days: 7 }),
        },
        silver: {
          low: thr(4000, 4, 14, 600, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 35, deductible: 150, waiting_period_days: 21 }),
          mid: thr(6000, 4, 18, 900, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 50, deductible: 200, waiting_period_days: 21 }),
          high: thr(9000, 4, 26, 1400, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 65, deductible: 300, waiting_period_days: 14 }),
        },
        bronze: {
          low: thr(1400, 2, 4, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 30, deductible: 250, waiting_period_days: 30 }),
          mid: thr(2100, 2, 6, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 40, deductible: 300, waiting_period_days: 30 }),
          high: thr(3200, 2, 8, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 450, waiting_period_days: 30 }),
        },
      }),
    },
    {
      id: "healthcare",
      name: "Healthcare / Labs",
      description: "Clinical, lab, and calibrated equipment with compliance documentation.",
      active: true,
      sort_order: 80,
      levels: makeLevels({
        packId: "healthcare",
        bounds: BOUNDS.healthcare,
        units: { bronze: 5, silver: 12, gold: 25 },
        taglines: {
          gold: "Audit-ready PM with tight emergency SLA",
          silver: "Quarterly calibrated-equipment PM",
          bronze: "Compliance checklist inspections",
        },
        coverages: {
          gold: healthcareGold,
          silver: healthcareSilver,
          bronze: healthcareBronze,
        },
        gold: {
          low: thr(11000, 10, 40, 2000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 40, deductible: 0, waiting_period_days: 7 }),
          mid: thr(16500, 12, 56, 3200, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 50, deductible: 0, waiting_period_days: 7 }),
          high: thr(25500, 12, 80, 5000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 65, deductible: 200, waiting_period_days: 7 }),
        },
        silver: {
          low: thr(4800, 4, 16, 700, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 35, deductible: 100, waiting_period_days: 14 }),
          mid: thr(7200, 4, 22, 1100, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 45, deductible: 150, waiting_period_days: 14 }),
          high: thr(10800, 4, 30, 1600, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 55, deductible: 250, waiting_period_days: 14 }),
        },
        bronze: {
          low: thr(1600, 2, 4, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 30, deductible: 200, waiting_period_days: 30 }),
          mid: thr(2400, 2, 6, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 40, deductible: 250, waiting_period_days: 30 }),
          high: thr(3600, 2, 8, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 400, waiting_period_days: 30 }),
        },
      }),
    },
    {
      id: "manufacturing",
      name: "Manufacturing / Plant",
      description: "Production-line and critical plant equipment maintenance.",
      active: true,
      sort_order: 90,
      levels: makeLevels({
        packId: "manufacturing",
        bounds: BOUNDS.manufacturing,
        units: { bronze: 6, silver: 15, gold: 35 },
        taglines: {
          gold: "Critical-line PM with production-down priority",
          silver: "Quarterly critical-asset plant PM",
          bronze: "Semi-annual production equipment checks",
        },
        coverages: {
          gold: manufacturingGold,
          silver: manufacturingSilver,
          bronze: manufacturingBronze,
        },
        gold: {
          low: thr(12000, 10, 44, 2200, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 50, deductible: 0, waiting_period_days: 14 }),
          mid: thr(18000, 12, 60, 3500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 65, deductible: 0, waiting_period_days: 14 }),
          high: thr(28000, 12, 88, 5500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 90, deductible: 350, waiting_period_days: 7 }),
        },
        silver: {
          low: thr(5200, 4, 16, 800, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 45, deductible: 150, waiting_period_days: 21 }),
          mid: thr(7800, 4, 22, 1200, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 60, deductible: 200, waiting_period_days: 21 }),
          high: thr(11500, 4, 32, 1800, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 75, deductible: 350, waiting_period_days: 14 }),
        },
        bronze: {
          low: thr(1800, 2, 4, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 40, deductible: 300, waiting_period_days: 30 }),
          mid: thr(2700, 2, 6, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 400, waiting_period_days: 30 }),
          high: thr(4000, 2, 8, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 65, deductible: 500, waiting_period_days: 30 }),
        },
      }),
    },
    {
      id: "fleet",
      name: "Fleet / Mobile",
      description: "Mobile service units, refrigerated trucks, and field equipment.",
      active: true,
      sort_order: 100,
      levels: makeLevels({
        packId: "fleet",
        bounds: BOUNDS.fleet,
        units: { bronze: 6, silver: 15, gold: 30 },
        taglines: {
          gold: "Wide-radius PM for downed mobile units",
          silver: "Quarterly mobile-unit PM on the road",
          bronze: "Semi-annual mobile unit inspections",
        },
        coverages: {
          gold: fleetGold,
          silver: fleetSilver,
          bronze: fleetBronze,
        },
        gold: {
          low: thr(8600, 10, 36, 1600, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 90, deductible: 0, waiting_period_days: 14 }),
          mid: thr(12800, 12, 48, 2500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 120, deductible: 0, waiting_period_days: 14 }),
          high: thr(19800, 12, 68, 4000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 150, deductible: 250, waiting_period_days: 7 }),
        },
        silver: {
          low: thr(3800, 4, 12, 550, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 70, deductible: 150, waiting_period_days: 21 }),
          mid: thr(5600, 4, 18, 850, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 100, deductible: 200, waiting_period_days: 21 }),
          high: thr(8400, 4, 26, 1300, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 125, deductible: 300, waiting_period_days: 14 }),
        },
        bronze: {
          low: thr(1300, 2, 4, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 250, waiting_period_days: 30 }),
          mid: thr(2000, 2, 6, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 75, deductible: 300, waiting_period_days: 30 }),
          high: thr(3000, 2, 8, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 90, deductible: 450, waiting_period_days: 30 }),
        },
      }),
    },
    {
      id: "property_multisite",
      name: "Property / Multi-site",
      description: "Portfolio HVAC and equipment coverage across multiple sites.",
      active: true,
      sort_order: 110,
      levels: makeLevels({
        packId: "property_multisite",
        bounds: BOUNDS.property_multisite,
        units: { bronze: 10, silver: 25, gold: 50 },
        taglines: {
          gold: "Monthly multi-site cadence with portfolio reporting",
          silver: "Quarterly PM shared across sites",
          bronze: "Rotating portfolio site inspections",
        },
        coverages: {
          gold: propertyGold,
          silver: propertySilver,
          bronze: propertyBronze,
        },
        gold: {
          low: thr(10000, 10, 40, 1800, "Monthly", "8 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 60, deductible: 0, waiting_period_days: 14 }),
          mid: thr(15000, 12, 56, 2800, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 80, deductible: 0, waiting_period_days: 14 }),
          high: thr(23000, 12, 80, 4500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 110, deductible: 250, waiting_period_days: 7 }),
        },
        silver: {
          low: thr(4400, 4, 14, 600, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 50, deductible: 150, waiting_period_days: 21 }),
          mid: thr(6600, 4, 20, 1000, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 70, deductible: 200, waiting_period_days: 21 }),
          high: thr(9800, 4, 28, 1500, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 90, deductible: 300, waiting_period_days: 14 }),
        },
        bronze: {
          low: thr(1500, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 40, deductible: 250, waiting_period_days: 30 }),
          mid: thr(2300, 2, 6, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 55, deductible: 300, waiting_period_days: 30 }),
          high: thr(3400, 3, 8, 0, "Quarterly", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 70, deductible: 450, waiting_period_days: 30 }),
        },
      }),
    },
    {
      id: "standby_power",
      name: "Emergency / Standby Power",
      description: "Generators, UPS, transfer switches, and load-bank testing.",
      active: true,
      sort_order: 120,
      levels: makeLevels({
        packId: "standby_power",
        bounds: BOUNDS.standby_power,
        units: { bronze: 2, silver: 4, gold: 8 },
        taglines: {
          gold: "Monthly exercise with fast emergency response",
          silver: "Semi-annual generator and UPS PM",
          bronze: "Annual load-bank and start testing",
        },
        coverages: {
          gold: standbyGold,
          silver: standbySilver,
          bronze: standbyBronze,
        },
        gold: {
          low: thr(7800, 10, 28, 1200, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 50, deductible: 0, waiting_period_days: 7, fuel_system_checks: true, transfer_switch_checks: true }),
          mid: thr(11400, 12, 40, 2000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 65, deductible: 0, waiting_period_days: 7, fuel_system_checks: true, transfer_switch_checks: true }),
          high: thr(17600, 12, 56, 3200, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 85, deductible: 200, waiting_period_days: 7, fuel_system_checks: true, transfer_switch_checks: true }),
        },
        silver: {
          low: thr(3400, 2, 10, 400, "Semi-Annual", "8 business hours", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 45, deductible: 100, waiting_period_days: 14 }),
          mid: thr(5100, 2, 14, 650, "Semi-Annual", "8 business hours", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 55, deductible: 150, waiting_period_days: 14 }),
          high: thr(7600, 3, 20, 1000, "Quarterly", "8 business hours", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 70, deductible: 250, waiting_period_days: 14 }),
        },
        bronze: {
          low: thr(1100, 1, 3, 0, "Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 35, deductible: 250, waiting_period_days: 30 }),
          mid: thr(1700, 1, 4, 0, "Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 45, deductible: 300, waiting_period_days: 30 }),
          high: thr(2500, 2, 6, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 55, deductible: 400, waiting_period_days: 30 }),
        },
      }),
    },
    {
      id: "custom_industry",
      name: "Custom Industry",
      description: "Customizable baseline pack — edit prices, bands, and coverage as needed.",
      active: true,
      sort_order: 130,
      levels: makeLevels({
        packId: "custom_industry",
        bounds: BOUNDS.custom_industry,
        units: { bronze: 8, silver: 20, gold: 40 },
        taglines: {
          gold: "Full uptime protection — customize for your vertical",
          silver: "Balanced PM and limited repair — editable baseline",
          bronze: "Essential inspections — editable baseline",
        },
        coverages: {
          gold: warehouseGold,
          silver: warehouseSilver,
          bronze: warehouseBronze,
        },
        gold: {
          low: thr(8400, 12, 36, 1500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 40, deductible: 0, waiting_period_days: 14 }),
          mid: thr(12000, 12, 48, 2500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 50, deductible: 0, waiting_period_days: 14 }),
          high: thr(18600, 12, 72, 4000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 75, deductible: 250, waiting_period_days: 14 }),
        },
        silver: {
          low: thr(3600, 4, 12, 500, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 40, deductible: 100, waiting_period_days: 30 }),
          mid: thr(5400, 4, 16, 800, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 50, deductible: 150, waiting_period_days: 30 }),
          high: thr(7800, 4, 24, 1200, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 60, deductible: 250, waiting_period_days: 30 }),
        },
        bronze: {
          low: thr(1200, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 30, deductible: 250, waiting_period_days: 30 }),
          mid: thr(1800, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 40, deductible: 250, waiting_period_days: 30 }),
          high: thr(2700, 2, 8, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 500, waiting_period_days: 30 }),
        },
      }),
    },
  ];

  return {
    version: CATALOG_VERSION,
    packs,
    updated_at: new Date().toISOString(),
  };
}

export const DEFAULT_CUSTOMER_PACK_ID = "warehouse";
/** Manual apply path — not a seeded industry pack. */
export const CUSTOM_PACK_ID = "custom";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function midBandMidpointAssetValue(pack: IndustryPack): number {
  const bands = pack.levels[0]?.bands ?? [];
  const mid = bands.find((b) => b.id === "mid") ?? bands[1] ?? bands[0];
  if (!mid) return 100_000;
  if (mid.max_asset_value == null) {
    return mid.min_asset_value + Math.max(50_000, Math.round(mid.min_asset_value * 0.5));
  }
  return Math.floor((mid.min_asset_value + mid.max_asset_value) / 2);
}

function mergeMissingPacksFromSeed(stored: ContractPlanCatalog): {
  catalog: ContractPlanCatalog;
  changed: boolean;
} {
  const seed = buildSeedCatalog();
  const existingIds = new Set(stored.packs.map((p) => p.id));
  const missing = seed.packs.filter((p) => !existingIds.has(p.id));
  const needsVersionBump = (stored.version ?? 0) < CATALOG_VERSION;
  if (missing.length === 0 && !needsVersionBump) {
    return { catalog: stored, changed: false };
  }
  return {
    catalog: {
      ...stored,
      version: CATALOG_VERSION,
      packs: [...stored.packs, ...missing],
      updated_at: new Date().toISOString(),
    },
    changed: true,
  };
}

function readStoredCatalogRaw(): { raw: string | null; fromV1: boolean } {
  if (!canUseStorage()) return { raw: null, fromV1: false };
  const v2 = localStorage.getItem(CONTRACT_PLANS_STORAGE_KEY);
  if (v2) return { raw: v2, fromV1: false };
  const v1 = localStorage.getItem(CONTRACT_PLANS_STORAGE_KEY_V1);
  if (v1) return { raw: v1, fromV1: true };
  return { raw: null, fromV1: false };
}

export function loadCatalog(): ContractPlanCatalog {
  if (!canUseStorage()) return buildSeedCatalog();
  try {
    const { raw, fromV1 } = readStoredCatalogRaw();
    if (!raw) {
      const seed = buildSeedCatalog();
      saveCatalog(seed);
      return seed;
    }
    const parsed = JSON.parse(raw) as ContractPlanCatalog;
    if (!parsed?.packs?.length) {
      const seed = buildSeedCatalog();
      saveCatalog(seed);
      return seed;
    }
    const { catalog, changed } = mergeMissingPacksFromSeed(parsed);
    const normalized = normalizeCatalog(catalog);
    if (changed || fromV1 || (parsed.version ?? 0) < CATALOG_VERSION) {
      const next = { ...normalized, version: CATALOG_VERSION };
      saveCatalog(next);
      return next;
    }
    return normalized;
  } catch {
    return buildSeedCatalog();
  }
}

export function saveCatalog(catalog: ContractPlanCatalog): void {
  if (!canUseStorage()) return;
  const next = {
    ...catalog,
    updated_at: new Date().toISOString(),
    version: CATALOG_VERSION,
  };
  localStorage.setItem(CONTRACT_PLANS_STORAGE_KEY, JSON.stringify(next));
}

export function resetCatalogToSeed(): ContractPlanCatalog {
  const seed = buildSeedCatalog();
  saveCatalog(seed);
  return seed;
}

export function listActivePacks(catalog?: ContractPlanCatalog): IndustryPack[] {
  const cat = catalog ?? loadCatalog();
  return [...cat.packs].filter((p) => p.active).sort((a, b) => a.sort_order - b.sort_order);
}

export function getPack(packId: string, catalog?: ContractPlanCatalog): IndustryPack | null {
  const cat = catalog ?? loadCatalog();
  return cat.packs.find((p) => p.id === packId) ?? null;
}

export function getLevel(pack: IndustryPack, tierId: ServiceLevelId): ServiceLevelPlan | null {
  return pack.levels.find((l) => l.id === tierId) ?? null;
}

export function resolveBand(bands: AssetValueBand[], assetValue: number): AssetValueBand {
  const value = Number.isFinite(assetValue) && assetValue >= 0 ? assetValue : 0;
  const sorted = [...bands].sort((a, b) => a.min_asset_value - b.min_asset_value);
  for (const band of sorted) {
    const underMax = band.max_asset_value == null || value < band.max_asset_value;
    if (value >= band.min_asset_value && underMax) return band;
  }
  return sorted[sorted.length - 1] ?? sorted[0];
}

export function resolvePlan(
  packId: string,
  tierId: ServiceLevelId,
  assetValue: number,
  catalog?: ContractPlanCatalog,
): ResolvedPlan | null {
  if (packId === CUSTOM_PACK_ID) return null;
  const pack = getPack(packId, catalog);
  if (!pack || !pack.active) return null;
  const level = getLevel(pack, tierId);
  if (!level) return null;
  const band = resolveBand(level.bands, assetValue);
  return { pack, level, band, thresholds: band.thresholds, assetValue };
}

export function sumEquipmentAssetValue(
  equipment: { replacement_cost?: number | null }[],
): number {
  return equipment.reduce((sum, eq) => sum + (Number(eq.replacement_cost) || 0), 0);
}

export function formatPlanSnapshot(input: {
  pack: IndustryPack;
  level: ServiceLevelPlan;
  band: AssetValueBand;
  assetValue: number;
}): string {
  const asset = Math.round(input.assetValue).toLocaleString("en-US");
  return `[Plan: ${input.pack.name} · ${input.level.name} · ${input.band.label} · asset $${asset}]`;
}

export function mergePlanSnapshotIntoNotes(existingNotes: string | null | undefined, tag: string): string {
  const cleaned = (existingNotes ?? "")
    .replace(PLAN_TAG_RE, "")
    .replace(EXTRAS_TAG_RE, "")
    .trim();
  return cleaned ? `${tag}\n${cleaned}` : tag;
}

export function parsePlanSnapshotFromNotes(notes: string | null | undefined): PlanSnapshot | null {
  if (!notes) return null;
  const match = notes.match(PLAN_TAG_RE);
  if (!match) return null;
  const packName = match[1].trim();
  const tierName = match[2].trim();
  const bandLabel = match[3].trim();
  const assetValue = Number(String(match[4]).replace(/,/g, ""));
  const tierId = (["gold", "silver", "bronze"] as ServiceLevelId[]).find(
    (id) => id === tierName.toLowerCase(),
  );
  const extrasMatch = notes.match(/\[Extras:\s*([^\]]+)\]/i);
  const extras: Record<string, string | number | boolean> = {};
  if (extrasMatch) {
    for (const part of extrasMatch[1].split(";")) {
      const idx = part.indexOf("=");
      if (idx <= 0) continue;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (!key) continue;
      const num = Number(val);
      extras[key] = Number.isFinite(num) && val !== "" ? num : val;
    }
  }
  return {
    packId: packName.toLowerCase().replace(/\s+/g, "_"),
    packName,
    tierId: tierId ?? "silver",
    tierName,
    bandId: bandLabel.toLowerCase(),
    bandLabel,
    assetValue: Number.isFinite(assetValue) ? assetValue : 0,
    extras,
  };
}

export function applyPlanToContractForm<T extends ManagerContractFormFields>(
  form: T,
  resolved: ResolvedPlan,
  options?: { updateName?: boolean; customerName?: string; serviceFeeOption?: 100 | 125 },
): T {
  const t = resolved.thresholds;
  const feeOption = options?.serviceFeeOption ?? 125;
  const monthlyPremium =
    feeOption === 100
      ? (t.monthly_premium_at_100_fee ?? Math.round(t.annual_price / 12) + 25)
      : (t.monthly_premium_at_125_fee ?? Math.round(t.annual_price / 12));
  const tag = formatPlanSnapshot({
    pack: resolved.pack,
    level: resolved.level,
    band: resolved.band,
    assetValue: resolved.assetValue,
  });
  const extrasLine = buildPricingExtrasLine(t, feeOption, resolved.pack.id);
  const notesWithExtras = mergePlanSnapshotIntoNotes(
    form.notes,
    `${tag}\n${extrasLine}`,
  );

  const name =
    options?.updateName && options.customerName
      ? `${options.customerName} · ${resolved.pack.name} · ${resolved.level.name}`
      : form.name;

  const annual = Number(t.annual_price) || 0;
  const isMonthly = /monthly\s*recurring/i.test(t.billing_method);
  const deductibleRaw = t.extras.deductible;
  const deductible =
    typeof deductibleRaw === "number"
      ? deductibleRaw
      : Number(deductibleRaw);
  const monthly = isMonthly ? Math.round((annual / 12) * 100) / 100 : 0;

  return {
    ...form,
    ...(name != null ? { name } : {}),
    contract_type: t.contract_type,
    billing_method: t.billing_method,
    contract_price: String(monthlyPremium * 12),
    monthly_amount: String(monthlyPremium),
    deductible: String(Number.isFinite(deductible) && deductible >= 0 ? deductible : 0),
    included_service_visits: String(t.included_service_visits),
    included_labor_hours: String(t.included_labor_hours),
    included_replacement_parts: String(t.included_replacement_parts),
    service_frequency: t.service_frequency,
    emergency_response_commitment: t.emergency_response_commitment,
    payment_terms: t.payment_terms,
    renewal_option: t.renewal_option,
    approval_requirements: t.approval_requirements,
    notes: notesWithExtras,
  };
}

/** Build tier shape from a pack's Mid band for customer request UI. */
export function getCatalogDrivenTier(
  tierId: ServiceLevelId,
  packId: string = DEFAULT_CUSTOMER_PACK_ID,
  catalog?: ContractPlanCatalog,
): CatalogDrivenTier {
  const cat = catalog ?? loadCatalog();
  const pack = getPack(packId || DEFAULT_CUSTOMER_PACK_ID, cat);
  if (!pack) {
    throw new Error(`Unknown contract pack: ${packId}`);
  }
  const assetValue = midBandMidpointAssetValue(pack);
  const resolved = resolvePlan(pack.id, tierId, assetValue, cat);
  if (!resolved) {
    throw new Error(`Unknown contract tier or pack: ${packId}/${tierId}`);
  }
  const t = resolved.thresholds;
  const units = Number(t.extras.max_units_covered);
  const coverages = [...resolved.level.coverages];
  const hasUnitsLine = coverages.some((c) => /pieces of equipment covered/i.test(c));
  if (!hasUnitsLine && Number.isFinite(units) && units > 0) {
    coverages.unshift(unitsLine(units));
  }
  const monthly125 = t.monthly_premium_at_125_fee ?? Math.round(t.annual_price / 12);
  const monthly100 = t.monthly_premium_at_100_fee ?? monthly125 + 25;
  return {
    id: tierId,
    name: resolved.level.name,
    tagline: resolved.level.tagline,
    recommended: resolved.level.recommended,
    coverages: [
      ...coverages,
      `${formatMoneyPlain(monthly125)}/mo @ $125/visit or ${formatMoneyPlain(monthly100)}/mo @ $100/visit (${resolved.pack.name} Mid band)`,
      "$100 or $125 service fee per dispatch (your choice at signup)",
    ],
    formDefaults: {
      contract_type: t.contract_type,
      renewal_option: t.renewal_option,
      included_service_visits: String(t.included_service_visits),
      service_frequency: t.service_frequency,
      included_labor_hours: String(t.included_labor_hours),
      included_replacement_parts: String(t.included_replacement_parts),
      emergency_response_commitment: t.emergency_response_commitment,
      billing_method: t.billing_method,
      payment_terms: t.payment_terms,
      approval_requirements: t.approval_requirements,
    },
  };
}

export function listCatalogDrivenTiers(
  packId: string = DEFAULT_CUSTOMER_PACK_ID,
  catalog?: ContractPlanCatalog,
): CatalogDrivenTier[] {
  return (["gold", "silver", "bronze"] as ServiceLevelId[]).map((id) =>
    getCatalogDrivenTier(id, packId, catalog),
  );
}

export function matchContractPlan(notes: string | null | undefined): PlanSnapshot | null {
  return parsePlanSnapshotFromNotes(notes);
}

export function resolvePackIdFromSnapshot(
  snap: PlanSnapshot,
  catalog?: ContractPlanCatalog,
): string | null {
  const packs = (catalog ?? loadCatalog()).packs;
  const byName = packs.find((p) => p.name.toLowerCase() === snap.packName.toLowerCase());
  if (byName) return byName.id;
  const byId = packs.find((p) => p.id === snap.packId);
  return byId?.id ?? null;
}

/** Filter helper for manager Contracts list. */
export function contractMatchesPlanFilters(
  notes: string | null | undefined,
  industryPack: "all" | "unlabeled" | string,
  tier: "all" | ServiceLevelId,
  catalog?: ContractPlanCatalog,
): boolean {
  const snap = parsePlanSnapshotFromNotes(notes);
  if (industryPack === "unlabeled") {
    return !snap && tier === "all";
  }
  if (!snap) {
    return industryPack === "all" && tier === "all";
  }
  if (industryPack !== "all") {
    const resolvedId = resolvePackIdFromSnapshot(snap, catalog);
    if (resolvedId !== industryPack) return false;
  }
  if (tier !== "all" && snap.tierId !== tier) return false;
  return true;
}

/** Mid-band Gold price for browse panel quick reference. */
export function packGoldMidPrice(pack: IndustryPack): number {
  const gold = pack.levels.find((l) => l.id === "gold");
  const mid = gold?.bands.find((b) => b.id === "mid") ?? gold?.bands[0];
  return mid?.thresholds.annual_price ?? 0;
}

function formatMoneyPlain(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function upsertPack(catalog: ContractPlanCatalog, pack: IndustryPack): ContractPlanCatalog {
  const idx = catalog.packs.findIndex((p) => p.id === pack.id);
  const packs = [...catalog.packs];
  if (idx >= 0) packs[idx] = pack;
  else packs.push(pack);
  const next = { ...catalog, packs };
  saveCatalog(next);
  return next;
}

export function clonePack(catalog: ContractPlanCatalog, packId: string, newName: string): ContractPlanCatalog {
  const source = getPack(packId, catalog);
  if (!source) return catalog;
  const idBase = newName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  let id = idBase || `pack_${Date.now().toString(36)}`;
  let n = 2;
  while (catalog.packs.some((p) => p.id === id)) {
    id = `${idBase}_${n++}`;
  }
  const clone: IndustryPack = {
    ...structuredClone(source),
    id,
    name: newName.trim() || `${source.name} Copy`,
    sort_order: Math.max(...catalog.packs.map((p) => p.sort_order), 0) + 10,
    active: true,
  };
  return upsertPack(catalog, clone);
}

export function setPackActive(
  catalog: ContractPlanCatalog,
  packId: string,
  active: boolean,
): ContractPlanCatalog {
  const pack = getPack(packId, catalog);
  if (!pack) return catalog;
  return upsertPack(catalog, { ...pack, active });
}

export function updateBandThresholds(
  catalog: ContractPlanCatalog,
  packId: string,
  tierId: ServiceLevelId,
  bandId: string,
  patch: Partial<PlanThresholds> & { extras?: Record<string, string | number | boolean> },
): ContractPlanCatalog {
  const pack = getPack(packId, catalog);
  if (!pack) return catalog;
  const levels = pack.levels.map((level) => {
    if (level.id !== tierId) return level;
    const bands = level.bands.map((band) => {
      if (band.id !== bandId) return band;
      return {
        ...band,
        thresholds: {
          ...band.thresholds,
          ...patch,
          extras: patch.extras ?? band.thresholds.extras,
        },
      };
    });
    return { ...level, bands };
  });
  return upsertPack(catalog, { ...pack, levels });
}

export function updateBandBounds(
  catalog: ContractPlanCatalog,
  packId: string,
  tierId: ServiceLevelId,
  bandId: string,
  bounds: { label?: string; min_asset_value?: number; max_asset_value?: number | null },
): ContractPlanCatalog {
  const pack = getPack(packId, catalog);
  if (!pack) return catalog;
  const levels = pack.levels.map((level) => {
    if (level.id !== tierId) return level;
    const bands = level.bands.map((band) => {
      if (band.id !== bandId) return band;
      return {
        ...band,
        label: bounds.label ?? band.label,
        min_asset_value: bounds.min_asset_value ?? band.min_asset_value,
        max_asset_value:
          bounds.max_asset_value !== undefined ? bounds.max_asset_value : band.max_asset_value,
      };
    });
    return { ...level, bands };
  });
  return upsertPack(catalog, { ...pack, levels });
}

export function createBlankPack(name: string): IndustryPack {
  const seed = buildSeedCatalog().packs.find((p) => p.id === "warehouse")!;
  const idBase = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return {
    ...structuredClone(seed),
    id: idBase || `pack_${Date.now().toString(36)}`,
    name: name.trim() || "New Industry",
    description: "Custom industry pack — edit prices and thresholds as needed.",
    active: true,
    sort_order: 200,
  };
}

export function formatBandRange(band: AssetValueBand): string {
  const min = `$${band.min_asset_value.toLocaleString("en-US")}`;
  if (band.max_asset_value == null) return `${min}+`;
  return `${min} – $${(band.max_asset_value - 1).toLocaleString("en-US")}`;
}
