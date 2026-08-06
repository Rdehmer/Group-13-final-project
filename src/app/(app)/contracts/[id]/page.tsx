"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import type { Customer, Profile, ServiceContract } from "@/lib/types";
import { ApplyContractPlanPreset } from "@/components/ApplyContractPlanPreset";
import { ContractPricingSummary } from "@/components/ContractPricingSummary";
import { monthlyPremiumFromContract, formatMonthlyPremium } from "@/lib/contract-pricing";
import {
  parsePlanSnapshotFromNotes,
  resolvePackIdFromSnapshot,
  sumEquipmentAssetValue,
} from "@/lib/contract-plans";
import {
  formatStandingDetail,
  getContractPaymentStanding,
  monthlyFromAnnual,
  resolveMoneyFromContractNotes,
  resolvedDeductible,
  resolvedMonthlyAmount,
  standingBadgeClass,
} from "@/lib/contract-billing";
import type { Invoice } from "@/lib/types";

type ContractDetail = ServiceContract & { customers?: { id: string; name: string } | null };

type CoveredEquipment = {
  id: string;
  name: string;
  location: string | null;
  replacement_cost?: number | null;
};

/**
 * This business faces outdated contract terms risk.
 * Our app reduces the risk by letting managers edit contract details and jump to the customer record.
 */
export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [equipment, setEquipment] = useState<CoveredEquipment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [standingInvoices, setStandingInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: "",
    name: "",
    contract_type: "Preventive Maintenance",
    start_date: "",
    end_date: "",
    renewal_option: "",
    billing_method: "Monthly Recurring Charge",
    contract_price: "0",
    monthly_amount: "0",
    deductible: "0",
    payment_terms: "",
    included_service_visits: "0",
    service_frequency: "",
    included_labor_hours: "0",
    included_replacement_parts: "0",
    emergency_response_commitment: "",
    warranty_terms: "",
    cancellation_terms: "",
    approval_requirements: "",
    status: "Draft",
    notes: "",
  });

  const isManager =
    profile?.role === "service_manager" || profile?.role === "administrator";
  const isPending = contract?.status === "Pending Approval";

  async function load() {
    setLoading(true);
    const [{ data }, { data: cust }, { data: { user } }, { data: links }, { data: inv }] =
      await Promise.all([
      supabase.from("service_contracts").select("*, customers(id, name)").eq("id", id).single(),
      supabase.from("customers").select("*").order("name"),
      supabase.auth.getUser(),
      supabase
        .from("contract_equipment")
        .select("equipment ( id, name, location, replacement_cost )")
        .eq("contract_id", id),
      supabase
        .from("invoices")
        .select("*")
        .eq("contract_id", id)
        .is("work_order_id", null)
        .gt("recurring_service_charge", 0),
    ]);
    const sc = data as ContractDetail | null;
    setContract(sc);
    setCustomers((cust as Customer[]) ?? []);
    setStandingInvoices((inv as Invoice[]) ?? []);
    const covered = ((links as { equipment: CoveredEquipment | CoveredEquipment[] | null }[] | null) ?? [])
      .flatMap((row) => {
        const eq = row.equipment;
        if (!eq) return [];
        return Array.isArray(eq) ? eq : [eq];
      })
      .filter((eq): eq is CoveredEquipment => !!eq?.id);
    setEquipment(covered);
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
    }
    if (sc) {
      setForm({
        customer_id: sc.customer_id,
        name: sc.name,
        contract_type: sc.contract_type,
        start_date: sc.start_date ?? "",
        end_date: sc.end_date ?? "",
        renewal_option: sc.renewal_option ?? "",
        billing_method: sc.billing_method,
        contract_price: String(sc.contract_price ?? 0),
        monthly_amount: String(sc.monthly_amount ?? resolvedMonthlyAmount(sc)),
        deductible: String(sc.deductible ?? 0),
        payment_terms: sc.payment_terms ?? "",
        included_service_visits: String(sc.included_service_visits ?? 0),
        service_frequency: sc.service_frequency ?? "",
        included_labor_hours: String(sc.included_labor_hours ?? 0),
        included_replacement_parts: String(sc.included_replacement_parts ?? 0),
        emergency_response_commitment: sc.emergency_response_commitment ?? "",
        warranty_terms: sc.warranty_terms ?? "",
        cancellation_terms: sc.cancellation_terms ?? "",
        approval_requirements: sc.approval_requirements ?? "",
        status: sc.status,
        notes: sc.notes ?? "",
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager || !contract) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const annual = Number(form.contract_price) || 0;
    const monthly =
      Number(form.monthly_amount) > 0
        ? Number(form.monthly_amount)
        : /monthly\s*recurring/i.test(form.billing_method)
          ? monthlyFromAnnual(annual)
          : 0;
    const payload = {
      customer_id: form.customer_id,
      name: form.name.trim(),
      contract_type: form.contract_type,
      start_date: form.start_date,
      end_date: form.end_date,
      renewal_option: form.renewal_option.trim() || null,
      billing_method: form.billing_method,
      contract_price: annual,
      monthly_amount: monthly,
      deductible: Number(form.deductible) || 0,
      payment_terms: form.payment_terms.trim() || null,
      included_service_visits: Number(form.included_service_visits),
      service_frequency: form.service_frequency.trim() || null,
      included_labor_hours: Number(form.included_labor_hours),
      included_replacement_parts: Number(form.included_replacement_parts),
      emergency_response_commitment: form.emergency_response_commitment.trim() || null,
      warranty_terms: form.warranty_terms.trim() || null,
      cancellation_terms: form.cancellation_terms.trim() || null,
      approval_requirements: form.approval_requirements.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error: updateError } = await supabase
      .from("service_contracts")
      .update(payload)
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "updated",
      recordType: "contract",
      recordId: id,
      newValue: payload.name,
    });
    setMessage("Contract details saved.");
    setSaving(false);
    load();
  }

  async function approveRequest() {
    if (!isManager || !contract) return;
    let price = Number(form.contract_price);
    let monthly = Number(form.monthly_amount) || 0;
    let deductible = Number(form.deductible) || 0;
    if (!Number.isFinite(price) || price <= 0) {
      const fromPlan = resolveMoneyFromContractNotes(form.notes || contract.notes);
      if (fromPlan && fromPlan.contract_price > 0) {
        price = fromPlan.contract_price;
        monthly = fromPlan.monthly_amount;
        deductible = fromPlan.deductible;
        setForm((prev) => ({
          ...prev,
          contract_price: String(price),
          monthly_amount: String(monthly),
          deductible: String(deductible),
          billing_method: fromPlan.billing_method || prev.billing_method,
        }));
      }
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError("Enter a contract price greater than $0 before approving (or apply a plan preset).");
      return;
    }
    if (monthly <= 0 && /monthly\s*recurring/i.test(form.billing_method)) {
      monthly = monthlyFromAnnual(price);
    }
    setActionBusy(true);
    setError(null);
    setMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("service_contracts")
      .update({
        status: "Active",
        contract_price: price,
        monthly_amount: monthly,
        deductible,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
      setActionBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "contract_approved",
      recordType: "contract",
      recordId: id,
      previousValue: "Pending Approval",
      newValue: `Active @ ${formatMoney(price)}`,
    });
    setMessage("Request approved — contract is now Active.");
    setActionBusy(false);
    load();
  }

  async function rejectRequest() {
    if (!isManager || !contract) return;
    setActionBusy(true);
    setError(null);
    setMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const note = [form.notes.trim(), "Rejected by Ridley (customer request not approved)."]
      .filter(Boolean)
      .join("\n");
    const { error: updateError } = await supabase
      .from("service_contracts")
      .update({
        status: "Canceled",
        notes: note,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
      setActionBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "contract_rejected",
      recordType: "contract",
      recordId: id,
      previousValue: "Pending Approval",
      newValue: "Canceled",
    });
    setMessage("Request rejected — contract marked Canceled.");
    setActionBusy(false);
    load();
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  if (!contract) {
    return (
      <div className="p-6">
        <EmptyState
          title="Contract not found"
          description="This contract may have been removed."
          action={
            <Link href="/contracts" className="btn btn-sm">
              Back to Contracts
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={contract.name}
        description={isManager ? "View and edit contract details" : "Contract details"}
        actions={
          <div className="flex flex-wrap gap-2">
            {contract.customers?.id ? (
              <Link href={`/customers/${contract.customers.id}`} className="btn btn-ghost btn-sm">
                Customer
              </Link>
            ) : null}
            <Link href="/work-orders" className="btn btn-ghost btn-sm">
              Work Orders
            </Link>
            <Link href="/billing" className="btn btn-ghost btn-sm">
              Billing
            </Link>
            <Link href="/contracts" className="btn btn-ghost btn-sm">
              ← Back
            </Link>
          </div>
        }
      />

      <form onSubmit={onSave} className="card bg-base-100 shadow max-w-2xl">
        <div className="card-body space-y-3">
          {error ? <div className="alert alert-error text-sm">{error}</div> : null}
          {message ? <div className="alert alert-success text-sm">{message}</div> : null}

          {isManager && isPending ? (
            <div className="rounded-box border border-warning/40 bg-warning/5 p-4">
              <p className="font-medium">Customer request awaiting approval</p>
              <p className="mt-1 text-sm opacity-70">
                Apply an industry plan preset (or set price manually), then Approve to activate or
                Reject to cancel.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={actionBusy}
                  onClick={() => void approveRequest()}
                >
                  {actionBusy ? "Working…" : "Approve request"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-error btn-sm"
                  disabled={actionBusy}
                  onClick={() => void rejectRequest()}
                >
                  Reject request
                </button>
              </div>
            </div>
          ) : null}

          {isManager ? (
            <ApplyContractPlanPreset
              form={form}
              suggestedAssetValue={sumEquipmentAssetValue(equipment)}
              customerName={customers.find((c) => c.id === form.customer_id)?.name}
              updateName={false}
              initialPackId={
                (() => {
                  const snap = parsePlanSnapshotFromNotes(form.notes || contract.notes);
                  return snap ? resolvePackIdFromSnapshot(snap) : null;
                })()
              }
              initialTierId={
                parsePlanSnapshotFromNotes(form.notes || contract.notes)?.tierId ?? null
              }
              onApply={(next) =>
                setForm((prev) => ({
                  ...prev,
                  ...next,
                  monthly_amount: next.monthly_amount ?? prev.monthly_amount,
                  deductible: next.deductible ?? prev.deductible,
                }))
              }
            />
          ) : null}

          {parsePlanSnapshotFromNotes(form.notes || contract.notes) ? (
            <div className="badge badge-outline badge-lg gap-1">
              Plan:{" "}
              {(() => {
                const snap = parsePlanSnapshotFromNotes(form.notes || contract.notes)!;
                return `${snap.packName} · ${snap.tierName} · ${snap.bandLabel}`;
              })()}
            </div>
          ) : null}

          <div className="rounded-box border border-base-300 bg-base-200/40 p-4">
            <p className="text-sm font-medium">Covered equipment</p>
            {equipment.length === 0 ? (
              <p className="mt-1 text-sm opacity-60">No equipment linked to this contract.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {equipment.map((eq) => (
                  <li key={eq.id}>
                    <span className="font-medium">{eq.name}</span>
                    {eq.location ? <span className="opacity-60"> · {eq.location}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!isManager ? (
            <div className="flex flex-wrap gap-2">
              <StatusBadge label={contract.status} tone={statusTone(contract.status)} />
              <span className="text-sm opacity-70">{formatMoney(contract.contract_price)}</span>
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
              <span className="font-medium">{contract.name}</span>
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
            ) : contract.customers?.id ? (
              <Link href={`/customers/${contract.customers.id}`} className="link link-primary">
                {contract.customers.name}
              </Link>
            ) : (
              <span>—</span>
            )}
          </FormRow>

          <FormRow label="Status">
            {isManager ? (
              <select
                className="select select-bordered w-full"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="Draft">Draft</option>
                <option value="Pending Approval">Pending Approval</option>
                <option value="Active">Active</option>
                <option value="Expired">Expired</option>
                <option value="Canceled">Canceled</option>
                <option value="Pending Renewal">Pending Renewal</option>
              </select>
            ) : (
              <StatusBadge label={contract.status} tone={statusTone(contract.status)} />
            )}
          </FormRow>

          <FormRow label="Type">
            {isManager ? (
              <select
                className="select select-bordered w-full"
                value={form.contract_type}
                onChange={(e) => setForm({ ...form, contract_type: e.target.value })}
              >
                <option>Preventive Maintenance</option>
                <option>Full-Service Maintenance</option>
                <option>Emergency Repair Plan</option>
                <option>Time and Materials</option>
                <option>Custom Service Agreement</option>
              </select>
            ) : (
              <span>{contract.contract_type}</span>
            )}
          </FormRow>

          <FormRow label="Billing method">
            {isManager ? (
              <select
                className="select select-bordered w-full"
                value={form.billing_method}
                onChange={(e) => setForm({ ...form, billing_method: e.target.value })}
              >
                <option>Monthly Recurring Charge</option>
                <option>Annual Fixed Fee</option>
                <option>Per-Service Charge</option>
                <option>Time and Materials</option>
                <option>Cost Plus</option>
              </select>
            ) : (
              <span>{contract.billing_method}</span>
            )}
          </FormRow>

          <FormRow label="Annual contract value">
            {isManager ? (
              <div className="space-y-1">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.contract_price}
                  onChange={(e) => {
                    const price = e.target.value;
                    const monthly =
                      /monthly\s*recurring/i.test(form.billing_method) && Number(price) > 0
                        ? String(monthlyFromAnnual(Number(price)))
                        : form.monthly_amount;
                    setForm({ ...form, contract_price: price, monthly_amount: monthly });
                  }}
                />
                {Number(form.contract_price) > 0 ? (
                  <p className="text-xs opacity-60">
                    ≈ {formatMonthlyPremium(monthlyPremiumFromContract({ ...contract, contract_price: Number(form.contract_price) }))}
                  </p>
                ) : null}
              </div>
            ) : (
              <span>
                {formatMoney(contract.contract_price)}
                {contract.contract_price > 0 ? (
                  <span className="ml-2 text-sm opacity-60">
                    ({formatMonthlyPremium(monthlyPremiumFromContract(contract))})
                  </span>
                ) : null}
              </span>
            )}
          </FormRow>

          <FormRow label="Monthly fee">
            {isManager ? (
              <input
                type="number"
                min="0"
                step="0.01"
                className="input input-bordered w-full"
                value={form.monthly_amount}
                onChange={(e) => setForm({ ...form, monthly_amount: e.target.value })}
              />
            ) : (
              <span>{formatMoney(resolvedMonthlyAmount(contract))}</span>
            )}
          </FormRow>

          <FormRow label="Deductible">
            {isManager ? (
              <input
                type="number"
                min="0"
                step="0.01"
                className="input input-bordered w-full"
                value={form.deductible}
                onChange={(e) => setForm({ ...form, deductible: e.target.value })}
              />
            ) : (
              <span>{formatMoney(resolvedDeductible(contract))}</span>
            )}
          </FormRow>

          {contract.contract_price > 0 ? (
            <div className="rounded-box border border-base-300 p-4">
              <ContractPricingSummary variant="contract" contract={contract} compact />
            </div>
          ) : null}

          {(() => {
            const standing = getContractPaymentStanding(contract, standingInvoices);
            if (standing.id === "not_monthly") return null;
            return (
              <div className="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="opacity-70">Monthly fee status</span>
                  <span className={`badge badge-sm ${standingBadgeClass(standing.id)}`}>
                    {standing.label}
                  </span>
                </div>
                <p className="mt-1 opacity-70">{formatStandingDetail(standing)}</p>
              </div>
            );
          })()}


          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Start date">
              {isManager ? (
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  required
                />
              ) : (
                <span>{contract.start_date}</span>
              )}
            </FormRow>
            <FormRow label="End date">
              {isManager ? (
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  required
                />
              ) : (
                <span>{contract.end_date}</span>
              )}
            </FormRow>
          </div>

          <FormRow label="Renewal option">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.renewal_option}
                onChange={(e) => setForm({ ...form, renewal_option: e.target.value })}
              />
            ) : (
              <span>{contract.renewal_option ?? "—"}</span>
            )}
          </FormRow>

          <FormRow label="Payment terms">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.payment_terms}
                onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
              />
            ) : (
              <span>{contract.payment_terms ?? "—"}</span>
            )}
          </FormRow>

          <div className="grid gap-3 sm:grid-cols-3">
            <FormRow label="Visits">
              {isManager ? (
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={form.included_service_visits}
                  onChange={(e) => setForm({ ...form, included_service_visits: e.target.value })}
                />
              ) : (
                <span>{contract.included_service_visits}</span>
              )}
            </FormRow>
            <FormRow label="Labor hours">
              {isManager ? (
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={form.included_labor_hours}
                  onChange={(e) => setForm({ ...form, included_labor_hours: e.target.value })}
                />
              ) : (
                <span>{contract.included_labor_hours}</span>
              )}
            </FormRow>
            <FormRow label="Parts allowance">
              {isManager ? (
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={form.included_replacement_parts}
                  onChange={(e) => setForm({ ...form, included_replacement_parts: e.target.value })}
                />
              ) : (
                <span>{contract.included_replacement_parts}</span>
              )}
            </FormRow>
          </div>

          <FormRow label="Service frequency">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.service_frequency}
                onChange={(e) => setForm({ ...form, service_frequency: e.target.value })}
              />
            ) : (
              <span>{contract.service_frequency ?? "—"}</span>
            )}
          </FormRow>

          <FormRow label="Emergency response">
            {isManager ? (
              <input
                className="input input-bordered w-full"
                value={form.emergency_response_commitment}
                onChange={(e) => setForm({ ...form, emergency_response_commitment: e.target.value })}
              />
            ) : (
              <span>{contract.emergency_response_commitment ?? "—"}</span>
            )}
          </FormRow>

          <FormRow label="Warranty terms">
            {isManager ? (
              <textarea
                className="textarea textarea-bordered w-full"
                rows={2}
                value={form.warranty_terms}
                onChange={(e) => setForm({ ...form, warranty_terms: e.target.value })}
              />
            ) : (
              <span className="break-words whitespace-pre-wrap">{contract.warranty_terms ?? "—"}</span>
            )}
          </FormRow>

          <FormRow label="Cancellation terms">
            {isManager ? (
              <textarea
                className="textarea textarea-bordered w-full"
                rows={2}
                value={form.cancellation_terms}
                onChange={(e) => setForm({ ...form, cancellation_terms: e.target.value })}
              />
            ) : (
              <span className="break-words whitespace-pre-wrap">{contract.cancellation_terms ?? "—"}</span>
            )}
          </FormRow>

          <FormRow label="Approval requirements">
            {isManager ? (
              <textarea
                className="textarea textarea-bordered w-full"
                rows={2}
                value={form.approval_requirements}
                onChange={(e) => setForm({ ...form, approval_requirements: e.target.value })}
              />
            ) : (
              <span className="break-words whitespace-pre-wrap">
                {contract.approval_requirements ?? "—"}
              </span>
            )}
          </FormRow>

          <FormRow label="Notes">
            {isManager ? (
              <textarea
                className="textarea textarea-bordered w-full"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            ) : (
              <span className="break-words whitespace-pre-wrap">{contract.notes ?? "—"}</span>
            )}
          </FormRow>

          {isManager ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              {form.customer_id ? (
                <Link href={`/customers/${form.customer_id}`} className="btn btn-ghost">
                  Open customer
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}
