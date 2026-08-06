"use client";

/**
 * Manager inbox — customer and vendor portal threads in one place.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyCustomerInboxUnreadChanged } from "@/lib/customer-inbox";
import { notifyVendorInboxUnreadChanged } from "@/lib/vendor-inbox";
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
import {
  vendorInboxCategoryLabel,
  type VendorInboxMessage,
  type VendorInboxThread,
} from "@/app/(app)/vendor/inbox/vendor-inbox-types";
import {
  markInboxThreadReadByStaff,
  markVendorInboxThreadReadByStaff,
} from "@/lib/manager-inbox";
import { usesStaffInbox } from "@/lib/topbar-config";
import { homeForRole } from "@/lib/roles";

type InboxTab = "customers" | "vendors";

const CUSTOMER_THREAD_SELECT = `
  *,
  customers ( id, name, email ),
  work_orders ( work_order_number, work_order_type, status, scheduled_date, equipment ( name ) )
`;

const VENDOR_THREAD_SELECT = `
  *,
  vendors ( id, name, email ),
  vendor_work_items ( id, title ),
  vendor_supply_orders ( id, item_name )
`;

export default function ManagerInboxPage() {
  const supabase = createClient();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<InboxTab>("customers");

  const [customerThreads, setCustomerThreads] = useState<InboxThread[]>([]);
  const [customerMessages, setCustomerMessages] = useState<InboxMessage[]>([]);
  const [customerSelectedId, setCustomerSelectedId] = useState<string | null>(null);

  const [vendorThreads, setVendorThreads] = useState<VendorInboxThread[]>([]);
  const [vendorMessages, setVendorMessages] = useState<VendorInboxMessage[]>([]);
  const [vendorSelectedId, setVendorSelectedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const selectedCustomerThread = useMemo(
    () => customerThreads.find((t) => t.id === customerSelectedId) ?? null,
    [customerThreads, customerSelectedId],
  );

  const selectedVendorThread = useMemo(
    () => vendorThreads.find((t) => t.id === vendorSelectedId) ?? null,
    [vendorThreads, vendorSelectedId],
  );

  const loadCustomerThreads = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("customer_inbox_threads")
      .select(CUSTOMER_THREAD_SELECT)
      .order("last_message_at", { ascending: false });

    if (loadError) throw new Error(loadError.message);
    return ((data as InboxThread[]) ?? []).map(normalizeInboxThread);
  }, [supabase]);

  const loadVendorThreads = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("vendor_inbox_threads")
      .select(VENDOR_THREAD_SELECT)
      .order("last_message_at", { ascending: false });

    if (loadError) throw new Error(loadError.message);
    return (data as VendorInboxThread[]) ?? [];
  }, [supabase]);

  const loadCustomerMessages = useCallback(
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

  const loadVendorMessages = useCallback(
    async (threadId: string) => {
      const { data, error: loadError } = await supabase
        .from("vendor_inbox_messages")
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      if (loadError) throw new Error(loadError.message);
      return (data as VendorInboxMessage[]) ?? [];
    },
    [supabase],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [customers, vendors] = await Promise.all([
        loadCustomerThreads(),
        loadVendorThreads(),
      ]);
      setCustomerThreads(customers);
      setVendorThreads(vendors);
      setCustomerSelectedId((prev) => {
        if (prev && customers.some((t) => t.id === prev)) return prev;
        return customers[0]?.id ?? null;
      });
      setVendorSelectedId((prev) => {
        if (prev && vendors.some((t) => t.id === prev)) return prev;
        return vendors[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inbox.");
      setCustomerThreads([]);
      setVendorThreads([]);
    }
    setLoading(false);
  }, [loadCustomerThreads, loadVendorThreads]);

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
      if (!next || !usesStaffInbox(next.role)) {
        router.replace(next ? homeForRole(next.role) : "/login");
        return;
      }
      setReady(true);
      await refresh();
    })();
  }, [refresh, router, supabase]);

  useEffect(() => {
    if (tab !== "customers" || !customerSelectedId) {
      if (tab === "customers") setCustomerMessages([]);
      return;
    }
    setReply("");
    (async () => {
      try {
        const rows = await loadCustomerMessages(customerSelectedId);
        setCustomerMessages(rows);
        try {
          const { data: threadRow } = await supabase
            .from("customer_inbox_threads")
            .select("last_message_at")
            .eq("id", customerSelectedId)
            .maybeSingle();
          const readAt = await markInboxThreadReadByStaff(
            supabase,
            customerSelectedId,
            (threadRow as { last_message_at?: string } | null)?.last_message_at,
          );
          setCustomerThreads((prev) =>
            prev.map((t) =>
              t.id === customerSelectedId ? { ...t, staff_last_read_at: readAt } : t,
            ),
          );
        } catch {
          /* reading still works if mark-read fails */
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load messages.");
      }
    })();
  }, [tab, customerSelectedId, loadCustomerMessages, supabase]);

  useEffect(() => {
    if (tab !== "vendors" || !vendorSelectedId) {
      if (tab === "vendors") setVendorMessages([]);
      return;
    }
    setReply("");
    (async () => {
      try {
        const rows = await loadVendorMessages(vendorSelectedId);
        setVendorMessages(rows);
        try {
          const { data: threadRow } = await supabase
            .from("vendor_inbox_threads")
            .select("last_message_at")
            .eq("id", vendorSelectedId)
            .maybeSingle();
          const readAt = await markVendorInboxThreadReadByStaff(
            supabase,
            vendorSelectedId,
            (threadRow as { last_message_at?: string } | null)?.last_message_at,
          );
          setVendorThreads((prev) =>
            prev.map((t) =>
              t.id === vendorSelectedId ? { ...t, staff_last_read_at: readAt } : t,
            ),
          );
        } catch {
          /* reading still works if mark-read fails */
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load messages.");
      }
    })();
  }, [tab, vendorSelectedId, loadVendorMessages, supabase]);

  async function handleSendCustomerReply() {
    if (!profile || !customerSelectedId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    const body = reply.trim();

    const { data, error: insertError } = await supabase
      .from("customer_inbox_messages")
      .insert({
        thread_id: customerSelectedId,
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

    setCustomerMessages((prev) => [...prev, data as InboxMessage]);
    setReply("");
    notifyCustomerInboxUnreadChanged();
    try {
      const readAt = await markInboxThreadReadByStaff(
        supabase,
        customerSelectedId,
        (data as InboxMessage).created_at,
      );
      const refreshed = await loadCustomerThreads();
      setCustomerThreads(
        refreshed.map((t) =>
          t.id === customerSelectedId ? { ...t, staff_last_read_at: readAt } : t,
        ),
      );
    } catch {
      /* keep local message even if list refresh fails */
    }
    setBusy(false);
  }

  async function handleSendVendorReply() {
    if (!profile || !vendorSelectedId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    const body = reply.trim();

    const { data, error: insertError } = await supabase
      .from("vendor_inbox_messages")
      .insert({
        thread_id: vendorSelectedId,
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

    setVendorMessages((prev) => [...prev, data as VendorInboxMessage]);
    setReply("");
    notifyVendorInboxUnreadChanged();
    try {
      const readAt = await markVendorInboxThreadReadByStaff(
        supabase,
        vendorSelectedId,
        (data as VendorInboxMessage).created_at,
      );
      const refreshed = await loadVendorThreads();
      setVendorThreads(
        refreshed.map((t) =>
          t.id === vendorSelectedId ? { ...t, staff_last_read_at: readAt } : t,
        ),
      );
    } catch {
      /* keep local message even if list refresh fails */
    }
    setBusy(false);
  }

  if (!ready || !profile || !usesStaffInbox(profile.role)) {
    return <div className="p-8 text-center text-sm opacity-60">Loading inbox…</div>;
  }

  const customerName = selectedCustomerThread?.customers?.name?.trim() || "Customer";
  const vendorName = selectedVendorThread?.vendors?.name?.trim() || "Vendor";
  const activeThreads = tab === "customers" ? customerThreads : vendorThreads;
  const activeSelectedId = tab === "customers" ? customerSelectedId : vendorSelectedId;
  const setActiveSelectedId = tab === "customers" ? setCustomerSelectedId : setVendorSelectedId;

  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Messages with customers and vendors about service, supplies, billing, and contracts."
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

      <div role="tablist" className="tabs tabs-boxed mb-4 w-fit">
        <button
          type="button"
          role="tab"
          className={`tab ${tab === "customers" ? "tab-active" : ""}`}
          aria-selected={tab === "customers"}
          onClick={() => setTab("customers")}
        >
          Customers
        </button>
        <button
          type="button"
          role="tab"
          className={`tab ${tab === "vendors" ? "tab-active" : ""}`}
          aria-selected={tab === "vendors"}
          onClick={() => setTab("vendors")}
        >
          Vendors
        </button>
      </div>

      {error ? (
        <div className="alert alert-error mb-4 text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {loading && activeThreads.length === 0 ? (
        <div className="p-8 text-center text-sm opacity-60">Loading inbox…</div>
      ) : activeThreads.length === 0 ? (
        <EmptyState
          title="No messages yet"
          description={
            tab === "customers"
              ? "When a customer starts a conversation in their portal Inbox, it will appear here."
              : "When a vendor starts a conversation in their portal Inbox, it will appear here."
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            {tab === "customers" ? (
              <ThreadList
                threads={customerThreads}
                selectedId={activeSelectedId}
                onSelect={setActiveSelectedId}
                participantMode="customer"
                showUnread
                unreadMode="staff"
              />
            ) : (
              <ThreadList
                threads={vendorThreads}
                selectedId={activeSelectedId}
                onSelect={setActiveSelectedId}
                participantMode="vendor"
                showUnread
                unreadMode="staff"
                emptyHint="No vendor messages yet."
              />
            )}
          </div>

          <div className="lg:col-span-3">
            {tab === "customers" && selectedCustomerThread ? (
              <div className="space-y-3">
                <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3">
                  <h2 className="font-semibold">{selectedCustomerThread.subject}</h2>
                  <p className="mt-1 text-xs opacity-60">
                    {selectedCustomerThread.customers?.id ? (
                      <Link
                        href={`/customers/${selectedCustomerThread.customers.id}`}
                        className="link link-hover"
                      >
                        {customerName}
                      </Link>
                    ) : (
                      customerName
                    )}
                    {` · ${inboxCategoryLabel(selectedCustomerThread.category)}`}
                    {selectedCustomerThread.work_order_id &&
                    selectedCustomerThread.work_orders?.work_order_number ? (
                      <>
                        {" · "}
                        <Link
                          href={`/work-orders/${selectedCustomerThread.work_order_id}`}
                          className="link link-hover"
                        >
                          {selectedCustomerThread.work_orders.work_order_number}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <ConversationPanel
                  messages={customerMessages}
                  reply={reply}
                  busy={busy}
                  viewerRole="staff"
                  customerLabel={customerName}
                  staffLabel="EquipmentIQ"
                  onReplyChange={setReply}
                  onSend={() => void handleSendCustomerReply()}
                />
              </div>
            ) : tab === "vendors" && selectedVendorThread ? (
              <div className="space-y-3">
                <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3">
                  <h2 className="font-semibold">{selectedVendorThread.subject}</h2>
                  <p className="mt-1 text-xs opacity-60">
                    {selectedVendorThread.vendors?.id ? (
                      <Link
                        href={`/vendors/${selectedVendorThread.vendors.id}`}
                        className="link link-hover"
                      >
                        {vendorName}
                      </Link>
                    ) : (
                      vendorName
                    )}
                    {` · ${vendorInboxCategoryLabel(selectedVendorThread.category)}`}
                    {selectedVendorThread.vendor_work_items?.title ? (
                      <> · {selectedVendorThread.vendor_work_items.title}</>
                    ) : null}
                    {selectedVendorThread.vendor_supply_orders?.item_name ? (
                      <> · {selectedVendorThread.vendor_supply_orders.item_name}</>
                    ) : null}
                  </p>
                </div>
                <ConversationPanel
                  messages={vendorMessages}
                  reply={reply}
                  busy={busy}
                  viewerRole="staff"
                  vendorLabel={vendorName}
                  staffLabel="Ridley Equipment Services"
                  onReplyChange={setReply}
                  onSend={() => void handleSendVendorReply()}
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
