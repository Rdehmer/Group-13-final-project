"use client";

/**
 * Manager inbox — same customer_inbox_* threads as the customer portal, email-style UI.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";
import type { Profile } from "@/lib/types";
import { ConversationPanel } from "@/app/(app)/customer/inbox/ConversationPanel";
import { ThreadList } from "@/app/(app)/customer/inbox/ThreadList";
import {
  formatMessageWhen,
  inboxCategoryLabel,
  normalizeInboxThread,
  type InboxMessage,
  type InboxThread,
} from "@/app/(app)/customer/inbox/inbox-types";
import { countUnreadStaffThreads, isThreadUnreadForStaff, markAllInboxThreadsReadByStaff, markInboxThreadReadByStaff } from "@/lib/manager-inbox";

const THREAD_SELECT = `
  *,
  customers ( id, name, email ),
  work_orders ( work_order_number, work_order_type, status, scheduled_date, equipment ( name ) )
`;

type StatusFilter = "all" | "open" | "resolved";

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
  const [markingRead, setMarkingRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );

  const visibleThreads = useMemo(() => {
    if (statusFilter === "all") return threads;
    return threads.filter((t) => t.status === statusFilter);
  }, [threads, statusFilter]);

  const openCount = useMemo(
    () => threads.filter((t) => t.status === "open").length,
    [threads],
  );
  const unreadCount = useMemo(() => countUnreadStaffThreads(threads), [threads]);

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
      if (next?.role !== "service_manager") {
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

  async function handleMarkSelectedRead() {
    if (!selectedThread || !isThreadUnreadForStaff(selectedThread)) return;
    setMarkingRead(true);
    setError(null);
    try {
      const readAt = await markInboxThreadReadByStaff(
        supabase,
        selectedThread.id,
        selectedThread.last_message_at,
      );
      setThreads((prev) =>
        prev.map((t) => (t.id === selectedThread.id ? { ...t, staff_last_read_at: readAt } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark as read.");
    }
    setMarkingRead(false);
  }

  async function handleMarkAllRead() {
    if (unreadCount === 0) return;
    setMarkingRead(true);
    setError(null);
    try {
      await markAllInboxThreadsReadByStaff(supabase, threads);
      setThreads((prev) =>
        prev.map((t) => {
          if (t.status === "resolved" || !isThreadUnreadForStaff(t)) return t;
          const ms = Math.max(Date.now(), new Date(t.last_message_at).getTime());
          return { ...t, staff_last_read_at: new Date(ms).toISOString() };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark all as read.");
    }
    setMarkingRead(false);
  }

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

  if (!ready || profile?.role !== "service_manager") {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  const customerName = selectedThread?.customers?.name?.trim() || "Customer";
  const customerEmail = selectedThread?.customers?.email?.trim() || null;

  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Email-style threads with customers — same conversations they see in their portal Inbox."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={markingRead || unreadCount === 0}
              onClick={() => void handleMarkAllRead()}
            >
              {markingRead ? "Updating…" : "Mark all as read"}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="stats stats-horizontal shadow">
          <div className="stat px-4 py-3">
            <div className="stat-title text-xs">Unread</div>
            <div className="stat-value text-2xl">{unreadCount}</div>
          </div>
          <div className="stat px-4 py-3">
            <div className="stat-title text-xs">Open threads</div>
            <div className="stat-value text-2xl">{openCount}</div>
          </div>
          <div className="stat px-4 py-3">
            <div className="stat-title text-xs">All threads</div>
            <div className="stat-value text-2xl">{threads.length}</div>
          </div>
        </div>
        <select
          className="select select-bordered select-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter threads"
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {loading && threads.length === 0 ? (
        <div className="space-y-3">
          <div className="skeleton h-40 w-full rounded-2xl" />
          <div className="skeleton h-64 w-full rounded-2xl" />
        </div>
      ) : threads.length === 0 ? (
        <EmptyState
          title="No customer messages yet"
          description="When a customer starts a conversation in their portal Inbox, it will appear here so you can reply."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Inbox className="h-4 w-4 opacity-60" />
              Mailbox
            </div>
            <ThreadList
              threads={visibleThreads}
              selectedId={selectedId}
              onSelect={setSelectedId}
              showCustomer
              showUnread
              emptyHint="No threads match this filter."
            />
          </div>

          <div className="lg:col-span-3">
            {selectedThread ? (
              <div className="space-y-3">
                <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-lg font-semibold leading-snug">{selectedThread.subject}</p>
                    {isThreadUnreadForStaff(selectedThread) ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={markingRead}
                        onClick={() => void handleMarkSelectedRead()}
                      >
                        {markingRead ? "Saving…" : "Mark as read"}
                      </button>
                    ) : (
                      <span className="badge badge-ghost badge-sm self-center">Read</span>
                    )}
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide opacity-50">
                        From
                      </dt>
                      <dd className="font-medium">
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
                        {customerEmail ? (
                          <span className="mt-0.5 block text-xs opacity-60">&lt;{customerEmail}&gt;</span>
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide opacity-50">
                        To
                      </dt>
                      <dd className="font-medium">Ridley Equipment Services</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide opacity-50">
                        Category
                      </dt>
                      <dd>{inboxCategoryLabel(selectedThread.category)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide opacity-50">
                        Last activity
                      </dt>
                      <dd>{formatMessageWhen(selectedThread.last_message_at)}</dd>
                    </div>
                  </dl>
                  {selectedThread.work_order_id && selectedThread.work_orders?.work_order_number ? (
                    <p className="mt-3 text-sm">
                      <span className="opacity-60">Related job: </span>
                      <Link
                        href={`/work-orders/${selectedThread.work_order_id}`}
                        className="link link-hover font-medium"
                      >
                        {selectedThread.work_orders.work_order_number}
                      </Link>
                    </p>
                  ) : null}
                </div>

                <ConversationPanel
                  messages={messages}
                  reply={reply}
                  busy={busy}
                  viewerRole="staff"
                  layout="email"
                  customerLabel={customerName}
                  staffLabel="You (Ridley)"
                  onReplyChange={setReply}
                  onSend={() => void handleSendReply()}
                />
              </div>
            ) : (
              <div className="rounded-box border border-dashed border-base-300 p-10 text-center text-sm opacity-70">
                Select a message from the mailbox to read and reply.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
