"use client";

import { Send } from "lucide-react";
import {
  formatMessageWhen,
  type InboxMessage,
} from "@/app/(app)/customer/inbox/inbox-types";

type ViewerRole = "customer" | "staff";

type Props = {
  messages: InboxMessage[];
  reply: string;
  busy: boolean;
  /** Who is reading — flips “me” vs other alignment in chat mode. */
  viewerRole?: ViewerRole;
  /** Chat bubbles (customer portal) vs stacked email cards (manager). */
  layout?: "chat" | "email";
  showDraftHint?: boolean;
  replyPlaceholder?: string;
  customerLabel?: string;
  staffLabel?: string;
  onReplyChange: (value: string) => void;
  onSend: () => void;
};

/**
 * Shared conversation surface for customer chat and manager email-style inbox.
 */
export function ConversationPanel({
  messages,
  reply,
  busy,
  viewerRole = "customer",
  layout = "chat",
  showDraftHint = false,
  replyPlaceholder,
  customerLabel = "Customer",
  staffLabel = "EquipmentIQ",
  onReplyChange,
  onSend,
}: Props) {
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSend();
  }

  const replyRows = Math.max(showDraftHint ? 10 : 3, reply.split("\n").length + 1);
  const placeholder =
    replyPlaceholder ??
    (viewerRole === "staff" ? "Write a reply to the customer…" : "Write a reply to EquipmentIQ…");

  if (layout === "email") {
    return (
      <div className="flex min-h-[28rem] flex-col rounded-box border border-base-300 bg-base-100">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <p className="text-center text-sm opacity-60">No messages in this thread yet.</p>
          ) : (
            messages.map((msg) => {
              const fromStaff = msg.sender_role === "staff";
              const fromLabel = fromStaff ? staffLabel : customerLabel;
              return (
                <article
                  key={msg.id}
                  className={`rounded-lg border px-4 py-3 shadow-sm ${
                    fromStaff
                      ? "border-primary/25 bg-primary/5"
                      : "border-base-300 bg-base-100"
                  }`}
                >
                  <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-base-200 pb-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide opacity-50">
                        From
                      </p>
                      <p className="text-sm font-semibold">{fromLabel}</p>
                    </div>
                    <time className="text-xs opacity-50 tabular-nums">
                      {formatMessageWhen(msg.created_at)}
                    </time>
                  </header>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.body}</p>
                </article>
              );
            })
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-base-300 bg-base-200/40 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-50">Reply</p>
          {showDraftHint ? (
            <p className="mb-2 text-xs opacity-60">Draft started for you — edit before sending.</p>
          ) : null}
          <div className="flex gap-2">
            <textarea
              id="inbox-reply"
              className="textarea textarea-bordered min-h-[7rem] flex-1 bg-base-100 text-base leading-relaxed"
              rows={replyRows}
              placeholder={placeholder}
              value={reply}
              onChange={(e) => onReplyChange(e.target.value)}
              disabled={busy}
            />
            <button
              type="submit"
              className="btn btn-primary self-end gap-1"
              disabled={busy || !reply.trim()}
            >
              {busy ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-[22rem] flex-col rounded-box border border-base-300 bg-base-100">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm opacity-60">No messages in this thread yet.</p>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender_role === viewerRole;
            return (
              <div
                key={msg.id}
                className={`flex ${isMine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    isMine
                      ? "rounded-br-sm bg-primary text-primary-content"
                      : "rounded-bl-sm bg-base-200 text-base-content"
                  }`}
                >
                  {!isMine ? (
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-60">
                      {msg.sender_role === "staff" ? staffLabel : customerLabel}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                  <p
                    className={`mt-1 text-[10px] ${
                      isMine ? "text-primary-content/70" : "opacity-50"
                    }`}
                  >
                    {formatMessageWhen(msg.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-base-200 p-3">
        <label className="sr-only" htmlFor="inbox-reply">
          Reply
        </label>
        {showDraftHint ? (
          <p className="mb-2 text-xs opacity-60">Draft started for you — edit before sending.</p>
        ) : null}
        <div className="flex gap-2">
          <textarea
            id="inbox-reply"
            className={`textarea textarea-bordered flex-1 text-base leading-relaxed ${
              showDraftHint ? "min-h-[14rem]" : "min-h-[5rem]"
            }`}
            rows={replyRows}
            placeholder={placeholder}
            value={reply}
            onChange={(e) => onReplyChange(e.target.value)}
            disabled={busy}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm self-end gap-1"
            disabled={busy || !reply.trim()}
          >
            {busy ? <span className="loading loading-spinner loading-xs" /> : <Send className="h-4 w-4" />}
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
