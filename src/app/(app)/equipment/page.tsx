"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatInstallDate } from "@/lib/equipment";
import type { Customer, Equipment } from "@/lib/types";

export default function EquipmentPage() {
  const supabase = createClient();
  const [equipment, setEquipment] = useState<(Equipment & { customers?: { name: string } })[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: "",
    name: "",
    category: "",
    manufacturer: "",
    model: "",
    serial_number: "",
    installation_date: "",
    location: "",
    operating_status: "Operational" as Equipment["operating_status"],
  });

  async function load() {
    const [{ data: eq }, { data: cust }] = await Promise.all([
      supabase.from("equipment").select("*, customers(name)").order("name"),
      supabase.from("customers").select("*").eq("status", "Active").order("name"),
    ]);
    setEquipment((eq as typeof equipment) ?? []);
    setCustomers((cust as Customer[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      ...form,
      manufacturer: form.manufacturer || null,
      model: form.model || null,
      serial_number: form.serial_number || null,
      installation_date: form.installation_date || null,
      location: form.location || null,
      category: form.category || null,
    };
    const { data, error: insertError } = await supabase.from("equipment").insert(payload).select().single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "equipment",
      recordId: data.id,
      newValue: form.name,
    });
    setShowForm(false);
    setForm({
      customer_id: "",
      name: "",
      category: "",
      manufacturer: "",
      model: "",
      serial_number: "",
      installation_date: "",
      location: "",
      operating_status: "Operational",
    });
    load();
  }

  return (
    <div>
      <PageHeader
        title="Equipment"
        description="Track units by model, serial number, and install date — link them to jobs and invoices"
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            Add Equipment
          </button>
        }
      />

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">Register Equipment</h3>
            <p className="text-sm opacity-70">Model, serial, and install date identify the unit on jobs and invoices.</p>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <FormRow label="Customer" required>
                <select
                  className="select select-bordered w-full"
                  value={form.customer_id}
                  onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  required
                >
                  <option value="">Select…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Unit name" required>
                <input
                  className="input input-bordered w-full"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Roof top unit RTU-1"
                  required
                />
              </FormRow>
              <FormRow label="Category">
                <input
                  className="input input-bordered w-full"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </FormRow>
              <FormRow label="Manufacturer">
                <input
                  className="input input-bordered w-full"
                  value={form.manufacturer}
                  onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                />
              </FormRow>
              <FormRow label="Model" required>
                <input
                  className="input input-bordered w-full"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="Serial #" required>
                <input
                  className="input input-bordered w-full"
                  value={form.serial_number}
                  onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="Install date">
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={form.installation_date}
                  onChange={(e) => setForm({ ...form, installation_date: e.target.value })}
                />
              </FormRow>
              <FormRow label="Location">
                <input
                  className="input input-bordered w-full"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </FormRow>
              <FormRow label="Status">
                <select
                  className="select select-bordered w-full"
                  value={form.operating_status}
                  onChange={(e) =>
                    setForm({ ...form, operating_status: e.target.value as Equipment["operating_status"] })
                  }
                >
                  <option value="Operational">Operational</option>
                  <option value="Needs Service">Needs Service</option>
                  <option value="Out of Service">Out of Service</option>
                  <option value="Retired">Retired</option>
                </select>
              </FormRow>
              <div className="modal-action">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save
                </button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setShowForm(false)}>
              close
            </button>
          </form>
        </dialog>
      ) : null}

      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {equipment.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No equipment registered"
                description="Add equipment with model and serial to link work orders and invoices."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Customer</th>
                    <th>Model</th>
                    <th>Serial #</th>
                    <th>Installed</th>
                    <th>Status</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {equipment.map((eq) => (
                    <tr key={eq.id}>
                      <td className="font-medium">{eq.name}</td>
                      <td>
                        {eq.customer_id ? (
                          <Link href={`/customers/${eq.customer_id}`} className="link link-hover">
                            {eq.customers?.name ?? "—"}
                          </Link>
                        ) : (
                          eq.customers?.name ?? "—"
                        )}
                      </td>
                      <td>{eq.model ?? "—"}</td>
                      <td className="font-mono text-sm">{eq.serial_number ?? "—"}</td>
                      <td>{formatInstallDate(eq.installation_date)}</td>
                      <td>
                        <StatusBadge label={eq.operating_status} tone={statusTone(eq.operating_status)} />
                      </td>
                      <td>{eq.location ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
