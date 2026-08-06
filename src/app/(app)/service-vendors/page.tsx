"use client";

/**
 * Ecotrak-style service vendor directory — companies we buy services from.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { ScrollableOverlay } from "@/components/ScrollableOverlay";
import type { Profile, ServiceVendor, ServiceVendorRating } from "@/lib/types";
import {
  SERVICE_TRADES,
  avgRating,
  canApproveVendors,
  canCreateVendor,
  isServiceVendorSchemaError,
  newVendorApprovalStatus,
  serviceVendorAllowedRoles,
} from "@/lib/serviceVendors";

const EMPTY_FORM = {
  name: "",
  primary_trade: "HVAC",
  contact_name: "",
  email: "",
  phone: "",
  city: "",
  state: "",
  service_area: "",
  notes: "",
};

export default function ServiceVendorsPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vendors, setVendors] = useState<ServiceVendor[]>([]);
  const [ratings, setRatings] = useState<ServiceVendorRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isManager = profile ? canApproveVendors(profile.role) : false;
  const canCreate = profile ? canCreateVendor(profile.role) : false;
  const allowed = new Set(serviceVendorAllowedRoles());

  async function load() {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    setProfile((prof as Profile) ?? null);

    const [{ data: rows, error: vErr }, { data: ratingRows, error: rErr }] = await Promise.all([
      supabase.from("service_vendors").select("*").order("name"),
      supabase.from("service_vendor_ratings").select("*"),
    ]);

    if (vErr || rErr) {
      const msg = vErr?.message ?? rErr?.message ?? "Failed to load service vendors.";
      setError(
        isServiceVendorSchemaError(msg)
          ? "Service vendor tables missing. Run supabase/migrations/20260806_service_vendors.sql."
          : msg,
      );
      setVendors([]);
      setRatings([]);
    } else {
      setVendors((rows as ServiceVendor[]) ?? []);
      setRatings((ratingRows as ServiceVendorRating[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const pending = useMemo(
    () => vendors.filter((v) => (v.approval_status ?? "Approved") === "Pending"),
    [vendors],
  );

  const listed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors
      .filter((v) => {
        const status = v.approval_status ?? "Approved";
        if (status === "Pending" || status === "Rejected") return false;
        if (!showInactive && !v.is_active) return false;
        if (tradeFilter !== "all" && v.primary_trade !== tradeFilter) return false;
        if (!q) return true;
        return `${v.name} ${v.primary_trade} ${v.contact_name ?? ""} ${v.service_area ?? ""}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [vendors, search, tradeFilter, showInactive]);

  async function createVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !canCreateVendor(profile.role)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const approval = newVendorApprovalStatus(profile.role);
    const payload = {
      name: form.name.trim(),
      primary_trade: form.primary_trade,
      trades: [form.primary_trade],
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      service_area: form.service_area.trim() || null,
      notes: form.notes.trim() || null,
      is_active: true,
      approval_status: approval,
      requested_by: profile.id,
      reviewed_by: approval === "Approved" ? profile.id : null,
      reviewed_at: approval === "Approved" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.name) {
      setError("Name is required.");
      setSaving(false);
      return;
    }
    const { data, error: insertError } = await supabase
      .from("service_vendors")
      .insert(payload)
      .select("*")
      .single();
    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: approval === "Pending" ? "service_vendor_requested" : "service_vendor_created",
      recordType: "service_vendor",
      recordId: (data as ServiceVendor).id,
      newValue: `${payload.name} · ${payload.primary_trade}`,
    });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setSuccess(
      approval === "Pending"
        ? "Service vendor submitted for approval."
        : "Service vendor added.",
    );
    setSaving(false);
    await load();
  }

  async function reviewVendor(vendor: ServiceVendor, decision: "Approved" | "Rejected") {
    if (!profile || !isManager) return;
    setBusyId(vendor.id);
    const { error: updErr } = await supabase
      .from("service_vendors")
      .update({
        approval_status: decision,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        is_active: decision === "Approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", vendor.id);
    if (updErr) {
      setError(updErr.message);
      setBusyId(null);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: decision === "Approved" ? "service_vendor_approved" : "service_vendor_rejected",
      recordType: "service_vendor",
      recordId: vendor.id,
      newValue: vendor.name,
    });
    setSuccess(decision === "Approved" ? `Approved ${vendor.name}.` : `Rejected ${vendor.name}.`);
    setBusyId(null);
    await load();
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading service vendors…</div>;
  }

  if (!profile || !allowed.has(profile.role)) {
    return (
      <EmptyState
        title="Service vendors unavailable"
        description="Only administrators, service managers, and billing can manage service providers."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Service Vendors"
        description={
          isManager
            ? "Providers you hire for specialty work — add and approve here"
            : "View approved service providers assigned to work orders"
        }
        actions={
          canCreate ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setError(null);
                setShowForm(true);
              }}
            >
              Add provider
            </button>
          ) : undefined
        }
      />

      <p className="mb-4 text-sm opacity-70">
        Specialty providers you hire for jobs. For parts payables, see{" "}
        <Link href="/vendors" className="link link-hover font-medium">
          Suppliers
        </Link>
        .
      </p>

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}
      {success ? (
        <div role="status" className="alert alert-success mb-4">
          <span>{success}</span>
        </div>
      ) : null}

      {isManager && pending.length > 0 ? (
        <section className="mb-6 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <h2 className="mb-3 font-semibold">Pending approval ({pending.length})</h2>
          <ul className="space-y-2">
            {pending.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2"
              >
                <div>
                  <Link href={`/service-vendors/${v.id}`} className="link link-hover font-medium">
                    {v.name}
                  </Link>
                  <p className="text-xs opacity-60">
                    {v.primary_trade}
                    {v.service_area ? ` · ${v.service_area}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-success btn-xs"
                    disabled={busyId === v.id}
                    onClick={() => void reviewVendor(v, "Approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={busyId === v.id}
                    onClick={() => void reviewVendor(v, "Rejected")}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="form-control min-w-[14rem] flex-1">
          <span className="label-text text-xs opacity-70">Search</span>
          <input
            className="input input-bordered input-sm w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, trade, area"
          />
        </label>
        <label className="form-control">
          <span className="label-text text-xs opacity-70">Trade</span>
          <select
            className="select select-bordered select-sm"
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
          >
            <option value="all">All trades</option>
            {SERVICE_TRADES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="label cursor-pointer gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          <span className="label-text text-sm">Show inactive</span>
        </label>
      </div>

      {listed.length === 0 ? (
        <EmptyState
          title="No service providers yet"
          description={
            isManager
              ? "Add HVAC, electrical, and other specialty vendors you subcontract work to."
              : "Ask a manager or administrator to add a service provider."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Trade</th>
                <th>Service area</th>
                <th>Rating</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((v) => {
                const avg = avgRating(ratings.filter((r) => r.service_vendor_id === v.id));
                return (
                  <tr key={v.id} className="hover">
                    <td>
                      <Link
                        href={`/service-vendors/${v.id}`}
                        className="link link-hover font-medium"
                      >
                        {v.name}
                      </Link>
                      <p className="text-xs opacity-50">{v.contact_name ?? v.phone ?? ""}</p>
                    </td>
                    <td>{v.primary_trade}</td>
                    <td className="text-sm">{v.service_area ?? "—"}</td>
                    <td className="tabular-nums">{avg != null ? `${avg}★` : "—"}</td>
                    <td>
                      <StatusBadge
                        label={v.is_active ? "Active" : "Inactive"}
                        tone={statusTone(v.is_active ? "Active" : "Inactive")}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && canCreate ? (
        <ScrollableOverlay title="Add service provider" onClose={() => setShowForm(false)}>
          <form onSubmit={createVendor}>
            <div className="max-h-[min(60vh,24rem)] space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              <FormRow label="Company name" required>
                <input
                  className="input input-bordered w-full"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="Primary trade" required>
                <select
                  className="select select-bordered w-full"
                  value={form.primary_trade}
                  onChange={(e) => setForm({ ...form, primary_trade: e.target.value })}
                >
                  {SERVICE_TRADES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Contact">
                <input
                  className="input input-bordered w-full"
                  value={form.contact_name}
                  onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                />
              </FormRow>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormRow label="Email">
                  <input
                    type="email"
                    className="input input-bordered w-full"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </FormRow>
                <FormRow label="Phone">
                  <input
                    className="input input-bordered w-full"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </FormRow>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormRow label="City">
                  <input
                    className="input input-bordered w-full"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </FormRow>
                <FormRow label="State">
                  <input
                    className="input input-bordered w-full"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                  />
                </FormRow>
              </div>
              <FormRow label="Service area">
                <input
                  className="input input-bordered w-full"
                  value={form.service_area}
                  onChange={(e) => setForm({ ...form, service_area: e.target.value })}
                  placeholder="e.g. Central IL · 100 mi radius"
                />
              </FormRow>
              <FormRow label="Notes">
                <textarea
                  className="textarea textarea-bordered w-full"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </FormRow>
            </div>
            <div className="flex justify-end gap-2 border-t border-base-300 px-4 py-3 sm:px-6">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving}
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </ScrollableOverlay>
      ) : null}
    </div>
  );
}
