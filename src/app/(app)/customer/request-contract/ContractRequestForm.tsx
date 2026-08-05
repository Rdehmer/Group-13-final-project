"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AddEquipmentModal } from "@/components/AddEquipmentModal";
import { logActivity } from "@/lib/activity";
import {
  applyTierToFormState,
  BILLING_METHODS,
  buildContractPreview,
  buildContractSubmission,
  clearContractDraft,
  CONTRACT_TYPE_HELP,
  CONTRACT_TYPES,
  defaultContractFormState,
  EMERGENCY_SLA_OPTIONS,
  findOverlappingEquipment,
  getContractTier,
  PAYMENT_TERMS,
  RENEWAL_OPTIONS,
  saveContractDraft,
  SERVICE_FREQUENCIES,
  type ContractRequestFormState,
  type ContractTierId,
  type CustomerContract,
} from "@/lib/contracts";
import { FormRow } from "@/components/PageHeader";
import type { Equipment } from "@/lib/types";
import { ContractRequestPreview } from "./ContractRequestPreview";

type Props = {
  supabase: SupabaseClient;
  customerId: string;
  equipment: Equipment[];
  activeContracts: CustomerContract[];
  selectedTier: ContractTierId;
  onSuccess: (contractName: string) => void;
  onEquipmentAdded?: (equipment: Equipment) => void;
};

const STEPS = ["Plan", "Equipment", "Coverage", "Billing", "Review"] as const;
const REVIEW_STEP = STEPS.length - 1;

export function ContractRequestForm({
  supabase,
  customerId,
  equipment,
  activeContracts,
  selectedTier,
  onSuccess,
  onEquipmentAdded,
}: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ContractRequestFormState>(() =>
    applyTierToFormState(selectedTier, defaultContractFormState()),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [customizeCoverage, setCustomizeCoverage] = useState(false);
  const submitIntentRef = useRef(false);
  const tierRef = useRef(selectedTier);

  useEffect(() => {
    if (tierRef.current === selectedTier) return;
    tierRef.current = selectedTier;
    setForm((prev) => applyTierToFormState(selectedTier, prev));
  }, [selectedTier]);

  useEffect(() => {
    saveContractDraft(customerId, { form, tierId: selectedTier, step });
  }, [customerId, form, selectedTier, step]);

  const preview = useMemo(
    () => buildContractPreview(form, selectedTier, equipment),
    [form, selectedTier, equipment],
  );

  const equipmentNames = useMemo(
    () => new Map(equipment.map((eq) => [eq.id, eq.name])),
    [equipment],
  );

  const overlaps = useMemo(
    () => findOverlappingEquipment(activeContracts, form.equipment_ids, equipmentNames),
    [activeContracts, form.equipment_ids, equipmentNames],
  );

  function update(patch: Partial<ContractRequestFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function toggleEquipment(id: string) {
    setForm((prev) => ({
      ...prev,
      equipment_ids: prev.equipment_ids.includes(id)
        ? prev.equipment_ids.filter((x) => x !== id)
        : [...prev.equipment_ids, id],
    }));
  }

  function selectAllEquipment() {
    setForm((prev) => ({
      ...prev,
      equipment_ids: equipment.map((eq) => eq.id),
    }));
  }

  function handleEquipmentAdded(item: Equipment) {
    onEquipmentAdded?.(item);
    setForm((prev) => ({
      ...prev,
      equipment_ids: prev.equipment_ids.includes(item.id)
        ? prev.equipment_ids
        : [...prev.equipment_ids, item.id],
    }));
  }

  function validateStep(currentStep = step): string | null {
    if (currentStep === 0) {
      if (!form.start_date || !form.end_date) return "Start and end dates are required.";
      if (form.end_date <= form.start_date) return "End date must be after start date.";
    }
    if (currentStep === 1 && form.equipment_ids.length === 0) {
      return "Select at least one piece of equipment to cover.";
    }
    if (currentStep === 2 && Number(form.included_service_visits) < 0) {
      return "Included service visits cannot be negative.";
    }
    if (currentStep >= 3 && form.equipment_ids.length === 0) {
      return "Select at least one piece of equipment to cover.";
    }
    return null;
  }

  function nextStep() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(null);
    submitIntentRef.current = false;
    setStep((s) => Math.min(s + 1, REVIEW_STEP));
  }

  function goBack() {
    setError(null);
    submitIntentRef.current = false;
    setStep((s) => s - 1);
  }

  async function submitContract() {
    if (!submitIntentRef.current) return;
    submitIntentRef.current = false;

    const err = validateStep(REVIEW_STEP);
    if (err) { setError(err); return; }

    setBusy(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const payload = buildContractSubmission({
      customerId,
      userId: user?.id ?? null,
      form,
      tierId: selectedTier,
    });

    const { data: contract, error: insertError } = await supabase
      .from("service_contracts")
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      setError(
        insertError.message.includes("permission") || insertError.code === "42501"
          ? "Unable to submit contract request. Please contact Ridley Equipment Services."
          : insertError.message,
      );
      setBusy(false);
      return;
    }

    const equipmentRows = form.equipment_ids.map((equipment_id) => ({
      contract_id: contract.id,
      equipment_id,
    }));

    const { error: linkError } = await supabase.from("contract_equipment").insert(equipmentRows);
    if (linkError) {
      setError(linkError.message);
      setBusy(false);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "contract_requested",
      recordType: "contract",
      recordId: contract.id,
      newValue: payload.name,
    }).catch(() => {});

    clearContractDraft(customerId);
    setBusy(false);
    onSuccess(payload.name);
  }

  function handleSubmitClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    submitIntentRef.current = true;
    void submitContract();
  }

  function handleFormKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") e.preventDefault();
  }

  const onReviewStep = step === REVIEW_STEP;
  const activeTier = getContractTier(selectedTier);

  return (
    <div className="lg:grid lg:grid-cols-3 lg:gap-6">
      <div className="lg:col-span-2">
        <ul className="steps steps-horizontal mb-6 w-full text-xs">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={`step ${i <= step ? "step-primary" : ""}`}
              aria-current={i === step ? "step" : undefined}
            >
              {label}
            </li>
          ))}
        </ul>

        {error ? (
          <div role="alert" className="alert alert-error mb-4 text-sm"><span>{error}</span></div>
        ) : null}

        {overlaps.length > 0 ? (
          <div role="status" className="alert alert-warning mb-4 text-sm">
            <span>
              {overlaps.map((o) => (
                <span key={o.equipmentId} className="block">
                  {o.equipmentName} is already covered by {o.contractName}.
                </span>
              ))}
              You can still submit, or contact Ridley to amend your existing agreement.
            </span>
          </div>
        ) : null}

        <div className="space-y-3" onKeyDown={handleFormKeyDown}>
          {step === 0 ? (
            <>
              <div className="rounded-box bg-base-200 px-4 py-3 text-sm">
                <span className="font-medium">Selected plan:</span>{" "}
                {activeTier.name} — {activeTier.tagline}
              </div>
              <FormRow label="Contract type" required>
                <select
                  className="select select-bordered w-full"
                  value={form.contract_type}
                  onChange={(e) => update({ contract_type: e.target.value })}
                  required
                >
                  {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <p className="mt-1 text-xs opacity-70">{CONTRACT_TYPE_HELP[form.contract_type]}</p>
              </FormRow>
              <FormRow label="Start date" required>
                <input type="date" className="input input-bordered w-full" value={form.start_date} onChange={(e) => update({ start_date: e.target.value })} required />
              </FormRow>
              <FormRow label="End date" required>
                <input type="date" className="input input-bordered w-full" value={form.end_date} onChange={(e) => update({ end_date: e.target.value })} required />
              </FormRow>
              <FormRow label="Renewal preference">
                <select className="select select-bordered w-full" value={form.renewal_option} onChange={(e) => update({ renewal_option: e.target.value })}>
                  {RENEWAL_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </FormRow>
            </>
          ) : null}

          {step === 1 ? (
            <>
              {equipment.length === 0 ? (
                <div className="rounded-box border border-dashed border-base-300 p-6 text-center">
                  <p className="text-sm opacity-70">Register your units first so we know what to cover.</p>
                  <button type="button" className="btn btn-primary btn-sm mt-3" onClick={() => setShowAddEquipment(true)}>
                    Add Equipment
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Select equipment to cover</p>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={selectAllEquipment}>
                      Select all
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {equipment.map((eq) => (
                      <li key={eq.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-box bg-base-200 p-3">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={form.equipment_ids.includes(eq.id)}
                            onChange={() => toggleEquipment(eq.id)}
                          />
                          <div className="flex-1 text-sm">
                            <p className="font-medium">{eq.name}</p>
                            <p className="opacity-60">
                              {[eq.category, eq.location].filter(Boolean).join(" · ") || "No details on file"}
                            </p>
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="flex justify-end pt-1">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAddEquipment(true)}>
                  Add Equipment
                </button>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="rounded-box bg-base-200/60 p-4">
                <p className="text-sm font-medium">{activeTier.name} coverage includes:</p>
                <ul className="mt-3 space-y-1.5 text-sm opacity-80">
                  {activeTier.coverages.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-primary">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs opacity-60">{preview.coverageSummary}</p>
              </div>

              <FormRow label="Site notes">
                <textarea className="textarea textarea-bordered w-full" rows={2} value={form.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Site access, hours, dock info, or other details" />
              </FormRow>

              <div>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setCustomizeCoverage((v) => !v)}
                >
                  {customizeCoverage ? "Hide customize coverage" : "Customize coverage details"}
                </button>
              </div>

              {customizeCoverage ? (
                <div className="space-y-3 rounded-box border border-base-300 p-4">
                  <FormRow label="Included visits / year">
                    <input type="number" min="0" className="input input-bordered w-full" value={form.included_service_visits} onChange={(e) => update({ included_service_visits: e.target.value })} />
                  </FormRow>
                  <FormRow label="Service frequency">
                    <select className="select select-bordered w-full" value={form.service_frequency} onChange={(e) => update({ service_frequency: e.target.value })}>
                      {SERVICE_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </FormRow>
                  <FormRow label="Included labor hours">
                    <input type="number" min="0" step="0.5" className="input input-bordered w-full" value={form.included_labor_hours} onChange={(e) => update({ included_labor_hours: e.target.value })} />
                  </FormRow>
                  <FormRow label="Parts allowance ($)">
                    <input type="number" min="0" step="0.01" className="input input-bordered w-full" value={form.included_replacement_parts} onChange={(e) => update({ included_replacement_parts: e.target.value })} />
                  </FormRow>
                  <FormRow label="Emergency response">
                    <select className="select select-bordered w-full" value={form.emergency_response_commitment} onChange={(e) => update({ emergency_response_commitment: e.target.value })}>
                      {EMERGENCY_SLA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </FormRow>
                  <FormRow label="Approval requirements">
                    <textarea className="textarea textarea-bordered w-full" rows={2} value={form.approval_requirements} onChange={(e) => update({ approval_requirements: e.target.value })} placeholder="e.g. PO required before dispatch" />
                  </FormRow>
                </div>
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <FormRow label="Billing method">
                <select className="select select-bordered w-full" value={form.billing_method} onChange={(e) => update({ billing_method: e.target.value })}>
                  {BILLING_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </FormRow>
              <FormRow label="Payment terms">
                <select className="select select-bordered w-full" value={form.payment_terms} onChange={(e) => update({ payment_terms: e.target.value })}>
                  {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormRow>
              <p className="text-xs opacity-70">
                Ridley will confirm final pricing before your agreement is activated.
              </p>
            </>
          ) : null}

          {onReviewStep ? (
            <ContractRequestPreview preview={preview} compact />
          ) : null}

          <div className="flex gap-2 pt-2">
            {step > 0 ? (
              <button type="button" className="btn btn-sm" onClick={goBack} disabled={busy}>
                Back
              </button>
            ) : null}
            {!onReviewStep ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={nextStep} disabled={busy}>
                Next
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy || form.equipment_ids.length === 0}
                onClick={handleSubmitClick}
              >
                {busy ? "Submitting…" : "Submit Contract Request"}
              </button>
            )}
          </div>
        </div>

        <AddEquipmentModal
          supabase={supabase}
          customerId={customerId}
          open={showAddEquipment}
          onClose={() => setShowAddEquipment(false)}
          onAdded={handleEquipmentAdded}
        />
      </div>

      <div className="hidden lg:col-span-1 lg:block">
        <div className="sticky top-24">
          <ContractRequestPreview preview={preview} />
        </div>
      </div>
    </div>
  );
}
