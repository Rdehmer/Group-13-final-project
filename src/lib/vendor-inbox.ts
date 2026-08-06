/**
 * Vendor inbox unread helpers for the portal notification badge.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const VENDOR_INBOX_UNREAD_EVENT = "vendor-inbox-unread-changed";

export function notifyVendorInboxUnreadChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VENDOR_INBOX_UNREAD_EVENT));
}

export type VendorInboxUnreadThread = {
  id: string;
  last_message_at: string;
  vendor_last_read_at: string | null;
  last_sender_role: "vendor" | "staff" | null;
};

export function isVendorInboxThreadUnread(thread: VendorInboxUnreadThread): boolean {
  if (thread.last_sender_role !== "staff") return false;
  if (!thread.vendor_last_read_at) return true;
  return new Date(thread.last_message_at).getTime() > new Date(thread.vendor_last_read_at).getTime();
}

export async function countUnreadVendorInboxThreads(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("vendor_inbox_threads")
    .select("id, last_message_at, vendor_last_read_at, last_sender_role")
    .eq("vendor_id", vendorId)
    .eq("last_sender_role", "staff");

  if (error) {
    console.error("countUnreadVendorInboxThreads", error.message);
    return 0;
  }

  return ((data as VendorInboxUnreadThread[]) ?? []).filter(isVendorInboxThreadUnread).length;
}

export async function markVendorInboxThreadRead(
  supabase: SupabaseClient,
  threadId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("vendor_inbox_threads")
    .update({ vendor_last_read_at: now })
    .eq("id", threadId);
  if (error) {
    console.error("markVendorInboxThreadRead", error.message);
    return;
  }
  notifyVendorInboxUnreadChanged();
}
