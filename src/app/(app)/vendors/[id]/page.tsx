"use client";

/**
 * Vendor detail — edit profile, enter bills, pay bills, view AP aging.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import { postApBill, postApPayment } from "@/lib/accounting/postings";
import type {
  Profile,
  Vendor,
  VendorBill,
  VendorBillPayment,
  VendorPaymentMethod,
} from "@/lib/types";
import {
  addDaysIso,
  agingHint,
  billBalance,
  canApproveVendors,
  canDeleteVendor,
  canEditVendorMaster,
  canEnterBillsForVendor,
  isVendorSchemaError,
  openBalanceForBills,
  overdueBalanceForBills,
  recomputeBillStatus,
  todayIso,
} from "@/lib/vendors";

const ALLOWED_ROLES = new Set(["administrator", "service_manager", "billing"]);
const PAYMENT_METHODS: VendorPaymentMethod[] = ["Check", "ACH", "Cash", "Card", "Other"];

type BillWithPayments = VendorBill & { payments: VendorBillPayment[] };

function termsToDays(terms: string): number {
  const m = /(\d+)/.exec(terms);
  return m ? Number(m[1]) : 30;
}

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [bills, setBills] = useState<BillWithPayments[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showBill, setShowBill] = useState(false);
  const [showPay, setShowPay] = useState<VendorBill | null>(null);
  const [billForm, setBillForm] = useState({
    bill_number: "",
    bill_date: todayIso(),
    due_date: "",
    amount: "",
    memo: "",
  });
  const [payForm, setPayForm] = useState({
    payment_date: todayIso(),
    amount: "",
    method: "Check" as VendorPaymentMethod,
    memo: "",
  });
  const [busy, setBusy] = useState(false);

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

    const [{ data: v, error: vErr }, { data: billRows, error: bErr }] = await Promise.all([
      supabase.from("vendors").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("vendor_bills")
        .select("*")
        .eq("vendor_id", id)
        .order("bill_date", { ascending: false }),
    ]);

    if (vErr || bErr) {
      const msg = vErr?.message ?? bErr?.message ?? "Failed to load vendor.";
      setError(
        isVendorSchemaError(msg)
          ? "Vendor tables are not set up yet. Run supabase/migrations/20260806_vendors_ap.sql in Supabase."
          : msg,
      );
      setVendor(null);
      setBills([]);
      setLoading(false);
      return;
    }

    if (!v) {
      setVendor(null);
      setBills([]);
      setLoading(false);
      return;
    }

    const billList = (billRows as VendorBill[]) ?? [];
    const billIds = billList.map((b) => b.id);
    let payments: VendorBillPayment[] = [];
    if (billIds.length > 0) {
      const { data: payRows, error: pErr } = await supabase
        .from("vendor_bill_payments")
        .select("*")
        .in("bill_id", billIds)
        .order("payment_date", { ascending: false });
      if (pErr) {
        setError(pErr.message);
      } else {
        payments = (payRows as VendorBillPayment[]) ?? [];
      }
    }

    setVendor(v as Vendor);
    setBills(
      billList.map((b) => ({
        ...b,
        payments: payments.filter((p) => p.bill_id === b.id),
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [id]);

  const openAp = useMemo(() => openBalanceForBills(bills), [bills]);
  const overdueAp = useMemo(() => overdueBalanceForBills(bills), [bills]);

  async function onSaveVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor || !profile || !canEditVendorMaster(profile.role)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const { error: updErr } = await supabase
      .from("vendors")
      .update({
        name: vendor.name.trim(),
        contact_name: vendor.contact_name?.trim() || null,
        email: vendor.email?.trim() || null,
        phone: vendor.phone?.trim() || null,
        address_line1: vendor.address_line1?.trim() || null,
        city: vendor.city?.trim() || null,
        state: vendor.state?.trim() || null,
        postal_code: vendor.postal_code?.trim() || null,
        payment_terms: vendor.payment_terms.trim() || "Net 30",
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
    await logActivity(supabase, {
      userId: profile.id,
      action: "vendor_updated",
      recordType: "vendor",
      recordId: id,
      newValue: vendor.name,
    });
    setSuccess("Vendor saved.");
    setSaving(false);
    await load();
  }

  function openEnterBill() {
    if (!vendor) return;
    if (!canEnterBillsForVendor(vendor)) {
      setError(
        (vendor.approval_status ?? "Approved") !== "Approved"
          ? "Vendor must be approved before entering bills."
          : "Reactivate the vendor before entering bills.",
      );
      return;
    }
    const today = todayIso();
    setBillForm({
      bill_number: "",
      bill_date: today,
      due_date: addDaysIso(today, termsToDays(vendor.payment_terms)),
      amount: "",
      memo: "",
    });
    setShowBill(true);
    setError(null);
    setSuccess(null);
  }

  async function setVendorActive(active: boolean) {
    if (!vendor || !profile || !canEditVendorMaster(profile.role)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const { error: updErr } = await supabase
      .from("vendors")
      .update({
        is_active: active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updErr) {
      setError(updErr.message);
      setBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: active ? "vendor_reactivated" : "vendor_deactivated",
      recordType: "vendor",
      recordId: id,
      newValue: vendor.name,
    });
    setSuccess(active ? "Vendor set to active." : "Vendor set to inactive.");
    setBusy(false);
    await load();
  }

  async function reviewVendor(decision: "Approved" | "Rejected") {
    if (!vendor || !profile || !canApproveVendors(profile.role)) return;
    setBusy(true);
    setError(null);
    const { error: updErr } = await supabase
      .from("vendors")
      .update({
        approval_status: decision,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        is_active: decision === "Approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updErr) {
      setError(updErr.message);
      setBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: decision === "Approved" ? "vendor_approved" : "vendor_rejected",
      recordType: "vendor",
      recordId: id,
      newValue: vendor.name,
    });
    setSuccess(decision === "Approved" ? "Vendor approved." : "Vendor rejected.");
    setBusy(false);
    await load();
  }

  async function deleteVendor() {
    if (!vendor || !profile || !canDeleteVendor(profile.role)) return;
    if (bills.length > 0) {
      setError(
        "Cannot delete a vendor with bills. Set the vendor inactive instead to preserve AP history.",
      );
      return;
    }
    if (!window.confirm(`Permanently delete vendor ${vendor.name}?`)) return;
    setBusy(true);
    setError(null);
    const { error: delErr } = await supabase.from("vendors").delete().eq("id", id);
    if (delErr) {
      setError(delErr.message);
      setBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: "vendor_deleted",
      recordType: "vendor",
      recordId: id,
      newValue: vendor.name,
    });
    router.push("/vendors");
  }

  async function submitBill(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor || !profile) return;
    if (!canEnterBillsForVendor(vendor)) {
      setError("Vendor must be approved and active before entering bills.");
      return;
    }
    const amount = Number(billForm.amount);
    if (!billForm.bill_number.trim()) {
      setError("Bill number is required.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Bill amount must be greater than zero.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data: bill, error: insertError } = await supabase
      .from("vendor_bills")
      .insert({
        vendor_id: vendor.id,
        bill_number: billForm.bill_number.trim(),
        bill_date: billForm.bill_date,
        due_date: billForm.due_date || addDaysIso(billForm.bill_date, 30),
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
      setError(insertError?.message ?? "Could not create bill.");
      setBusy(false);
      return;
    }

    const journal = postApBill({
      vendor: vendor.name,
      amount,
      asOf: billForm.bill_date,
      billId: (bill as VendorBill).id,
      userId: profile.id,
    });
    if (!journal.ok) {
      // Subledger saved; local GL is best-effort educational ledger
      console.warn(journal.error);
    }

    await logActivity(supabase, {
      userId: profile.id,
      action: "vendor_bill_created",
      recordType: "vendor_bill",
      recordId: (bill as VendorBill).id,
      newValue: `${billForm.bill_number} · $${amount.toFixed(2)}`,
    });

    setShowBill(false);
    setSuccess(`Bill ${billForm.bill_number.trim()} entered.`);
    setBusy(false);
    await load();
  }

  function openPayBill(bill: VendorBill) {
    const balance = billBalance(bill);
    setPayForm({
      payment_date: todayIso(),
      amount: balance > 0 ? String(balance) : "",
      method: "Check",
      memo: "",
    });
    setShowPay(bill);
    setError(null);
    setSuccess(null);
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor || !profile || !showPay) return;
    const amount = Number(payForm.amount);
    const balance = billBalance(showPay);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Payment amount must be greater than zero.");
      return;
    }
    if (amount > balance + 0.005) {
      setError(`Payment cannot exceed open balance (${formatMoney(balance)}).`);
      return;
    }
    setBusy(true);
    setError(null);

    const { data: payment, error: payErr } = await supabase
      .from("vendor_bill_payments")
      .insert({
        bill_id: showPay.id,
        payment_date: payForm.payment_date,
        amount,
        method: payForm.method,
        memo: payForm.memo.trim() || null,
        created_by: profile.id,
      })
      .select("*")
      .single();

    if (payErr || !payment) {
      setError(payErr?.message ?? "Could not record payment.");
      setBusy(false);
      return;
    }

    const newPaid = Math.round((Number(showPay.amount_paid) + amount) * 100) / 100;
    const newStatus = recomputeBillStatus(Number(showPay.amount), newPaid, showPay.status);
    const { error: billUpdErr } = await supabase
      .from("vendor_bills")
      .update({
        amount_paid: newPaid,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", showPay.id);

    if (billUpdErr) {
      setError(billUpdErr.message);
      setBusy(false);
      return;
    }

    const journal = postApPayment({
      vendor: vendor.name,
      amount,
      asOf: payForm.payment_date,
      paymentId: (payment as VendorBillPayment).id,
      userId: profile.id,
    });
    if (!journal.ok) console.warn(journal.error);

    await logActivity(supabase, {
      userId: profile.id,
      action: "vendor_bill_paid",
      recordType: "vendor_bill_payment",
      recordId: (payment as VendorBillPayment).id,
      newValue: `${showPay.bill_number} · $${amount.toFixed(2)}`,
    });

    setShowPay(null);
    setSuccess(`Payment of ${formatMoney(amount)} recorded.`);
    setBusy(false);
    await load();
  }

  async function voidBill(bill: VendorBill) {
    if (!profile) return;
    if (Number(bill.amount_paid) > 0) {
      setError("Cannot void a bill that already has payments.");
      return;
    }
    if (!window.confirm(`Void bill ${bill.bill_number}?`)) return;
    setBusy(true);
    const { error: voidErr } = await supabase
      .from("vendor_bills")
      .update({ status: "Void", updated_at: new Date().toISOString() })
      .eq("id", bill.id);
    if (voidErr) {
      setError(voidErr.message);
      setBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: "vendor_bill_voided",
      recordType: "vendor_bill",
      recordId: bill.id,
      newValue: bill.bill_number,
    });
    setSuccess(`Bill ${bill.bill_number} voided.`);
    setBusy(false);
    await load();
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading vendor…</div>;
  }

  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return (
      <EmptyState
        title="Vendors unavailable"
        description="Only managers, administrators, and billing can access the vendor portal."
      />
    );
  }

  if (!vendor) {
    return (
      <EmptyState
        title="Vendor not found"
        description={error ?? "This vendor does not exist or you cannot view it."}
      />
    );
  }

  const approval = vendor.approval_status ?? "Approved";
  const canBill = canEnterBillsForVendor(vendor);
  const isManager = canApproveVendors(profile.role);
  const canEditMaster = canEditVendorMaster(profile.role);
  const canDelete = canDeleteVendor(profile.role);

  return (
    <div>
      <PageHeader
        title={vendor.name}
        description={
          approval === "Pending"
            ? "Pending manager/admin approval"
            : approval === "Rejected"
              ? "Rejected — bills not allowed"
              : "Vendor profile and accounts payable"
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/vendors" className="btn btn-ghost btn-sm">
              ← Suppliers
            </Link>
            {isManager && approval === "Pending" ? (
              <>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={busy}
                  onClick={() => void reviewVendor("Approved")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => void reviewVendor("Rejected")}
                >
                  Reject
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canBill}
              onClick={openEnterBill}
              title={canBill ? undefined : "Approved active vendors only"}
            >
              Enter bill
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
          <p className="text-xs opacity-60">Open AP</p>
          <p className="text-xl font-bold tabular-nums">{formatMoney(openAp)}</p>
        </div>
        <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-3">
          <p className="text-xs opacity-60">Overdue</p>
          <p className="text-xl font-bold tabular-nums text-error">{formatMoney(overdueAp)}</p>
        </div>
        <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-3">
          <p className="text-xs opacity-60">Bills</p>
          <p className="text-xl font-bold tabular-nums">{bills.length}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card bg-base-100 shadow lg:col-span-1">
          <div className="card-body space-y-3">
            <h2 className="card-title text-base">Details</h2>
            {canEditMaster ? (
              <form onSubmit={onSaveVendor} className="space-y-3">
                <FormRow label="Name" required>
                  <input
                    className="input input-bordered w-full"
                    value={vendor.name}
                    onChange={(e) => setVendor({ ...vendor, name: e.target.value })}
                    required
                  />
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
                <FormRow label="Address">
                  <input
                    className="input input-bordered w-full"
                    value={vendor.address_line1 ?? ""}
                    onChange={(e) => setVendor({ ...vendor, address_line1: e.target.value })}
                  />
                </FormRow>
                <div className="grid grid-cols-3 gap-2">
                  <FormRow label="City">
                    <input
                      className="input input-bordered w-full"
                      value={vendor.city ?? ""}
                      onChange={(e) => setVendor({ ...vendor, city: e.target.value })}
                    />
                  </FormRow>
                  <FormRow label="State">
                    <input
                      className="input input-bordered w-full"
                      value={vendor.state ?? ""}
                      onChange={(e) => setVendor({ ...vendor, state: e.target.value })}
                    />
                  </FormRow>
                  <FormRow label="ZIP">
                    <input
                      className="input input-bordered w-full"
                      value={vendor.postal_code ?? ""}
                      onChange={(e) => setVendor({ ...vendor, postal_code: e.target.value })}
                    />
                  </FormRow>
                </div>
                <FormRow label="Payment terms">
                  <input
                    className="input input-bordered w-full"
                    value={vendor.payment_terms}
                    onChange={(e) => setVendor({ ...vendor, payment_terms: e.target.value })}
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
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={vendor.is_active}
                    onChange={(e) => setVendor({ ...vendor, is_active: e.target.checked })}
                  />
                  <span className="label-text">Active</span>
                </label>
                <p className="text-xs opacity-60">
                  Status: {approval}
                  {approval === "Pending" ? " — bills locked until approved" : ""}
                </p>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <div className="flex flex-wrap gap-2 border-t border-base-300 pt-3">
                  {vendor.is_active ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={busy}
                      onClick={() => void setVendorActive(false)}
                    >
                      Set inactive
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={busy}
                      onClick={() => void setVendorActive(true)}
                    >
                      Set active
                    </button>
                  )}
                  {canDelete ? (
                    <button
                      type="button"
                      className="btn btn-error btn-outline btn-sm"
                      disabled={busy}
                      onClick={() => void deleteVendor()}
                      title={
                        bills.length > 0
                          ? "Delete blocked while bills exist — use inactive"
                          : "Permanently delete vendor"
                      }
                    >
                      Delete vendor
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="space-y-2 text-sm">
                <FormRow label="Contact">
                  <span>{vendor.contact_name ?? "—"}</span>
                </FormRow>
                <FormRow label="Email">
                  <span>{vendor.email ?? "—"}</span>
                </FormRow>
                <FormRow label="Phone">
                  <span>{vendor.phone ?? "—"}</span>
                </FormRow>
                <FormRow label="Address">
                  <span>
                    {[vendor.address_line1, vendor.city, vendor.state, vendor.postal_code]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </span>
                </FormRow>
                <FormRow label="Payment terms">
                  <span>{vendor.payment_terms}</span>
                </FormRow>
                <FormRow label="Notes">
                  <span>{vendor.notes ?? "—"}</span>
                </FormRow>
                <p className="text-xs opacity-60">
                  Status: {approval}
                  {vendor.is_active ? " · Active" : " · Inactive"}
                  {approval === "Pending" ? " — bills locked until approved" : ""}
                </p>
                <p className="text-xs opacity-50">
                  Only managers and administrators can edit supplier master data. Billing can enter
                  bills and payments.
                </p>
              </div>
            )}
          </div>
        </div>

        <section className="card bg-base-100 shadow lg:col-span-2">
          <div className="card-body">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="card-title text-base">Bills</h2>
              <button type="button" className="btn btn-outline btn-sm" onClick={openEnterBill}>
                Enter bill
              </button>
            </div>

            {bills.length === 0 ? (
              <EmptyState
                title="No bills yet"
                description="Enter a vendor bill to post AP and track what you owe."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Bill #</th>
                      <th>Date</th>
                      <th>Due</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">Balance</th>
                      <th>Aging</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((bill) => {
                      const balance = billBalance(bill);
                      return (
                        <tr key={bill.id} className="align-top">
                          <td className="font-medium">
                            {bill.bill_number}
                            {bill.payments.length > 0 ? (
                              <ul className="mt-1 space-y-0.5 text-xs opacity-60">
                                {bill.payments.map((p) => (
                                  <li key={p.id}>
                                    Paid {formatMoney(Number(p.amount))} · {p.method} ·{" "}
                                    {p.payment_date}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                          <td>{bill.bill_date}</td>
                          <td>{bill.due_date}</td>
                          <td className="text-right tabular-nums">
                            {formatMoney(Number(bill.amount))}
                          </td>
                          <td className="text-right tabular-nums font-medium">
                            {formatMoney(balance)}
                          </td>
                          <td className="text-sm">{agingHint(bill)}</td>
                          <td>
                            <StatusBadge label={bill.status} tone={statusTone(bill.status)} />
                          </td>
                          <td className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              {balance > 0 && bill.status !== "Void" ? (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-xs"
                                  disabled={busy}
                                  onClick={() => openPayBill(bill)}
                                >
                                  Pay
                                </button>
                              ) : null}
                              {bill.status === "Open" && Number(bill.amount_paid) === 0 ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs"
                                  disabled={busy}
                                  onClick={() => void voidBill(bill)}
                                >
                                  Void
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {showBill ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-md">
            <h2 className="text-xl font-bold">Enter bill</h2>
            <form onSubmit={submitBill} className="mt-4 space-y-3">
              <FormRow label="Bill number" required>
                <input
                  className="input input-bordered w-full"
                  value={billForm.bill_number}
                  onChange={(e) => setBillForm({ ...billForm, bill_number: e.target.value })}
                  required
                />
              </FormRow>
              <div className="grid grid-cols-2 gap-3">
                <FormRow label="Bill date" required>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={billForm.bill_date}
                    onChange={(e) => {
                      const bill_date = e.target.value;
                      setBillForm({
                        ...billForm,
                        bill_date,
                        due_date: addDaysIso(bill_date, termsToDays(vendor.payment_terms)),
                      });
                    }}
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => setShowBill(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save bill"}
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

      {showPay ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-md">
            <h2 className="text-xl font-bold">Pay bill {showPay.bill_number}</h2>
            <p className="mt-1 text-sm opacity-70">
              Open balance {formatMoney(billBalance(showPay))}
            </p>
            <form onSubmit={submitPayment} className="mt-4 space-y-3">
              <FormRow label="Payment date" required>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={payForm.payment_date}
                  onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="Amount" required>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="Method" required>
                <select
                  className="select select-bordered w-full"
                  value={payForm.method}
                  onChange={(e) =>
                    setPayForm({ ...payForm, method: e.target.value as VendorPaymentMethod })
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Memo">
                <input
                  className="input input-bordered w-full"
                  value={payForm.memo}
                  onChange={(e) => setPayForm({ ...payForm, memo: e.target.value })}
                />
              </FormRow>
              <div className="modal-action">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => setShowPay(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Record payment"}
                </button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setShowPay(null)}>
              close
            </button>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
