"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { formatMoney, formatPct } from "@/lib/calculations";
import type { Part, Profile, Vendor, WorkOrderPart } from "@/lib/types";

type UsageRow = WorkOrderPart & {
  work_orders?: {
    id: string;
    work_order_number: string;
    status: string;
    scheduled_date: string | null;
  } | null;
};

/**
 * This business faces outdated parts master-data risk.
 * Our app reduces the risk by letting managers open a part, update stock/pricing, and see recent usage.
 */
export default function PartDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [part, setPart] = useState<Part | null>(null);
  const [suppliers, setSuppliers] = useState<Pick<Vendor, "id" | "name">[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
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
    vendor_id: "",
    is_active: true,
  });

  const isManager =
    profile?.role === "administrator" || profile?.role === "service_manager";

  async function load() {
    setLoading(true);
    const [{ data }, { data: { user } }, { data: usageData }, { data: vendorRows }] =
      await Promise.all([
        supabase.from("parts").select("*").eq("id", id).single(),
        supabase.auth.getUser(),
        supabase
          .from("work_order_parts")
          .select("*, work_orders(id, work_order_number, status, scheduled_date)")
          .eq("part_id", id)
          .order("date_used", { ascending: false })
          .limit(20),
        supabase
          .from("vendors")
          .select("id, name")
          .eq("is_active", true)
          .eq("approval_status", "Approved")
          .order("name"),
      ]);
    const p = data as Part | null;
    setPart(p);
    setUsage((usageData as UsageRow[]) ?? []);
    let supplierOptions = (vendorRows as Pick<Vendor, "id" | "name">[]) ?? [];
    if (p?.vendor_id && !supplierOptions.some((v) => v.id === p.vendor_id)) {
      const { data: linked } = await supabase
        .from("vendors")
        .select("id, name")
        .eq("id", p.vendor_id)
        .maybeSingle();
      if (linked) {
        supplierOptions = [...supplierOptions, linked as Pick<Vendor, "id" | "name">].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      }
    }
    setSuppliers(supplierOptions);
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
        vendor_id: p.vendor_id ?? "",
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
    const selectedVendor = suppliers.find((v) => v.id === form.vendor_id) ?? null;
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
      vendor_id: selectedVendor?.id ?? null,
      supplier: selectedVendor?.name ?? null,
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
  const margin = Number(part.standard_customer_price) - Number(part.unit_cost);
  const marginPct = Number(part.unit_cost) > 0 ? margin / Number(part.unit_cost) : null;
  const negativeMargin = margin < 0;

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
            <StatusBadge label={low ? "Low Stock" : "OK"} tone={low ? "warning" : "success"} />
            <StatusBadge
              label={part.is_active ? "Active" : "Inactive"}
              tone={statusTone(part.is_active ? "Active" : "Inactive")}
            />
            {isManager && negativeMargin ? (
              <StatusBadge label="Neg margin" tone="error" />
            ) : null}
          </div>

          {isManager ? (
            <p className="text-sm opacity-70">
              Margin {formatMoney(margin)}
              {marginPct != null ? ` (${formatPct(marginPct)})` : ""}
            </p>
          ) : null}

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
              <select
                className="select select-bordered w-full"
                value={form.vendor_id}
                onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
              >
                <option value="">No supplier</option>
                {suppliers.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : part.vendor_id ? (
              <Link href={`/vendors/${part.vendor_id}`} className="link link-hover">
                {part.supplier ?? "—"}
              </Link>
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

      {isManager ? (
        <section className="card mt-4 max-w-2xl bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Recent work order usage</h2>
            {usage.length === 0 ? (
              <p className="text-sm opacity-60">No recorded usage on work orders yet.</p>
            ) : (
              <ul className="space-y-2">
                {usage.map((row) => {
                  const wo = row.work_orders;
                  return (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 px-3 py-2 text-sm"
                    >
                      <div>
                        {wo?.id ? (
                          <Link
                            href={`/work-orders/${wo.id}`}
                            className="link link-primary font-medium"
                          >
                            {wo.work_order_number}
                          </Link>
                        ) : (
                          <span className="font-medium">Work order</span>
                        )}
                        <p className="text-xs opacity-60">
                          Qty {row.quantity_used}
                          {row.date_used ? ` · ${row.date_used}` : ""}
                          {wo?.status ? ` · ${wo.status}` : ""}
                        </p>
                      </div>
                      <span>{formatMoney(row.billable_amount)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
