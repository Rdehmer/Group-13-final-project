export type InboxCategory = "general" | "service" | "billing" | "contract";

export type WorkOrderDraftFields = {
  status: string;
  scheduled_date?: string | null;
  equipment?: { name: string } | null;
};

export type InboxThread = {
  id: string;
  customer_id: string;
  subject: string;
  category: InboxCategory;
  work_order_id: string | null;
  status: "open" | "resolved";
  last_message_at: string;
  /** When a manager last opened the thread (unread badge). */
  staff_last_read_at?: string | null;
  created_at: string;
  work_orders?:
    | ({ work_order_number: string; work_order_type: string } & WorkOrderDraftFields)
    | null;
  /** Present on manager inbox loads. */
  customers?: { id: string; name: string; email: string | null } | null;
};

export type InboxMessage = {
  id: string;
  thread_id: string;
  sender_role: "customer" | "staff";
  sender_profile_id: string | null;
  body: string;
  created_at: string;
};

export type WorkOrderOption = {
  id: string;
  work_order_number: string;
  work_order_type: string;
} & WorkOrderDraftFields;

export type WorkOrderRow = {
  id: string;
  work_order_number: string;
  work_order_type: string;
  status: string;
  scheduled_date?: string | null;
  equipment?: { name: string } | { name: string }[] | null;
};

function normalizeEquipment(
  equipment: WorkOrderRow["equipment"],
): WorkOrderDraftFields["equipment"] {
  if (!equipment) return null;
  if (Array.isArray(equipment)) return equipment[0] ?? null;
  return equipment;
}

export function normalizeWorkOrderOption(row: WorkOrderRow): WorkOrderOption {
  return {
    id: row.id,
    work_order_number: row.work_order_number,
    work_order_type: row.work_order_type,
    status: row.status,
    scheduled_date: row.scheduled_date,
    equipment: normalizeEquipment(row.equipment),
  };
}

export function normalizeInboxThread(thread: InboxThread): InboxThread {
  if (!thread.work_orders) return thread;
  return {
    ...thread,
    work_orders: {
      ...thread.work_orders,
      equipment: normalizeEquipment(
        thread.work_orders.equipment as WorkOrderRow["equipment"],
      ),
    },
  };
}

export const INBOX_CATEGORIES: { id: InboxCategory; label: string }[] = [
  { id: "general", label: "General" },
  { id: "service", label: "Service" },
  { id: "billing", label: "Billing" },
  { id: "contract", label: "Contract" },
];

export function inboxCategoryLabel(category: InboxCategory): string {
  return INBOX_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

export function formatInboxWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatMessageWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
