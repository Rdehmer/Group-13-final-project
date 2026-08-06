/**
 * Industry × Gold/Silver/Bronze × asset-value-band contract plan catalog.
 * Stored in localStorage (ridley_contract_plans_v1); no Supabase table required.
 */

export const CONTRACT_PLANS_STORAGE_KEY = "ridley_contract_plans_v1";

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
  version: 1;
  packs: IndustryPack[];
  updated_at: string;
};

export type ManagerContractFormFields = {
  name?: string;
  contract_type: string;
  billing_method: string;
  contract_price: string;
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

const PLAN_TAG_RE =
  /\[Plan:\s*([^·]+)·\s*([^·]+)·\s*([^·]+)·\s*asset\s*\$([0-9,]+(?:\.\d+)?)\]/i;
const EXTRAS_TAG_RE = /\[Extras:\s*[^\]]*\]/gi;

const DEFAULT_BAND_BOUNDS = [
  { id: "low", label: "Low", min: 0, max: 50_000 },
  { id: "mid", label: "Mid", min: 50_000, max: 250_000 },
  { id: "high", label: "High", min: 250_000, max: null as number | null },
] as const;

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

function bandsFor(
  low: PlanThresholds,
  mid: PlanThresholds,
  high: PlanThresholds,
): AssetValueBand[] {
  return DEFAULT_BAND_BOUNDS.map((b, i) => ({
    id: b.id,
    label: b.label,
    min_asset_value: b.min,
    max_asset_value: b.max,
    thresholds: [low, mid, high][i],
  }));
}

function goldCoverages(visits: number, labor: number, parts: number, sla: string): string[] {
  return [
    `${visits} scheduled visits per year`,
    `${labor} included labor hours`,
    parts > 0 ? `$${parts.toLocaleString()} parts allowance` : "Parts billed separately",
    `${sla} emergency response`,
    "Priority dispatch and after-hours coverage",
    "Corrective repairs within allowance",
    "Annual performance summary",
    "Auto-renew eligible",
  ];
}

function silverCoverages(visits: number, labor: number, parts: number, sla: string): string[] {
  return [
    `${visits} scheduled visits per year`,
    `${labor} included labor hours`,
    parts > 0 ? `$${parts.toLocaleString()} parts allowance` : "Parts billed separately",
    `${sla} emergency response`,
    "PM inspections, cleaning, and tune-ups",
    "Limited corrective work within allowance",
    "Standard business-hours dispatch",
  ];
}

function bronzeCoverages(visits: number, labor: number, sla: string): string[] {
  return [
    `${visits} scheduled visits per year`,
    `${labor} included labor hours`,
    "No included parts — billed separately",
    `${sla} emergency response`,
    "Essential inspections and basic tune-ups",
    "Corrective work billed time and materials",
  ];
}

function makeLevels(opts: {
  gold: { low: PlanThresholds; mid: PlanThresholds; high: PlanThresholds };
  silver: { low: PlanThresholds; mid: PlanThresholds; high: PlanThresholds };
  bronze: { low: PlanThresholds; mid: PlanThresholds; high: PlanThresholds };
}): ServiceLevelPlan[] {
  const g = opts.gold.mid;
  const s = opts.silver.mid;
  const b = opts.bronze.mid;
  return [
    {
      id: "gold",
      name: "Gold",
      tagline: "Full uptime protection",
      recommended: true,
      coverages: goldCoverages(
        g.included_service_visits,
        g.included_labor_hours,
        g.included_replacement_parts,
        g.emergency_response_commitment,
      ),
      bands: bandsFor(opts.gold.low, opts.gold.mid, opts.gold.high),
    },
    {
      id: "silver",
      name: "Silver",
      tagline: "Balanced PM and limited repair",
      coverages: silverCoverages(
        s.included_service_visits,
        s.included_labor_hours,
        s.included_replacement_parts,
        s.emergency_response_commitment,
      ),
      bands: bandsFor(opts.silver.low, opts.silver.mid, opts.silver.high),
    },
    {
      id: "bronze",
      name: "Bronze",
      tagline: "Essential inspections only",
      coverages: bronzeCoverages(
        b.included_service_visits,
        b.included_labor_hours,
        b.emergency_response_commitment,
      ),
      bands: bandsFor(opts.bronze.low, opts.bronze.mid, opts.bronze.high),
    },
  ];
}

/** Seeded industry packs — Warehouse Mid mirrors legacy CONTRACT_TIERS. */
export function buildSeedCatalog(): ContractPlanCatalog {
  const packs: IndustryPack[] = [
    {
      id: "warehouse",
      name: "Warehouse",
      description: "Cold storage, distribution, and industrial warehouse equipment.",
      active: true,
      sort_order: 10,
      levels: makeLevels({
        gold: {
          low: thr(8400, 12, 36, 1500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 40, deductible: 0, waiting_period_days: 14, max_units_covered: 15 }),
          mid: thr(12000, 12, 48, 2500, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 50, deductible: 0, waiting_period_days: 14, max_units_covered: 40 }),
          high: thr(18600, 12, 72, 4000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 75, deductible: 250, waiting_period_days: 14, max_units_covered: 100 }),
        },
        silver: {
          low: thr(3600, 4, 12, 500, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 40, deductible: 100, waiting_period_days: 30, max_units_covered: 10 }),
          mid: thr(5400, 4, 16, 800, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 50, deductible: 150, waiting_period_days: 30, max_units_covered: 25 }),
          high: thr(7800, 4, 24, 1200, "Quarterly", "Next business day", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 60, deductible: 250, waiting_period_days: 30, max_units_covered: 50 }),
        },
        bronze: {
          low: thr(1200, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 30, deductible: 250, waiting_period_days: 30, max_units_covered: 5 }),
          mid: thr(1800, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 40, deductible: 250, waiting_period_days: 30, max_units_covered: 12 }),
          high: thr(2700, 2, 8, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 500, waiting_period_days: 30, max_units_covered: 20 }),
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
        gold: {
          low: thr(9600, 12, 40, 2000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 60, deductible: 0, waiting_period_days: 7, max_units_covered: 20 }),
          mid: thr(14400, 12, 56, 3200, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 80, deductible: 0, waiting_period_days: 7, max_units_covered: 50 }),
          high: thr(22000, 12, 80, 5000, "Monthly", "4 business hours", "Monthly Recurring Charge", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 100, deductible: 500, waiting_period_days: 7, max_units_covered: 120 }),
        },
        silver: {
          low: thr(4200, 4, 14, 600, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 50, deductible: 150, waiting_period_days: 14, max_units_covered: 12 }),
          mid: thr(6600, 4, 20, 1000, "Quarterly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 70, deductible: 200, waiting_period_days: 14, max_units_covered: 30 }),
          high: thr(9600, 6, 28, 1500, "Bi-Monthly", "8 business hours", "Monthly Recurring Charge", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $750", { travel_radius_miles: 90, deductible: 300, waiting_period_days: 14, max_units_covered: 60 }),
        },
        bronze: {
          low: thr(1500, 2, 4, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 40, deductible: 300, waiting_period_days: 30, max_units_covered: 6 }),
          mid: thr(2400, 2, 6, 0, "Semi-Annual", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 400, waiting_period_days: 30, max_units_covered: 15 }),
          high: thr(3600, 3, 8, 0, "Quarterly", "Next business day", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 60, deductible: 500, waiting_period_days: 30, max_units_covered: 25 }),
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
        gold: {
          low: thr(7200, 8, 32, 1200, "Monthly", "8 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 75, deductible: 100, waiting_period_days: 21, max_units_covered: 12, seasonal_peak_months: "Apr-Oct" }),
          mid: thr(10800, 10, 40, 2000, "Monthly", "8 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 90, deductible: 150, waiting_period_days: 21, max_units_covered: 30, seasonal_peak_months: "Apr-Oct" }),
          high: thr(16200, 12, 56, 3000, "Monthly", "4 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 120, deductible: 250, waiting_period_days: 14, max_units_covered: 60, seasonal_peak_months: "Apr-Oct" }),
        },
        silver: {
          low: thr(3000, 3, 10, 400, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $400", { travel_radius_miles: 60, deductible: 200, waiting_period_days: 30, max_units_covered: 8 }),
          mid: thr(4500, 4, 14, 600, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $400", { travel_radius_miles: 80, deductible: 250, waiting_period_days: 30, max_units_covered: 20 }),
          high: thr(6600, 4, 20, 900, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $400", { travel_radius_miles: 100, deductible: 350, waiting_period_days: 30, max_units_covered: 40 }),
        },
        bronze: {
          low: thr(900, 2, 3, 0, "Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 50, deductible: 300, waiting_period_days: 45, max_units_covered: 4 }),
          mid: thr(1500, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 60, deductible: 350, waiting_period_days: 45, max_units_covered: 10 }),
          high: thr(2200, 2, 6, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 75, deductible: 500, waiting_period_days: 45, max_units_covered: 18 }),
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
        gold: {
          low: thr(7800, 10, 36, 1400, "Monthly", "8 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 80, deductible: 100, waiting_period_days: 21, max_units_covered: 15 }),
          mid: thr(11500, 12, 44, 2200, "Monthly", "4 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 100, deductible: 150, waiting_period_days: 14, max_units_covered: 35 }),
          high: thr(17500, 12, 64, 3500, "Monthly", "4 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 125, deductible: 300, waiting_period_days: 14, max_units_covered: 80 }),
        },
        silver: {
          low: thr(3300, 3, 12, 450, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 70, deductible: 200, waiting_period_days: 30, max_units_covered: 10 }),
          mid: thr(5100, 4, 16, 700, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 90, deductible: 250, waiting_period_days: 30, max_units_covered: 25 }),
          high: thr(7500, 4, 22, 1100, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Manager approval for extras over $500", { travel_radius_miles: 110, deductible: 400, waiting_period_days: 30, max_units_covered: 50 }),
        },
        bronze: {
          low: thr(1100, 2, 3, 0, "Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 55, deductible: 300, waiting_period_days: 45, max_units_covered: 5 }),
          mid: thr(1700, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 70, deductible: 400, waiting_period_days: 45, max_units_covered: 12 }),
          high: thr(2500, 2, 6, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Preventive Maintenance", "Manual renewal", "Customer approval required before non-PM dispatch", { travel_radius_miles: 85, deductible: 500, waiting_period_days: 45, max_units_covered: 20 }),
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
        gold: {
          low: thr(4800, 4, 16, 800, "Quarterly", "Next business day", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 35, deductible: 75, waiting_period_days: 30, max_units_covered: 8 }),
          mid: thr(7200, 4, 24, 1200, "Quarterly", "8 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 45, deductible: 100, waiting_period_days: 30, max_units_covered: 15 }),
          high: thr(10800, 6, 32, 1800, "Bi-Monthly", "4 business hours", "Annual Fixed Fee", "Full-Service Maintenance", "Auto-renew", "Manager approval for extras beyond allowance", { travel_radius_miles: 55, deductible: 150, waiting_period_days: 21, max_units_covered: 25 }),
        },
        silver: {
          low: thr(2400, 2, 8, 300, "Semi-Annual", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Customer approval for extras over $300", { travel_radius_miles: 30, deductible: 100, waiting_period_days: 45, max_units_covered: 5 }),
          mid: thr(3600, 2, 10, 500, "Semi-Annual", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Customer approval for extras over $300", { travel_radius_miles: 40, deductible: 125, waiting_period_days: 45, max_units_covered: 10 }),
          high: thr(5400, 3, 14, 750, "Quarterly", "Next business day", "Annual Fixed Fee", "Preventive Maintenance", "Manual renewal", "Customer approval for extras over $300", { travel_radius_miles: 50, deductible: 175, waiting_period_days: 30, max_units_covered: 18 }),
        },
        bronze: {
          low: thr(900, 1, 2, 0, "Annual", "Standard (best effort)", "Per-Service Charge", "Emergency Repair Plan", "No renewal", "Customer approval required before dispatch", { travel_radius_miles: 25, deductible: 150, waiting_period_days: 60, max_units_covered: 3 }),
          mid: thr(1400, 1, 3, 0, "Annual", "Standard (best effort)", "Per-Service Charge", "Emergency Repair Plan", "Manual renewal", "Customer approval required before dispatch", { travel_radius_miles: 30, deductible: 200, waiting_period_days: 60, max_units_covered: 6 }),
          high: thr(2100, 2, 4, 0, "Semi-Annual", "Standard (best effort)", "Per-Service Charge", "Emergency Repair Plan", "Manual renewal", "Customer approval required before dispatch", { travel_radius_miles: 40, deductible: 250, waiting_period_days: 45, max_units_covered: 10 }),
        },
      }),
    },
  ];

  return {
    version: 1,
    packs,
    updated_at: new Date().toISOString(),
  };
}

export const DEFAULT_CUSTOMER_PACK_ID = "warehouse";
export const CUSTOM_PACK_ID = "custom";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadCatalog(): ContractPlanCatalog {
  if (!canUseStorage()) return buildSeedCatalog();
  try {
    const raw = localStorage.getItem(CONTRACT_PLANS_STORAGE_KEY);
    if (!raw) {
      const seed = buildSeedCatalog();
      localStorage.setItem(CONTRACT_PLANS_STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as ContractPlanCatalog;
    if (!parsed?.packs?.length) {
      const seed = buildSeedCatalog();
      saveCatalog(seed);
      return seed;
    }
    return parsed;
  } catch {
    return buildSeedCatalog();
  }
}

export function saveCatalog(catalog: ContractPlanCatalog): void {
  if (!canUseStorage()) return;
  const next = { ...catalog, updated_at: new Date().toISOString(), version: 1 as const };
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
  return {
    packId: packName.toLowerCase().replace(/\s+/g, "_"),
    packName,
    tierId: tierId ?? "silver",
    tierName,
    bandId: bandLabel.toLowerCase(),
    bandLabel,
    assetValue: Number.isFinite(assetValue) ? assetValue : 0,
    extras: {},
  };
}

export function applyPlanToContractForm<T extends ManagerContractFormFields>(
  form: T,
  resolved: ResolvedPlan,
  options?: { updateName?: boolean; customerName?: string },
): T {
  const t = resolved.thresholds;
  const tag = formatPlanSnapshot({
    pack: resolved.pack,
    level: resolved.level,
    band: resolved.band,
    assetValue: resolved.assetValue,
  });
  const extrasLine =
    Object.keys(t.extras).length > 0
      ? `[Extras: ${Object.entries(t.extras)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join("; ")}]`
      : "";
  const notesWithExtras = mergePlanSnapshotIntoNotes(
    form.notes,
    extrasLine ? `${tag}\n${extrasLine}` : tag,
  );

  const name =
    options?.updateName && options.customerName
      ? `${options.customerName} · ${resolved.pack.name} · ${resolved.level.name}`
      : form.name;

  return {
    ...form,
    ...(name != null ? { name } : {}),
    contract_type: t.contract_type,
    billing_method: t.billing_method,
    contract_price: String(t.annual_price),
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
  const resolved = resolvePlan(packId || DEFAULT_CUSTOMER_PACK_ID, tierId, 100_000, catalog);
  if (!resolved) {
    throw new Error(`Unknown contract tier or pack: ${packId}/${tierId}`);
  }
  const t = resolved.thresholds;
  return {
    id: tierId,
    name: resolved.level.name,
    tagline: resolved.level.tagline,
    recommended: resolved.level.recommended,
    coverages: [
      ...resolved.level.coverages,
      `From ${formatMoneyPlain(t.annual_price)}/yr (${resolved.pack.name} Mid asset band; final price set by Ridley)`,
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
