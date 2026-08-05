"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";
import { StatusHoverEditor } from "@/components/StatusHoverEditor";
import type { Customer, Equipment, Profile } from "@/lib/types";

type EquipmentRow = Equipment & { customers?: { name: string } | null };

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
 * This business faces incomplete equipment-to-customer linkage risk.
 * Our app reduces the risk by letting managers register equipment and create the customer in one flow.
 */
export default function EquipmentPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
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
    category: "",
    status: "",
    location: "",
  });
  const [sort, setSort] = useState<{
    column: "name" | "customer" | "category" | "status" | "location";
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });

  const isManager = profile?.role === "service_manager";

  async function load() {
    const [{ data: eq }, { data: cust }, { data: { user } }] = await Promise.all([
      supabase.from("equipment").select("*, customers(name)").order("name"),
      supabase.from("customers").select("*").order("name"),
      supabase.auth.getUser(),
    ]);
    setEquipment((eq as EquipmentRow[]) ?? []);
    setCustomers((cust as Customer[]) ?? []);
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filterOptions = useMemo(() => {
    const uniqueSorted = (values: string[]) =>
      Array.from(new Set(values.filter((v) => v.trim() !== ""))).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );

    return {
      name: uniqueSorted(equipment.map((eq) => eq.name)),
      customer: uniqueSorted(equipment.map((eq) => eq.customers?.name ?? "")),
      category: uniqueSorted(equipment.map((eq) => eq.category ?? "")),
      status: uniqueSorted(equipment.map((eq) => eq.operating_status)),
      location: uniqueSorted(equipment.map((eq) => eq.location ?? "")),
    };
  }, [equipment]);

  const filteredEquipment = useMemo(() => {
    const rows = equipment.filter((eq) => {
      if (filters.name && eq.name !== filters.name) return false;
      if (filters.customer && (eq.customers?.name ?? "") !== filters.customer) return false;
      if (filters.category && (eq.category ?? "") !== filters.category) return false;
      if (filters.status && eq.operating_status !== filters.status) return false;
      if (filters.location && (eq.location ?? "") !== filters.location) return false;
      return true;
    });

    const valueFor = (eq: EquipmentRow) => {
      switch (sort.column) {
        case "customer":
          return eq.customers?.name ?? "";
        case "category":
          return eq.category ?? "";
        case "status":
          return eq.operating_status;
        case "location":
          return eq.location ?? "";
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

  function onColumnFilterChange(
    column: keyof typeof filters,
    value: string,
  ) {
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

  async function updateOperatingStatus(
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
                <button type="submit" className="btn btn-primary" disabled={isManager && showNewCustomer}>
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
              <table className="table table-fixed w-full">
                <thead>
                  <tr>
                    <th className="w-[22%]">Name</th>
                    <th className="w-[22%]">Customer</th>
                    <th className="w-[16%]">Category</th>
                    <th className="w-[18%]">Status</th>
                    <th className="w-[22%]">Location</th>
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
                        <div className="flex gap-1">
                          <ColumnFilterSelect
                            column="location"
                            label="location"
                            options={filterOptions.location}
                          />
                          {hasActiveFilters ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs shrink-0"
                              onClick={() =>
                                setFilters({
                                  name: "",
                                  customer: "",
                                  category: "",
                                  status: "",
                                  location: "",
                                })
                              }
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
                      <td colSpan={5} className="p-6">
                        <EmptyState
                          title="No matching equipment"
                          description="Try clearing one or more column filters."
                          action={
                            hasActiveFilters ? (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() =>
                                  setFilters({
                                    name: "",
                                    customer: "",
                                    category: "",
                                    status: "",
                                    location: "",
                                  })
                                }
                              >
                                Clear filters
                              </button>
                            ) : undefined
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredEquipment.map((eq) => (
                      <tr key={eq.id}>
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
                        <td className="align-top break-words">{eq.customers?.name ?? "—"}</td>
                        <td className="align-top break-words">{eq.category ?? "—"}</td>
                        <td className="align-top">
                          <StatusHoverEditor
                            value={eq.operating_status}
                            disabled={!isManager}
                            onChange={(next) =>
                              updateOperatingStatus(eq.id, eq.operating_status, next)
                            }
                          />
                        </td>
                        <td className="align-top break-words">{eq.location ?? "—"}</td>
                      </tr>
                    ))
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
