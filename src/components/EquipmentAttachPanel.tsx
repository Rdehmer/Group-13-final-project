"use client";

import { useState } from "react";
import { Plus, Cpu } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FormRow } from "@/components/PageHeader";
import { formatInstallDate, equipmentLabel } from "@/lib/equipment";
import type { Equipment } from "@/lib/types";

export type EquipmentOption = Pick<
  Equipment,
  | "id"
  | "name"
  | "model"
  | "serial_number"
  | "installation_date"
  | "manufacturer"
  | "location"
  | "operating_status"
  | "customer_id"
>;

/**
 * Attach known customer equipment to a job or invoice, or register a new unit
 * with model, serial number, and install date in one step.
 */
export function EquipmentAttachPanel({
  customerId,
  equipment,
  selectedId,
  onSelect,
  onCreated,
  disabled,
  required,
  compact,
}: {
  customerId: string;
  equipment: EquipmentOption[];
  selectedId: string;
  onSelect: (equipmentId: string) => void;
  onCreated?: (row: EquipmentOption) => void;
  disabled?: boolean;
  required?: boolean;
  compact?: boolean;
}) {
  const supabase = createClient();
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    manufacturer: "",
    model: "",
    serial_number: "",
    installation_date: "",
    location: "",
    category: "",
  });

  const selected = equipment.find((e) => e.id === selectedId) ?? null;

  async function registerUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) {
      setError("Select a customer first.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      customer_id: customerId,
      name: draft.name.trim(),
      manufacturer: draft.manufacturer.trim() || null,
      model: draft.model.trim() || null,
      serial_number: draft.serial_number.trim() || null,
      installation_date: draft.installation_date || null,
      location: draft.location.trim() || null,
      category: draft.category.trim() || null,
      operating_status: "Operational" as const,
    };
    const { data, error: insertError } = await supabase.from("equipment").insert(payload).select().single();
    if (insertError || !data) {
      setError(insertError?.message ?? "Could not register equipment");
      setBusy(false);
      return;
    }
    const row = data as EquipmentOption;
    onCreated?.(row);
    onSelect(row.id);
    setMode("pick");
    setDraft({
      name: "",
      manufacturer: "",
      model: "",
      serial_number: "",
      installation_date: "",
      location: "",
      category: "",
    });
    setBusy(false);
  }

  return (
    <div className={`rounded-box border border-base-300 bg-base-200/30 ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Cpu className="h-4 w-4 text-primary" />
          Equipment worked on
          {required ? <span className="text-error">*</span> : null}
        </div>
        {customerId && mode === "pick" ? (
          <button
            type="button"
            className="btn btn-ghost btn-xs gap-1"
            disabled={disabled || !customerId}
            onClick={() => setMode("new")}
          >
            <Plus className="h-3.5 w-3.5" /> Register unit
          </button>
        ) : null}
      </div>

      {!customerId ? (
        <p className="text-sm opacity-60">Select a customer to attach equipment by model and serial number.</p>
      ) : mode === "new" ? (
        <form onSubmit={registerUnit} className="space-y-2">
          <p className="text-xs opacity-60">
            Creates a unit on this customer with model, serial, and install date so jobs and invoices can track what was serviced.
          </p>
          {error ? <div className="alert alert-error py-2 text-xs">{error}</div> : null}
          <FormRow label="Unit name" required>
            <input
              className="input input-bordered input-sm w-full"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Walk-in freezer #2"
              required
              disabled={disabled || busy}
            />
          </FormRow>
          <div className="grid gap-2 sm:grid-cols-2">
            <FormRow label="Manufacturer">
              <input
                className="input input-bordered input-sm w-full"
                value={draft.manufacturer}
                onChange={(e) => setDraft({ ...draft, manufacturer: e.target.value })}
                disabled={disabled || busy}
              />
            </FormRow>
            <FormRow label="Model" required>
              <input
                className="input input-bordered input-sm w-full"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="Model number"
                required
                disabled={disabled || busy}
              />
            </FormRow>
            <FormRow label="Serial number" required>
              <input
                className="input input-bordered input-sm w-full"
                value={draft.serial_number}
                onChange={(e) => setDraft({ ...draft, serial_number: e.target.value })}
                placeholder="Serial #"
                required
                disabled={disabled || busy}
              />
            </FormRow>
            <FormRow label="Install date">
              <input
                type="date"
                className="input input-bordered input-sm w-full"
                value={draft.installation_date}
                onChange={(e) => setDraft({ ...draft, installation_date: e.target.value })}
                disabled={disabled || busy}
              />
            </FormRow>
            <FormRow label="Location">
              <input
                className="input input-bordered input-sm w-full"
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                placeholder="Kitchen, Roof, etc."
                disabled={disabled || busy}
              />
            </FormRow>
            <FormRow label="Category">
              <input
                className="input input-bordered input-sm w-full"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                placeholder="HVAC, Refrigeration…"
                disabled={disabled || busy}
              />
            </FormRow>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode("pick")}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? "Saving…" : "Save unit & attach"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <select
            className="select select-bordered select-sm w-full"
            value={selectedId}
            required={required}
            disabled={disabled || !customerId}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="">{required ? "Select equipment…" : "No equipment linked"}</option>
            {equipment.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {equipmentLabel(eq)}
              </option>
            ))}
          </select>
          {equipment.length === 0 ? (
            <p className="mt-2 text-xs opacity-60">
              No units on file for this customer. Use <strong>Register unit</strong> to add model, serial, and install date.
            </p>
          ) : null}
          {selected ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-3">
              <div>
                <dt className="opacity-50">Model</dt>
                <dd className="font-medium">{selected.model || "—"}</dd>
              </div>
              <div>
                <dt className="opacity-50">Serial #</dt>
                <dd className="font-medium font-mono">{selected.serial_number || "—"}</dd>
              </div>
              <div>
                <dt className="opacity-50">Install date</dt>
                <dd className="font-medium">{formatInstallDate(selected.installation_date)}</dd>
              </div>
              {selected.manufacturer ? (
                <div>
                  <dt className="opacity-50">Manufacturer</dt>
                  <dd className="font-medium">{selected.manufacturer}</dd>
                </div>
              ) : null}
              {selected.location ? (
                <div>
                  <dt className="opacity-50">Location</dt>
                  <dd className="font-medium">{selected.location}</dd>
                </div>
              ) : null}
              {selected.operating_status ? (
                <div>
                  <dt className="opacity-50">Status</dt>
                  <dd className="font-medium">{selected.operating_status}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Read-only equipment identity block for invoices / job summaries. */
export function EquipmentIdentityCard({
  equipment,
  emptyLabel = "No equipment linked",
}: {
  equipment: EquipmentOption | null | undefined;
  emptyLabel?: string;
}) {
  if (!equipment) {
    return <p className="text-sm opacity-60">{emptyLabel}</p>;
  }
  return (
    <div className="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{equipment.name}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
            <div>
              <dt className="opacity-50">Model</dt>
              <dd className="font-medium">{equipment.model || "—"}</dd>
            </div>
            <div>
              <dt className="opacity-50">Serial #</dt>
              <dd className="font-mono font-medium">{equipment.serial_number || "—"}</dd>
            </div>
            <div>
              <dt className="opacity-50">Install date</dt>
              <dd className="font-medium">{formatInstallDate(equipment.installation_date)}</dd>
            </div>
            {equipment.manufacturer ? (
              <div>
                <dt className="opacity-50">Manufacturer</dt>
                <dd className="font-medium">{equipment.manufacturer}</dd>
              </div>
            ) : null}
            {equipment.location ? (
              <div>
                <dt className="opacity-50">Site location</dt>
                <dd className="font-medium">{equipment.location}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
    </div>
  );
}
