import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxThread } from "@/app/(app)/customer/inbox/inbox-types";

export const MANAGER_INBOX_UNREAD_EVENT = "manager-inbox-unread-changed";

export function notifyManagerInboxUnreadChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MANAGER_INBOX_UNREAD_EVENT));
}

/** Thread needs manager attention when newest activity is after last staff open. */
export function isThreadUnreadForStaff(
  thread: Pick<InboxThread, "last_message_at" | "staff_last_read_at">,
): boolean {
  if (!thread.last_message_at) return false;
  if (!thread.staff_last_read_at) return true;
  return new Date(thread.last_message_at).getTime() > new Date(thread.staff_last_read_at).getTime();
}

export function countUnreadStaffThreads(
  threads: Array<Pick<InboxThread, "last_message_at" | "staff_last_read_at" | "status">>,
): number {
  return threads.filter((t) => t.status !== "resolved" && isThreadUnreadForStaff(t)).length;
}

export async function fetchManagerUnreadInboxCount(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("customer_inbox_threads")
    .select("id, status, last_message_at, staff_last_read_at")
    .neq("status", "resolved");

  if (error) throw new Error(error.message);
  return countUnreadStaffThreads((data as InboxThread[]) ?? []);
}

/** Ensure staff_last_read_at is at/after last_message_at so the unread badge clears. */
export function readTimestampForThread(lastMessageAt?: string | null): string {
  const now = Date.now();
  const last = lastMessageAt ? new Date(lastMessageAt).getTime() : NaN;
  const ms = Number.isFinite(last) ? Math.max(now, last) : now;
  return new Date(ms).toISOString();
}

export async function markInboxThreadReadByStaff(
  supabase: SupabaseClient,
  threadId: string,
  lastMessageAt?: string | null,
): Promise<string> {
  const readAt = readTimestampForThread(lastMessageAt);
  const { error } = await supabase
    .from("customer_inbox_threads")
    .update({ staff_last_read_at: readAt })
    .eq("id", threadId);
  if (error) throw new Error(error.message);
  notifyManagerInboxUnreadChanged();
  return readAt;
}

export async function markAllInboxThreadsReadByStaff(
  supabase: SupabaseClient,
  threads: Array<Pick<InboxThread, "id" | "last_message_at" | "staff_last_read_at" | "status">>,
): Promise<number> {
  const unread = threads.filter((t) => t.status !== "resolved" && isThreadUnreadForStaff(t));
  if (unread.length === 0) return 0;

  await Promise.all(
    unread.map((t) =>
      supabase
        .from("customer_inbox_threads")
        .update({ staff_last_read_at: readTimestampForThread(t.last_message_at) })
        .eq("id", t.id),
    ),
  );
  notifyManagerInboxUnreadChanged();
  return unread.length;
}
