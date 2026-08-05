"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatCard, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney, grossProfit, profitMargin, formatPct } from "@/lib/calculations";
import type { Customer, ServiceContract } from "@/lib/types";

/**
 * This business faces contract profitability drift risk.
 * Our app reduces the risk by comparing contract revenue to estimated service delivery cost.
 */
export default function ContractsPage() {
  const supabase = createClient();
  const [contracts, setContracts] = useState<(ServiceContract & { customers?: { name: string } })[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: "",
    name: "",
    contract_type: "Preventive Maintenance",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    billing_method: "Monthly Recurring Charge",
    contract_price: "0",
    included_service_visits: "4",
    included_labor_hours: "8",
    status: "Draft",
  });

  async function load() {
    const [{ data: sc }, { data: cust }] = await Promise.all([
      supabase.from("service_contracts").select("*, customers(name)").order("created_at", { ascending: false }),
      supabase.from("customers").select("*").eq("status", "Active").order("name"),
    ]);
    setContracts((sc as typeof contracts) ?? []);
    setCustomers((cust as Customer[]) ?? []);
  }

  useEffect(() => { load(); }, []);

  const totalRevenue = contracts.filter((c) => c.status === "Active").reduce((s, c) => s + Number(c.contract_price), 0);
  const estCostPerVisit = 350;
  const estDirectCost = contracts.filter((c) => c.status === "Active").reduce((s, c) => s + c.included_service_visits * estCostPerVisit, 0);
  const profit = grossProfit(totalRevenue, estDirectCost);
  const margin = profitMargin(totalRevenue, profit);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      ...form,
      contract_price: Number(form.contract_price),
      included_service_visits: Number(form.included_service_visits),
      included_labor_hours: Number(form.included_labor_hours),
      created_by: user?.id ?? null,
    };
    const { data, error: insertError } = await supabase.from("service_contracts").insert(payload).select().single();
    if (insertError) { setError(insertError.message); return; }
    await logActivity(supabase, { userId: user?.id ?? null, action: "created", recordType: "contract", recordId: data.id, newValue: form.name });
    setShowForm(false);
    load();
  }

  return (
    <div>
      <PageHeader title="Service Contracts" description="Manage maintenance agreements and profitability" actions={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>New Contract</button>
      } />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Active Contract Revenue" value={formatMoney(totalRevenue)} />
        <StatCard label="Est. Direct Cost" value={formatMoney(estDirectCost)} hint="Assumes $350/visit avg" />
        <StatCard label="Est. Gross Margin" value={formatPct(margin)} hint={`Profit ${formatMoney(profit)}`} />
      </div>

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">New Contract</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <FormRow label="Customer" required>
                <select className="select select-bordered w-full" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>
                  <option value="">Select…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormRow>
              <FormRow label="Name" required>
                <input className="input input-bordered w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </FormRow>
              <FormRow label="Type">
                <select className="select select-bordered w-full" value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
                  <option>Preventive Maintenance</option>
                  <option>Full-Service Maintenance</option>
                  <option>Emergency Repair Plan</option>
                  <option>Time and Materials</option>
                  <option>Custom Service Agreement</option>
                </select>
              </FormRow>
              <FormRow label="Start">
                <input type="date" className="input input-bordered w-full" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
              </FormRow>
              <FormRow label="End">
                <input type="date" className="input input-bordered w-full" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
              </FormRow>
              <FormRow label="Price">
                <input type="number" min="0" step="0.01" className="input input-bordered w-full" value={form.contract_price} onChange={(e) => setForm({ ...form, contract_price: e.target.value })} />
              </FormRow>
              <FormRow label="Visits">
                <input type="number" min="0" className="input input-bordered w-full" value={form.included_service_visits} onChange={(e) => setForm({ ...form, included_service_visits: e.target.value })} />
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
          {contracts.length === 0 ? (
            <div className="p-6"><EmptyState title="No contracts" description="Create service agreements to track recurring revenue." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Name</th><th>Customer</th><th>Type</th><th>Price</th><th>Status</th><th>End</th></tr></thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id}>
                      <td className="font-medium">{c.name}</td>
                      <td>
                        {c.customer_id ? (
                          <Link href={`/customers/${c.customer_id}`} className="link link-hover">
                            {c.customers?.name ?? "—"}
                          </Link>
                        ) : (
                          c.customers?.name ?? "—"
                        )}
                      </td>
                      <td>{c.contract_type}</td>
                      <td>{formatMoney(c.contract_price)}</td>
                      <td><StatusBadge label={c.status} tone={statusTone(c.status)} /></td>
                      <td>{c.end_date}</td>
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
