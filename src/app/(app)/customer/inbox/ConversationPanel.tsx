import { Send } from "lucide-react";
import { formatMessageWhen, type InboxMessage } from "./inbox-types";

type Props = {
  messages: InboxMessage[];
  reply: string;
  busy: boolean;
  showDraftHint?: boolean;
  onReplyChange: (value: string) => void;
  onSend: () => void;
};

export function ConversationPanel({
  messages,
  reply,
  busy,
  showDraftHint = false,
  onReplyChange,
  onSend,
}: Props) {
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSend();
  }

  const replyRows = Math.max(showDraftHint ? 10 : 3, reply.split("\n").length + 1);

  return (
    <div className="flex min-h-[22rem] flex-col rounded-box border border-base-300 bg-base-100">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm opacity-60">No messages in this thread yet.</p>
        ) : (
          messages.map((msg) => {
            const isCustomer = msg.sender_role === "customer";
            return (
              <div
                key={msg.id}
                className={`flex ${isCustomer ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    isCustomer
                      ? "bg-primary text-primary-content rounded-br-sm"
                      : "bg-base-200 text-base-content rounded-bl-sm"
                  }`}
                >
                  {!isCustomer ? (
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-60">
                      Ridley Equipment Services
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                  <p
                    className={`mt-1 text-[10px] ${
                      isCustomer ? "text-primary-content/70" : "opacity-50"
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

      <form
        onSubmit={handleSubmit}
        className="border-t border-base-200 p-3"
      >
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
            placeholder="Write a reply to Ridley…"
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
