"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";
import { formatServiceDate } from "@/lib/invoices";
import type { ServiceHistoryWorkOrder } from "@/lib/invoices";
import {
  EMPTY_RATING_FORM,
  isWorkOrderUnrated,
  RATING_DIMENSIONS,
  ratingInsertPayload,
  type ServiceRatingFormState,
  validateServiceRatingForm,
} from "@/lib/service-ratings";
import type { WorkOrderServiceRating } from "@/lib/types";
import { StarRatingInput } from "@/components/StarRatingInput";

type Props = {
  open: boolean;
  required?: boolean;
  supabase: SupabaseClient;
  customerId: string;
  workOrder: ServiceHistoryWorkOrder;
  onClose: () => void;
  onSubmitted: (rating: WorkOrderServiceRating) => void;
  onAlreadyRated?: () => void;
};

function fieldKeyForDimension(field: (typeof RATING_DIMENSIONS)[number]["field"]): keyof ServiceRatingFormState {
  switch (field) {
    case "overall_rating":
      return "overall_rating";
    case "technician_rating":
      return "technician_rating";
    case "timeliness_rating":
      return "timeliness_rating";
    case "quality_rating":
      return "quality_rating";
  }
}

export function RateServiceModal({
  open,
  required = false,
  supabase,
  customerId,
  workOrder,
  onClose,
  onSubmitted,
  onAlreadyRated,
}: Props) {
  const [form, setForm] = useState<ServiceRatingFormState>(EMPTY_RATING_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_RATING_FORM);
    setError(null);
    setBusy(false);
    setSubmitted(false);
  }, [open, workOrder.id]);

  useEffect(() => {
    if (!open || isWorkOrderUnrated(workOrder)) return;
    onAlreadyRated?.();
  }, [open, onAlreadyRated, workOrder]);

  useEffect(() => {
    if (!submitted || required) return;
    const timer = window.setTimeout(() => {
      onClose();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [submitted, required, onClose]);

  if (!open) return null;

  function handleClose() {
    if (busy) return;
    if (required && !submitted) return;
    onClose();
  }

  function updateField(key: keyof ServiceRatingFormState, value: ServiceRatingFormState[typeof key]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  async function handleSubmit() {
    const problem = validateServiceRatingForm(form);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload = ratingInsertPayload(workOrder.id, customerId, user?.id ?? "", form);

    const { data, error: insertError } = await supabase
      .from("work_order_service_ratings")
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        onAlreadyRated?.();
      }
      setError(
        insertError.code === "23505"
          ? "You have already rated this visit."
          : insertError.message.includes("permission") || insertError.code === "42501"
            ? "Unable to submit rating. Please contact EquipmentIQ."
            : insertError.message,
      );
      setBusy(false);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "service_rated",
      recordType: "work_order",
      recordId: workOrder.id,
      newValue: String(form.overall_rating),
    }).catch(() => {});

    setSubmitted(true);
    setBusy(false);
    onSubmitted(data as WorkOrderServiceRating);
  }

  const completionLabel = workOrder.completion_date
    ? formatServiceDate(workOrder.completion_date)
    : null;

  return (
    <dialog className="modal modal-open" aria-labelledby="rate-service-title">
      <div className="modal-box flex max-h-[92vh] w-full max-w-lg flex-col border border-base-300 p-0 shadow-xl">
        <div className="border-b border-base-200 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-box bg-primary/10 p-2.5 text-primary">
              <Star className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="rate-service-title" className="text-xl font-semibold tracking-tight">
                Rate Your Service
              </h3>
              <p className="mt-1 text-sm leading-relaxed opacity-70">
                {workOrder.work_order_number}
                {workOrder.equipment?.name ? ` · ${workOrder.equipment.name}` : ""}
                {completionLabel ? ` · Completed ${completionLabel}` : ""}
              </p>
            </div>
          </div>
        </div>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/20 text-success">
              <Star className="h-7 w-7 fill-current" />
            </div>
            <div>
              <p className="text-lg font-semibold">Thank You for Your Feedback</p>
              <p className="mt-1 text-sm opacity-70">
                Your rating helps EquipmentIQ improve every visit.
              </p>
            </div>
            <button type="button" className="btn btn-primary btn-sm mt-2" onClick={handleClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
              <div className="rounded-box border border-base-300 bg-base-200/40 p-4 text-sm">
                <p className="font-medium">{workOrder.work_order_type}</p>
                <p className="mt-1 opacity-70">
                  {workOrder.problem_description?.trim() ||
                    "Tell us how this service visit went."}
                </p>
              </div>

              <p className="text-sm opacity-70">
                {required ? (
                  <>Please submit your rating to continue using the portal. Only <strong>Overall Experience</strong> is required.</>
                ) : (
                  <>Tap the stars that apply. Only <strong>Overall Experience</strong> is required.</>
                )}
              </p>

              <div className="space-y-4">
                {RATING_DIMENSIONS.map((dimension) => {
                  const fieldKey = fieldKeyForDimension(dimension.field);
                  return (
                    <StarRatingInput
                      key={dimension.key}
                      id={`rate-${dimension.key}`}
                      label={dimension.label}
                      required={dimension.required}
                      value={form[fieldKey] as number}
                      onChange={(value) => updateField(fieldKey, value)}
                      disabled={busy}
                    />
                  );
                })}
              </div>

              <label className="form-control w-full gap-2">
                <span className="text-sm font-medium">Additional Feedback (Optional)</span>
                <textarea
                  className="textarea textarea-bordered w-full"
                  rows={3}
                  placeholder="Tell us what went well or what we could improve…"
                  value={form.comments}
                  onChange={(e) => updateField("comments", e.target.value)}
                  disabled={busy}
                />
              </label>

              {error ? (
                <div role="alert" className="alert alert-error text-sm">
                  <span>{error}</span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-base-200 px-6 py-4">
              {!required ? (
                <button type="button" className="btn btn-ghost" onClick={handleClose} disabled={busy}>
                  Not Now
                </button>
              ) : null}
              <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={busy}>
                {busy ? "Submitting…" : "Submit Rating"}
              </button>
            </div>
          </>
        )}
      </div>
      {!required ? (
        <form method="dialog" className="modal-backdrop">
          <button type="button" aria-label="Close" onClick={handleClose} disabled={busy}>
            close
          </button>
        </form>
      ) : null}
    </dialog>
  );
}
