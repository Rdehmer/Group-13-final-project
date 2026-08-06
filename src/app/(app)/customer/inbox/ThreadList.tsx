import {
  formatInboxWhen,
  inboxCategoryLabel,
  type InboxThread,
} from "./inbox-types";
import { isThreadUnreadForStaff } from "@/lib/manager-inbox";

type Props = {
  threads: InboxThread[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Manager list shows customer as the “From” line. */
  showCustomer?: boolean;
  /** Show unread indicator for manager mailbox. */
  showUnread?: boolean;
  emptyHint?: string;
};

export function ThreadList({
  threads,
  selectedId,
  onSelect,
  showCustomer = false,
  showUnread = false,
  emptyHint = "No messages yet. Start a conversation with Ridley.",
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
        const fromName = thread.customers?.name?.trim() || "Customer";
        const unread = showUnread && isThreadUnreadForStaff(thread);
        return (
          <li key={thread.id}>
            <button
              type="button"
              onClick={() => onSelect(thread.id)}
              className={`w-full px-4 py-3 text-left transition hover:bg-base-200/60 ${
                active ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""
              } ${unread ? "bg-warning/5" : ""}`}
            >
              {showCustomer ? (
                <div className="mb-0.5 flex items-start justify-between gap-2">
                  <p className={`line-clamp-1 text-sm ${unread ? "font-bold" : "font-semibold"}`}>
                    {fromName}
                    {unread ? (
                      <span className="ml-2 inline-block h-2 w-2 rounded-full bg-error align-middle" />
                    ) : null}
                  </p>
                  <span className="shrink-0 text-[10px] opacity-50 tabular-nums">
                    {formatInboxWhen(thread.last_message_at)}
                  </span>
                </div>
              ) : null}
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`line-clamp-1 text-sm ${
                    showCustomer
                      ? unread
                        ? "font-semibold opacity-95"
                        : "font-medium opacity-90"
                      : "font-medium"
                  }`}
                >
                  {thread.subject}
                </p>
                {!showCustomer ? (
                  <span className="shrink-0 text-[10px] opacity-50 tabular-nums">
                    {formatInboxWhen(thread.last_message_at)}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="badge badge-ghost badge-xs">
                  {inboxCategoryLabel(thread.category)}
                </span>
                {thread.work_orders?.work_order_number ? (
                  <span className="text-[10px] opacity-50">
                    {thread.work_orders.work_order_number}
                  </span>
                ) : null}
                {unread ? <span className="badge badge-error badge-xs">Unread</span> : null}
                {thread.status === "resolved" ? (
                  <span className="badge badge-success badge-xs">Resolved</span>
                ) : (
                  <span className="badge badge-warning badge-xs">Open</span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
