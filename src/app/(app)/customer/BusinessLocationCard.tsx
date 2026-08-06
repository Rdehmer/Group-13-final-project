"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FormRow } from "@/components/PageHeader";
import {
  customerAddressFormFromCustomer,
  emptyCustomerAddressForm,
  formatCustomerAddress,
  hasCustomerAddress,
  type CustomerAddressFields,
  type CustomerAddressForm,
} from "@/lib/customer-address";

type Props = {
  address: CustomerAddressFields;
  onUpdated: (address: CustomerAddressFields) => void;
};

export function BusinessLocationCard({ address, onUpdated }: Props) {
  const supabase = createClient();
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState<CustomerAddressForm>(() => customerAddressFormFromCustomer(address));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEdit() {
    setForm(customerAddressFormFromCustomer(address));
    setError(null);
    setShowEdit(true);
  }

  function closeEdit() {
    if (!busy) {
      setShowEdit(false);
      setError(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("update_my_business_address", {
      p_service_address: form.service_address,
      p_billing_address: form.billing_address,
      p_city: form.city,
      p_state: form.state,
      p_zip_code: form.zip_code,
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    const updated: CustomerAddressFields = {
      service_address: form.service_address.trim() || null,
      billing_address: form.billing_address.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      zip_code: form.zip_code.trim() || null,
    };
    onUpdated(updated);
    setShowEdit(false);
    setBusy(false);
  }

  return (
    <>
      <div className="card bg-base-100 shadow">
        <div className="card-body gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-box bg-primary/10 p-2 text-primary">
                <MapPin className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <h2 className="card-title text-base">Business location</h2>
                <p className="text-sm opacity-70">
                  Where our technicians should arrive for service visits.
                </p>
              </div>
            </div>
            <button type="button" className="btn btn-outline btn-sm shrink-0" onClick={openEdit}>
              Edit address
            </button>
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed">
            {hasCustomerAddress(address)
              ? formatCustomerAddress(address)
              : "No business address on file yet. Add one so EquipmentIQ knows where to send your technician."}
          </p>
        </div>
      </div>

      {showEdit ? (
        <dialog className="modal modal-open" aria-labelledby="business-location-title">
          <div className="modal-box max-w-lg">
            <h3 id="business-location-title" className="text-lg font-bold">
              Edit business location
            </h3>
            <p className="mt-1 text-sm opacity-70">
              This is the address our team uses for scheduling and on-site visits.
            </p>
            {error ? (
              <div role="alert" className="alert alert-error mt-3 text-sm">
                <span>{error}</span>
              </div>
            ) : null}
            <form onSubmit={(e) => void handleSave(e)} className="mt-4 space-y-3">
              <FormRow label="Street address">
                <input
                  className="input input-bordered w-full"
                  value={form.service_address}
                  onChange={(e) => setForm({ ...form, service_address: e.target.value })}
                  autoComplete="street-address"
                />
              </FormRow>
              <FormRow label="Address line 2">
                <input
                  className="input input-bordered w-full"
                  value={form.billing_address}
                  onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
                  placeholder="Suite, unit, building (optional)"
                />
              </FormRow>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormRow label="City">
                  <input
                    className="input input-bordered w-full"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </FormRow>
                <FormRow label="State / Province">
                  <input
                    className="input input-bordered w-full"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                  />
                </FormRow>
              </div>
              <FormRow label="ZIP / Postal code">
                <input
                  className="input input-bordered w-full"
                  value={form.zip_code}
                  onChange={(e) => setForm({ ...form, zip_code: e.target.value })}
                />
              </FormRow>
              <div className="modal-action">
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeEdit} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  {busy ? "Saving…" : "Save address"}
                </button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={closeEdit}>
              close
            </button>
          </form>
        </dialog>
      ) : null}
    </>
  );
}

export function emptyBusinessLocationAddress(): CustomerAddressFields {
  return {
    ...emptyCustomerAddressForm(),
    service_address: null,
    billing_address: null,
    city: null,
    state: null,
    zip_code: null,
    region: null,
    country: null,
  };
}
