/**
 * Vendor preference matrix — standard weighted scorecard for:
 * - Product vendors (AP suppliers / materials)
 * - Service vendors (third-party technicians)
 *
 * Spec:
 * 1. Measure KPIs in business units ($, hours, ★).
 * 2. Convert each to a 0–100 index (higher = better).
 * 3. Overall = weighted average of available indexes (admin weights).
 * 4. Rank = sort by Overall descending (preferred is a badge only).
 * 5. Prune = fail any admin threshold (independent of Overall).
 *
 * Admins fully customize labels, weights, enable/disable metrics, prune rules,
 * and scorecard copy via vendor_matrix_config (synced to flat columns on save).
 */

import type {
  ServiceVendor,
  ServiceVendorBill,
  ServiceVendorRating,
  Vendor,
  VendorBill,
} from "@/lib/types";
import { avgRating } from "@/lib/serviceVendors";

export type VendorMatrixFamily = "product" | "service";
export type VendorMatrixCategory = "technician" | "materials" | "both" | "all";
export type VendorMatrixMetricKey = "cost" | "speed" | "rating";

export type VendorMatrixMetricConfig = {
  enabled: boolean;
  weight: number;
  label: string;
  /** When true, lower raw values score higher (typical for cost/speed). */
  lowerIsBetter: boolean;
  helpText: string;
};

export type VendorMatrixConfig = {
  title: string;
  summary: string;
  productTabLabel: string;
  serviceTabLabel: string;
  normalizeWeights: boolean;
  /** Ratings with fewer reviews than this are ignored for scoring (0 = no minimum). */
  minRatingCount: number;
  showPreferredBadge: boolean;
  showEquation: boolean;
  showHowItWorks: boolean;
  metrics: {
    cost: VendorMatrixMetricConfig;
    speed: VendorMatrixMetricConfig;
    rating: VendorMatrixMetricConfig;
  };
  prune: {
    hidePruned: boolean;
    minStars: { enabled: boolean; value: number };
    maxCost: { enabled: boolean; value: number | null };
    maxHours: { enabled: boolean; value: number | null };
  };
};

export type VendorMatrixSettings = {
  vendor_matrix_weight_cost: number;
  vendor_matrix_weight_speed: number;
  vendor_matrix_weight_rating: number;
  vendor_matrix_min_star_rating: number;
  vendor_matrix_max_avg_repair_cost: number | null;
  vendor_matrix_max_response_hours: number | null;
  vendor_matrix_hide_pruned: boolean;
  vendor_matrix_config: VendorMatrixConfig;
};

export const DEFAULT_VENDOR_MATRIX_CONFIG: VendorMatrixConfig = {
  title: "Standard vendor scorecard",
  summary:
    "Each KPI becomes a 0–100 index (higher is better). Overall blends those indexes with your weights. Rank = sort by Overall. Preferred is a badge only.",
  productTabLabel: "Product suppliers",
  serviceTabLabel: "Service vendors",
  normalizeWeights: true,
  minRatingCount: 0,
  showPreferredBadge: true,
  showEquation: true,
  showHowItWorks: true,
  metrics: {
    cost: {
      enabled: true,
      weight: 30,
      label: "Cost",
      lowerIsBetter: true,
      helpText:
        "Relative to peers: lowest avg cost → 100, highest → 0. Product = order/bill cost; service = job cost.",
    },
    speed: {
      enabled: true,
      weight: 30,
      label: "Speed",
      lowerIsBetter: true,
      helpText:
        "Relative to peers: fastest response/lead time → 100, slowest → 0. Product = lead hours; service = response hours.",
    },
    rating: {
      enabled: true,
      weight: 40,
      label: "Stars",
      lowerIsBetter: false,
      helpText: "Stars ÷ 5 × 100 (5★ = 100). Same scale for every vendor.",
    },
  },
  prune: {
    hidePruned: false,
    minStars: { enabled: true, value: 3 },
    maxCost: { enabled: true, value: 2500 },
    maxHours: { enabled: true, value: 48 },
  },
};

export const DEFAULT_VENDOR_MATRIX_SETTINGS: VendorMatrixSettings = {
  vendor_matrix_weight_cost: 30,
  vendor_matrix_weight_speed: 30,
  vendor_matrix_weight_rating: 40,
  vendor_matrix_min_star_rating: 3,
  vendor_matrix_max_avg_repair_cost: 2500,
  vendor_matrix_max_response_hours: 48,
  vendor_matrix_hide_pruned: false,
  vendor_matrix_config: DEFAULT_VENDOR_MATRIX_CONFIG,
};

/** @deprecated Prefer resolveScorecardCopy(settings) — kept for call sites that only need static defaults. */
export const VENDOR_SCORECARD_SPEC = {
  title: DEFAULT_VENDOR_MATRIX_CONFIG.title,
  summary: DEFAULT_VENDOR_MATRIX_CONFIG.summary,
  productLabel: "Product vendors",
  serviceLabel: "Service vendors",
  metrics: [
    {
      key: "cost" as const,
      label: DEFAULT_VENDOR_MATRIX_CONFIG.metrics.cost.label,
      unit: "$",
      index: DEFAULT_VENDOR_MATRIX_CONFIG.metrics.cost.helpText,
    },
    {
      key: "speed" as const,
      label: DEFAULT_VENDOR_MATRIX_CONFIG.metrics.speed.label,
      unit: "hours",
      index: DEFAULT_VENDOR_MATRIX_CONFIG.metrics.speed.helpText,
    },
    {
      key: "rating" as const,
      label: DEFAULT_VENDOR_MATRIX_CONFIG.metrics.rating.label,
      unit: "★ / 5",
      index: DEFAULT_VENDOR_MATRIX_CONFIG.metrics.rating.helpText,
    },
  ],
  overallFormula: "Overall = (Cost × Wcost + Speed × Wspeed + Stars × Wstars) ÷ 100",
  overallFormulaNote:
    "Cost, Speed, and Stars are each 0–100 indexes. Weights are percents that add to 100. If a vendor is missing a KPI, that weight is dropped and the rest are re-scaled.",
  rankRule: "Rank 1 = highest Overall. Ties break A–Z by name.",
  preferredRule: "Preferred is a shortlist badge only — it does not change Overall or Rank.",
  pruneRule:
    "Prune = failed a threshold (min stars, max avg cost, or max response hours). Separate from Overall.",
} as const;

function num(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v == null) return fallback;
  return Boolean(v);
}

function isEmptyConfig(raw: unknown): boolean {
  return raw == null || typeof raw !== "object" || Object.keys(raw as object).length === 0;
}

function mergeMetric(
  defaults: VendorMatrixMetricConfig,
  raw: Partial<VendorMatrixMetricConfig> | null | undefined,
): VendorMatrixMetricConfig {
  return {
    enabled: bool(raw?.enabled, defaults.enabled),
    weight: Math.max(0, num(raw?.weight, defaults.weight)),
    label: (raw?.label?.trim() || defaults.label).slice(0, 40),
    lowerIsBetter: bool(raw?.lowerIsBetter, defaults.lowerIsBetter),
    helpText: (raw?.helpText?.trim() || defaults.helpText).slice(0, 400),
  };
}

export function normalizeVendorMatrixConfig(
  raw: Partial<VendorMatrixConfig> | null | undefined,
): VendorMatrixConfig {
  const d = DEFAULT_VENDOR_MATRIX_CONFIG;
  const metricsIn = raw?.metrics;
  const pruneIn = raw?.prune;
  return {
    title: (raw?.title?.trim() || d.title).slice(0, 120),
    summary: (raw?.summary?.trim() || d.summary).slice(0, 600),
    productTabLabel: (raw?.productTabLabel?.trim() || d.productTabLabel).slice(0, 40),
    serviceTabLabel: (raw?.serviceTabLabel?.trim() || d.serviceTabLabel).slice(0, 40),
    normalizeWeights: bool(raw?.normalizeWeights, d.normalizeWeights),
    minRatingCount: Math.max(0, Math.min(50, Math.round(num(raw?.minRatingCount, d.minRatingCount)))),
    showPreferredBadge: bool(raw?.showPreferredBadge, d.showPreferredBadge),
    showEquation: bool(raw?.showEquation, d.showEquation),
    showHowItWorks: bool(raw?.showHowItWorks, d.showHowItWorks),
    metrics: {
      cost: mergeMetric(d.metrics.cost, metricsIn?.cost),
      speed: mergeMetric(d.metrics.speed, metricsIn?.speed),
      rating: mergeMetric(d.metrics.rating, metricsIn?.rating),
    },
    prune: {
      hidePruned: bool(pruneIn?.hidePruned, d.prune.hidePruned),
      minStars: {
        enabled: bool(pruneIn?.minStars?.enabled, d.prune.minStars.enabled),
        value: Math.min(5, Math.max(0, num(pruneIn?.minStars?.value, d.prune.minStars.value))),
      },
      maxCost: {
        enabled: bool(pruneIn?.maxCost?.enabled, d.prune.maxCost.enabled),
        value:
          pruneIn?.maxCost && "value" in pruneIn.maxCost
            ? pruneIn.maxCost.value == null
              ? null
              : Math.max(0, num(pruneIn.maxCost.value))
            : d.prune.maxCost.value,
      },
      maxHours: {
        enabled: bool(pruneIn?.maxHours?.enabled, d.prune.maxHours.enabled),
        value:
          pruneIn?.maxHours && "value" in pruneIn.maxHours
            ? pruneIn.maxHours.value == null
              ? null
              : Math.max(0, num(pruneIn.maxHours.value))
            : d.prune.maxHours.value,
      },
    },
  };
}

/** Seed config from legacy flat columns when JSON config is empty. */
function configFromFlatColumns(
  flat: Omit<VendorMatrixSettings, "vendor_matrix_config">,
): VendorMatrixConfig {
  const base = structuredClone(DEFAULT_VENDOR_MATRIX_CONFIG);
  base.metrics.cost.weight = flat.vendor_matrix_weight_cost;
  base.metrics.speed.weight = flat.vendor_matrix_weight_speed;
  base.metrics.rating.weight = flat.vendor_matrix_weight_rating;
  base.prune.hidePruned = flat.vendor_matrix_hide_pruned;
  base.prune.minStars = {
    enabled: true,
    value: flat.vendor_matrix_min_star_rating,
  };
  base.prune.maxCost = {
    enabled: flat.vendor_matrix_max_avg_repair_cost != null,
    value: flat.vendor_matrix_max_avg_repair_cost,
  };
  base.prune.maxHours = {
    enabled: flat.vendor_matrix_max_response_hours != null,
    value: flat.vendor_matrix_max_response_hours,
  };
  return base;
}

/** Derive flat columns from config (kept in sync for older readers / migrations). */
export function flatColumnsFromConfig(config: VendorMatrixConfig): Omit<
  VendorMatrixSettings,
  "vendor_matrix_config"
> {
  const weights = resolveActiveWeights(config);
  return {
    vendor_matrix_weight_cost: weights.cost,
    vendor_matrix_weight_speed: weights.speed,
    vendor_matrix_weight_rating: weights.rating,
    vendor_matrix_min_star_rating: config.prune.minStars.value,
    vendor_matrix_max_avg_repair_cost: config.prune.maxCost.enabled
      ? config.prune.maxCost.value
      : null,
    vendor_matrix_max_response_hours: config.prune.maxHours.enabled
      ? config.prune.maxHours.value
      : null,
    vendor_matrix_hide_pruned: config.prune.hidePruned,
  };
}

export function resolveActiveWeights(config: VendorMatrixConfig): {
  cost: number;
  speed: number;
  rating: number;
} {
  const raw = {
    cost: config.metrics.cost.enabled ? Math.max(0, config.metrics.cost.weight) : 0,
    speed: config.metrics.speed.enabled ? Math.max(0, config.metrics.speed.weight) : 0,
    rating: config.metrics.rating.enabled ? Math.max(0, config.metrics.rating.weight) : 0,
  };
  if (!config.normalizeWeights) return raw;
  const sum = raw.cost + raw.speed + raw.rating;
  if (sum <= 0) return raw;
  return {
    cost: Math.round((raw.cost / sum) * 1000) / 10,
    speed: Math.round((raw.speed / sum) * 1000) / 10,
    rating: Math.round((raw.rating / sum) * 1000) / 10,
  };
}

export function normalizeMatrixSettings(
  raw:
    | (Partial<Omit<VendorMatrixSettings, "vendor_matrix_config">> & {
        vendor_matrix_config?: Partial<VendorMatrixConfig> | Record<string, unknown> | null;
      })
    | null
    | undefined,
): VendorMatrixSettings {
  const maxCost =
    raw && "vendor_matrix_max_avg_repair_cost" in raw
      ? raw.vendor_matrix_max_avg_repair_cost == null
        ? null
        : num(raw.vendor_matrix_max_avg_repair_cost)
      : DEFAULT_VENDOR_MATRIX_SETTINGS.vendor_matrix_max_avg_repair_cost;
  const maxHours =
    raw && "vendor_matrix_max_response_hours" in raw
      ? raw.vendor_matrix_max_response_hours == null
        ? null
        : num(raw.vendor_matrix_max_response_hours)
      : DEFAULT_VENDOR_MATRIX_SETTINGS.vendor_matrix_max_response_hours;

  const flat = {
    vendor_matrix_weight_cost: num(
      raw?.vendor_matrix_weight_cost,
      DEFAULT_VENDOR_MATRIX_SETTINGS.vendor_matrix_weight_cost,
    ),
    vendor_matrix_weight_speed: num(
      raw?.vendor_matrix_weight_speed,
      DEFAULT_VENDOR_MATRIX_SETTINGS.vendor_matrix_weight_speed,
    ),
    vendor_matrix_weight_rating: num(
      raw?.vendor_matrix_weight_rating,
      DEFAULT_VENDOR_MATRIX_SETTINGS.vendor_matrix_weight_rating,
    ),
    vendor_matrix_min_star_rating: num(
      raw?.vendor_matrix_min_star_rating,
      DEFAULT_VENDOR_MATRIX_SETTINGS.vendor_matrix_min_star_rating,
    ),
    vendor_matrix_max_avg_repair_cost: maxCost,
    vendor_matrix_max_response_hours: maxHours,
    vendor_matrix_hide_pruned: Boolean(
      raw?.vendor_matrix_hide_pruned ?? DEFAULT_VENDOR_MATRIX_SETTINGS.vendor_matrix_hide_pruned,
    ),
  };

  const config = isEmptyConfig(raw?.vendor_matrix_config)
    ? configFromFlatColumns(flat)
    : normalizeVendorMatrixConfig(raw?.vendor_matrix_config as Partial<VendorMatrixConfig>);

  const synced = flatColumnsFromConfig(config);
  return { ...synced, vendor_matrix_config: config };
}

/** Payload to persist admin form → company_settings. */
export function buildVendorMatrixSavePayload(settings: VendorMatrixSettings): {
  vendor_matrix_weight_cost: number;
  vendor_matrix_weight_speed: number;
  vendor_matrix_weight_rating: number;
  vendor_matrix_min_star_rating: number;
  vendor_matrix_max_avg_repair_cost: number | null;
  vendor_matrix_max_response_hours: number | null;
  vendor_matrix_hide_pruned: boolean;
  vendor_matrix_config: VendorMatrixConfig;
  updated_at: string;
} {
  const config = normalizeVendorMatrixConfig(settings.vendor_matrix_config);
  const flat = flatColumnsFromConfig(config);
  return {
    ...flat,
    vendor_matrix_config: config,
    updated_at: new Date().toISOString(),
  };
}

export function resolveScorecardCopy(settings: VendorMatrixSettings) {
  const c = settings.vendor_matrix_config;
  return {
    title: c.title,
    summary: c.summary,
    productLabel: c.productTabLabel,
    serviceLabel: c.serviceTabLabel,
    rankRule: VENDOR_SCORECARD_SPEC.rankRule,
    preferredRule: VENDOR_SCORECARD_SPEC.preferredRule,
    pruneRule: VENDOR_SCORECARD_SPEC.pruneRule,
    overallFormulaNote: VENDOR_SCORECARD_SPEC.overallFormulaNote,
  };
}

/** Live Overall equation with current admin weights and custom labels. */
export function formatOverallEquation(settings: VendorMatrixSettings): string {
  const c = normalizeMatrixSettings(settings).vendor_matrix_config;
  const w = resolveActiveWeights(c);
  const parts: string[] = [];
  if (c.metrics.cost.enabled && w.cost > 0) {
    parts.push(`${c.metrics.cost.label} × ${w.cost}`);
  }
  if (c.metrics.speed.enabled && w.speed > 0) {
    parts.push(`${c.metrics.speed.label} × ${w.speed}`);
  }
  if (c.metrics.rating.enabled && w.rating > 0) {
    parts.push(`${c.metrics.rating.label} × ${w.rating}`);
  }
  if (!parts.length) return "Overall = — (no metrics enabled)";
  return `Overall = (${parts.join(" + ")}) ÷ 100`;
}

/** Short weight legend for headers / tooltips. */
export function formatWeightLegend(settings: VendorMatrixSettings): string {
  const c = normalizeMatrixSettings(settings).vendor_matrix_config;
  const w = resolveActiveWeights(c);
  const parts: string[] = [];
  if (c.metrics.cost.enabled) parts.push(`${c.metrics.cost.label} ${w.cost}%`);
  if (c.metrics.speed.enabled) parts.push(`${c.metrics.speed.label} ${w.speed}%`);
  if (c.metrics.rating.enabled) parts.push(`${c.metrics.rating.label} ${w.rating}%`);
  return parts.length ? parts.join(" · ") : "No metrics enabled";
}

export type VendorRatingLike = {
  vendor_id?: string;
  service_vendor_id?: string;
  rating: number;
};

export type VendorMatrixRow = {
  family: VendorMatrixFamily;
  id: string;
  name: string;
  subtitle: string;
  detailHref: string;
  typeLabel: string;
  isPreferred: boolean;
  avgStarRating: number | null;
  ratingCount: number;
  avgRepairCost: number | null;
  avgResponseHours: number | null;
  costScore: number | null;
  speedScore: number | null;
  ratingScore: number | null;
  compositeScore: number | null;
  pruneReasons: string[];
  shouldPrune: boolean;
  rank: number;
};

/** Internal normalized entity before scoring. */
type MatrixEntity = {
  family: VendorMatrixFamily;
  id: string;
  name: string;
  subtitle: string;
  detailHref: string;
  typeLabel: string;
  isPreferred: boolean;
  isActive: boolean;
  approvalStatus: string;
  avgStarRating: number | null;
  ratingCount: number;
  avgRepairCost: number | null;
  avgResponseHours: number | null;
};

function avgBillAmount(
  amounts: number[],
  fallback: number | null | undefined,
): number | null {
  if (amounts.length) {
    const sum = amounts.reduce((s, n) => s + n, 0);
    return Math.round((sum / amounts.length) * 100) / 100;
  }
  if (fallback == null || !Number.isFinite(Number(fallback))) return null;
  return Math.round(Number(fallback) * 100) / 100;
}

export function lowerIsBetterIndex(value: number, peers: number[]): number {
  if (!peers.length) return 50;
  const min = Math.min(...peers);
  const max = Math.max(...peers);
  if (max === min) return 100;
  return Math.round((1 - (value - min) / (max - min)) * 100);
}

export function higherIsBetterIndex(value: number, peers: number[]): number {
  if (!peers.length) return 50;
  const min = Math.min(...peers);
  const max = Math.max(...peers);
  if (max === min) return 100;
  return Math.round(((value - min) / (max - min)) * 100);
}

export function peerIndex(
  value: number,
  peers: number[],
  lowerIsBetter: boolean,
): number {
  return lowerIsBetter ? lowerIsBetterIndex(value, peers) : higherIsBetterIndex(value, peers);
}

export function starRatingIndex(avgStars: number): number {
  const clamped = Math.min(5, Math.max(0, avgStars));
  return Math.round((clamped / 5) * 100);
}

export function computeOverallScore(input: {
  costIndex: number | null;
  speedIndex: number | null;
  ratingIndex: number | null;
  weightCost: number;
  weightSpeed: number;
  weightRating: number;
}): number | null {
  const parts: { score: number; weight: number }[] = [];
  if (input.costIndex != null && input.weightCost > 0) {
    parts.push({ score: input.costIndex, weight: input.weightCost });
  }
  if (input.speedIndex != null && input.weightSpeed > 0) {
    parts.push({ score: input.speedIndex, weight: input.weightSpeed });
  }
  if (input.ratingIndex != null && input.weightRating > 0) {
    parts.push({ score: input.ratingIndex, weight: input.weightRating });
  }
  if (!parts.length) return null;
  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  const weighted = parts.reduce((s, p) => s + p.score * p.weight, 0);
  return Math.round(weighted / weightSum);
}

function scoreEntities(
  entities: MatrixEntity[],
  settings: VendorMatrixSettings,
): VendorMatrixRow[] {
  const config = settings.vendor_matrix_config;
  const weights = resolveActiveWeights(config);
  const costPeers = entities.map((d) => d.avgRepairCost).filter((n): n is number => n != null);
  const speedPeers = entities
    .map((d) => d.avgResponseHours)
    .filter((n): n is number => n != null);

  const scored: VendorMatrixRow[] = entities.map((d) => {
    const ratingEligible =
      d.avgStarRating != null && d.ratingCount >= config.minRatingCount;

    const costScore =
      !config.metrics.cost.enabled || d.avgRepairCost == null
        ? null
        : peerIndex(d.avgRepairCost, costPeers, config.metrics.cost.lowerIsBetter);
    const speedScore =
      !config.metrics.speed.enabled || d.avgResponseHours == null
        ? null
        : peerIndex(d.avgResponseHours, speedPeers, config.metrics.speed.lowerIsBetter);
    const ratingScore =
      !config.metrics.rating.enabled || !ratingEligible || d.avgStarRating == null
        ? null
        : starRatingIndex(d.avgStarRating);

    const compositeScore = computeOverallScore({
      costIndex: costScore,
      speedIndex: speedScore,
      ratingIndex: ratingScore,
      weightCost: weights.cost,
      weightSpeed: weights.speed,
      weightRating: weights.rating,
    });

    const pruneReasons: string[] = [];
    const starLabel = config.metrics.rating.label;
    const costLabel = config.metrics.cost.label;
    const speedLabel = config.metrics.speed.label;

    if (
      config.prune.minStars.enabled &&
      d.avgStarRating != null &&
      d.avgStarRating < config.prune.minStars.value
    ) {
      pruneReasons.push(
        `${starLabel} ${d.avgStarRating.toFixed(1)} below min ${config.prune.minStars.value}`,
      );
    }
    if (
      config.prune.maxCost.enabled &&
      config.prune.maxCost.value != null &&
      d.avgRepairCost != null &&
      d.avgRepairCost > config.prune.maxCost.value
    ) {
      pruneReasons.push(
        `Avg ${costLabel.toLowerCase()} $${d.avgRepairCost.toFixed(0)} above max $${config.prune.maxCost.value}`,
      );
    }
    if (
      config.prune.maxHours.enabled &&
      config.prune.maxHours.value != null &&
      d.avgResponseHours != null &&
      d.avgResponseHours > config.prune.maxHours.value
    ) {
      pruneReasons.push(
        `${speedLabel} ${d.avgResponseHours}h slower than max ${config.prune.maxHours.value}h`,
      );
    }

    return {
      family: d.family,
      id: d.id,
      name: d.name,
      subtitle: d.subtitle,
      detailHref: d.detailHref,
      typeLabel: d.typeLabel,
      isPreferred: d.isPreferred,
      avgStarRating: d.avgStarRating,
      ratingCount: d.ratingCount,
      avgRepairCost: d.avgRepairCost,
      avgResponseHours: d.avgResponseHours,
      costScore,
      speedScore,
      ratingScore,
      compositeScore,
      pruneReasons,
      shouldPrune: pruneReasons.length > 0,
      rank: 0,
    };
  });

  scored.sort((a, b) => {
    const as = a.compositeScore ?? -1;
    const bs = b.compositeScore ?? -1;
    if (bs !== as) return bs - as;
    return a.name.localeCompare(b.name);
  });

  let filtered = scored;
  if (config.prune.hidePruned) {
    filtered = scored.filter((r) => !r.shouldPrune);
  }

  return filtered.map((row, i) => ({ ...row, rank: i + 1 }));
}

/** Product / AP suppliers matrix. */
export function buildProductVendorMatrix(input: {
  vendors: Vendor[];
  ratings: { vendor_id: string; rating: number }[];
  bills: VendorBill[];
  settings: VendorMatrixSettings;
}): VendorMatrixRow[] {
  const settings = normalizeMatrixSettings(input.settings);
  const entities: MatrixEntity[] = input.vendors
    .filter((v) => v.is_active && (v.approval_status ?? "Approved") === "Approved")
    .map((vendor) => {
      const mineRatings = input.ratings.filter((r) => r.vendor_id === vendor.id);
      const amounts = input.bills
        .filter((b) => b.vendor_id === vendor.id && Number(b.amount) > 0)
        .map((b) => Number(b.amount));
      const avgRepairCost = avgBillAmount(amounts, vendor.avg_order_cost);
      const avgResponseHours =
        vendor.avg_response_hours == null || !Number.isFinite(Number(vendor.avg_response_hours))
          ? null
          : Math.round(Number(vendor.avg_response_hours) * 100) / 100;
      return {
        family: "product" as const,
        id: vendor.id,
        name: vendor.name,
        subtitle: vendor.specialty ?? vendor.payment_terms ?? "Supplier",
        detailHref: `/vendors/${vendor.id}`,
        typeLabel: "Product",
        isPreferred: Boolean(vendor.is_preferred),
        isActive: vendor.is_active,
        approvalStatus: vendor.approval_status ?? "Approved",
        avgStarRating: avgRating(mineRatings),
        ratingCount: mineRatings.length,
        avgRepairCost,
        avgResponseHours,
      };
    });
  return scoreEntities(entities, settings);
}

/** Service / third-party technician matrix. */
export function buildServiceVendorMatrix(input: {
  vendors: ServiceVendor[];
  ratings: ServiceVendorRating[];
  bills: ServiceVendorBill[];
  settings: VendorMatrixSettings;
  category?: VendorMatrixCategory;
}): VendorMatrixRow[] {
  const settings = normalizeMatrixSettings(input.settings);
  const category = input.category ?? "all";

  const entities: MatrixEntity[] = input.vendors
    .filter((v) => {
      if ((v.approval_status ?? "Approved") !== "Approved") return false;
      if (!v.is_active) return false;
      const cat = (v.vendor_category ?? "technician") as "technician" | "materials" | "both";
      if (category === "all") return true;
      if (category === "technician") return cat === "technician" || cat === "both";
      if (category === "materials") return cat === "materials" || cat === "both";
      return cat === category;
    })
    .map((vendor) => {
      const mineRatings = input.ratings.filter((r) => r.service_vendor_id === vendor.id);
      const amounts = input.bills
        .filter((b) => b.service_vendor_id === vendor.id && Number(b.amount) > 0)
        .map((b) => Number(b.amount));
      const avgRepairCost = avgBillAmount(amounts, vendor.avg_repair_cost);
      const avgResponseHours =
        vendor.avg_response_hours == null || !Number.isFinite(Number(vendor.avg_response_hours))
          ? null
          : Math.round(Number(vendor.avg_response_hours) * 100) / 100;
      const cat = vendor.vendor_category ?? "technician";
      return {
        family: "service" as const,
        id: vendor.id,
        name: vendor.name,
        subtitle: vendor.primary_trade,
        detailHref: `/service-vendors/${vendor.id}`,
        typeLabel: cat === "materials" ? "Materials" : cat === "both" ? "Both" : "Service",
        isPreferred: Boolean(vendor.is_preferred),
        isActive: vendor.is_active,
        approvalStatus: vendor.approval_status ?? "Approved",
        avgStarRating: avgRating(mineRatings),
        ratingCount: mineRatings.length,
        avgRepairCost,
        avgResponseHours,
      };
    });
  return scoreEntities(entities, settings);
}

/** @deprecated Use buildServiceVendorMatrix */
export function buildVendorMatrix(input: {
  vendors: ServiceVendor[];
  ratings: ServiceVendorRating[];
  bills: ServiceVendorBill[];
  settings: VendorMatrixSettings;
  category?: VendorMatrixCategory;
}): VendorMatrixRow[] {
  return buildServiceVendorMatrix(input);
}

export function formatHours(h: number | null): string {
  if (h == null) return "—";
  return `${h}h`;
}

export function formatMoneyShort(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatStars(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} ★`;
}

export function normalizeWeightsTo100(weights: {
  cost: number;
  speed: number;
  rating: number;
}): { cost: number; speed: number; rating: number } {
  const cost = Math.max(0, num(weights.cost));
  const speed = Math.max(0, num(weights.speed));
  const rating = Math.max(0, num(weights.rating));
  const sum = cost + speed + rating;
  if (sum <= 0) return { cost: 30, speed: 30, rating: 40 };
  return {
    cost: Math.round((cost / sum) * 1000) / 10,
    speed: Math.round((speed / sum) * 1000) / 10,
    rating: Math.round((rating / sum) * 1000) / 10,
  };
}
