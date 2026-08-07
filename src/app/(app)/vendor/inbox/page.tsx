"use client";

/**
 * Vendor portal inbox — messages with EquipmentIQ staff about work, supplies, and billing.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";
import type { Profile } from "@/lib/types";
import { ConversationPanel } from "@/app/(app)/customer/inbox/ConversationPanel";
import { ThreadList } from "@/app/(app)/customer/inbox/ThreadList";
import { markVendorInboxThreadRead } from "@/lib/vendor-inbox";
import { listSupplyOrdersForVendor, listWorkItemsForVendor } from "@/lib/vendorPortal";
import { VendorNewMessageModal } from "./VendorNewMessageModal";
import {
  vendorInboxCategoryLabel,
  type VendorInboxCategory,
  type VendorInboxMessage,
  type VendorInboxThread,
  type VendorSupplyOrderOption,
  type VendorWorkItemOption,
} from "./vendor-inbox-types";

const THREAD_SELECT = `
  *,
  vendor_work_items ( id, title ),
  vendor_supply_orders ( id, item_name )
`;

export default function VendorInboxPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm opacity-60">Loading inbox…</div>}>
      <VendorInboxPageInner />
    </Suspense>
  );
}

function VendorInboxPageInner() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [threads, setThreads] = useState<VendorInboxThread[]>([]);
  const [messages, setMessages] = useState<VendorInboxMessage[]>([]);
  const [workItems, setWorkItems] = useState<VendorWorkItemOption[]>([]);
  const [supplyOrders, setSupplyOrders] = useState<VendorSupplyOrderOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newCategory, setNewCategory] = useState<VendorInboxCategory>("general");
  const [newWorkItemId, setNewWorkItemId] = useState("");
  const [newSupplyOrderId, setNewSupplyOrderId] = useState("");
  const [newBody, setNewBody] = useState("");

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );

  const loadThreads = useCallback(async (vendorId: string) => {
    const { data, error: loadError } = await supabase
      .from("vendor_inbox_threads")
      .select(THREAD_SELECT)
      .eq("vendor_id", vendorId)
      .order("last_message_at", { ascending: false });

    if (loadError) throw new Error(loadError.message);
    return (data as VendorInboxThread[]) ?? [];
  }, [supabase]);

  const loadMessages = useCallback(async (threadId: string) => {
    const { data, error: loadError } = await supabase
      .from("vendor_inbox_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (loadError) throw new Error(loadError.message);
    return (data as VendorInboxMessage[]) ?? [];
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
    if (!p?.vendor_id) {
      setLoading(false);
      return;
    }

    try {
      const [threadRows, workRes, orderRes] = await Promise.all([
        loadThreads(p.vendor_id),
        listWorkItemsForVendor(supabase, p.vendor_id),
        listSupplyOrdersForVendor(supabase, p.vendor_id),
      ]);

      setThreads(threadRows);
      setWorkItems(
        workRes.data.map((item) => ({ id: item.id, title: item.title, status: item.status })),
      );
      setSupplyOrders(
        orderRes.data.map((order) => ({
          id: order.id,
          item_name: order.item_name,
          status: order.status,
        })),
      );
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

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    (async () => {
      try {
        const rows = await loadMessages(selectedId);
        setMessages(rows);
        await markVendorInboxThreadRead(supabase, selectedId);
        const now = new Date().toISOString();
        setThreads((prev) =>
          prev.map((t) => (t.id === selectedId ? { ...t, vendor_last_read_at: now } : t)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load messages.");
      }
    })();
  }, [selectedId, loadMessages, supabase]);

  function resetNewForm() {
    setNewSubject("");
    setNewCategory("general");
    setNewWorkItemId("");
    setNewSupplyOrderId("");
    setNewBody("");
  }

  async function handleSendReply() {
    if (!profile?.vendor_id || !selectedId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    const body = reply.trim();

    const { data, error: insertError } = await supabase
      .from("vendor_inbox_messages")
      .insert({
        thread_id: selectedId,
        sender_role: "vendor",
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

    setMessages((prev) => [...prev, data as VendorInboxMessage]);
    setReply("");
    const refreshed = await loadThreads(profile.vendor_id);
    setThreads(refreshed);
    setBusy(false);
  }

  async function handleCreateThread() {
    if (!profile?.vendor_id || !newSubject.trim() || !newBody.trim()) return;
    setBusy(true);
    setError(null);

    const { data: thread, error: threadError } = await supabase
      .from("vendor_inbox_threads")
      .insert({
        vendor_id: profile.vendor_id,
        subject: newSubject.trim(),
        category: newCategory,
        vendor_work_item_id: newWorkItemId || null,
        vendor_supply_order_id: newSupplyOrderId || null,
      })
      .select(THREAD_SELECT)
      .single();

    if (threadError || !thread) {
      setError(threadError?.message ?? "Could not create conversation.");
      setBusy(false);
      return;
    }

    const { error: msgError } = await supabase.from("vendor_inbox_messages").insert({
      thread_id: thread.id,
      sender_role: "vendor",
      sender_profile_id: profile.id,
      body: newBody.trim(),
    });

    if (msgError) {
      setError(msgError.message);
      setBusy(false);
      return;
    }

    const refreshed = await loadThreads(profile.vendor_id);
    setThreads(refreshed);
    setSelectedId(thread.id);
    setShowNew(false);
    resetNewForm();
    setBusy(false);
  }

  if (!profile) {
    return <div className="p-8 text-center text-sm opacity-60">Loading inbox…</div>;
  }

  if (!profile.vendor_id) {
    return (
      <EmptyState
        title="No vendor account linked"
        description="Contact EquipmentIQ to link your portal account."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Messages with EquipmentIQ about work assignments, supply orders, and billing."
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
          description="Ask about a work item, supply order, or invoice — our team will reply here."
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
              unreadMode="vendor"
            />
          </div>

          <div className="lg:col-span-3">
            {selectedThread ? (
              <div className="space-y-3">
                <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3">
                  <h2 className="font-semibold">{selectedThread.subject}</h2>
                  <p className="mt-1 text-xs opacity-60">
                    {vendorInboxCategoryLabel(selectedThread.category)}
                    {selectedThread.vendor_work_items?.title ? (
                      <> · {selectedThread.vendor_work_items.title}</>
                    ) : null}
                    {selectedThread.vendor_supply_orders?.item_name ? (
                      <> · {selectedThread.vendor_supply_orders.item_name}</>
                    ) : null}
                  </p>
                </div>
                <ConversationPanel
                  messages={messages}
                  reply={reply}
                  busy={busy}
                  viewerRole="vendor"
                  vendorLabel="You"
                  staffLabel="EquipmentIQ"
                  onReplyChange={setReply}
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

      <VendorNewMessageModal
        open={showNew}
        busy={busy}
        workItems={workItems}
        supplyOrders={supplyOrders}
        subject={newSubject}
        category={newCategory}
        workItemId={newWorkItemId}
        supplyOrderId={newSupplyOrderId}
        body={newBody}
        onSubjectChange={setNewSubject}
        onCategoryChange={setNewCategory}
        onWorkItemIdChange={setNewWorkItemId}
        onSupplyOrderIdChange={setNewSupplyOrderId}
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
