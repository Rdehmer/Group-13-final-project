"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusBadge, statusTone, EmptyState } from "@/components/ui";
import type { Customer, Equipment, Profile } from "@/lib/types";

type EquipmentDetail = Equipment & { customers?: { id: string; name: string } | null };

/**
 * This business faces stale equipment master-data risk.
 * Our app reduces the risk by letting managers edit equipment details on the detail page.
 */
export default function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<EquipmentDetail | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: "",
    name: "",
    category: "",
    manufacturer: "",
    model: "",
    serial_number: "",
    location: "",
    operating_status: "Operational" as Equipment["operating_status"],
    warranty_status: "Unknown" as Equipment["warranty_status"],
    installation_date: "",
    last_service_date: "",
    next_scheduled_service_date: "",
    warranty_expiration_date: "",
    notes: "",
  });

  const isManager = profile?.role === "service_manager";

  async function load() {
    setLoading(true);
    const [{ data }, { data: cust }, { data: { user } }] = await Promise.all([
      supabase.from("equipment").select("*, customers(id, name)").eq("id", id).single(),
      supabase.from("customers").select("*").order("name"),
      supabase.auth.getUser(),
    ]);
    const eq = data as EquipmentDetail | null;
    setEquipment(eq);
    setCustomers((cust as Customer[]) ?? []);
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
    }
    if (eq) {
      setForm({
        customer_id: eq.customer_id,
        name: eq.name,
        category: eq.category ?? "",
        manufacturer: eq.manufacturer ?? "",
        model: eq.model ?? "",
        serial_number: eq.serial_number ?? "",
        location: eq.location ?? "",
        operating_status: eq.operating_status,
        warranty_status: eq.warranty_status,
        installation_date: eq.installation_date ?? "",
        last_service_date: eq.last_service_date ?? "",
        next_scheduled_service_date: eq.next_scheduled_service_date ?? "",
        warranty_expiration_date: eq.warranty_expiration_date ?? "",
        notes: eq.notes ?? "",
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager || !equipment) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const payload = {
      customer_id: form.customer_id,
      name: form.name.trim(),
      category: form.category.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      location: form.location.trim() || null,
      operating_status: form.operating_status,
      warranty_status: form.warranty_status,
      installation_date: form.installation_date || null,
      last_service_date: form.last_service_date || null,
      next_scheduled_service_date: form.next_scheduled_service_date || null,
      warranty_expiration_date: form.warranty_expiration_date || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error: updateError } = await supabase.from("equipment").update(payload).eq("id", id);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "updated",
      recordType: "equipment",
      recordId: id,
      newValue: payload.name,
    });
    setMessage("Equipment details saved.");
    setSaving(false);
    load();
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  if (!equipment) {
    return (
      <div className="p-6">
        <EmptyState
          title="Equipment not found"
          description="This equipment record may have been removed."
          action={
            <Link href="/equipment" className="btn btn-sm">
              Back to Equipment
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={equipment.name}
        description={isManager ? "View and edit equipment details" : "Equipment details"}
        actions={
          <Link href="/equipment" className="btn btn-ghost btn-sm">
            ← Back
          </Link>
        }
      />

      <form onSubmit={onSave} className="card bg-base-100 shadow max-w-2xl">
        <div className="card-body space-y-3">
          {error ? <div className="alert alert-error text-sm">{error}</div> : null}
          {message ? <div className="alert alert-success text-sm">{message}</div> : null}

          {!isManager ? (
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label={equipment.operating_status}
                tone={statusTone(equipment.operating_status)}
                className="max-w-[10rem]"
              />
              <StatusBadge
                label={equipment.warranty_status}
                tone={statusTone(equipment.warranty_status)}
                className="max-w-[10rem]"
              />
            </div>
          ) : null}

          <FormRow label="Name" required>
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            ) : (
              <span className="font-medium">{equipment.name}</span>
            )}
          </FormRow>

          <FormRow label="Customer">
            {isManager ? (
              <select
                className="select select-bordered w-full"
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                required
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : equipment.customers?.id ? (
              <Link href={`/customers/${equipment.customers.id}`} className="link link-primary">
                {equipment.customers.name}
              </Link>
            ) : (
              <span>—</span>
            )}
          </FormRow>

          <FormRow label="Operating status">
            {isManager ? (
              <select
                className="select select-bordered w-full"
                value={form.operating_status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    operating_status: e.target.value as Equipment["operating_status"],
                  })
                }
              >
                <option value="Operational">Operational</option>
                <option value="Needs Service">Needs Service</option>
                <option value="Out of Service">Out of Service</option>
                <option value="Retired">Retired</option>
              </select>
            ) : (
              <StatusBadge
                label={equipment.operating_status}
                tone={statusTone(equipment.operating_status)}
                className="max-w-[10rem]"
              />
            )}
          </FormRow>

          <FormRow label="Warranty status">
            {isManager ? (
              <select
                className="select select-bordered w-full"
                value={form.warranty_status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    warranty_status: e.target.value as Equipment["warranty_status"],
                  })
                }
              >
                <option value="Under Warranty">Under Warranty</option>
                <option value="Warranty Expired">Warranty Expired</option>
                <option value="Not Covered">Not Covered</option>
                <option value="Unknown">Unknown</option>
              </select>
            ) : (
              <StatusBadge
                label={equipment.warranty_status}
                tone={statusTone(equipment.warranty_status)}
                className="max-w-[10rem]"
              />
            )}
          </FormRow>

          <FormRow label="Category">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            ) : (
              <span>{equipment.category ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Manufacturer">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
              />
            ) : (
              <span>{equipment.manufacturer ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Model">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            ) : (
              <span>{equipment.model ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Serial #">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.serial_number}
                onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
              />
            ) : (
              <span className="break-all">{equipment.serial_number ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Location">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            ) : (
              <span className="break-words">{equipment.location ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Installation date">
            {isManager ? (
              <input
                type="date"
                className="input input-bordered w-full"
                value={form.installation_date}
                onChange={(e) => setForm({ ...form, installation_date: e.target.value })}
              />
            ) : (
              <span>{equipment.installation_date ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Warranty expiration">
            {isManager ? (
              <input
                type="date"
                className="input input-bordered w-full"
                value={form.warranty_expiration_date}
                onChange={(e) => setForm({ ...form, warranty_expiration_date: e.target.value })}
              />
            ) : (
              <span>{equipment.warranty_expiration_date ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Last service">
            {isManager ? (
              <input
                type="date"
                className="input input-bordered w-full"
                value={form.last_service_date}
                onChange={(e) => setForm({ ...form, last_service_date: e.target.value })}
              />
            ) : (
              <span>{equipment.last_service_date ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Next scheduled service">
            {isManager ? (
              <input
                type="date"
                className="input input-bordered w-full"
                value={form.next_scheduled_service_date}
                onChange={(e) => setForm({ ...form, next_scheduled_service_date: e.target.value })}
              />
            ) : (
              <span>{equipment.next_scheduled_service_date ?? "—"}</span>
            )}
          </FormRow>
          <FormRow label="Notes">
            {isManager ? (
              <textarea
                className="textarea textarea-bordered w-full"
                rows={4}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            ) : (
              <span className="break-words whitespace-pre-wrap">{equipment.notes ?? "—"}</span>
            )}
          </FormRow>

          {isManager ? (
            <div className="pt-2">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}
