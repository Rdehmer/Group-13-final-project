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

export type VendorMatrixSettings = {
  vendor_matrix_weight_cost: number;
  vendor_matrix_weight_speed: number;
  vendor_matrix_weight_rating: number;
  vendor_matrix_min_star_rating: number;
  vendor_matrix_max_avg_repair_cost: number | null;
  vendor_matrix_max_response_hours: number | null;
  vendor_matrix_hide_pruned: boolean;
};

export const DEFAULT_VENDOR_MATRIX_SETTINGS: VendorMatrixSettings = {
  vendor_matrix_weight_cost: 30,
  vendor_matrix_weight_speed: 30,
  vendor_matrix_weight_rating: 40,
  vendor_matrix_min_star_rating: 3,
  vendor_matrix_max_avg_repair_cost: 2500,
  vendor_matrix_max_response_hours: 48,
  vendor_matrix_hide_pruned: false,
};

export const VENDOR_SCORECARD_SPEC = {
  title: "Standard vendor scorecard",
  summary:
    "Each KPI becomes a 0–100 index (higher is better). Overall blends those indexes with your weights. Rank = sort by Overall. Preferred is a badge only.",
  productLabel: "Product vendors",
  serviceLabel: "Service vendors",
  metrics: [
    {
      key: "cost",
      label: "Cost",
      unit: "$",
      index:
        "Relative to peers on this list: lowest avg cost → 100, highest → 0. Product = order/bill cost; service = job cost.",
    },
    {
      key: "speed",
      label: "Speed",
      unit: "hours",
      index:
        "Relative to peers: fastest response/lead time → 100, slowest → 0. Product = lead hours; service = response hours.",
    },
    {
      key: "rating",
      label: "Stars",
      unit: "★ / 5",
      index: "Stars ÷ 5 × 100 (5★ = 100). Same scale for every vendor.",
    },
  ],
  /** Compact equation template; use formatOverallEquation() for live weights. */
  overallFormula: "Overall = (Cost × Wcost + Speed × Wspeed + Stars × Wstars) ÷ 100",
  overallFormulaNote:
    "Cost, Speed, and Stars are each 0–100 indexes. Weights are percents that add to 100. If a vendor is missing a KPI, that weight is dropped and the rest are re-scaled.",
  rankRule: "Rank 1 = highest Overall. Ties break A–Z by name.",
  preferredRule: "Preferred is a shortlist badge only — it does not change Overall or Rank.",
  pruneRule:
    "Prune = failed a threshold (min stars, max avg cost, or max response hours). Separate from Overall.",
} as const;

/** Live Overall equation with current admin weights, e.g. (Cost×30 + Speed×30 + Stars×40) ÷ 100 */
export function formatOverallEquation(
  settings: Pick<
    VendorMatrixSettings,
    | "vendor_matrix_weight_cost"
    | "vendor_matrix_weight_speed"
    | "vendor_matrix_weight_rating"
  >,
): string {
  const w = normalizeWeightsTo100({
    cost: settings.vendor_matrix_weight_cost,
    speed: settings.vendor_matrix_weight_speed,
    rating: settings.vendor_matrix_weight_rating,
  });
  return `Overall = (Cost × ${w.cost} + Speed × ${w.speed} + Stars × ${w.rating}) ÷ 100`;
}

/** Short weight legend for headers / tooltips. */
export function formatWeightLegend(
  settings: Pick<
    VendorMatrixSettings,
    | "vendor_matrix_weight_cost"
    | "vendor_matrix_weight_speed"
    | "vendor_matrix_weight_rating"
  >,
): string {
  const w = normalizeWeightsTo100({
    cost: settings.vendor_matrix_weight_cost,
    speed: settings.vendor_matrix_weight_speed,
    rating: settings.vendor_matrix_weight_rating,
  });
  return `Cost ${w.cost}% · Speed ${w.speed}% · Stars ${w.rating}%`;
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

function num(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export function normalizeMatrixSettings(
  raw: Partial<VendorMatrixSettings> | null | undefined,
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

  return {
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
}

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
  const costPeers = entities.map((d) => d.avgRepairCost).filter((n): n is number => n != null);
  const speedPeers = entities
    .map((d) => d.avgResponseHours)
    .filter((n): n is number => n != null);

  const weightCost = Math.max(0, settings.vendor_matrix_weight_cost);
  const weightSpeed = Math.max(0, settings.vendor_matrix_weight_speed);
  const weightRating = Math.max(0, settings.vendor_matrix_weight_rating);

  const scored: VendorMatrixRow[] = entities.map((d) => {
    const costScore =
      d.avgRepairCost == null ? null : lowerIsBetterIndex(d.avgRepairCost, costPeers);
    const speedScore =
      d.avgResponseHours == null ? null : lowerIsBetterIndex(d.avgResponseHours, speedPeers);
    const ratingScore = d.avgStarRating == null ? null : starRatingIndex(d.avgStarRating);
    const compositeScore = computeOverallScore({
      costIndex: costScore,
      speedIndex: speedScore,
      ratingIndex: ratingScore,
      weightCost,
      weightSpeed,
      weightRating,
    });

    const pruneReasons: string[] = [];
    if (
      d.avgStarRating != null &&
      d.avgStarRating < settings.vendor_matrix_min_star_rating
    ) {
      pruneReasons.push(
        `Stars ${d.avgStarRating.toFixed(1)} below min ${settings.vendor_matrix_min_star_rating}`,
      );
    }
    if (
      settings.vendor_matrix_max_avg_repair_cost != null &&
      d.avgRepairCost != null &&
      d.avgRepairCost > settings.vendor_matrix_max_avg_repair_cost
    ) {
      pruneReasons.push(
        `Avg cost $${d.avgRepairCost.toFixed(0)} above max $${settings.vendor_matrix_max_avg_repair_cost}`,
      );
    }
    if (
      settings.vendor_matrix_max_response_hours != null &&
      d.avgResponseHours != null &&
      d.avgResponseHours > settings.vendor_matrix_max_response_hours
    ) {
      pruneReasons.push(
        `Response ${d.avgResponseHours}h slower than max ${settings.vendor_matrix_max_response_hours}h`,
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
  if (settings.vendor_matrix_hide_pruned) {
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
