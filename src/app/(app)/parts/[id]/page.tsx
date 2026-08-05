"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import type { Part, Profile } from "@/lib/types";

/**
 * This business faces outdated parts master-data risk.
 * Our app reduces the risk by letting managers open a part and update stock and pricing details.
 */
export default function PartDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [part, setPart] = useState<Part | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    part_number: "",
    name: "",
    category: "",
    description: "",
    quantity_on_hand: "0",
    reorder_level: "0",
    unit_cost: "0",
    standard_customer_price: "0",
    warranty_eligible: false,
    supplier: "",
    is_active: true,
  });

  const isManager = profile?.role === "service_manager";

  async function load() {
    setLoading(true);
    const [{ data }, { data: { user } }] = await Promise.all([
      supabase.from("parts").select("*").eq("id", id).single(),
      supabase.auth.getUser(),
    ]);
    const p = data as Part | null;
    setPart(p);
    if (user) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      setProfile(profileData as Profile);
    }
    if (p) {
      setForm({
        part_number: p.part_number,
        name: p.name,
        category: p.category ?? "",
        description: p.description ?? "",
        quantity_on_hand: String(p.quantity_on_hand),
        reorder_level: String(p.reorder_level),
        unit_cost: String(p.unit_cost),
        standard_customer_price: String(p.standard_customer_price),
        warranty_eligible: p.warranty_eligible,
        supplier: p.supplier ?? "",
        is_active: p.is_active,
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager || !part) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const payload = {
      part_number: form.part_number.trim(),
      name: form.name.trim(),
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      quantity_on_hand: Number(form.quantity_on_hand),
      reorder_level: Number(form.reorder_level),
      unit_cost: Number(form.unit_cost),
      standard_customer_price: Number(form.standard_customer_price),
      warranty_eligible: form.warranty_eligible,
      supplier: form.supplier.trim() || null,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };
    const { error: updateError } = await supabase.from("parts").update(payload).eq("id", id);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "updated",
      recordType: "part",
      recordId: id,
      newValue: payload.name,
    });
    setMessage("Part details saved.");
    setSaving(false);
    load();
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  if (!part) {
    return (
      <div className="p-6">
        <EmptyState
          title="Part not found"
          description="This part may have been removed."
          action={
            <Link href="/parts" className="btn btn-sm">
              Back to Parts
            </Link>
          }
        />
      </div>
    );
  }

  const low = part.quantity_on_hand <= part.reorder_level;

  return (
    <div>
      <PageHeader
        title={part.name}
        description={isManager ? "View and edit part details" : "Part details"}
        actions={
          <Link href="/parts" className="btn btn-ghost btn-sm">
            ← Back
          </Link>
        }
      />

      <form onSubmit={onSave} className="card bg-base-100 shadow max-w-2xl">
        <div className="card-body space-y-3">
          {error ? <div className="alert alert-error text-sm">{error}</div> : null}
          {message ? <div className="alert alert-success text-sm">{message}</div> : null}

          <div className="flex flex-wrap gap-2">
            <StatusBadge
              label={low ? "Low Stock" : "OK"}
              tone={low ? "warning" : "success"}
            />
            <StatusBadge
              label={part.is_active ? "Active" : "Inactive"}
              tone={statusTone(part.is_active ? "Active" : "Inactive")}
            />
          </div>

          <FormRow label="Part #" required>
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.part_number}
                onChange={(e) => setForm({ ...form, part_number: e.target.value })}
                required
              />
            ) : (
              <span className="font-medium">{part.part_number}</span>
            )}
          </FormRow>

          <FormRow label="Name" required>
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            ) : (
              <span className="font-medium">{part.name}</span>
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
              <span>{part.category ?? "—"}</span>
            )}
          </FormRow>

          <FormRow label="Description">
            {isManager ? (
              <textarea
                className="textarea textarea-bordered w-full"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            ) : (
              <span className="break-words whitespace-pre-wrap">{part.description ?? "—"}</span>
            )}
          </FormRow>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Quantity on hand">
              {isManager ? (
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={form.quantity_on_hand}
                  onChange={(e) => setForm({ ...form, quantity_on_hand: e.target.value })}
                />
              ) : (
                <span>{part.quantity_on_hand}</span>
              )}
            </FormRow>
            <FormRow label="Reorder level">
              {isManager ? (
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={form.reorder_level}
                  onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                />
              ) : (
                <span>{part.reorder_level}</span>
              )}
            </FormRow>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Unit cost">
              {isManager ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.unit_cost}
                  onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                />
              ) : (
                <span>{formatMoney(part.unit_cost)}</span>
              )}
            </FormRow>
            <FormRow label="Customer price">
              {isManager ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.standard_customer_price}
                  onChange={(e) => setForm({ ...form, standard_customer_price: e.target.value })}
                />
              ) : (
                <span>{formatMoney(part.standard_customer_price)}</span>
              )}
            </FormRow>
          </div>

          <FormRow label="Supplier">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              />
            ) : (
              <span>{part.supplier ?? "—"}</span>
            )}
          </FormRow>

          {isManager ? (
            <>
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={form.warranty_eligible}
                  onChange={(e) => setForm({ ...form, warranty_eligible: e.target.checked })}
                />
                <span className="label-text">Warranty eligible</span>
              </label>
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                <span className="label-text">Active in inventory</span>
              </label>
              <div className="pt-2">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </>
          ) : (
            <>
              <FormRow label="Warranty eligible">
                <span>{part.warranty_eligible ? "Yes" : "No"}</span>
              </FormRow>
              <FormRow label="Active">
                <span>{part.is_active ? "Yes" : "No"}</span>
              </FormRow>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
