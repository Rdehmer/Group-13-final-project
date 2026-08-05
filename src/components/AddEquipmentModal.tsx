"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";
import { FormRow } from "@/components/PageHeader";
import type { Equipment } from "@/lib/types";

type Props = {
  supabase: SupabaseClient;
  customerId: string;
  open: boolean;
  onClose: () => void;
  onAdded: (equipment: Equipment) => void;
};

const EMPTY_FORM = {
  name: "",
  category: "",
  manufacturer: "",
  model: "",
  serial_number: "",
  location: "",
};

export function AddEquipmentModal({ supabase, customerId, open, onClose, onAdded }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function handleClose() {
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      customer_id: customerId,
      name: form.name.trim(),
      category: form.category.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      location: form.location.trim() || null,
      operating_status: "Operational" as const,
      warranty_status: "Unknown" as const,
    };

    const { data, error: insertError } = await supabase
      .from("equipment")
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      setError(
        insertError.message.includes("permission") || insertError.code === "42501"
          ? "Unable to register equipment. Please contact Ridley Equipment Services."
          : insertError.message,
      );
      setBusy(false);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "equipment_registered",
      recordType: "equipment",
      recordId: data.id,
      newValue: payload.name,
    });

    onAdded(data as Equipment);
    setForm(EMPTY_FORM);
    setBusy(false);
    onClose();
  }

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-lg">
        <h3 className="text-lg font-bold">Register Equipment</h3>
        <p className="mt-1 text-sm opacity-70">Add commercial equipment to your account for service requests and contracts.</p>
        {error ? <div role="alert" className="alert alert-error mt-3 text-sm"><span>{error}</span></div> : null}
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <FormRow label="Name" required>
            <input className="input input-bordered w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </FormRow>
          <FormRow label="Category">
            <input className="input input-bordered w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Refrigeration" />
          </FormRow>
          <FormRow label="Manufacturer">
            <input className="input input-bordered w-full" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
          </FormRow>
          <FormRow label="Model">
            <input className="input input-bordered w-full" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </FormRow>
          <FormRow label="Serial #">
            <input className="input input-bordered w-full" value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
          </FormRow>
          <FormRow label="Location">
            <input className="input input-bordered w-full" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Warehouse A" />
          </FormRow>
          <div className="modal-action">
            <button type="button" className="btn" onClick={handleClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save Equipment"}</button>
          </div>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={handleClose}>close</button>
      </form>
    </dialog>
  );
}
