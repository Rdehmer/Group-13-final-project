"use client";

/**
 * Manager inbox — same customer_inbox_* threads and customer portal layout.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyCustomerInboxUnreadChanged } from "@/lib/customer-inbox";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";
import type { Profile } from "@/lib/types";
import { ConversationPanel } from "@/app/(app)/customer/inbox/ConversationPanel";
import { ThreadList } from "@/app/(app)/customer/inbox/ThreadList";
import {
  inboxCategoryLabel,
  normalizeInboxThread,
  type InboxMessage,
  type InboxThread,
} from "@/app/(app)/customer/inbox/inbox-types";
import { markInboxThreadReadByStaff } from "@/lib/manager-inbox";

const THREAD_SELECT = `
  *,
  customers ( id, name, email ),
  work_orders ( work_order_number, work_order_type, status, scheduled_date, equipment ( name ) )
`;

export default function ManagerInboxPage() {
  const supabase = createClient();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );

  const loadThreads = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("customer_inbox_threads")
      .select(THREAD_SELECT)
      .order("last_message_at", { ascending: false });

    if (loadError) throw new Error(loadError.message);
    return ((data as InboxThread[]) ?? []).map(normalizeInboxThread);
  }, [supabase]);

  const loadMessages = useCallback(
    async (threadId: string) => {
      const { data, error: loadError } = await supabase
        .from("customer_inbox_messages")
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      if (loadError) throw new Error(loadError.message);
      return (data as InboxMessage[]) ?? [];
    },
    [supabase],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadThreads();
      setThreads(rows);
      setSelectedId((prev) => {
        if (prev && rows.some((t) => t.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inbox.");
      setThreads([]);
    }
    setLoading(false);
  }, [loadThreads]);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      const next = p as Profile | null;
      setProfile(next);
      if (
        next?.role !== "service_manager" &&
        next?.role !== "administrator" &&
        next?.role !== "billing"
      ) {
        router.replace("/dashboard");
        return;
      }
      setReady(true);
      await refresh();
    })();
  }, [refresh, router, supabase]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setReply("");
      return;
    }
    setReply("");
    (async () => {
      try {
        const rows = await loadMessages(selectedId);
        setMessages(rows);
        try {
          const { data: threadRow } = await supabase
            .from("customer_inbox_threads")
            .select("last_message_at")
            .eq("id", selectedId)
            .maybeSingle();
          const readAt = await markInboxThreadReadByStaff(
            supabase,
            selectedId,
            (threadRow as { last_message_at?: string } | null)?.last_message_at,
          );
          setThreads((prev) =>
            prev.map((t) => (t.id === selectedId ? { ...t, staff_last_read_at: readAt } : t)),
          );
        } catch {
          /* reading still works if mark-read fails */
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load messages.");
      }
    })();
  }, [selectedId, loadMessages, supabase]);

  async function handleSendReply() {
    if (!profile || !selectedId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    const body = reply.trim();

    const { data, error: insertError } = await supabase
      .from("customer_inbox_messages")
      .insert({
        thread_id: selectedId,
        sender_role: "staff",
        sender_profile_id: profile.id,
        body,
      })
      .select("*")
      .single();

    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }

    setMessages((prev) => [...prev, data as InboxMessage]);
    setReply("");
    notifyCustomerInboxUnreadChanged();
    try {
      const readAt = await markInboxThreadReadByStaff(
        supabase,
        selectedId,
        (data as InboxMessage).created_at,
      );
      const refreshed = await loadThreads();
      setThreads(
        refreshed.map((t) => (t.id === selectedId ? { ...t, staff_last_read_at: readAt } : t)),
      );
    } catch {
      /* keep local message even if list refresh fails */
    }
    setBusy(false);
  }

  if (
    !ready ||
    (profile?.role !== "service_manager" &&
      profile?.role !== "administrator" &&
      profile?.role !== "billing")
  ) {
    return <div className="p-8 text-center text-sm opacity-60">Loading inbox…</div>;
  }

  const customerName = selectedThread?.customers?.name?.trim() || "Customer";

  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Messages with customers about service, billing, and contracts."
        actions={
          <button
            type="button"
            className="btn btn-outline btn-sm gap-1"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {error ? (
        <div className="alert alert-error mb-4 text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {loading && threads.length === 0 ? (
        <div className="p-8 text-center text-sm opacity-60">Loading inbox…</div>
      ) : threads.length === 0 ? (
        <EmptyState
          title="No messages yet"
          description="When a customer starts a conversation in their portal Inbox, it will appear here."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <ThreadList
              threads={threads}
              selectedId={selectedId}
              onSelect={setSelectedId}
              showCustomer
              showUnread
            />
          </div>

          <div className="lg:col-span-3">
            {selectedThread ? (
              <div className="space-y-3">
                <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3">
                  <h2 className="font-semibold">{selectedThread.subject}</h2>
                  <p className="mt-1 text-xs opacity-60">
                    {selectedThread.customers?.id ? (
                      <Link
                        href={`/customers/${selectedThread.customers.id}`}
                        className="link link-hover"
                      >
                        {customerName}
                      </Link>
                    ) : (
                      customerName
                    )}
                    {` · ${inboxCategoryLabel(selectedThread.category)}`}
                    {selectedThread.work_order_id && selectedThread.work_orders?.work_order_number ? (
                      <>
                        {" · "}
                        <Link
                          href={`/work-orders/${selectedThread.work_order_id}`}
                          className="link link-hover"
                        >
                          {selectedThread.work_orders.work_order_number}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <ConversationPanel
                  messages={messages}
                  reply={reply}
                  busy={busy}
                  viewerRole="staff"
                  customerLabel={customerName}
                  staffLabel="Ridley Equipment Services"
                  onReplyChange={setReply}
                  onSend={() => void handleSendReply()}
                />
              </div>
            ) : (
              <div className="rounded-box border border-dashed border-base-300 p-10 text-center text-sm opacity-70">
                Select a conversation to read and reply.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
