"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import {
  buildCoverageMap,
  coverageFor,
  EQUIPMENT_COVERAGE_SELECT,
  type ContractEquipmentLink,
  type EquipmentCoverage,
} from "@/lib/equipmentCoverage";
import type { Customer, Equipment } from "@/lib/types";

type ManagerEquipmentRow = Equipment & {
  customers?: { name: string };
  coverage: EquipmentCoverage;
};

export default function EquipmentPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center opacity-60">Loading…</div>}>
      <EquipmentPageInner />
    </Suspense>
  );
}

function EquipmentPageInner() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const [equipment, setEquipment] = useState<ManagerEquipmentRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: "",
    name: "",
    category: "",
    manufacturer: "",
    model: "",
    serial_number: "",
    location: "",
    operating_status: "Operational" as Equipment["operating_status"],
  });

  async function load() {
    const [{ data: eq }, { data: cust }, { data: links }] = await Promise.all([
      supabase.from("equipment").select("*, customers(name)").order("name"),
      supabase.from("customers").select("*").eq("status", "Active").order("name"),
      supabase.from("contract_equipment").select(EQUIPMENT_COVERAGE_SELECT),
    ]);
    const coverageMap = buildCoverageMap(links as ContractEquipmentLink[] | null);
    const rows = ((eq as (Equipment & { customers?: { name: string } })[]) ?? []).map((item) => ({
      ...item,
      coverage: coverageFor(coverageMap, item.id),
    }));
    setEquipment(rows);
    setCustomers((cust as Customer[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!highlightId || equipment.length === 0) return;
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, equipment]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase.from("equipment").insert(form).select().single();
    if (insertError) { setError(insertError.message); return; }
    await logActivity(supabase, { userId: user?.id ?? null, action: "created", recordType: "equipment", recordId: data.id, newValue: form.name });
    setShowForm(false);
    load();
  }

  return (
    <div>
      <PageHeader title="Equipment" description="Track installed commercial equipment" actions={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>Add Equipment</button>
      } />

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">Register Equipment</h3>
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
              <FormRow label="Category">
                <input className="input input-bordered w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </FormRow>
              <FormRow label="Manufacturer">
                <input className="input input-bordered w-full" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
              </FormRow>
              <FormRow label="Model">
                <input className="input input-bordered w-full" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </FormRow>
              <FormRow label="Serial #">
                <input className="input input-bordered w-full" value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
              </FormRow>
              <FormRow label="Location">
                <input className="input input-bordered w-full" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </FormRow>
              <FormRow label="Status">
                <select className="select select-bordered w-full" value={form.operating_status} onChange={(e) => setForm({ ...form, operating_status: e.target.value as Equipment["operating_status"] })}>
                  <option value="Operational">Operational</option>
                  <option value="Needs Service">Needs Service</option>
                  <option value="Out of Service">Out of Service</option>
                  <option value="Retired">Retired</option>
                </select>
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
          {equipment.length === 0 ? (
            <div className="p-6"><EmptyState title="No equipment registered" description="Add equipment to link work orders and contracts." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Customer</th>
                    <th>Serial #</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Location</th>
                    <th>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {equipment.map((eq) => {
                    const highlighted = highlightId === eq.id;
                    return (
                      <tr
                        key={eq.id}
                        ref={highlighted ? highlightRef : undefined}
                        className={highlighted ? "bg-primary/10" : undefined}
                      >
                        <td className="font-medium">{eq.name}</td>
                        <td>{eq.customers?.name ?? "—"}</td>
                        <td className="font-mono text-xs">{eq.serial_number ?? "—"}</td>
                        <td>{eq.category ?? "—"}</td>
                        <td><StatusBadge label={eq.operating_status} tone={statusTone(eq.operating_status)} /></td>
                        <td>{eq.location ?? "—"}</td>
                        <td>
                          {eq.coverage.covered ? (
                            <div>
                              <StatusBadge label="Covered" tone="success" />
                              {eq.coverage.contractName ? (
                                <p className="mt-1 text-xs opacity-60">{eq.coverage.contractName}</p>
                              ) : null}
                            </div>
                          ) : (
                            <StatusBadge label="Not covered" tone="neutral" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
