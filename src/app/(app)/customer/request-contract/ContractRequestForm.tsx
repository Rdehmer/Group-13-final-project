"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AddEquipmentModal } from "@/components/AddEquipmentModal";
import { logActivity } from "@/lib/activity";
import {
  applyTierToFormState,
  BILLING_METHODS,
  buildContractSubmission,
  CONTRACT_TYPE_HELP,
  CONTRACT_TYPES,
  defaultContractFormState,
  EMERGENCY_SLA_OPTIONS,
  getContractTier,
  PAYMENT_TERMS,
  RENEWAL_OPTIONS,
  SERVICE_FREQUENCIES,
  type ContractRequestFormState,
  type ContractTierId,
} from "@/lib/contracts";
import { FormRow } from "@/components/PageHeader";
import type { Equipment } from "@/lib/types";

type Props = {
  supabase: SupabaseClient;
  customerId: string;
  equipment: Equipment[];
  selectedTier: ContractTierId;
  onSuccess: () => void;
  onEquipmentAdded?: (equipment: Equipment) => void;
};

const STEPS = ["Agreement", "Equipment", "Service scope", "Billing"] as const;
const BILLING_STEP = STEPS.length - 1;

export function ContractRequestForm({
  supabase,
  customerId,
  equipment,
  selectedTier,
  onSuccess,
  onEquipmentAdded,
}: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ContractRequestFormState>(() =>
    applyTierToFormState("silver", defaultContractFormState()),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const submitIntentRef = useRef(false);
  const tierRef = useRef(selectedTier);

  useEffect(() => {
    if (tierRef.current === selectedTier) return;
    tierRef.current = selectedTier;
    setForm((prev) => applyTierToFormState(selectedTier, prev));
  }, [selectedTier]);

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
    if (currentStep === BILLING_STEP && form.equipment_ids.length === 0) {
      return "Select at least one piece of equipment to cover.";
    }
    return null;
  }

  function nextStep() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(null);
    submitIntentRef.current = false;
    window.setTimeout(() => {
      setStep((s) => Math.min(s + 1, BILLING_STEP));
    }, 0);
  }

  function goBack() {
    setError(null);
    submitIntentRef.current = false;
    setStep((s) => s - 1);
  }

  async function submitContract() {
    if (!submitIntentRef.current) return;
    submitIntentRef.current = false;

    const err = validateStep(BILLING_STEP);
    if (err) { setError(err); return; }
    if (form.equipment_ids.length === 0) {
      setError("Select at least one piece of equipment to cover.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

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
    }).catch(() => {
      /* activity log is best-effort; contract submission already succeeded */
    });

    setBusy(false);
    onSuccess();
  }

  function handleSubmitClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    submitIntentRef.current = true;
    void submitContract();
  }

  function handleFormKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  }

  const onBillingStep = step === BILLING_STEP;
  const activeTier = getContractTier(selectedTier);

  return (
    <div>
      <ul className="steps steps-horizontal mb-6 w-full text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className={`step ${i <= step ? "step-primary" : ""}`}>{label}</li>
        ))}
      </ul>

      {error ? <div role="alert" className="alert alert-error mb-4 text-sm"><span>{error}</span></div> : null}
      {message ? <div role="alert" className="alert alert-success mb-4 text-sm"><span>{message}</span></div> : null}

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
              <p className="text-sm opacity-70">No equipment registered yet. Add equipment below to include it in your contract.</p>
            ) : (
              <FormRow label="Equipment covered" required>
                <ul className="space-y-2 rounded-box bg-base-200 p-3">
                  {equipment.map((eq) => (
                    <li key={eq.id}>
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={form.equipment_ids.includes(eq.id)}
                          onChange={() => toggleEquipment(eq.id)}
                        />
                        <span className="text-sm">{eq.name}</span>
                        <span className="text-xs opacity-60">{eq.category ?? ""}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </FormRow>
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
            <FormRow label="Notes">
              <textarea className="textarea textarea-bordered w-full" rows={2} value={form.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Site access, hours, or other details" />
            </FormRow>
          </>
        ) : null}

        {onBillingStep ? (
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
              Review your billing preferences, then click Submit Contract Request when you are ready.
              {form.equipment_ids.length === 0 ? (
                <span className="mt-1 block text-warning">
                  Go back to the Equipment step and select at least one item to cover.
                </span>
              ) : null}
            </p>
          </>
        ) : null}

        <div className="flex gap-2 pt-2">
          {step > 0 ? (
            <button type="button" className="btn btn-sm" onClick={goBack} disabled={busy}>
              Back
            </button>
          ) : null}
          <button
            type="button"
            className={`btn btn-primary btn-sm ${onBillingStep ? "hidden pointer-events-none" : ""}`}
            onClick={nextStep}
            disabled={busy}
            tabIndex={onBillingStep ? -1 : 0}
            aria-hidden={onBillingStep}
          >
            Next
          </button>
          <button
            type="button"
            className={`btn btn-primary btn-sm ${onBillingStep ? "" : "hidden pointer-events-none"}`}
            disabled={busy || form.equipment_ids.length === 0}
            onClick={handleSubmitClick}
            tabIndex={onBillingStep ? 0 : -1}
            aria-hidden={!onBillingStep}
          >
            {busy ? "Submitting…" : "Submit Contract Request"}
          </button>
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
  );
}
