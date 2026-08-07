import { isInboxThreadUnread } from "@/lib/customer-inbox";
import { isThreadUnreadForStaff, isVendorThreadUnreadForStaff } from "@/lib/manager-inbox";
import { isVendorInboxThreadUnread } from "@/lib/vendor-inbox";
import {
  formatInboxWhen,
  inboxCategoryLabel,
} from "./inbox-types";
import {
  vendorInboxCategoryLabel,
  type VendorInboxThread,
} from "@/app/(app)/vendor/inbox/vendor-inbox-types";

type ThreadListItem = {
  id: string;
  subject: string;
  category: string;
  status: "open" | "resolved";
  last_message_at: string;
  staff_last_read_at?: string | null;
  customer_last_read_at?: string | null;
  vendor_last_read_at?: string | null;
  last_sender_role?: string | null;
  customer_id?: string;
  vendor_id?: string;
  work_orders?: { work_order_number: string } | null;
  customers?: { id: string; name: string; email: string | null } | null;
  vendors?: { id: string; name: string; email: string | null } | null;
  vendor_work_items?: { id: string; title: string } | null;
  vendor_supply_orders?: { id: string; item_name: string } | null;
};

type Props = {
  threads: ThreadListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Manager list shows customer as the “From” line. */
  showCustomer?: boolean;
  /** Show unread indicator for manager mailbox. */
  showUnread?: boolean;
  /** Who to show as the participant line (manager vendor tab). */
  participantMode?: "customer" | "vendor" | "none";
  /** Which unread rules to apply. */
  unreadMode?: "customer" | "staff" | "vendor";
  emptyHint?: string;
};

function categoryLabelForThread(thread: ThreadListItem, participantMode: Props["participantMode"]): string {
  if (participantMode === "vendor") {
    return vendorInboxCategoryLabel(thread.category as VendorInboxThread["category"]);
  }
  return inboxCategoryLabel(thread.category as Parameters<typeof inboxCategoryLabel>[0]);
}

function isThreadUnread(
  thread: ThreadListItem,
  unreadMode: NonNullable<Props["unreadMode"]>,
): boolean {
  if (unreadMode === "staff") {
    if (thread.vendor_id !== undefined) return isVendorThreadUnreadForStaff(thread);
    return isThreadUnreadForStaff(thread);
  }
  if (unreadMode === "vendor") {
    return isVendorInboxThreadUnread({
      id: thread.id,
      last_message_at: thread.last_message_at,
      vendor_last_read_at: thread.vendor_last_read_at ?? null,
      last_sender_role: (thread.last_sender_role as "vendor" | "staff" | null) ?? null,
    });
  }
  return isInboxThreadUnread({
    id: thread.id,
    last_message_at: thread.last_message_at,
    customer_last_read_at: thread.customer_last_read_at ?? null,
    last_sender_role: (thread.last_sender_role as "customer" | "staff" | null) ?? null,
  });
}

export function ThreadList({
  threads,
  selectedId,
  onSelect,
  showCustomer = false,
  showUnread = false,
  participantMode = showCustomer ? "customer" : "none",
  unreadMode = showUnread ? "staff" : showCustomer ? "customer" : "customer",
  emptyHint = "No messages yet. Start a conversation with EquipmentIQ.",
}: Props) {
  if (threads.length === 0) {
    return (
      <div className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm opacity-70">
        {emptyHint}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-base-200 rounded-box border border-base-300 bg-base-100">
      {threads.map((thread) => {
        const active = thread.id === selectedId;
        const fromName =
          participantMode === "vendor"
            ? thread.vendors?.name?.trim() || "Vendor"
            : thread.customers?.name?.trim() || "Customer";
        const showParticipant = participantMode !== "none";
        const unread = showUnread || participantMode === "vendor" || !showCustomer
          ? isThreadUnread(thread, unreadMode)
          : false;
        return (
          <li key={thread.id}>
            <button
              type="button"
              onClick={() => onSelect(thread.id)}
              className={`w-full px-4 py-3 text-left transition hover:bg-base-200/60 ${
                active ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={`line-clamp-1 text-sm ${unread ? "font-semibold" : "font-medium"}`}>
                  {unread ? (
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-full bg-success align-middle"
                      aria-label="Unread"
                    />
                  ) : null}
                  {thread.subject}
                </p>
                <span className="shrink-0 text-[10px] opacity-50 tabular-nums">
                  {formatInboxWhen(thread.last_message_at)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {showParticipant ? (
                  <span className="text-[10px] font-medium opacity-70">{fromName}</span>
                ) : null}
                <span className="badge badge-ghost badge-xs">
                  {categoryLabelForThread(thread, participantMode)}
                </span>
                {thread.work_orders?.work_order_number ? (
                  <span className="text-[10px] opacity-50">
                    {thread.work_orders.work_order_number}
                  </span>
                ) : null}
                {thread.vendor_work_items?.title ? (
                  <span className="text-[10px] opacity-50">{thread.vendor_work_items.title}</span>
                ) : null}
                {thread.vendor_supply_orders?.item_name ? (
                  <span className="text-[10px] opacity-50">
                    {thread.vendor_supply_orders.item_name}
                  </span>
                ) : null}
                {unread ? <span className="badge badge-success badge-xs">Unread</span> : null}
                {thread.status === "resolved" ? (
                  <span className="badge badge-success badge-xs">Resolved</span>
                ) : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
