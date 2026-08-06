"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge } from "@/components/ui";
import type { Customer } from "@/lib/types";
import {
  buildCustomerAddressPayload,
  emptyCustomerAddressForm,
  emptyToNull,
  formatCustomerAddress,
  formatCustomerLocationLabel,
  nonEmpty,
} from "@/lib/customer-address";

type CustomerLocation = Customer;

const ALL = "";

const emptyCustomerForm = {
  name: "",
  primary_contact_name: "",
  email: "",
  phone: "",
  ...emptyCustomerAddressForm(),
  status: "Active" as Customer["status"],
};

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const t = nonEmpty(v);
    if (t) set.add(t);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * This business faces customer data fragmentation risk.
 * Our app reduces the risk by centralizing contacts, sites, and service history.
 */

function customerStatusTone(status: string): "success" | "warning" | "error" | "info" | "neutral" | "critical" {
  const n = status.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  if (n === "active") return "success";
  if (n === "inactive") return "error";
  if (n === "on hold" || n === "pending") return "warning";
  return "neutral";
}

function formatContactTip(c: CustomerLocation): string {
  const phone = nonEmpty(c.phone) ?? "Not provided";
  const position = "Not provided";
  const company = nonEmpty(c.name) ?? "Not provided";
  const email = nonEmpty(c.email) ?? "Not provided";
  return [`Phone: ${phone}`, `Position: ${position}`, `Company: ${company}`, `Email: ${email}`].join("\n");
}

function InfoTip({
  tip,
  label,
  children,
}: {
  tip: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <span
      className="tooltip tooltip-bottom before:z-50 before:max-w-xs before:whitespace-pre-line before:text-left before:text-xs"
      data-tip={tip}
    >
      <span
        tabIndex={0}
        className="cursor-help rounded underline decoration-dotted decoration-base-content/40 underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        aria-label={label}
      >
        {children}
      </span>
    </span>
  );
}

type CustomerRow = CustomerLocation & { activeEquipmentCount: number };

/** Active equipment = not Retired (still on the service relationship). */
function isActiveEquipment(operatingStatus: string | null | undefined): boolean {
  return (operatingStatus ?? "").toLowerCase().trim() !== "retired";
}

function locationMatches(c: CustomerLocation, filter: string, value: string | null | undefined): boolean {
  if (!filter) return true;
  return (nonEmpty(value) ?? "").toLowerCase() === filter.toLowerCase();
}

export default function CustomersPage() {
  const supabase = createClient();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCountry, setFilterCountry] = useState(ALL);
  const [filterRegion, setFilterRegion] = useState(ALL);
  const [filterState, setFilterState] = useState(ALL);
  const [filterCity, setFilterCity] = useState(ALL);
  const [form, setForm] = useState(emptyCustomerForm);

  async function load() {
    setLoading(true);
    const [{ data: customerData }, { data: equipmentData }] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("equipment").select("customer_id, operating_status"),
    ]);

    const counts = new Map<string, number>();
    for (const eq of equipmentData ?? []) {
      if (!eq.customer_id || !isActiveEquipment(eq.operating_status as string)) continue;
      counts.set(eq.customer_id, (counts.get(eq.customer_id) ?? 0) + 1);
    }

    const rows: CustomerRow[] = ((customerData as CustomerLocation[]) ?? []).map((c) => ({
      ...c,
      activeEquipmentCount: counts.get(c.id) ?? 0,
    }));

    rows.sort((a, b) => {
      if (b.activeEquipmentCount !== a.activeEquipmentCount) {
        return b.activeEquipmentCount - a.activeEquipmentCount;
      }
      return a.name.localeCompare(b.name);
    });

    setCustomers(rows);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const countryOptions = useMemo(() => uniqueSorted(customers.map((c) => c.country)), [customers]);
  const regionOptions = useMemo(() => {
    const base = filterCountry
      ? customers.filter((c) => locationMatches(c, filterCountry, c.country))
      : customers;
    return uniqueSorted(base.map((c) => c.region));
  }, [customers, filterCountry]);
  const stateOptions = useMemo(() => {
    let base = customers;
    if (filterCountry) base = base.filter((c) => locationMatches(c, filterCountry, c.country));
    if (filterRegion) base = base.filter((c) => locationMatches(c, filterRegion, c.region));
    return uniqueSorted(base.map((c) => c.state));
  }, [customers, filterCountry, filterRegion]);
  const cityOptions = useMemo(() => {
    let base = customers;
    if (filterCountry) base = base.filter((c) => locationMatches(c, filterCountry, c.country));
    if (filterRegion) base = base.filter((c) => locationMatches(c, filterRegion, c.region));
    if (filterState) base = base.filter((c) => locationMatches(c, filterState, c.state));
    return uniqueSorted(base.map((c) => c.city));
  }, [customers, filterCountry, filterRegion, filterState]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(
      (c) =>
        locationMatches(c, filterCountry, c.country) &&
        locationMatches(c, filterRegion, c.region) &&
        locationMatches(c, filterState, c.state) &&
        locationMatches(c, filterCity, c.city),
    );
  }, [customers, filterCountry, filterRegion, filterState, filterCity]);

  const hasLocationFilters = Boolean(filterCountry || filterRegion || filterState || filterCity);

  function clearLocationFilters() {
    setFilterCountry(ALL);
    setFilterRegion(ALL);
    setFilterState(ALL);
    setFilterCity(ALL);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const addressPayload = buildCustomerAddressPayload(form);
    const payload = {
      name: form.name.trim(),
      primary_contact_name: emptyToNull(form.primary_contact_name),
      email: emptyToNull(form.email),
      phone: emptyToNull(form.phone),
      ...addressPayload,
      status: form.status,
    };

    let { data, error: insertError } = await supabase.from("customers").insert(payload).select().single();

    // If region/country columns are not in the DB yet, save without them.
    if (insertError && /region|country/i.test(insertError.message)) {
      const { region: _r, country: _c, ...withoutGeo } = payload;
      ({ data, error: insertError } = await supabase.from("customers").insert(withoutGeo).select().single());
      if (!insertError) {
        setError(
          "Customer saved, but region/country are not in the database yet. Ask your team to add customers.region and customers.country columns.",
        );
      }
    }

    if (insertError) {
      setError(insertError.message);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "customer",
      recordId: data.id,
      newValue: form.name,
    });
    setShowForm(false);
    setForm(emptyCustomerForm);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Manage commercial customer accounts"
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            Add Customer
          </button>
        }
      />

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold">New Customer</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <FormRow label="Company" required>
                <input className="input input-bordered w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </FormRow>
              <FormRow label="Contact">
                <input className="input input-bordered w-full" value={form.primary_contact_name} onChange={(e) => setForm({ ...form, primary_contact_name: e.target.value })} />
              </FormRow>
              <FormRow label="Email">
                <input type="email" className="input input-bordered w-full" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </FormRow>
              <FormRow label="Phone">
                <input className="input input-bordered w-full" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </FormRow>

              <div className="divider my-1 text-xs opacity-60">Address</div>
              <FormRow label="Street address">
                <input
                  className="input input-bordered w-full"
                  value={form.service_address}
                  onChange={(e) => setForm({ ...form, service_address: e.target.value })}
                  autoComplete="street-address"
                />
              </FormRow>
              <FormRow label="Address line 2">
                <input
                  className="input input-bordered w-full"
                  value={form.billing_address}
                  onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
                  placeholder="Suite, unit, building (optional)"
                />
              </FormRow>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormRow label="City">
                  <input className="input input-bordered w-full" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </FormRow>
                <FormRow label="State / Province">
                  <input className="input input-bordered w-full" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                </FormRow>
              </div>
              <FormRow label="ZIP / Postal code">
                <input className="input input-bordered w-full" value={form.zip_code} onChange={(e) => setForm({ ...form, zip_code: e.target.value })} />
              </FormRow>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormRow label="Region">
                  <input
                    className="input input-bordered w-full"
                    value={form.region}
                    onChange={(e) => setForm({ ...form, region: e.target.value })}
                    placeholder="e.g. Midwest, EU"
                  />
                </FormRow>
                <FormRow label="Country">
                  <input
                    className="input input-bordered w-full"
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    placeholder="e.g. United States"
                  />
                </FormRow>
              </div>

              <FormRow label="Status">
                <select className="select select-bordered w-full" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Customer["status"] })}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="On Hold">On Hold</option>
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

      {!loading && customers.length > 0 ? (
        <div className="mb-4 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Filter by location</p>
            {hasLocationFilters ? (
              <button type="button" className="btn btn-ghost btn-xs" onClick={clearLocationFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="form-control w-full">
              <span className="label-text mb-1 text-xs opacity-70">Country</span>
              <select
                className="select select-bordered select-sm w-full"
                value={filterCountry}
                onChange={(e) => {
                  setFilterCountry(e.target.value);
                  setFilterRegion(ALL);
                  setFilterState(ALL);
                  setFilterCity(ALL);
                }}
                aria-label="Filter customers by country"
              >
                <option value={ALL}>All countries</option>
                {countryOptions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              {countryOptions.length === 0 ? (
                <span className="mt-1 text-xs opacity-50">No country data yet (ready for global clients)</span>
              ) : null}
            </label>

            <label className="form-control w-full">
              <span className="label-text mb-1 text-xs opacity-70">Region</span>
              <select
                className="select select-bordered select-sm w-full"
                value={filterRegion}
                onChange={(e) => {
                  setFilterRegion(e.target.value);
                  setFilterState(ALL);
                  setFilterCity(ALL);
                }}
                aria-label="Filter customers by region"
              >
                <option value={ALL}>All regions</option>
                {regionOptions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              {regionOptions.length === 0 ? (
                <span className="mt-1 text-xs opacity-50">No region data yet</span>
              ) : null}
            </label>

            <label className="form-control w-full">
              <span className="label-text mb-1 text-xs opacity-70">State / Province</span>
              <select
                className="select select-bordered select-sm w-full"
                value={filterState}
                onChange={(e) => {
                  setFilterState(e.target.value);
                  setFilterCity(ALL);
                }}
                aria-label="Filter customers by state or province"
              >
                <option value={ALL}>All states / provinces</option>
                {stateOptions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>

            <label className="form-control w-full">
              <span className="label-text mb-1 text-xs opacity-70">City</span>
              <select
                className="select select-bordered select-sm w-full"
                value={filterCity}
                onChange={(e) => setFilterCity(e.target.value)}
                aria-label="Filter customers by city"
              >
                <option value={ALL}>All cities</option>
                {cityOptions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {loading ? (
            <div className="p-8 text-center opacity-60">Loading…</div>
          ) : customers.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No customers yet" description="Add your first commercial customer to begin tracking equipment and contracts." action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>Add Customer</button>} />
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No customers match these filters"
                description="Try another location, or clear filters to see all customers."
                action={
                  <button type="button" className="btn btn-primary btn-sm" onClick={clearLocationFilters}>
                    Clear filters
                  </button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Location</th>
                    <th>Active Equipment</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((c) => {
                    const locationLabel = formatCustomerLocationLabel(c);
                    const contactLabel = nonEmpty(c.primary_contact_name) ?? "—";
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link
                            href={`/customers/${c.id}`}
                            className="link link-hover link-primary font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            {c.name}
                          </Link>
                        </td>
                        <td>
                          <InfoTip
                            tip={formatContactTip(c)}
                            label={`Contact details for ${contactLabel === "—" ? c.name : contactLabel}: phone, position, company, email`}
                          >
                            {contactLabel}
                          </InfoTip>
                        </td>
                        <td>
                          <InfoTip tip={formatCustomerAddress(c)} label={`Full address for ${c.name}`}>
                            {locationLabel}
                          </InfoTip>
                        </td>
                        <td>
                          <span
                            className="tabular-nums font-medium"
                            aria-label={`${c.activeEquipmentCount} active equipment units for ${c.name}`}
                          >
                            {c.activeEquipmentCount}
                          </span>
                        </td>
                        <td>
                          <StatusBadge label={c.status} tone={customerStatusTone(c.status)} />
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
