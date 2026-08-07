export type VendorInboxCategory = "general" | "work" | "supply" | "billing";

export type VendorInboxThread = {
  id: string;
  vendor_id: string;
  subject: string;
  category: VendorInboxCategory;
  vendor_work_item_id: string | null;
  vendor_supply_order_id: string | null;
  status: "open" | "resolved";
  last_message_at: string;
  staff_last_read_at?: string | null;
  created_at: string;
  vendor_last_read_at?: string | null;
  last_sender_role?: "vendor" | "staff" | null;
  vendor_work_items?: { id: string; title: string } | null;
  vendor_supply_orders?: { id: string; item_name: string } | null;
  /** Present on manager inbox loads. */
  vendors?: { id: string; name: string; email: string | null } | null;
};

export type VendorInboxMessage = {
  id: string;
  thread_id: string;
  sender_role: "vendor" | "staff";
  sender_profile_id: string | null;
  body: string;
  created_at: string;
};

export type VendorWorkItemOption = {
  id: string;
  title: string;
  status: string;
};

export type VendorSupplyOrderOption = {
  id: string;
  item_name: string;
  status: string;
};

export const VENDOR_INBOX_CATEGORIES: { id: VendorInboxCategory; label: string }[] = [
  { id: "general", label: "General" },
  { id: "work", label: "Work" },
  { id: "supply", label: "Supply" },
  { id: "billing", label: "Billing" },
];

export function vendorInboxCategoryLabel(category: VendorInboxCategory): string {
  return VENDOR_INBOX_CATEGORIES.find((c) => c.id === category)?.label ?? category;
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
