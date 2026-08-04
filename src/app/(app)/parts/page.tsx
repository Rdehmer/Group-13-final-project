"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import type { Part } from "@/lib/types";

export default function PartsPage() {
  const supabase = createClient();
  const [parts, setParts] = useState<Part[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    part_number: "",
    name: "",
    category: "",
    quantity_on_hand: "0",
    reorder_level: "5",
    unit_cost: "0",
    standard_customer_price: "0",
  });

  async function load() {
    const { data } = await supabase.from("parts").select("*").order("name");
    setParts((data as Part[]) ?? []);
  }

  useEffect(() => { load(); }, []);

  const lowStock = parts.filter((p) => p.is_active && p.quantity_on_hand <= p.reorder_level);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      ...form,
      quantity_on_hand: Number(form.quantity_on_hand),
      reorder_level: Number(form.reorder_level),
      unit_cost: Number(form.unit_cost),
      standard_customer_price: Number(form.standard_customer_price),
    };
    const { data, error: insertError } = await supabase.from("parts").insert(payload).select().single();
    if (insertError) { setError(insertError.message); return; }
    await logActivity(supabase, { userId: user?.id ?? null, action: "created", recordType: "part", recordId: data.id, newValue: form.name });
    setShowForm(false);
    load();
  }

  return (
    <div>
      <PageHeader title="Parts Inventory" description="Track stock levels and pricing" actions={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>Add Part</button>
      } />

      {lowStock.length > 0 ? (
        <div role="alert" className="alert alert-warning mb-4">
          <span>{lowStock.length} part(s) at or below reorder level</span>
        </div>
      ) : null}

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">New Part</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <FormRow label="Part #" required><input className="input input-bordered w-full" value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} required /></FormRow>
              <FormRow label="Name" required><input className="input input-bordered w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></FormRow>
              <FormRow label="Category"><input className="input input-bordered w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></FormRow>
              <FormRow label="Qty"><input type="number" min="0" className="input input-bordered w-full" value={form.quantity_on_hand} onChange={(e) => setForm({ ...form, quantity_on_hand: e.target.value })} /></FormRow>
              <FormRow label="Reorder"><input type="number" min="0" className="input input-bordered w-full" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} /></FormRow>
              <FormRow label="Unit cost"><input type="number" min="0" step="0.01" className="input input-bordered w-full" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></FormRow>
              <FormRow label="Price"><input type="number" min="0" step="0.01" className="input input-bordered w-full" value={form.standard_customer_price} onChange={(e) => setForm({ ...form, standard_customer_price: e.target.value })} /></FormRow>
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
          {parts.length === 0 ? (
            <div className="p-6"><EmptyState title="No parts in inventory" description="Add parts to track usage on work orders." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Part #</th><th>Name</th><th>On Hand</th><th>Reorder</th><th>Cost</th><th>Price</th><th>Status</th></tr></thead>
                <tbody>
                  {parts.map((p) => {
                    const low = p.quantity_on_hand <= p.reorder_level;
                    return (
                      <tr key={p.id} className={low ? "bg-warning/10" : ""}>
                        <td>{p.part_number}</td>
                        <td className="font-medium">{p.name}</td>
                        <td>{p.quantity_on_hand}</td>
                        <td>{p.reorder_level}</td>
                        <td>{formatMoney(p.unit_cost)}</td>
                        <td>{formatMoney(p.standard_customer_price)}</td>
                        <td>{low ? <StatusBadge label="Low Stock" tone="warning" /> : <StatusBadge label="OK" tone="success" />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
