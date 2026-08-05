"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusBadge, statusTone, EmptyState } from "@/components/ui";
import { ActivityFeed } from "@/components/ActivityFeed";
import type { Customer, Equipment, WorkOrder, ServiceContract, Invoice } from "@/lib/types";
import { formatMoney } from "@/lib/calculations";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [contracts, setContracts] = useState<ServiceContract[]>([]);
  const [invoices, setInvoices] = useState<Pick<Invoice, "id" | "invoice_number" | "invoice_total" | "remaining_balance" | "status">[]>([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [{ data: c }, { data: eq }, { data: wo }, { data: sc }, { data: inv }] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).single(),
      supabase.from("equipment").select("*").eq("customer_id", id).order("name"),
      supabase.from("work_orders").select("*").eq("customer_id", id).order("created_at", { ascending: false }).limit(10),
      supabase.from("service_contracts").select("*").eq("customer_id", id).order("start_date", { ascending: false }),
      supabase.from("invoices").select("id, invoice_number, invoice_total, remaining_balance, status").eq("customer_id", id).order("created_at", { ascending: false }).limit(8),
    ]);
    setCustomer(c as Customer);
    setEquipment((eq as Equipment[]) ?? []);
    setWorkOrders((wo as WorkOrder[]) ?? []);
    setContracts((sc as ServiceContract[]) ?? []);
    setInvoices((inv as typeof invoices) ?? []);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return;
    setSaving(true);
    await supabase.from("customers").update({
      name: customer.name,
      primary_contact_name: customer.primary_contact_name,
      email: customer.email,
      phone: customer.phone,
      billing_address: customer.billing_address,
      service_address: customer.service_address,
      city: customer.city,
      state: customer.state,
      zip_code: customer.zip_code,
      status: customer.status,
      payment_terms: customer.payment_terms,
      notes: customer.notes,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    setSaving(false);
  }

  if (!customer) return <div className="p-8 text-center opacity-60">Loading…</div>;

  return (
    <div>
      <PageHeader
        title={customer.name}
        description="Customer profile and service history"
        actions={<Link href="/customers" className="btn btn-ghost btn-sm">← Back</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={onSave} className="card bg-base-100 shadow lg:col-span-1">
          <div className="card-body space-y-3">
            <h2 className="card-title text-base">Details</h2>
            <FormRow label="Name" required>
              <input className="input input-bordered w-full" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            </FormRow>
            <FormRow label="Contact">
              <input className="input input-bordered w-full" value={customer.primary_contact_name ?? ""} onChange={(e) => setCustomer({ ...customer, primary_contact_name: e.target.value })} />
            </FormRow>
            <FormRow label="Email">
              <input className="input input-bordered w-full" value={customer.email ?? ""} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
            </FormRow>
            <FormRow label="Phone">
              <input className="input input-bordered w-full" value={customer.phone ?? ""} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            </FormRow>
            <FormRow label="Status">
              <select className="select select-bordered w-full" value={customer.status} onChange={(e) => setCustomer({ ...customer, status: e.target.value as Customer["status"] })}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="On Hold">On Hold</option>
              </select>
            </FormRow>
            <FormRow label="Notes">
              <textarea className="textarea textarea-bordered w-full" rows={3} value={customer.notes ?? ""} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} />
            </FormRow>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
          </div>
        </form>

        <div className="space-y-6 lg:col-span-2">
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-base">Equipment ({equipment.length})</h2>
              {equipment.length === 0 ? (
                <EmptyState title="No equipment" description="Register equipment for this customer." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Model</th>
                        <th>Serial #</th>
                        <th>Installed</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equipment.map((eq) => (
                        <tr key={eq.id}>
                          <td>
                            <Link href="/equipment" className="link link-hover">
                              {eq.name}
                            </Link>
                          </td>
                          <td>{eq.model ?? "—"}</td>
                          <td className="font-mono text-xs">{eq.serial_number ?? "—"}</td>
                          <td>{eq.installation_date ?? "—"}</td>
                          <td>
                            <StatusBadge label={eq.operating_status} tone={statusTone(eq.operating_status)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title text-base">Contracts</h2>
              {contracts.length === 0 ? (
                <EmptyState title="No contracts" description="Create a service contract for this customer." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead><tr><th>Name</th><th>Type</th><th>Status</th></tr></thead>
                    <tbody>
                      {contracts.map((sc) => (
                        <tr key={sc.id}>
                          <td>
                            <Link href="/contracts" className="link link-hover">
                              {sc.name}
                            </Link>
                          </td>
                          <td>{sc.contract_type}</td>
                          <td><StatusBadge label={sc.status} tone={statusTone(sc.status)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title text-base">Recent Work Orders</h2>
                <Link href="/work-orders" className="link link-primary text-sm">All jobs</Link>
              </div>
              {workOrders.length === 0 ? (
                <EmptyState title="No work orders" description="Work orders for this customer will appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead><tr><th>Job #</th><th>Type</th><th>Priority</th><th>Status</th></tr></thead>
                    <tbody>
                      {workOrders.map((wo) => (
                        <tr key={wo.id} className={wo.priority === "Critical" ? "bg-error/10" : ""}>
                          <td><Link href={`/work-orders/${wo.id}`} className="link link-primary">{wo.work_order_number}</Link></td>
                          <td>{wo.work_order_type}</td>
                          <td><StatusBadge label={wo.priority} tone={statusTone(wo.priority)} /></td>
                          <td><StatusBadge label={wo.status} tone={statusTone(wo.status)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title text-base">Invoices</h2>
                <Link href="/billing" className="link link-primary text-sm">Billing</Link>
              </div>
              {invoices.length === 0 ? (
                <EmptyState title="No invoices" description="Invoices for this customer will appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Balance</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td>
                            <Link href={`/billing/${inv.id}`} className="link link-primary">
                              {inv.invoice_number}
                            </Link>
                          </td>
                          <td className="text-right">{formatMoney(inv.invoice_total)}</td>
                          <td className="text-right">{formatMoney(inv.remaining_balance)}</td>
                          <td>
                            <StatusBadge label={inv.status} tone={statusTone(inv.status)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <ActivityFeed recordType="customer" recordId={id} />
          </div>
        </div>
      </div>
    </div>
  );
}
