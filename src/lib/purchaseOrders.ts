import type { SupabaseClient } from "@supabase/supabase-js";
import type { PurchaseOrder, PurchaseOrderAttachment, PurchaseOrderLine, Part } from "@/lib/types";

export type PurchaseOrderWithDetails = PurchaseOrder & {
  purchase_order_lines?: PurchaseOrderLine[];
  purchase_order_attachments?: PurchaseOrderAttachment[];
  vendor_supply_orders?: { id: string; status: string; item_name: string } | null;
};

export type PurchaseOrderKind = "restock" | "field";

/** Friendly message for PO UI — avoids raw Postgres / migration hints. */
export function formatPurchaseOrderError(message: string | null | undefined): string {
  const raw = (message ?? "").trim();
  if (!raw) return "Could not save the purchase order. Try again.";
  const lower = raw.toLowerCase();
  if (lower.includes("schema cache") || lower.includes("42p01") || lower.includes("does not exist")) {
    if (lower.includes("purchase_order_lines") || lower.includes("purchase_order_attachments")) {
      return "Purchase order lines or receipts are not set up yet. Ask an administrator to apply the latest database migration.";
    }
    return "Purchase orders are not fully set up in this environment yet. Ask an administrator to apply the latest database migration.";
  }
  if (lower.includes("po_number") && lower.includes("null")) {
    return "Enter a PO number before saving.";
  }
  if (lower.includes("purchase_orders_shape_check")) {
    return "This purchase order is missing required details (restock part/qty or field PO number).";
  }
  if (lower.includes("row-level security") || lower.includes("permission denied")) {
    return "You do not have permission to create or update this purchase order.";
  }
  if (lower.includes("not enough warehouse stock")) {
    return raw;
  }
  return raw;
}

export async function createVendorSupplyOrderForRestock(
  supabase: SupabaseClient,
  input: {
    purchaseOrderId: string;
    vendorId: string;
    itemName: string;
    quantity: number;
    notes?: string | null;
    createdBy?: string | null;
  },
): Promise<{ supplyOrderId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("vendor_supply_orders")
    .insert({
      vendor_id: input.vendorId,
      item_name: input.itemName,
      quantity: input.quantity,
      status: "Pending",
      notes:
        input.notes?.trim() ||
        "Technician restock request — accept when you can supply, then notify the office.",
      created_by: input.createdBy ?? null,
      purchase_order_id: input.purchaseOrderId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { supplyOrderId: null, error: formatPurchaseOrderError(error?.message) };
  }

  const supplyOrderId = data.id as string;
  const { error: linkError } = await supabase
    .from("purchase_orders")
    .update({
      vendor_supply_order_id: supplyOrderId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.purchaseOrderId);

  if (linkError) {
    return { supplyOrderId, error: formatPurchaseOrderError(linkError.message) };
  }

  return { supplyOrderId, error: null };
}

export function nextPoNumber(): string {
  return `PO-${Date.now().toString().slice(-8)}`;
}

export async function loadPurchaseOrders(
  supabase: SupabaseClient,
  filter: { invoiceId?: string | null; workOrderId?: string | null },
): Promise<{ data: PurchaseOrderWithDetails[]; error: string | null }> {
  let query = supabase
    .from("purchase_orders")
    .select("*, purchase_order_lines(*), purchase_order_attachments(*)")
    .eq("order_type", "field")
    .order("created_at", { ascending: false });

  if (filter.invoiceId && filter.workOrderId) {
    query = query.or(`invoice_id.eq.${filter.invoiceId},work_order_id.eq.${filter.workOrderId}`);
  } else if (filter.invoiceId) {
    query = query.eq("invoice_id", filter.invoiceId);
  } else if (filter.workOrderId) {
    query = query.eq("work_order_id", filter.workOrderId);
  } else {
    return { data: [], error: null };
  }

  const { data, error } = await query;
  if (error) {
    return { data: [], error: formatPurchaseOrderError(error.message) };
  }
  return { data: (data as PurchaseOrderWithDetails[]) ?? [], error: null };
}

export async function linkWorkOrderPosToInvoice(
  supabase: SupabaseClient,
  workOrderId: string,
  invoiceId: string,
) {
  await supabase
    .from("purchase_orders")
    .update({ invoice_id: invoiceId, updated_at: new Date().toISOString() })
    .eq("work_order_id", workOrderId)
    .is("invoice_id", null);
}

const RECEIPT_BUCKET = "po-receipts";
const MAX_INLINE_BYTES = 450_000;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export async function uploadPoReceipt(
  supabase: SupabaseClient,
  opts: {
    purchaseOrderId: string;
    file: File;
    userId: string | null;
  },
): Promise<{ error: string | null }> {
  const path = `${opts.purchaseOrderId}/${Date.now()}-${opts.file.name.replace(/[^\w.\-]+/g, "_")}`;
  let file_path: string | null = null;
  let file_data: string | null = null;

  const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, opts.file, {
    upsert: false,
    contentType: opts.file.type || undefined,
  });

  if (!uploadError) {
    file_path = path;
  } else if (opts.file.size <= MAX_INLINE_BYTES) {
    // Fallback for demos without a storage bucket
    try {
      file_data = await fileToDataUrl(opts.file);
    } catch {
      return {
        error: `${uploadError.message}. Also failed to store inline. Create Storage bucket "${RECEIPT_BUCKET}".`,
      };
    }
  } else {
    return {
      error: `${uploadError.message}. File too large for inline fallback (>450KB). Create Storage bucket "${RECEIPT_BUCKET}".`,
    };
  }

  const { error: insertError } = await supabase.from("purchase_order_attachments").insert({
    purchase_order_id: opts.purchaseOrderId,
    file_name: opts.file.name,
    file_path,
    file_data,
    mime_type: opts.file.type || null,
    file_size: opts.file.size,
    uploaded_by: opts.userId,
  });

  if (insertError) return { error: insertError.message };
  return { error: null };
}

export async function getReceiptViewUrl(
  supabase: SupabaseClient,
  att: PurchaseOrderAttachment,
): Promise<string | null> {
  if (att.file_data) return att.file_data;
  if (!att.file_path) return null;
  const { data } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(att.file_path, 3600);
  if (data?.signedUrl) return data.signedUrl;
  const pub = supabase.storage.from(RECEIPT_BUCKET).getPublicUrl(att.file_path);
  return pub.data.publicUrl || null;
}

export function lineTotal(line: Pick<PurchaseOrderLine, "quantity" | "unit_cost">): number {
  return Number(line.quantity) * Number(line.unit_cost);
}

export function inventoryToLineDraft(part: Part) {
  return {
    part_id: part.id,
    part_number: part.part_number,
    part_name: part.name,
    description: part.description || part.name,
    quantity: 1,
    unit_cost: Number(part.unit_cost) || 0,
  };
}
