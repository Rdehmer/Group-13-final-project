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

type ContractDetail = ServiceContract & { customers?: { id: string; name: string } | null };

/**
 * This business faces outdated contract terms risk.
 * Our app reduces the risk by letting managers edit contract details and jump to the customer record.
 */
export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const isManager = profile?.role === "service_manager";

  async function load() {
    setLoading(true);
    const [{ data }, { data: cust }, { data: { user } }] = await Promise.all([
      supabase.from("service_contracts").select("*, customers(id, name)").eq("id", id).single(),
      supabase.from("customers").select("*").order("name"),
      supabase.auth.getUser(),
    ]);
    const sc = data as ContractDetail | null;
    setContract(sc);
    setCustomers((cust as Customer[]) ?? []);
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
    const payload = {
      customer_id: form.customer_id,
      name: form.name.trim(),
      contract_type: form.contract_type,
      start_date: form.start_date,
      end_date: form.end_date,
      renewal_option: form.renewal_option.trim() || null,
      billing_method: form.billing_method,
      contract_price: Number(form.contract_price),
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

          <FormRow label="Price">
            {isManager ? (
              <input
                type="number"
                min="0"
                step="0.01"
                className="input input-bordered w-full"
                value={form.contract_price}
                onChange={(e) => setForm({ ...form, contract_price: e.target.value })}
              />
            ) : (
              <span>{formatMoney(contract.contract_price)}</span>
            )}
          </FormRow>

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
