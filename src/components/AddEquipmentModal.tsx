"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  installation_date: "",
};

export function AddEquipmentModal({ supabase, customerId, open, onClose, onAdded }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mounted, setMounted] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

  if (!open || !mounted) return null;

  function handleClose() {
    if (busy) return;
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const payload = {
      customer_id: customerId,
      name: form.name.trim(),
      category: form.category.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      location: form.location.trim() || null,
      installation_date: form.installation_date,
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
          ? "Unable to register equipment. Please contact EquipmentIQ."
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

  return createPortal(
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="register-equipment-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        onClick={handleClose}
        disabled={busy}
      />
      <div className="relative z-10 flex max-h-[min(90vh,48rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl">
        <div className="shrink-0 border-b border-base-200 px-6 py-5">
          <h3 id="register-equipment-title" className="text-lg font-bold">
            Register Equipment
          </h3>
          <p className="mt-1 text-sm opacity-70">
            Add commercial equipment to your account for service requests and contracts.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error ? (
            <div role="alert" className="alert alert-error mb-3 text-sm">
              <span>{error}</span>
            </div>
          ) : null}
          <form id="register-equipment-form" onSubmit={onSubmit} className="space-y-3">
            <FormRow label="Name" required>
              <input
                className="input input-bordered w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </FormRow>
            <FormRow label="Category">
              <input
                className="input input-bordered w-full"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Refrigeration"
              />
            </FormRow>
            <FormRow label="Manufacturer">
              <input
                className="input input-bordered w-full"
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
              />
            </FormRow>
            <FormRow label="Model">
              <input
                className="input input-bordered w-full"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </FormRow>
            <FormRow label="Serial #">
              <input
                className="input input-bordered w-full"
                value={form.serial_number}
                onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
              />
            </FormRow>
            <FormRow label="Location">
              <input
                className="input input-bordered w-full"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Warehouse A"
              />
            </FormRow>
            <FormRow label="Install date" required>
              <input
                type="date"
                className="input input-bordered w-full"
                value={form.installation_date}
                onChange={(e) => setForm({ ...form, installation_date: e.target.value })}
                required
              />
            </FormRow>
          </form>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-base-200 px-6 py-4">
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="register-equipment-form"
            className="btn btn-primary btn-sm"
            disabled={busy}
          >
            {busy ? "Saving…" : "Save Equipment"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
