"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Customer } from "@/lib/types";

/**
 * This business faces customer data fragmentation risk.
 * Our app reduces the risk by centralizing contacts, sites, and service history.
 */
export default function CustomersPage() {
  const supabase = createClient();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    primary_contact_name: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    status: "Active" as Customer["status"],
  });

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("customers").select("*").order("name");
    setCustomers((data as Customer[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("customers")
      .insert(form)
      .select()
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "customer",
      recordId: data.id,
      newValue: form.name,
    });
    setShowForm(false);
    setForm({ name: "", primary_contact_name: "", email: "", phone: "", city: "", state: "", status: "Active" });
    load();
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Manage commercial customer accounts"
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            Add Customer
          </button>
        }
      />

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">New Customer</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <FormRow label="Company" required>
                <input className="input input-bordered w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </FormRow>
              <FormRow label="Contact">
                <input className="input input-bordered w-full" value={form.primary_contact_name} onChange={(e) => setForm({ ...form, primary_contact_name: e.target.value })} />
              </FormRow>
              <FormRow label="Email">
                <input type="email" className="input input-bordered w-full" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </FormRow>
              <FormRow label="Phone">
                <input className="input input-bordered w-full" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </FormRow>
              <FormRow label="City">
                <input className="input input-bordered w-full" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </FormRow>
              <FormRow label="State">
                <input className="input input-bordered w-full" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </FormRow>
              <FormRow label="Status">
                <select className="select select-bordered w-full" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Customer["status"] })}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="On Hold">On Hold</option>
                </select>
              </FormRow>
              <div className="modal-action">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop"><button type="button" onClick={() => setShowForm(false)}>close</button></form>
        </dialog>
      ) : null}

      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {loading ? (
            <div className="p-8 text-center opacity-60">Loading…</div>
          ) : customers.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No customers yet" description="Add your first commercial customer to begin tracking equipment and contracts." action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>Add Customer</button>} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td className="font-medium">{c.name}</td>
                      <td>{c.primary_contact_name ?? c.email ?? "—"}</td>
                      <td>{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                      <td><StatusBadge label={c.status} tone={statusTone(c.status)} /></td>
                      <td><Link href={`/customers/${c.id}`} className="btn btn-ghost btn-xs">View</Link></td>
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
