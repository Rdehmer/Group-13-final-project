"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FormRow } from "@/components/PageHeader";
import { formatCustomerPhone } from "@/lib/technician-field";
import {
  buildCustomerContactPayload,
  customerContactFormFromCustomer,
  validateCustomerContactForm,
  type CustomerContactFields,
  type CustomerContactForm,
} from "@/lib/customer-contact";

type Props = {
  contact: CustomerContactFields;
  onUpdated: (contact: CustomerContactFields) => void;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export function ContactInformationCard({ contact, onUpdated }: Props) {
  const supabase = createClient();
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState<CustomerContactForm>(() => customerContactFormFromCustomer(contact));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEdit() {
    setForm(customerContactFormFromCustomer(contact));
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
    const validationError = validateCustomerContactForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("update_my_contact_info", {
      p_primary_contact_name: form.primary_contact_name,
      p_email: form.email,
      p_phone: form.phone,
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    onUpdated(buildCustomerContactPayload(form));
    setShowEdit(false);
    setBusy(false);
  }

  return (
    <>
      <div className="card bg-base-100 shadow">
        <div className="card-body gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-box bg-primary/10 p-2.5 text-primary">
                <Mail className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <h2 className="card-title text-base">Contact information</h2>
                <p className="text-sm opacity-70">
                  Who EquipmentIQ should reach for scheduling and account questions.
                </p>
              </div>
            </div>
            <button type="button" className="btn btn-outline btn-sm shrink-0" onClick={openEdit}>
              Edit contact
            </button>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <DetailRow
              label="Primary contact"
              value={contact.primary_contact_name?.trim() || "Not on file"}
            />
            <DetailRow label="Account email" value={contact.email?.trim() || "Not on file"} />
            <DetailRow
              label="Phone"
              value={
                contact.phone?.trim() ? formatCustomerPhone(contact.phone) : "Not on file"
              }
            />
          </dl>
        </div>
      </div>

      {showEdit ? (
        <dialog className="modal modal-open" aria-labelledby="contact-info-title">
          <div className="modal-box max-w-lg">
            <h3 id="contact-info-title" className="text-lg font-bold">
              Edit contact information
            </h3>
            <p className="mt-1 text-sm opacity-70">
              Updates here are saved to your EquipmentIQ account record for our team to use.
            </p>
            {error ? (
              <div role="alert" className="alert alert-error mt-3 text-sm">
                <span>{error}</span>
              </div>
            ) : null}
            <form onSubmit={(e) => void handleSave(e)} className="mt-4 space-y-3">
              <FormRow label="Primary contact">
                <input
                  className="input input-bordered w-full"
                  value={form.primary_contact_name}
                  onChange={(e) => setForm({ ...form, primary_contact_name: e.target.value })}
                  autoComplete="name"
                />
              </FormRow>
              <FormRow label="Account email">
                <input
                  type="email"
                  className="input input-bordered w-full"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                />
              </FormRow>
              <FormRow label="Phone">
                <input
                  type="tel"
                  className="input input-bordered w-full"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  autoComplete="tel"
                />
              </FormRow>
              <div className="modal-action">
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeEdit} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  {busy ? "Saving…" : "Save contact"}
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
