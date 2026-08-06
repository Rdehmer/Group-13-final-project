/**
 * Industry-specific coverage cap profiles for contract tiers.
 * Heavy commercial (warehouse, farm, agriculture) scales higher than residential home warranty.
 */

export type ServiceTierId = "gold" | "silver" | "bronze";

export type IndustryCapProfile = "heavyCommercial" | "commercial" | "residential";

export type AssetBandId = "low" | "mid" | "high";

export type ResolvedCoverageCaps = {
  aggregate: number;
  perEquipment: number;
  partsMid: number;
  profile: IndustryCapProfile;
  profileMultiplier: number;
};

const BASE_TIER_CAPS: Record<
  ServiceTierId,
  { aggregate: number; perEquipment: number; partsMid: number }
> = {
  gold: { aggregate: 25_000, perEquipment: 5_000, partsMid: 2_500 },
  silver: { aggregate: 12_000, perEquipment: 2_500, partsMid: 800 },
  bronze: { aggregate: 4_000, perEquipment: 1_000, partsMid: 500 },
};

/** Map custom level ids onto seed cap tiers (gold/silver/bronze). */
export function coerceServiceTierId(tier: string | null | undefined): ServiceTierId {
  const id = (tier ?? "silver").toLowerCase();
  if (id === "gold" || id === "silver" || id === "bronze") return id;
  if (id.includes("gold") || id.includes("premier") || id.includes("premium") || id.includes("plus")) {
    return "gold";
  }
  if (id.includes("bronze") || id.includes("basic") || id.includes("essential") || id.includes("starter")) {
    return "bronze";
  }
  return "silver";
}

export const CAP_PROFILE_MULTIPLIER: Record<IndustryCapProfile, number> = {
  heavyCommercial: 1.75,
  commercial: 1.0,
  residential: 0.5,
};

export const CAP_PROFILE_LABEL: Record<IndustryCapProfile, string> = {
  heavyCommercial: "Heavy commercial",
  commercial: "Commercial",
  residential: "Residential",
};

/** Default profile when pack id is unknown. */
const DEFAULT_PROFILE: IndustryCapProfile = "commercial";

export const INDUSTRY_CAP_PROFILE: Record<string, IndustryCapProfile> = {
  warehouse: "heavyCommercial",
  shipping: "heavyCommercial",
  farm: "heavyCommercial",
  agriculture: "heavyCommercial",
  manufacturing: "heavyCommercial",
  standby_power: "heavyCommercial",
  foodservice: "commercial",
  retail_grocery: "commercial",
  healthcare: "commercial",
  fleet: "commercial",
  property_multisite: "commercial",
  custom_industry: "commercial",
  home_warranty: "residential",
};

export function getIndustryCapProfile(packId: string | null | undefined): IndustryCapProfile {
  if (!packId) return DEFAULT_PROFILE;
  return INDUSTRY_CAP_PROFILE[packId] ?? DEFAULT_PROFILE;
}

export function bandScaleForCaps(bandId: AssetBandId | string | undefined): number {
  const id = (bandId ?? "mid").toLowerCase();
  if (id === "low") return 0.7;
  if (id === "high") return 1.5;
  return 1;
}

export function resolveCoverageCaps(
  tier: ServiceTierId | string,
  bandId: AssetBandId | string,
  packId?: string | null,
): ResolvedCoverageCaps {
  const profile = getIndustryCapProfile(packId);
  const profileMultiplier = CAP_PROFILE_MULTIPLIER[profile];
  const bandScale = bandScaleForCaps(bandId);
  const base = BASE_TIER_CAPS[coerceServiceTierId(tier)];
  return {
    aggregate: Math.round(base.aggregate * profileMultiplier * bandScale),
    perEquipment: Math.round(base.perEquipment * profileMultiplier * bandScale),
    partsMid: Math.round(base.partsMid * profileMultiplier * bandScale),
    profile,
    profileMultiplier,
  };
}

export function formatCapSummaryLine(caps: Pick<ResolvedCoverageCaps, "perEquipment" | "aggregate">): string {
  const perEq = caps.perEquipment.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const agg = caps.aggregate.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return `Corrective coverage up to ${perEq} per equipment / ${agg} per year`;
}
