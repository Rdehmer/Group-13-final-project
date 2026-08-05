import type { SupabaseClient } from "@supabase/supabase-js";
import type { PurchaseOrder, PurchaseOrderAttachment, PurchaseOrderLine, Part } from "@/lib/types";

export type PurchaseOrderWithDetails = PurchaseOrder & {
  purchase_order_lines?: PurchaseOrderLine[];
  purchase_order_attachments?: PurchaseOrderAttachment[];
};

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
    if (error.message.includes("purchase_orders") || error.code === "42P01" || error.message.includes("schema cache")) {
      return {
        data: [],
        error:
          "Purchase orders table missing — run supabase/migrations/20260805_purchase_orders.sql in Supabase SQL Editor.",
      };
    }
    return { data: [], error: error.message };
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
