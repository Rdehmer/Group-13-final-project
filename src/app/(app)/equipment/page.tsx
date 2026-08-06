"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusHoverEditor } from "@/components/StatusHoverEditor";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import {
  buildCoverageMap,
  coverageFor,
  EQUIPMENT_COVERAGE_SELECT,
  type ContractEquipmentLink,
  type EquipmentCoverage,
} from "@/lib/equipmentCoverage";
import type { Customer, Equipment, Profile } from "@/lib/types";

type ManagerEquipmentRow = Equipment & {
  customers?: { id: string; name: string } | null;
  coverage: EquipmentCoverage;
};

const emptyEquipmentForm = {
  customer_id: "",
  name: "",
  category: "",
  manufacturer: "",
  model: "",
  serial_number: "",
  location: "",
  operating_status: "Operational" as Equipment["operating_status"],
};

const emptyCustomerForm = {
  name: "",
  primary_contact_name: "",
  email: "",
  phone: "",
  city: "",
  state: "",
  status: "Active" as Customer["status"],
};

/**
 * This business faces slow equipment lookup and onboarding friction risk.
 * Our app reduces the risk by linking list fields for managers and letting them create customers inline.
 */
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<ManagerEquipmentRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyEquipmentForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [filters, setFilters] = useState({
    name: "",
    customer: "",
    serial: "",
    category: "",
    status: "",
    location: "",
    contract: "",
  });
  const [sort, setSort] = useState<{
    column: "name" | "customer" | "serial" | "category" | "status" | "location" | "contract";
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });

  const isManager = profile?.role === "service_manager";

  async function load() {
    const [{ data: eq }, { data: cust }, { data: links }, { data: { user } }] = await Promise.all([
      supabase.from("equipment").select("*, customers(id, name)").order("name"),
      supabase.from("customers").select("*").order("name"),
      supabase.from("contract_equipment").select(EQUIPMENT_COVERAGE_SELECT),
      supabase.auth.getUser(),
    ]);
    const coverageMap = buildCoverageMap(links as ContractEquipmentLink[] | null);
    const rows = ((eq as (Equipment & { customers?: { id: string; name: string } | null })[]) ?? []).map(
      (item) => ({
        ...item,
        coverage: coverageFor(coverageMap, item.id),
      }),
    );
    setEquipment(rows);
    setCustomers((cust as Customer[]) ?? []);
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!highlightId || equipment.length === 0) return;
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, equipment]);

  const filterOptions = useMemo(() => {
    const uniqueSorted = (values: string[]) =>
      Array.from(new Set(values.filter((v) => v.trim() !== ""))).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );

    return {
      name: uniqueSorted(equipment.map((e) => e.name)),
      customer: uniqueSorted(equipment.map((e) => e.customers?.name ?? "")),
      serial: uniqueSorted(equipment.map((e) => e.serial_number ?? "")),
      category: uniqueSorted(equipment.map((e) => e.category ?? "")),
      status: uniqueSorted(equipment.map((e) => e.operating_status)),
      location: uniqueSorted(equipment.map((e) => e.location ?? "")),
      contract: uniqueSorted(
        equipment.map((e) =>
          e.coverage.covered ? (e.coverage.contractName ?? "Covered") : "Not covered",
        ),
      ),
    };
  }, [equipment]);

  const filteredEquipment = useMemo(() => {
    const rows = equipment.filter((eq) => {
      if (filters.name && eq.name !== filters.name) return false;
      if (filters.customer && (eq.customers?.name ?? "") !== filters.customer) return false;
      if (filters.serial && (eq.serial_number ?? "") !== filters.serial) return false;
      if (filters.category && (eq.category ?? "") !== filters.category) return false;
      if (filters.status && eq.operating_status !== filters.status) return false;
      if (filters.location && (eq.location ?? "") !== filters.location) return false;
      if (filters.contract) {
        const label = eq.coverage.covered
          ? (eq.coverage.contractName ?? "Covered")
          : "Not covered";
        if (label !== filters.contract) return false;
      }
      return true;
    });

    const valueFor = (eq: ManagerEquipmentRow) => {
      switch (sort.column) {
        case "customer":
          return eq.customers?.name ?? "";
        case "serial":
          return eq.serial_number ?? "";
        case "category":
          return eq.category ?? "";
        case "status":
          return eq.operating_status;
        case "location":
          return eq.location ?? "";
        case "contract":
          return eq.coverage.covered
            ? (eq.coverage.contractName ?? "Covered")
            : "Not covered";
        case "name":
        default:
          return eq.name;
      }
    };

    return [...rows].sort((a, b) => {
      const cmp = valueFor(a).localeCompare(valueFor(b), undefined, { sensitivity: "base" });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [equipment, filters, sort]);

  const hasActiveFilters = Object.values(filters).some((v) => v.trim() !== "");

  function clearFilters() {
    setFilters({
      name: "",
      customer: "",
      serial: "",
      category: "",
      status: "",
      location: "",
      contract: "",
    });
  }

  function onColumnFilterChange(column: keyof typeof filters, value: string) {
    if (value === "__sort_asc") {
      setSort({ column, direction: "asc" });
      return;
    }
    if (value === "__sort_desc") {
      setSort({ column, direction: "desc" });
      return;
    }
    setFilters((prev) => ({ ...prev, [column]: value }));
  }

  function ColumnFilterSelect({
    column,
    label,
    options,
  }: {
    column: keyof typeof filters;
    label: string;
    options: string[];
  }) {
    const sortingThis = sort.column === column;
    return (
      <select
        className="select select-bordered select-xs w-full min-w-0"
        value={filters[column]}
        onChange={(e) => onColumnFilterChange(column, e.target.value)}
        aria-label={`Filter or sort ${label}`}
      >
        <option value="">All</option>
        <option value="__sort_asc">
          Sort A–Z{sortingThis && sort.direction === "asc" ? " ✓" : ""}
        </option>
        <option value="__sort_desc">
          Sort Z–A{sortingThis && sort.direction === "desc" ? " ✓" : ""}
        </option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  async function onCreateCustomer(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    setCustomerError(null);
    if (!customerForm.name.trim()) {
      setCustomerError("Company name is required.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("customers")
      .insert(customerForm)
      .select()
      .single();
    if (insertError) {
      setCustomerError(insertError.message);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "customer",
      recordId: data.id,
      newValue: customerForm.name,
    });
    setCustomers((prev) => [...prev, data as Customer].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((prev) => ({ ...prev, customer_id: data.id }));
    setCustomerForm(emptyCustomerForm);
    setShowNewCustomer(false);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.customer_id) {
      setError("Select a customer, or create a new one first.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase.from("equipment").insert(form).select().single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "equipment",
      recordId: data.id,
      newValue: form.name,
    });
    setShowForm(false);
    setShowNewCustomer(false);
    setForm(emptyEquipmentForm);
    load();
  }

  function openAddForm() {
    setError(null);
    setCustomerError(null);
    setShowNewCustomer(false);
    setForm(emptyEquipmentForm);
    setShowForm(true);
  }

  async function updateStatus(
    equipmentId: string,
    previous: Equipment["operating_status"],
    next: Equipment["operating_status"],
  ) {
    if (previous === next) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("equipment")
      .update({ operating_status: next, updated_at: new Date().toISOString() })
      .eq("id", equipmentId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEquipment((prev) =>
      prev.map((eq) => (eq.id === equipmentId ? { ...eq, operating_status: next } : eq)),
    );
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "status_change",
      recordType: "equipment",
      recordId: equipmentId,
      previousValue: previous,
      newValue: next,
    });
  }

  const activeCustomers = customers.filter((c) => c.status === "Active");

  return (
    <div>
      <PageHeader
        title="Equipment"
        description="Track installed commercial equipment"
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={openAddForm}>
            Add Equipment
          </button>
        }
      />

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">Register Equipment</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <FormRow label="Customer" required>
                <select
                  className="select select-bordered w-full"
                  value={form.customer_id}
                  onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  required={!showNewCustomer}
                  disabled={showNewCustomer && isManager}
                >
                  <option value="">Select…</option>
                  {(isManager ? customers : activeCustomers).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.status !== "Active" ? ` (${c.status})` : ""}
                    </option>
                  ))}
                </select>
              </FormRow>

              {isManager ? (
                <div className="rounded-box border border-base-300 bg-base-200/40 p-3">
                  {!showNewCustomer ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm w-full"
                      onClick={() => {
                        setCustomerError(null);
                        setShowNewCustomer(true);
                      }}
                    >
                      Create new customer
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">New customer</p>
                      {customerError ? (
                        <div className="alert alert-error text-sm">{customerError}</div>
                      ) : null}
                      <FormRow label="Company" required>
                        <input
                          className="input input-bordered w-full"
                          value={customerForm.name}
                          onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                          required
                        />
                      </FormRow>
                      <FormRow label="Contact">
                        <input
                          className="input input-bordered w-full"
                          value={customerForm.primary_contact_name}
                          onChange={(e) =>
                            setCustomerForm({ ...customerForm, primary_contact_name: e.target.value })
                          }
                        />
                      </FormRow>
                      <FormRow label="Email">
                        <input
                          type="email"
                          className="input input-bordered w-full"
                          value={customerForm.email}
                          onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                        />
                      </FormRow>
                      <FormRow label="Phone">
                        <input
                          className="input input-bordered w-full"
                          value={customerForm.phone}
                          onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                        />
                      </FormRow>
                      <div className="grid grid-cols-2 gap-2">
                        <FormRow label="City">
                          <input
                            className="input input-bordered w-full"
                            value={customerForm.city}
                            onChange={(e) => setCustomerForm({ ...customerForm, city: e.target.value })}
                          />
                        </FormRow>
                        <FormRow label="State">
                          <input
                            className="input input-bordered w-full"
                            value={customerForm.state}
                            onChange={(e) => setCustomerForm({ ...customerForm, state: e.target.value })}
                          />
                        </FormRow>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            setShowNewCustomer(false);
                            setCustomerError(null);
                          }}
                        >
                          Cancel
                        </button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={onCreateCustomer}>
                          Save customer
                        </button>
                      </div>
                      <p className="text-xs opacity-70">
                        Saved customers also appear on the Customers tab.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              <FormRow label="Name" required>
                <input
                  className="input input-bordered w-full"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="Category">
                <input
                  className="input input-bordered w-full"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </FormRow>
              <FormRow label="Manufacturer">
                <input
                  className="input input-bordered w-full"
                  value={form.manufacturer}
                  onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                />
              </FormRow>
              <FormRow label="Model">
                <input
                  className="input input-bordered w-full"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </FormRow>
              <FormRow label="Serial #">
                <input
                  className="input input-bordered w-full"
                  value={form.serial_number}
                  onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                />
              </FormRow>
              <FormRow label="Location">
                <input
                  className="input input-bordered w-full"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </FormRow>
              <FormRow label="Status">
                <select
                  className="select select-bordered w-full"
                  value={form.operating_status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      operating_status: e.target.value as Equipment["operating_status"],
                    })
                  }
                >
                  <option value="Operational">Operational</option>
                  <option value="Needs Service">Needs Service</option>
                  <option value="Out of Service">Out of Service</option>
                  <option value="Retired">Retired</option>
                </select>
              </FormRow>
              <div className="modal-action">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setShowForm(false);
                    setShowNewCustomer(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isManager && showNewCustomer}
                >
                  Save
                </button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setShowNewCustomer(false);
              }}
            >
              close
            </button>
          </form>
        </dialog>
      ) : null}

      {error && !showForm ? (
        <div className="alert alert-error mb-4 text-sm">{error}</div>
      ) : null}

      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {equipment.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No equipment registered"
                description="Add equipment to link work orders and contracts."
              />
            </div>
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
                  {isManager ? (
                    <tr className="bg-base-200/50">
                      <th className="font-normal">
                        <ColumnFilterSelect column="name" label="name" options={filterOptions.name} />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="customer"
                          label="customer"
                          options={filterOptions.customer}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="serial"
                          label="serial"
                          options={filterOptions.serial}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="category"
                          label="category"
                          options={filterOptions.category}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="status"
                          label="status"
                          options={filterOptions.status}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="location"
                          label="location"
                          options={filterOptions.location}
                        />
                      </th>
                      <th className="font-normal">
                        <div className="flex gap-1">
                          <ColumnFilterSelect
                            column="contract"
                            label="contract"
                            options={filterOptions.contract}
                          />
                          {hasActiveFilters ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs shrink-0"
                              onClick={clearFilters}
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      </th>
                    </tr>
                  ) : null}
                </thead>
                <tbody>
                  {filteredEquipment.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6">
                        <EmptyState
                          title="No matching equipment"
                          description="Try clearing one or more column filters."
                          action={
                            hasActiveFilters ? (
                              <button type="button" className="btn btn-sm" onClick={clearFilters}>
                                Clear filters
                              </button>
                            ) : undefined
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredEquipment.map((eq) => {
                      const highlighted = highlightId === eq.id;
                      return (
                        <tr
                          key={eq.id}
                          ref={highlighted ? highlightRef : undefined}
                          className={highlighted ? "bg-primary/10" : undefined}
                        >
                          <td className="align-top">
                            {isManager ? (
                              <Link
                                href={`/equipment/${eq.id}`}
                                className="link link-primary font-medium break-words"
                                aria-label={`Open equipment ${eq.name}`}
                              >
                                {eq.name}
                              </Link>
                            ) : (
                              <span className="font-medium break-words">{eq.name}</span>
                            )}
                          </td>
                          <td className="align-top break-words">
                            {isManager && eq.customers?.id ? (
                              <Link
                                href={`/customers/${eq.customers.id}`}
                                className="link link-primary"
                                aria-label={`Open customer ${eq.customers.name}`}
                              >
                                {eq.customers.name}
                              </Link>
                            ) : (
                              (eq.customers?.name ?? "—")
                            )}
                          </td>
                          <td className="align-top font-mono text-xs">{eq.serial_number ?? "—"}</td>
                          <td className="align-top">{eq.category ?? "—"}</td>
                          <td className="align-top">
                            {isManager ? (
                              <StatusHoverEditor
                                value={eq.operating_status}
                                onChange={(next) => updateStatus(eq.id, eq.operating_status, next)}
                              />
                            ) : (
                              <StatusBadge
                                label={eq.operating_status}
                                tone={statusTone(eq.operating_status)}
                              />
                            )}
                          </td>
                          <td className="align-top">{eq.location ?? "—"}</td>
                          <td className="align-top">
                            {eq.coverage.covered ? (
                              <div>
                                <StatusBadge label="Covered" tone="success" />
                                {eq.coverage.contractName ? (
                                  isManager && eq.coverage.contractId ? (
                                    <p className="mt-1 text-xs">
                                      <Link
                                        href={`/contracts/${eq.coverage.contractId}`}
                                        className="link link-primary opacity-80"
                                        aria-label={`Open contract ${eq.coverage.contractName}`}
                                      >
                                        {eq.coverage.contractName}
                                      </Link>
                                    </p>
                                  ) : (
                                    <p className="mt-1 text-xs opacity-60">{eq.coverage.contractName}</p>
                                  )
                                ) : null}
                              </div>
                            ) : (
                              <StatusBadge label="Not covered" tone="neutral" />
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
