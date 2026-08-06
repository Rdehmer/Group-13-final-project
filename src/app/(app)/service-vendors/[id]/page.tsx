"use client";

/**
 * Service vendor detail — profile, assigned jobs, service bills, ratings.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import type {
  Profile,
  ServiceVendor,
  ServiceVendorBill,
  ServiceVendorRating,
  WorkOrder,
} from "@/lib/types";
import {
  SERVICE_TRADES,
  addDaysIso,
  avgRating,
  canApproveVendors,
  canDeleteVendor,
  canEditVendorMaster,
  canUseServiceVendor,
  isServiceVendorSchemaError,
  serviceVendorAllowedRoles,
  todayIso,
} from "@/lib/serviceVendors";
import { billBalance, recomputeBillStatus } from "@/lib/vendors";
import { postApBill } from "@/lib/accounting/postings";

export default function ServiceVendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vendor, setVendor] = useState<ServiceVendor | null>(null);
  const [jobs, setJobs] = useState<
    Pick<WorkOrder, "id" | "work_order_number" | "status" | "problem_description" | "scheduled_date">[]
  >([]);
  const [openJobs, setOpenJobs] = useState<
    Pick<WorkOrder, "id" | "work_order_number" | "problem_description">[]
  >([]);
  const [bills, setBills] = useState<ServiceVendorBill[]>([]);
  const [ratings, setRatings] = useState<ServiceVendorRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [assignJobId, setAssignJobId] = useState("");
  const [showBill, setShowBill] = useState(false);
  const [billForm, setBillForm] = useState({
    bill_number: "",
    bill_date: todayIso(),
    due_date: addDaysIso(todayIso(), 30),
    amount: "",
    work_order_id: "",
    memo: "",
  });
  const [ratingForm, setRatingForm] = useState({
    rating: "5",
    work_order_id: "",
    notes: "",
  });

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

    const [{ data: v, error: vErr }, { data: jobRows }, { data: billRows }, { data: ratingRows }, { data: openWo }] =
      await Promise.all([
        supabase.from("service_vendors").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("work_orders")
          .select("id, work_order_number, status, problem_description, scheduled_date")
          .eq("service_vendor_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("service_vendor_bills")
          .select("*")
          .eq("service_vendor_id", id)
          .order("bill_date", { ascending: false }),
        supabase
          .from("service_vendor_ratings")
          .select("*")
          .eq("service_vendor_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("work_orders")
          .select("id, work_order_number, problem_description")
          .neq("status", "Canceled")
          .order("scheduled_date", { ascending: false })
          .limit(40),
      ]);

    if (vErr) {
      setError(
        isServiceVendorSchemaError(vErr.message)
          ? "Service vendor tables missing. Run the service vendors migration."
          : vErr.message,
      );
      setVendor(null);
      setLoading(false);
      return;
    }

    setVendor((v as ServiceVendor) ?? null);
    setJobs(jobRows ?? []);
    setBills((billRows as ServiceVendorBill[]) ?? []);
    setRatings((ratingRows as ServiceVendorRating[]) ?? []);
    setOpenJobs(openWo ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [id]);

  const avg = useMemo(() => avgRating(ratings), [ratings]);
  const openAp = useMemo(
    () => Math.round(bills.reduce((s, b) => s + billBalance(b), 0) * 100) / 100,
    [bills],
  );

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor || !profile || !canEditVendorMaster(profile.role)) return;
    setSaving(true);
    setError(null);
    const { error: updErr } = await supabase
      .from("service_vendors")
      .update({
        name: vendor.name.trim(),
        primary_trade: vendor.primary_trade,
        trades: vendor.trades?.length ? vendor.trades : [vendor.primary_trade],
        contact_name: vendor.contact_name?.trim() || null,
        email: vendor.email?.trim() || null,
        phone: vendor.phone?.trim() || null,
        city: vendor.city?.trim() || null,
        state: vendor.state?.trim() || null,
        service_area: vendor.service_area?.trim() || null,
        notes: vendor.notes?.trim() || null,
        is_active: vendor.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updErr) {
      setError(updErr.message);
      setSaving(false);
      return;
    }
    setSuccess("Provider saved.");
    setSaving(false);
    await load();
  }

  async function review(decision: "Approved" | "Rejected") {
    if (!vendor || !profile || !canApproveVendors(profile.role)) return;
    setBusy(true);
    await supabase
      .from("service_vendors")
      .update({
        approval_status: decision,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        is_active: decision === "Approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    setSuccess(decision === "Approved" ? "Approved." : "Rejected.");
    setBusy(false);
    await load();
  }

  async function setActive(active: boolean) {
    if (!vendor || !profile || !canEditVendorMaster(profile.role)) return;
    setBusy(true);
    await supabase
      .from("service_vendors")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", id);
    setSuccess(active ? "Set active." : "Set inactive.");
    setBusy(false);
    await load();
  }

  async function deleteVendor() {
    if (!vendor || !profile || !canDeleteVendor(profile.role)) return;
    if (bills.length > 0 || jobs.length > 0) {
      setError("Cannot delete while bills or assigned jobs exist. Set inactive instead.");
      return;
    }
    if (!window.confirm(`Delete ${vendor.name}?`)) return;
    setBusy(true);
    const { error: delErr } = await supabase.from("service_vendors").delete().eq("id", id);
    if (delErr) {
      setError(delErr.message);
      setBusy(false);
      return;
    }
    router.push("/service-vendors");
  }

  async function assignJob() {
    if (!vendor || !profile || !assignJobId) return;
    if (!canUseServiceVendor(vendor)) {
      setError("Provider must be approved and active.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updErr } = await supabase
      .from("work_orders")
      .update({ service_vendor_id: vendor.id })
      .eq("id", assignJobId);
    if (updErr) {
      setError(
        updErr.message.includes("service_vendor_id")
          ? "Work order column missing. Re-run the service vendors migration."
          : updErr.message,
      );
      setBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: "service_vendor_assigned",
      recordType: "work_order",
      recordId: assignJobId,
      newValue: vendor.name,
    });
    setAssignJobId("");
    setSuccess("Work order assigned to provider.");
    setBusy(false);
    await load();
  }

  async function unassignJob(jobId: string) {
    if (!profile) return;
    setBusy(true);
    await supabase.from("work_orders").update({ service_vendor_id: null }).eq("id", jobId);
    setBusy(false);
    await load();
  }

  async function submitBill(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor || !profile) return;
    if (!canUseServiceVendor(vendor)) {
      setError("Provider must be approved and active.");
      return;
    }
    const amount = Number(billForm.amount);
    if (!billForm.bill_number.trim() || !(amount > 0)) {
      setError("Bill number and amount are required.");
      return;
    }
    setBusy(true);
    const { data: bill, error: insertError } = await supabase
      .from("service_vendor_bills")
      .insert({
        service_vendor_id: vendor.id,
        work_order_id: billForm.work_order_id || null,
        bill_number: billForm.bill_number.trim(),
        bill_date: billForm.bill_date,
        due_date: billForm.due_date,
        amount,
        amount_paid: 0,
        status: "Open",
        memo: billForm.memo.trim() || null,
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (insertError || !bill) {
      setError(insertError?.message ?? "Could not save bill.");
      setBusy(false);
      return;
    }
    postApBill({
      vendor: vendor.name,
      amount,
      asOf: billForm.bill_date,
      billId: (bill as ServiceVendorBill).id,
      userId: profile.id,
    });
    setShowBill(false);
    setSuccess(`Bill ${billForm.bill_number.trim()} entered.`);
    setBusy(false);
    await load();
  }

  async function markBillPaid(bill: ServiceVendorBill) {
    if (!profile) return;
    const balance = billBalance(bill);
    if (balance <= 0) return;
    setBusy(true);
    const paid = Math.round((Number(bill.amount_paid) + balance) * 100) / 100;
    await supabase
      .from("service_vendor_bills")
      .update({
        amount_paid: paid,
        status: recomputeBillStatus(Number(bill.amount), paid, bill.status),
        updated_at: new Date().toISOString(),
      })
      .eq("id", bill.id);
    setSuccess("Bill marked paid.");
    setBusy(false);
    await load();
  }

  async function submitRating(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor || !profile) return;
    const rating = Number(ratingForm.rating);
    if (!(rating >= 1 && rating <= 5)) {
      setError("Rating must be 1–5.");
      return;
    }
    setBusy(true);
    const { error: insertError } = await supabase.from("service_vendor_ratings").insert({
      service_vendor_id: vendor.id,
      work_order_id: ratingForm.work_order_id || null,
      rating,
      notes: ratingForm.notes.trim() || null,
      created_by: profile.id,
    });
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }
    setRatingForm({ rating: "5", work_order_id: "", notes: "" });
    setSuccess("Rating saved.");
    setBusy(false);
    await load();
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading provider…</div>;
  }

  if (!profile || !allowed.has(profile.role)) {
    return (
      <EmptyState
        title="Unavailable"
        description="Only administrators, service managers, and billing can view service vendors."
      />
    );
  }

  if (!vendor) {
    return <EmptyState title="Provider not found" description={error ?? "Missing provider."} />;
  }

  const approval = vendor.approval_status ?? "Approved";
  const isManager = canApproveVendors(profile.role);
  const canEditMaster = canEditVendorMaster(profile.role);
  const usable = canUseServiceVendor(vendor);

  return (
    <div>
      <PageHeader
        title={vendor.name}
        description={`${vendor.primary_trade} service provider`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/service-vendors" className="btn btn-ghost btn-sm">
              ← Directory
            </Link>
            {isManager && approval === "Pending" ? (
              <>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={busy}
                  onClick={() => void review("Approved")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => void review("Rejected")}
                >
                  Reject
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!usable}
              onClick={() => {
                setBillForm({
                  bill_number: "",
                  bill_date: todayIso(),
                  due_date: addDaysIso(todayIso(), 30),
                  amount: "",
                  work_order_id: jobs[0]?.id ?? "",
                  memo: "",
                });
                setShowBill(true);
              }}
            >
              Enter service bill
            </button>
          </div>
        }
      />

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

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-3">
          <p className="text-xs opacity-60">Open service AP</p>
          <p className="text-xl font-bold tabular-nums">{formatMoney(openAp)}</p>
        </div>
        <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-3">
          <p className="text-xs opacity-60">Assigned jobs</p>
          <p className="text-xl font-bold tabular-nums">{jobs.length}</p>
        </div>
        <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-3">
          <p className="text-xs opacity-60">Avg rating</p>
          <p className="text-xl font-bold tabular-nums">{avg != null ? `${avg}★` : "—"}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card bg-base-100 shadow lg:col-span-1">
          <div className="card-body space-y-3">
            <h2 className="card-title text-base">Provider profile</h2>
            {canEditMaster ? (
              <form onSubmit={onSave} className="space-y-3">
                <FormRow label="Name" required>
                  <input
                    className="input input-bordered w-full"
                    value={vendor.name}
                    onChange={(e) => setVendor({ ...vendor, name: e.target.value })}
                    required
                  />
                </FormRow>
                <FormRow label="Primary trade">
                  <select
                    className="select select-bordered w-full"
                    value={vendor.primary_trade}
                    onChange={(e) => setVendor({ ...vendor, primary_trade: e.target.value })}
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
                    value={vendor.contact_name ?? ""}
                    onChange={(e) => setVendor({ ...vendor, contact_name: e.target.value })}
                  />
                </FormRow>
                <FormRow label="Email">
                  <input
                    type="email"
                    className="input input-bordered w-full"
                    value={vendor.email ?? ""}
                    onChange={(e) => setVendor({ ...vendor, email: e.target.value })}
                  />
                </FormRow>
                <FormRow label="Phone">
                  <input
                    className="input input-bordered w-full"
                    value={vendor.phone ?? ""}
                    onChange={(e) => setVendor({ ...vendor, phone: e.target.value })}
                  />
                </FormRow>
                <FormRow label="Service area">
                  <input
                    className="input input-bordered w-full"
                    value={vendor.service_area ?? ""}
                    onChange={(e) => setVendor({ ...vendor, service_area: e.target.value })}
                  />
                </FormRow>
                <FormRow label="Notes">
                  <textarea
                    className="textarea textarea-bordered w-full"
                    rows={2}
                    value={vendor.notes ?? ""}
                    onChange={(e) => setVendor({ ...vendor, notes: e.target.value })}
                  />
                </FormRow>
                <p className="text-xs opacity-60">Approval: {approval}</p>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <div className="flex flex-wrap gap-2 border-t border-base-300 pt-3">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={busy}
                    onClick={() => void setActive(!vendor.is_active)}
                  >
                    {vendor.is_active ? "Set inactive" : "Set active"}
                  </button>
                  {canDeleteVendor(profile.role) ? (
                    <button
                      type="button"
                      className="btn btn-error btn-outline btn-sm"
                      disabled={busy}
                      onClick={() => void deleteVendor()}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="space-y-2 text-sm">
                <FormRow label="Trade">
                  <span>{vendor.primary_trade}</span>
                </FormRow>
                <FormRow label="Contact">
                  <span>{vendor.contact_name ?? "—"}</span>
                </FormRow>
                <FormRow label="Email">
                  <span>{vendor.email ?? "—"}</span>
                </FormRow>
                <FormRow label="Phone">
                  <span>{vendor.phone ?? "—"}</span>
                </FormRow>
                <FormRow label="Service area">
                  <span>{vendor.service_area ?? "—"}</span>
                </FormRow>
                <FormRow label="Notes">
                  <span>{vendor.notes ?? "—"}</span>
                </FormRow>
                <p className="text-xs opacity-60">
                  Approval: {approval}
                  {vendor.is_active ? " · Active" : " · Inactive"}
                </p>
                <p className="text-xs opacity-50">
                  Only managers and administrators can edit provider master data.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">

          <section className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-base">Assigned work orders</h2>
              <div className="flex flex-wrap gap-2">
                <select
                  className="select select-bordered select-sm min-w-[16rem] flex-1"
                  value={assignJobId}
                  onChange={(e) => setAssignJobId(e.target.value)}
                  disabled={!usable}
                >
                  <option value="">Select work order…</option>
                  {openJobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.work_order_number} — {j.problem_description ?? "Job"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!assignJobId || busy || !usable}
                  onClick={() => void assignJob()}
                >
                  Assign
                </button>
              </div>
              {jobs.length === 0 ? (
                <p className="mt-3 text-sm opacity-60">No jobs assigned yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-base-300">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <Link href={`/work-orders/${j.id}`} className="link link-hover font-medium">
                          {j.work_order_number}
                        </Link>
                        <p className="text-xs opacity-60">
                          {j.status}
                          {j.scheduled_date ? ` · ${j.scheduled_date}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={busy}
                        onClick={() => void unassignJob(j.id)}
                      >
                        Unassign
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-base">Service bills</h2>
              {bills.length === 0 ? (
                <p className="text-sm opacity-60">No service bills yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Bill #</th>
                        <th>Date</th>
                        <th className="text-right">Balance</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map((b) => (
                        <tr key={b.id}>
                          <td className="font-medium">{b.bill_number}</td>
                          <td>{b.bill_date}</td>
                          <td className="text-right tabular-nums">
                            {formatMoney(billBalance(b))}
                          </td>
                          <td>
                            <StatusBadge label={b.status} tone={statusTone(b.status)} />
                          </td>
                          <td className="text-right">
                            {billBalance(b) > 0 ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-xs"
                                disabled={busy}
                                onClick={() => void markBillPaid(b)}
                              >
                                Mark paid
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="card bg-base-100 shadow">
            <div className="card-body space-y-3">
              <h2 className="card-title text-base">Performance ratings</h2>
              <form onSubmit={submitRating} className="grid gap-2 sm:grid-cols-4">
                <select
                  className="select select-bordered select-sm"
                  value={ratingForm.rating}
                  onChange={(e) => setRatingForm({ ...ratingForm, rating: e.target.value })}
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n}★
                    </option>
                  ))}
                </select>
                <select
                  className="select select-bordered select-sm sm:col-span-2"
                  value={ratingForm.work_order_id}
                  onChange={(e) => setRatingForm({ ...ratingForm, work_order_id: e.target.value })}
                >
                  <option value="">Job (optional)</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.work_order_number}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn-outline btn-sm" disabled={busy}>
                  Add rating
                </button>
                <input
                  className="input input-bordered input-sm sm:col-span-4"
                  placeholder="Notes"
                  value={ratingForm.notes}
                  onChange={(e) => setRatingForm({ ...ratingForm, notes: e.target.value })}
                />
              </form>
              {ratings.length === 0 ? (
                <p className="text-sm opacity-60">No ratings yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {ratings.map((r) => (
                    <li key={r.id} className="rounded-lg border border-base-300 px-3 py-2">
                      <span className="font-semibold">{r.rating}★</span>
                      {r.notes ? <span className="opacity-70"> — {r.notes}</span> : null}
                      <span className="ml-2 text-xs opacity-50">{r.created_at.slice(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      {showBill ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-md">
            <h2 className="text-xl font-bold">Enter service bill</h2>
            <form onSubmit={submitBill} className="mt-4 space-y-3">
              <FormRow label="Bill number" required>
                <input
                  className="input input-bordered w-full"
                  value={billForm.bill_number}
                  onChange={(e) => setBillForm({ ...billForm, bill_number: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="Work order">
                <select
                  className="select select-bordered w-full"
                  value={billForm.work_order_id}
                  onChange={(e) => setBillForm({ ...billForm, work_order_id: e.target.value })}
                >
                  <option value="">None</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.work_order_number}
                    </option>
                  ))}
                </select>
              </FormRow>
              <div className="grid grid-cols-2 gap-3">
                <FormRow label="Bill date" required>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={billForm.bill_date}
                    onChange={(e) => setBillForm({ ...billForm, bill_date: e.target.value })}
                    required
                  />
                </FormRow>
                <FormRow label="Due date" required>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={billForm.due_date}
                    onChange={(e) => setBillForm({ ...billForm, due_date: e.target.value })}
                    required
                  />
                </FormRow>
              </div>
              <FormRow label="Amount" required>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={billForm.amount}
                  onChange={(e) => setBillForm({ ...billForm, amount: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="Memo">
                <input
                  className="input input-bordered w-full"
                  value={billForm.memo}
                  onChange={(e) => setBillForm({ ...billForm, memo: e.target.value })}
                />
              </FormRow>
              <div className="modal-action">
                <button type="button" className="btn btn-ghost" onClick={() => setShowBill(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Save bill
                </button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setShowBill(false)}>
              close
            </button>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
