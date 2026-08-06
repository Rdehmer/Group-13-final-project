/**
 * Optional demo seed for deferred revenue — call from Period Close when contracts have $0 prices.
 * Updates Annual Fixed Fee / Active contracts in-browser cache only is NOT enough; this hits Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function seedPrepaidContractPrices(
  supabase: SupabaseClient,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("service_contracts")
    .select("id, billing_method, contract_price, status")
    .or("billing_method.ilike.%Annual%,billing_method.ilike.%Fixed Fee%,billing_method.ilike.%Prepaid%");

  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []).filter((c) => Number(c.contract_price) <= 0.005);
  let updated = 0;
  for (const row of rows) {
    const { error: uErr } = await supabase
      .from("service_contracts")
      .update({
        billing_method: "Annual Fixed Fee",
        contract_price: 14400,
        status: row.status === "Pending Approval" ? "Active" : row.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (!uErr) updated += 1;
  }

  // Also promote one Active monthly to annual if still nothing
  if (updated === 0) {
    const { data: active } = await supabase
      .from("service_contracts")
      .select("id")
      .eq("status", "Active")
      .limit(1);
    if (active?.[0]) {
      const { error: uErr } = await supabase
        .from("service_contracts")
        .update({
          billing_method: "Annual Fixed Fee",
          contract_price: 14400,
          updated_at: new Date().toISOString(),
        })
        .eq("id", active[0].id);
      if (!uErr) updated = 1;
    }
  }

  return { ok: true, updated };
}
