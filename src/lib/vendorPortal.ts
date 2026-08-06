/**
 * Vendor portal helpers — work needed + supply orders assigned to AP vendors.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Profile,
  UserRole,
  Vendor,
  VendorSpecialty,
  VendorSupplyOrder,
  VendorSupplyOrderStatus,
  VendorWorkItem,
  VendorWorkItemStatus,
} from "@/lib/types";

export const VENDOR_SPECIALTIES: VendorSpecialty[] = [
  "HVAC",
  "Plumbing",
  "Electrical",
  "Parts",
  "Other",
];

export const VENDOR_WORK_STATUSES: VendorWorkItemStatus[] = [
  "Pending",
  "Accepted",
  "Rejected",
];

export const VENDOR_ORDER_STATUSES: VendorSupplyOrderStatus[] = [
  "Pending",
  "Accepted",
  "Rejected",
];

export function isVendorPortalManager(role: UserRole): boolean {
  return role === "administrator" || role === "service_manager";
}

export function isVendorPortalUser(profile: Pick<Profile, "role" | "vendor_id">): boolean {
  return profile.role === "vendor" && Boolean(profile.vendor_id);
}

export async function listWorkItemsForVendor(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<{ data: VendorWorkItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("vendor_work_items")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data as VendorWorkItem[]) ?? [], error: null };
}

export async function listSupplyOrdersForVendor(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<{ data: VendorSupplyOrder[]; error: string | null }> {
  const { data, error } = await supabase
    .from("vendor_supply_orders")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data as VendorSupplyOrder[]) ?? [], error: null };
}

export async function upsertWorkItem(
  supabase: SupabaseClient,
  input: {
    id?: string | null;
    vendor_id: string;
    title: string;
    description?: string | null;
    status: VendorWorkItemStatus;
    due_date?: string | null;
    created_by?: string | null;
  },
): Promise<{ data: VendorWorkItem | null; error: string | null }> {
  const now = new Date().toISOString();
  if (input.id) {
    const { data, error } = await supabase
      .from("vendor_work_items")
      .update({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        status: input.status,
        due_date: input.due_date || null,
        updated_at: now,
      })
      .eq("id", input.id)
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    return { data: data as VendorWorkItem, error: null };
  }
  const { data, error } = await supabase
    .from("vendor_work_items")
    .insert({
      vendor_id: input.vendor_id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: input.status,
      due_date: input.due_date || null,
      created_by: input.created_by ?? null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as VendorWorkItem, error: null };
}

export async function deleteWorkItem(
  supabase: SupabaseClient,
  id: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("vendor_work_items").delete().eq("id", id);
  return { error: error?.message ?? null };
}

export async function upsertSupplyOrder(
  supabase: SupabaseClient,
  input: {
    id?: string | null;
    vendor_id: string;
    item_name: string;
    quantity: number;
    status: VendorSupplyOrderStatus;
    notes?: string | null;
    created_by?: string | null;
  },
): Promise<{ data: VendorSupplyOrder | null; error: string | null }> {
  const now = new Date().toISOString();
  const qty = Math.max(0.01, Number(input.quantity) || 1);
  if (input.id) {
    const { data, error } = await supabase
      .from("vendor_supply_orders")
      .update({
        item_name: input.item_name.trim(),
        quantity: qty,
        status: input.status,
        notes: input.notes?.trim() || null,
        updated_at: now,
      })
      .eq("id", input.id)
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    return { data: data as VendorSupplyOrder, error: null };
  }
  const { data, error } = await supabase
    .from("vendor_supply_orders")
    .insert({
      vendor_id: input.vendor_id,
      item_name: input.item_name.trim(),
      quantity: qty,
      status: input.status,
      notes: input.notes?.trim() || null,
      created_by: input.created_by ?? null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as VendorSupplyOrder, error: null };
}

export async function deleteSupplyOrder(
  supabase: SupabaseClient,
  id: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("vendor_supply_orders").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/** Vendor may only change status (core fields stay as loaded). */
export async function updateWorkItemStatus(
  supabase: SupabaseClient,
  id: string,
  status: VendorWorkItemStatus,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("vendor_work_items")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error: error?.message ?? null };
}

export async function updateSupplyOrderStatus(
  supabase: SupabaseClient,
  id: string,
  status: VendorSupplyOrderStatus,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("vendor_supply_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error: error?.message ?? null };
}

export async function loadVendorById(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<{ data: Vendor | null; error: string | null }> {
  const { data, error } = await supabase.from("vendors").select("*").eq("id", vendorId).maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: (data as Vendor) ?? null, error: null };
}
