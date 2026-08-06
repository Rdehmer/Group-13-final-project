import type { ServiceHistoryWorkOrder } from "@/lib/invoices";
import type { WorkOrderServiceRating } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const UNRATED_COMPLETED_STATUSES = ["Completed", "Closed"] as const;

export const UNRATED_RATING_SELECT = `
  *,
  equipment ( id, name, location ),
  work_order_service_ratings (
    id, work_order_id, overall_rating, technician_rating,
    timeliness_rating, quality_rating, comments, created_at
  )
`;

export type RatingDimension = "overall" | "technician" | "timeliness" | "quality";

export const RATING_DIMENSIONS: {
  key: RatingDimension;
  field: keyof Pick<
    WorkOrderServiceRating,
    "overall_rating" | "technician_rating" | "timeliness_rating" | "quality_rating"
  >;
  label: string;
  required?: boolean;
}[] = [
  { key: "overall", field: "overall_rating", label: "Overall Experience", required: true },
  { key: "technician", field: "technician_rating", label: "Technician Service" },
  { key: "timeliness", field: "timeliness_rating", label: "Timeliness" },
  { key: "quality", field: "quality_rating", label: "Work Quality" },
];

export type ServiceRatingFormState = {
  overall_rating: number;
  technician_rating: number;
  timeliness_rating: number;
  quality_rating: number;
  comments: string;
};

export const EMPTY_RATING_FORM: ServiceRatingFormState = {
  overall_rating: 0,
  technician_rating: 0,
  timeliness_rating: 0,
  quality_rating: 0,
  comments: "",
};

export function canRateWorkOrder(status: string): boolean {
  return status === "Completed" || status === "Closed";
}

export function isValidStarValue(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

export function validateServiceRatingForm(form: ServiceRatingFormState): string | null {
  if (!isValidStarValue(form.overall_rating)) {
    return "Please rate your overall experience.";
  }
  if (form.technician_rating !== 0 && !isValidStarValue(form.technician_rating)) {
    return "Technician Service must be between 1 and 5 stars.";
  }
  if (form.timeliness_rating !== 0 && !isValidStarValue(form.timeliness_rating)) {
    return "Timeliness must be between 1 and 5 stars.";
  }
  if (form.quality_rating !== 0 && !isValidStarValue(form.quality_rating)) {
    return "Work Quality must be between 1 and 5 stars.";
  }
  return null;
}

export function averageRating(rating: Pick<
  WorkOrderServiceRating,
  "overall_rating" | "technician_rating" | "timeliness_rating" | "quality_rating"
>): number {
  const values = [
    rating.overall_rating,
    rating.technician_rating,
    rating.timeliness_rating,
    rating.quality_rating,
  ].filter((v): v is number => v != null && v > 0);
  if (values.length === 0) return rating.overall_rating;
  const sum = values.reduce((s, v) => s + v, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export function formatRatingAverage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function ratingInsertPayload(
  workOrderId: string,
  customerId: string,
  submittedBy: string,
  form: ServiceRatingFormState,
) {
  return {
    work_order_id: workOrderId,
    customer_id: customerId,
    submitted_by: submittedBy,
    overall_rating: form.overall_rating,
    technician_rating: form.technician_rating > 0 ? form.technician_rating : null,
    timeliness_rating: form.timeliness_rating > 0 ? form.timeliness_rating : null,
    quality_rating: form.quality_rating > 0 ? form.quality_rating : null,
    comments: form.comments.trim() || null,
  };
}

export type ServiceHistoryRating = Pick<
  WorkOrderServiceRating,
  | "id"
  | "work_order_id"
  | "overall_rating"
  | "technician_rating"
  | "timeliness_rating"
  | "quality_rating"
  | "comments"
  | "created_at"
>;

export function normalizeWorkOrderRating(
  wo: Pick<ServiceHistoryWorkOrder, "work_order_service_ratings">,
): ServiceHistoryRating | null {
  const raw = wo.work_order_service_ratings;
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

export function isWorkOrderUnrated(wo: ServiceHistoryWorkOrder): boolean {
  return canRateWorkOrder(wo.status) && !normalizeWorkOrderRating(wo);
}

/** True when the customer should be prompted to rate this visit. */
export function shouldPromptForRating(wo: ServiceHistoryWorkOrder): boolean {
  return isWorkOrderUnrated(wo);
}

export function sortUnratedWorkOrders(workOrders: ServiceHistoryWorkOrder[]): ServiceHistoryWorkOrder[] {
  return [...workOrders].sort((a, b) => {
    const aDate = a.completion_date ?? a.created_at ?? "";
    const bDate = b.completion_date ?? b.created_at ?? "";
    return bDate.localeCompare(aDate);
  });
}

export function filterUnratedWorkOrders(workOrders: ServiceHistoryWorkOrder[]): ServiceHistoryWorkOrder[] {
  return sortUnratedWorkOrders(workOrders.filter(isWorkOrderUnrated));
}

/**
 * Loads completed/closed visits that still need a customer rating.
 * Cross-checks nested join data against the ratings table so already-rated
 * visits are never returned, even if the embed is stale or empty.
 */
export async function fetchUnratedCompletedWorkOrders(
  supabase: SupabaseClient,
  customerId: string,
): Promise<ServiceHistoryWorkOrder[]> {
  const [workOrdersResult, ratingsResult] = await Promise.all([
    supabase
      .from("work_orders")
      .select(UNRATED_RATING_SELECT)
      .eq("customer_id", customerId)
      .in("status", [...UNRATED_COMPLETED_STATUSES])
      .order("created_at", { ascending: false }),
    supabase
      .from("work_order_service_ratings")
      .select("work_order_id")
      .eq("customer_id", customerId),
  ]);

  if (workOrdersResult.error) {
    return [];
  }

  const ratedWorkOrderIds = new Set(
    (ratingsResult.data ?? []).map((row) => row.work_order_id as string),
  );

  return filterUnratedWorkOrders((workOrdersResult.data as ServiceHistoryWorkOrder[]) ?? []).filter(
    (wo) => !ratedWorkOrderIds.has(wo.id),
  );
}
