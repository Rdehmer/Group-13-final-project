/**
 * Customer inbox unread helpers for the portal notification badge.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type InboxUnreadThread = {
  id: string;
  last_message_at: string;
  customer_last_read_at: string | null;
  last_sender_role: "customer" | "staff" | null;
};

export function isInboxThreadUnread(thread: InboxUnreadThread): boolean {
  if (thread.last_sender_role !== "staff") return false;
  if (!thread.customer_last_read_at) return true;
  return new Date(thread.last_message_at).getTime() > new Date(thread.customer_last_read_at).getTime();
}

export async function countUnreadInboxThreads(
  supabase: SupabaseClient,
  customerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("customer_inbox_threads")
    .select("id, last_message_at, customer_last_read_at, last_sender_role")
    .eq("customer_id", customerId)
    .eq("last_sender_role", "staff");

  if (error) {
    console.error("countUnreadInboxThreads", error.message);
    return 0;
  }

  return ((data as InboxUnreadThread[]) ?? []).filter(isInboxThreadUnread).length;
}

export async function markInboxThreadRead(
  supabase: SupabaseClient,
  threadId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("customer_inbox_threads")
    .update({ customer_last_read_at: now })
    .eq("id", threadId);
  if (error) {
    console.error("markInboxThreadRead", error.message);
  }
}
