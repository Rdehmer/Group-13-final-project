"use client";

/**
 * This business faces customer communication gap risk when updates live only in phone or email.
 * Our app reduces the risk by giving customers a dedicated inbox tied to their Ridley account.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquarePlus, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";
import type { Profile } from "@/lib/types";
import { ConversationPanel } from "./ConversationPanel";
import {
  buildFollowUpDraft,
  followUpContextFromWorkOrder,
  type FollowUpWorkOrderContext,
} from "./inbox-draft";
import {
  inboxCategoryLabel,
  normalizeInboxThread,
  normalizeWorkOrderOption,
  type InboxCategory,
  type InboxMessage,
  type InboxThread,
  type WorkOrderOption,
  type WorkOrderRow,
} from "./inbox-types";
import { NewMessageModal } from "./NewMessageModal";
import { ThreadList } from "./ThreadList";
import { markInboxThreadRead } from "@/lib/customer-inbox";

const THREAD_SELECT = `
  *,
  work_orders ( work_order_number, work_order_type, status, scheduled_date, equipment ( name ) )
`;

const WORK_ORDER_SELECT =
  "id, work_order_number, work_order_type, status, scheduled_date, equipment ( name )";

export default function CustomerInboxPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm opacity-60">Loading inbox…</div>}>
      <CustomerInboxPageInner />
    </Suspense>
  );
}

function CustomerInboxPageInner() {
  const searchParams = useSearchParams();
  const followUpWorkOrderId = searchParams.get("work_order_id");
  const handledFollowUp = useRef(false);

  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replyDraftHint, setReplyDraftHint] = useState(false);
  const [lastAutoDraft, setLastAutoDraft] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newCategory, setNewCategory] = useState<InboxCategory>("general");
  const [newWorkOrderId, setNewWorkOrderId] = useState("");
  const [newBody, setNewBody] = useState("");

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );

  const loadThreads = useCallback(async (customerId: string) => {
    const { data, error: loadError } = await supabase
      .from("customer_inbox_threads")
      .select(THREAD_SELECT)
      .eq("customer_id", customerId)
      .order("last_message_at", { ascending: false });

    if (loadError) throw new Error(loadError.message);
    return ((data as InboxThread[]) ?? []).map(normalizeInboxThread);
  }, [supabase]);

  const loadMessages = useCallback(async (threadId: string) => {
    const { data, error: loadError } = await supabase
      .from("customer_inbox_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (loadError) throw new Error(loadError.message);
    return (data as InboxMessage[]) ?? [];
  }, [supabase]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    setProfile(p as Profile);
    if (!p?.customer_id) {
      setLoading(false);
      return;
    }

    try {
      const [threadRows, { data: wo }] = await Promise.all([
        loadThreads(p.customer_id),
        supabase
          .from("work_orders")
          .select(WORK_ORDER_SELECT)
          .eq("customer_id", p.customer_id)
          .order("created_at", { ascending: false })
          .limit(25),
      ]);

      setThreads(threadRows);
      setWorkOrders(((wo as WorkOrderRow[] | null) ?? []).map(normalizeWorkOrderOption));
      setSelectedId((prev) => {
        if (prev && threadRows.some((t) => t.id === prev)) return prev;
        return threadRows[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inbox.");
    }

    setLoading(false);
  }, [loadThreads, supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function draftContextForWorkOrderId(workOrderId: string): FollowUpWorkOrderContext | null {
    const fromList = workOrders.find((w) => w.id === workOrderId);
    if (fromList) return followUpContextFromWorkOrder(fromList);

    const thread = threads.find((t) => t.work_order_id === workOrderId);
    const wo = thread?.work_orders;
    if (!wo?.work_order_number || !wo.status) return null;

    return {
      work_order_number: wo.work_order_number,
      work_order_type: wo.work_order_type,
      status: wo.status,
      scheduled_date: wo.scheduled_date,
      equipment_name: wo.equipment?.name ?? null,
    };
  }

  function applyAutoDraft(context: FollowUpWorkOrderContext): string {
    return buildFollowUpDraft(context);
  }

  useEffect(() => {
    if (!followUpWorkOrderId || handledFollowUp.current || loading) return;

    const draftContext = draftContextForWorkOrderId(followUpWorkOrderId);
    const existing = threads.find((t) => t.work_order_id === followUpWorkOrderId);
    if (existing) {
      setSelectedId(existing.id);
      if (draftContext) {
        setReply(applyAutoDraft(draftContext));
        setReplyDraftHint(true);
      }
      handledFollowUp.current = true;
      return;
    }

    const wo = workOrders.find((w) => w.id === followUpWorkOrderId);
    if (wo) {
      const draft = applyAutoDraft(followUpContextFromWorkOrder(wo));
      setNewSubject(`Follow up on ${wo.work_order_number}`);
      setNewCategory("service");
      setNewWorkOrderId(wo.id);
      setNewBody(draft);
      setLastAutoDraft(draft);
      setShowNew(true);
      handledFollowUp.current = true;
    }
  }, [followUpWorkOrderId, loading, threads, workOrders]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    (async () => {
      try {
        const rows = await loadMessages(selectedId);
        setMessages(rows);
        await markInboxThreadRead(supabase, selectedId);
        const now = new Date().toISOString();
        setThreads((prev) =>
          prev.map((t) =>
            t.id === selectedId ? { ...t, customer_last_read_at: now } : t,
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load messages.");
      }
    })();
  }, [selectedId, loadMessages, supabase]);

  function resetNewForm() {
    setNewSubject("");
    setNewCategory("general");
    setNewWorkOrderId("");
    setNewBody("");
    setLastAutoDraft("");
  }

  function handleWorkOrderIdChange(workOrderId: string) {
    setNewWorkOrderId(workOrderId);
    if (!workOrderId) {
      if (!newBody.trim() || newBody === lastAutoDraft) {
        setNewBody("");
        setLastAutoDraft("");
      }
      return;
    }

    const wo = workOrders.find((w) => w.id === workOrderId);
    if (!wo) return;

    const draft = applyAutoDraft(followUpContextFromWorkOrder(wo));
    if (!newBody.trim() || newBody === lastAutoDraft) {
      setNewBody(draft);
      setLastAutoDraft(draft);
    }
  }

  function handleReplyChange(value: string) {
    setReply(value);
    if (replyDraftHint) setReplyDraftHint(false);
  }

  async function handleSendReply() {
    if (!profile?.customer_id || !selectedId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    const body = reply.trim();

    const { data, error: insertError } = await supabase
      .from("customer_inbox_messages")
      .insert({
        thread_id: selectedId,
        sender_role: "customer",
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
    setReplyDraftHint(false);
    const refreshed = await loadThreads(profile.customer_id);
    setThreads(refreshed);
    setBusy(false);
  }

  async function handleCreateThread() {
    if (!profile?.customer_id || !newSubject.trim() || !newBody.trim()) return;
    setBusy(true);
    setError(null);

    const { data: thread, error: threadError } = await supabase
      .from("customer_inbox_threads")
      .insert({
        customer_id: profile.customer_id,
        subject: newSubject.trim(),
        category: newCategory,
        work_order_id: newWorkOrderId || null,
      })
      .select(THREAD_SELECT)
      .single();

    if (threadError || !thread) {
      setError(threadError?.message ?? "Could not create conversation.");
      setBusy(false);
      return;
    }

    const { error: msgError } = await supabase.from("customer_inbox_messages").insert({
      thread_id: thread.id,
      sender_role: "customer",
      sender_profile_id: profile.id,
      body: newBody.trim(),
    });

    if (msgError) {
      setError(msgError.message);
      setBusy(false);
      return;
    }

    const refreshed = await loadThreads(profile.customer_id);
    setThreads(refreshed);
    setSelectedId(thread.id);
    setShowNew(false);
    resetNewForm();
    setBusy(false);
  }

  if (!profile) {
    return <div className="p-8 text-center text-sm opacity-60">Loading inbox…</div>;
  }

  if (!profile.customer_id) {
    return (
      <EmptyState
        title="No customer account linked"
        description="Contact Ridley Equipment Services to link your portal account."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Messages with Ridley Equipment Services about your service, billing, and contracts."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              onClick={() => setShowNew(true)}
            >
              <MessageSquarePlus className="h-4 w-4" />
              New message
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

      {loading && threads.length === 0 ? (
        <div className="p-8 text-center text-sm opacity-60">Loading inbox…</div>
      ) : threads.length === 0 ? (
        <EmptyState
          title="No messages yet"
          description="Ask about a visit, invoice, or contract — our team will reply here."
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
              Start a conversation
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <ThreadList
              threads={threads}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>

          <div className="lg:col-span-3">
            {selectedThread ? (
              <div className="space-y-3">
                <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3">
                  <h2 className="font-semibold">{selectedThread.subject}</h2>
                  <p className="mt-1 text-xs opacity-60">
                    {inboxCategoryLabel(selectedThread.category)}
                    {selectedThread.work_order_id &&
                    selectedThread.work_orders?.work_order_number ? (
                      <>
                        {" · "}
                        <Link
                          href={`/customer/open-request?work_order_id=${selectedThread.work_order_id}`}
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
                  showDraftHint={replyDraftHint}
                  onReplyChange={handleReplyChange}
                  onSend={() => void handleSendReply()}
                />
              </div>
            ) : (
              <div className="rounded-box border border-dashed border-base-300 p-10 text-center text-sm opacity-70">
                Select a conversation or start a new message.
              </div>
            )}
          </div>
        </div>
      )}

      <NewMessageModal
        open={showNew}
        busy={busy}
        workOrders={workOrders}
        subject={newSubject}
        category={newCategory}
        workOrderId={newWorkOrderId}
        body={newBody}
        onSubjectChange={setNewSubject}
        onCategoryChange={setNewCategory}
        onWorkOrderIdChange={handleWorkOrderIdChange}
        onBodyChange={setNewBody}
        onClose={() => {
          if (!busy) {
            setShowNew(false);
            resetNewForm();
          }
        }}
        onSubmit={() => void handleCreateThread()}
      />
    </div>
  );
}
