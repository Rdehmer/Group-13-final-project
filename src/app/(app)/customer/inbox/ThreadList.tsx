import { isInboxThreadUnread } from "@/lib/customer-inbox";
import { inboxCategoryLabel, formatInboxWhen, type InboxThread } from "./inbox-types";

type Props = {
  threads: InboxThread[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ThreadList({ threads, selectedId, onSelect }: Props) {
  if (threads.length === 0) {
    return (
      <div className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm opacity-70">
        No messages yet. Start a conversation with Ridley.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-base-200 rounded-box border border-base-300 bg-base-100">
      {threads.map((thread) => {
        const active = thread.id === selectedId;
        const unread = isInboxThreadUnread({
          id: thread.id,
          last_message_at: thread.last_message_at,
          customer_last_read_at: thread.customer_last_read_at ?? null,
          last_sender_role: thread.last_sender_role ?? null,
        });
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
                <p
                  className={`line-clamp-1 text-sm ${unread ? "font-semibold" : "font-medium"}`}
                >
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
                <span className="badge badge-ghost badge-xs">
                  {inboxCategoryLabel(thread.category)}
                </span>
                {thread.work_orders?.work_order_number ? (
                  <span className="text-[10px] opacity-50">
                    {thread.work_orders.work_order_number}
                  </span>
                ) : null}
                {thread.status === "resolved" ? (
                  <span className="badge badge-success badge-xs">Resolved</span>
                ) : null}
                {unread ? <span className="badge badge-success badge-xs">Unread</span> : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
