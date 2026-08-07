"use client";

/**
 * Vendors directory — mgmt/admin create & approve; billing uses approved suppliers for AP.
 * Includes a product-vendor preference matrix (cost, lead time, stars).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { ScrollableOverlay } from "@/components/ScrollableOverlay";
import { VendorMatrixPanel } from "@/components/VendorMatrixPanel";
import { formatMoney } from "@/lib/calculations";
import type { CompanySettings, Profile, Vendor, VendorBill, VendorRating } from "@/lib/types";
import {
  canApproveVendors,
  canCreateVendor,
  isVendorSchemaError,
  newVendorApprovalStatus,
  openBalanceForBills,
  worstAgingHint,
} from "@/lib/vendors";
import {
  DEFAULT_VENDOR_MATRIX_SETTINGS,
  buildProductVendorMatrix,
  normalizeMatrixSettings,
  type VendorMatrixSettings,
} from "@/lib/vendor-matrix";

const ALLOWED_ROLES = new Set(["administrator", "service_manager", "billing"]);

const EMPTY_FORM = {
  name: "",
  contact_name: "",
  email: "",
  phone: "",
  address_line1: "",
  city: "",
  state: "",
  postal_code: "",
  payment_terms: "Net 30",
  notes: "",
};

type VendorRow = Vendor & {
  openBalance: number;
  agingHint: string;
};

export default function VendorsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<VendorBill[]>([]);
  const [ratings, setRatings] = useState<VendorRating[]>([]);
  const [matrixSettings, setMatrixSettings] = useState<VendorMatrixSettings>(
    DEFAULT_VENDOR_MATRIX_SETTINGS,
  );
  const [view, setView] = useState<"directory" | "matrix">(
    searchParams.get("view") === "matrix" ? "matrix" : "directory",
  );
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);

  const isManager = profile ? canApproveVendors(profile.role) : false;
  const canCreate = profile ? canCreateVendor(profile.role) : false;

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

    const [
      { data: vendorRows, error: vendorError },
      { data: billRows, error: billError },
      { data: ratingRows, error: ratingError },
      { data: settingsRow },
    ] = await Promise.all([
      supabase.from("vendors").select("*").order("name"),
      supabase.from("vendor_bills").select("*"),
      supabase.from("vendor_ratings").select("*"),
      supabase.from("company_settings").select("*").limit(1).maybeSingle(),
    ]);

    if (vendorError || billError) {
      const msg = vendorError?.message ?? billError?.message ?? "Failed to load vendors.";
      if (isVendorSchemaError(msg) || msg.toLowerCase().includes("approval_status")) {
        setSchemaMissing(true);
        setError(
          "Vendor approval columns missing. Run supabase/migrations/20260806_vendors_approval.sql in Supabase.",
        );
      } else {
        setError(msg);
      }
      setVendors([]);
      setBills([]);
      setRatings([]);
    } else {
      setSchemaMissing(false);
      setVendors((vendorRows as Vendor[]) ?? []);
      setBills((billRows as VendorBill[]) ?? []);
      // Ratings table may be missing on older DBs; treat as empty.
      if (ratingError) setRatings([]);
      else setRatings((ratingRows as VendorRating[]) ?? []);
    }
    setMatrixSettings(
      normalizeMatrixSettings((settingsRow as CompanySettings | null) ?? undefined),
    );
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setView(searchParams.get("view") === "matrix" ? "matrix" : "directory");
  }, [searchParams]);

  const rows: VendorRow[] = useMemo(() => {
    return vendors.map((v) => {
      const vendorBills = bills.filter((b) => b.vendor_id === v.id);
      return {
        ...v,
        openBalance: openBalanceForBills(vendorBills),
        agingHint: worstAgingHint(vendorBills),
      };
    });
  }, [vendors, bills]);

  const matrixRows = useMemo(
    () =>
      buildProductVendorMatrix({
        vendors,
        ratings,
        bills,
        settings: matrixSettings,
      }),
    [vendors, ratings, bills, matrixSettings],
  );
  const pending = useMemo(
    () => rows.filter((v) => (v.approval_status ?? "Approved") === "Pending"),
    [rows],
  );

  const listed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((v) => {
        const status = v.approval_status ?? "Approved";
        if (showPendingOnly) return status === "Pending";
        if (status === "Rejected") return false;
        if (status === "Pending") return false;
        if (!showInactive && !v.is_active) return false;
        if (!q) return true;
        return `${v.name} ${v.contact_name ?? ""} ${v.email ?? ""} ${v.phone ?? ""}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, search, showInactive, showPendingOnly]);

  const totals = useMemo(() => {
    const open = listed.reduce((s, v) => s + v.openBalance, 0);
    return { count: listed.length, open: Math.round(open * 100) / 100 };
  }, [listed]);

  async function createVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !canCreateVendor(profile.role)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const approval = newVendorApprovalStatus(profile.role);
    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address_line1: form.address_line1.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      postal_code: form.postal_code.trim() || null,
      payment_terms: form.payment_terms.trim() || "Net 30",
      notes: form.notes.trim() || null,
      is_active: true,
      approval_status: approval,
      requested_by: profile.id,
      reviewed_by: approval === "Approved" ? profile.id : null,
      reviewed_at: approval === "Approved" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.name) {
      setError("Vendor name is required.");
      setSaving(false);
      return;
    }
    const { data, error: insertError } = await supabase
      .from("vendors")
      .insert(payload)
      .select("*")
      .single();
    if (insertError) {
      setError(
        isVendorSchemaError(insertError.message) || insertError.message.includes("approval_status")
          ? "Vendor approval columns missing. Run supabase/migrations/20260806_vendors_approval.sql in Supabase."
          : insertError.message,
      );
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: approval === "Pending" ? "vendor_requested" : "vendor_created",
      recordType: "vendor",
      recordId: (data as Vendor).id,
      newValue: `${payload.name} (${approval})`,
    });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setSuccess(
      approval === "Pending"
        ? "Vendor submitted for manager/admin approval."
        : "Vendor added.",
    );
    setSaving(false);
    await load();
  }

  async function reviewVendor(vendor: Vendor, decision: "Approved" | "Rejected") {
    if (!profile || !isManager) return;
    setBusyId(vendor.id);
    setError(null);
    setSuccess(null);
    const { error: updErr } = await supabase
      .from("vendors")
      .update({
        approval_status: decision,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        is_active: decision === "Approved" ? true : false,
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
      action: decision === "Approved" ? "vendor_approved" : "vendor_rejected",
      recordType: "vendor",
      recordId: vendor.id,
      newValue: vendor.name,
    });
    setSuccess(
      decision === "Approved" ? `Approved ${vendor.name}.` : `Rejected ${vendor.name}.`,
    );
    setBusyId(null);
    await load();
  }

  async function togglePreferred(vendorId: string, next: boolean) {
    if (!profile || !isManager) return;
    setBusyId(vendorId);
    setError(null);
    const preferredCount = vendors.filter((v) => v.is_preferred && v.id !== vendorId).length;
    const { error: updErr } = await supabase
      .from("vendors")
      .update({
        is_preferred: next,
        preferred_rank: next ? preferredCount + 1 : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", vendorId);
    if (updErr) {
      setError(updErr.message);
      setBusyId(null);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: next ? "vendor_preferred" : "vendor_unpreferred",
      recordType: "vendor",
      recordId: vendorId,
      newValue: next ? "preferred" : "not preferred",
    });
    setBusyId(null);
    await load();
  }

  async function deactivateVendor(vendorId: string) {
    if (!profile || !isManager) return;
    setBusyId(vendorId);
    setError(null);
    const { error: updErr } = await supabase
      .from("vendors")
      .update({
        is_active: false,
        is_preferred: false,
        preferred_rank: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", vendorId);
    if (updErr) {
      setError(updErr.message);
      setBusyId(null);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: "vendor_deactivated",
      recordType: "vendor",
      recordId: vendorId,
      newValue: "pruned via product matrix",
    });
    setSuccess("Supplier deactivated (pruned from active directory).");
    setBusyId(null);
    await load();
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading vendors…</div>;
  }

  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return (
      <EmptyState
        title="Vendors Unavailable"
        description="Only managers, administrators, and billing can access the vendor portal."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={view === "matrix" ? "Vendor Matrix" : "Vendor Suppliers"}
        description={
          view === "matrix"
            ? "Ranked preference scorecard — switch Product / Service with the tabs below"
            : isManager
              ? "Parts and materials suppliers directory"
              : "Enter bills and track payables for approved suppliers"
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {view === "directory" ? (
              <>
                <Link href="/vendors?view=matrix" className="btn btn-outline btn-sm">
                  Open matrix
                </Link>
                <Link href="/vendors/aging" className="btn btn-outline btn-sm">
                  A/P Aging
                </Link>
              </>
            ) : null}
            {profile.role === "administrator" ? (
              <Link href="/settings/vendor-matrix" className="btn btn-outline btn-sm">
                Customize
              </Link>
            ) : null}
            {view === "directory" && canCreate ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={schemaMissing}
                onClick={() => {
                  setError(null);
                  setShowForm(true);
                }}
              >
                New Supplier
              </button>
            ) : null}
          </div>
        }
      />

      {view === "directory" ? (
        <p className="mb-4 text-sm opacity-70">
          Parts &amp; materials AP. Specialty subcontractors are under{" "}
          <Link href="/service-vendors" className="link link-hover font-medium">
            Vendor Services
          </Link>
          .
        </p>
      ) : null}

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

      {view === "matrix" ? (
        <div className="mb-8">
          <VendorMatrixPanel
            rows={matrixRows}
            settings={matrixSettings}
            family="product"
            canEditPreferred={isManager}
            busyId={busyId}
            onTogglePreferred={(id, next) => void togglePreferred(id, next)}
            onDeactivate={(id) => void deactivateVendor(id)}
          />
        </div>
      ) : null}

      {view === "directory" ? (
        <>
      {isManager && pending.length > 0 ? (
        <section className="mb-6 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Pending Approval ({pending.length})</h2>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setShowPendingOnly((v) => !v)}
            >
              {showPendingOnly ? "Show directory" : "Focus pending"}
            </button>
          </div>
          <ul className="space-y-2">
            {pending.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2"
              >
                <div>
                  <Link href={`/vendors/${v.id}`} className="link link-hover font-medium">
                    {v.name}
                  </Link>
                  <p className="text-xs opacity-60">
                    {v.contact_name ?? "No contact"} · {v.payment_terms}
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
        <label className="form-control min-w-[16rem] flex-1">
          <span className="label-text text-xs opacity-70">Search</span>
          <input
            className="input input-bordered input-sm w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, contact, email, phone"
          />
        </label>
        <label className="label cursor-pointer gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          <span className="label-text text-sm">Show Inactive</span>
        </label>
        <p className="text-sm opacity-70">
          {totals.count} vendor{totals.count === 1 ? "" : "s"} · Open AP{" "}
          <span className="font-semibold tabular-nums">{formatMoney(totals.open)}</span>
        </p>
      </div>

      {listed.length === 0 ? (
        <EmptyState
          title={schemaMissing ? "Schema Missing" : showPendingOnly ? "No Pending Suppliers" : "No Suppliers Yet"}
          description={
            schemaMissing
              ? "Apply the vendors approval migration, then refresh."
              : isManager
                ? "Add a supplier to start tracking payables."
                : "Ask a manager or administrator to add a supplier."
          }
        />
      ) : (
        <DualHorizontalScroll className="rounded-xl border border-base-300 bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th className="text-right">Open Balance</th>
                <th>Aging</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((v) => (
                <tr key={v.id} className="hover">
                  <td>
                    <Link href={`/vendors/${v.id}`} className="link link-hover font-medium">
                      {v.name}
                    </Link>
                    {v.payment_terms ? (
                      <p className="text-xs opacity-50">{v.payment_terms}</p>
                    ) : null}
                  </td>
                  <td>
                    <div className="text-sm">{v.contact_name ?? "—"}</div>
                    <div className="text-xs opacity-60">{v.email ?? v.phone ?? ""}</div>
                  </td>
                  <td className="text-right tabular-nums font-medium">
                    {formatMoney(v.openBalance)}
                  </td>
                  <td className="text-sm">{v.agingHint}</td>
                  <td>
                    <StatusBadge
                      label={
                        (v.approval_status ?? "Approved") === "Pending"
                          ? "Pending"
                          : v.is_active
                            ? "Active"
                            : "Inactive"
                      }
                      tone={statusTone(
                        (v.approval_status ?? "Approved") === "Pending"
                          ? "Pending"
                          : v.is_active
                            ? "Active"
                            : "Inactive",
                      )}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DualHorizontalScroll>
      )}
        </>
      ) : null}

      {showForm && canCreate ? (
        <ScrollableOverlay title="New Supplier" onClose={() => setShowForm(false)}>
          <form onSubmit={createVendor}>
            <div className="max-h-[min(60vh,24rem)] space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              <FormRow label="Name" required>
                <input
                  className="input input-bordered w-full"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
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
              <FormRow label="Address">
                <input
                  className="input input-bordered w-full"
                  value={form.address_line1}
                  onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
                />
              </FormRow>
              <div className="grid gap-3 sm:grid-cols-3">
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
                <FormRow label="ZIP">
                  <input
                    className="input input-bordered w-full"
                    value={form.postal_code}
                    onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                  />
                </FormRow>
              </div>
              <FormRow label="Payment terms">
                <input
                  className="input input-bordered w-full"
                  value={form.payment_terms}
                  onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
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
                onClick={() => setShowForm(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save supplier"}
              </button>
            </div>
          </form>
        </ScrollableOverlay>
      ) : null}
    </div>
  );
}
