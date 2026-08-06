/**
 * Company-scoped contract plan catalogs (multi-tenant).
 * Loads/saves JSON catalogs from Supabase; seeds from buildSeedCatalog() when missing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSeedCatalog,
  normalizeCatalogFromUnknown,
  saveCatalogLocal,
  type ContractPlanCatalog,
} from "@/lib/contract-plans";

export const DEFAULT_COMPANY_ID = "00000000-0000-4000-8000-000000000001";

export async function getMyCompanyId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, customer_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.company_id) return profile.company_id as string;

  if (profile?.customer_id) {
    const { data: customer } = await supabase
      .from("customers")
      .select("company_id")
      .eq("id", profile.customer_id)
      .maybeSingle();
    if (customer?.company_id) return customer.company_id as string;
  }

  return DEFAULT_COMPANY_ID;
}

/**
 * Load company catalog from DB. If missing, clone seed defaults and persist.
 * Also mirrors into localStorage as a fast client cache.
 */
export async function loadCompanyCatalog(
  supabase: SupabaseClient,
  companyId?: string | null,
): Promise<{ catalog: ContractPlanCatalog; companyId: string; fromSeed: boolean }> {
  const resolvedId = companyId ?? (await getMyCompanyId(supabase)) ?? DEFAULT_COMPANY_ID;

  const { data, error } = await supabase
    .from("company_contract_plan_catalogs")
    .select("catalog, version")
    .eq("company_id", resolvedId)
    .maybeSingle();

  if (error) {
    // Table may not exist yet — fall back to seed + local cache.
    console.warn("[company-catalog] load failed, using seed:", error.message);
    const seed = buildSeedCatalog();
    saveCatalogLocal(seed);
    return { catalog: seed, companyId: resolvedId, fromSeed: true };
  }

  if (data?.catalog) {
    const catalog = normalizeCatalogFromUnknown(data.catalog);
    saveCatalogLocal(catalog);
    return { catalog, companyId: resolvedId, fromSeed: false };
  }

  const seed = buildSeedCatalog();
  const { data: ensured, error: ensureErr } = await supabase.rpc(
    "ensure_company_contract_catalog",
    {
      p_company_id: resolvedId,
      p_catalog: seed,
    },
  );

  if (ensureErr) {
    console.warn("[company-catalog] ensure rpc failed:", ensureErr.message);
    // Fallback: try direct upsert (admins/managers) then local seed.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: upsertErr } = await supabase.from("company_contract_plan_catalogs").upsert(
      {
        company_id: resolvedId,
        catalog: seed,
        version: seed.version,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      },
      { onConflict: "company_id" },
    );
    if (upsertErr) {
      console.warn("[company-catalog] seed upsert failed:", upsertErr.message);
    }
    saveCatalogLocal(seed);
    return { catalog: seed, companyId: resolvedId, fromSeed: true };
  }

  const catalog = normalizeCatalogFromUnknown(ensured ?? seed);
  saveCatalogLocal(catalog);
  return { catalog, companyId: resolvedId, fromSeed: true };
}

export async function saveCompanyCatalog(
  supabase: SupabaseClient,
  catalog: ContractPlanCatalog,
  companyId?: string | null,
): Promise<ContractPlanCatalog> {
  const resolvedId = companyId ?? (await getMyCompanyId(supabase)) ?? DEFAULT_COMPANY_ID;
  const next: ContractPlanCatalog = {
    ...catalog,
    updated_at: new Date().toISOString(),
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("company_contract_plan_catalogs").upsert(
    {
      company_id: resolvedId,
      catalog: next,
      version: next.version,
      updated_at: next.updated_at,
      updated_by: user?.id ?? null,
    },
    { onConflict: "company_id" },
  );

  if (error) {
    throw new Error(error.message || "Could not save company contract plans.");
  }

  saveCatalogLocal(next);
  return next;
}

export async function resetCompanyCatalogToSeed(
  supabase: SupabaseClient,
  companyId?: string | null,
): Promise<ContractPlanCatalog> {
  const seed = buildSeedCatalog();
  return saveCompanyCatalog(supabase, seed, companyId);
}

/**
 * Provision a new company with a clone of the seed catalog.
 */
export async function createCompanyWithDefaultCatalog(
  supabase: SupabaseClient,
  input: { name: string; slug?: string },
): Promise<{ companyId: string; catalog: ContractPlanCatalog }> {
  const slug =
    input.slug ??
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);

  const { data: company, error } = await supabase
    .from("companies")
    .insert({ name: input.name.trim(), slug: slug || null })
    .select("id")
    .single();

  if (error || !company) {
    throw new Error(error?.message || "Could not create company.");
  }

  const catalog = await saveCompanyCatalog(supabase, buildSeedCatalog(), company.id);
  return { companyId: company.id, catalog };
}
