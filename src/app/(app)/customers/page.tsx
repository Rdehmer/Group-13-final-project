"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge } from "@/components/ui";
import type { Customer, ServiceContract } from "@/lib/types";
import {
  inferContractTier,
  tierBadgeClass,
  type ContractTierId,
} from "@/lib/contracts";
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

/** Manager list: membership tier, one-off service (hot order), or ended membership. */
export type ServiceTypeKind = "tier" | "hot_order" | "inactive" | "active_membership";

export type ServiceTypeInfo = {
  kind: ServiceTypeKind;
  /** Display text in Service Type column */
  label: string;
  tierId?: ContractTierId;
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

function isActiveContract(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "active" || s === "renewed";
}

const TIER_RANK: Record<string, number> = { gold: 3, silver: 2, bronze: 1 };

/**
 * Resolve Service Type from membership contracts.
 * Active + known tier → Gold/Silver/Bronze.
 * Active + unknown tier (until customer branch stores tier reliably) → Active membership placeholder.
 * Past contracts only → Inactive.
 * No contracts → Hot Order (one-off service, not a tier membership).
 */
export function resolveServiceType(
  contracts: Array<Pick<ServiceContract, "name" | "status" | "end_date">>,
): ServiceTypeInfo {
  if (!contracts.length) {
    return { kind: "hot_order", label: "Hot Order" };
  }

  const active = contracts.filter((c) => isActiveContract(c.status));
  if (active.length > 0) {
    let bestTier: ContractTierId | null = null;
    for (const c of active) {
      const tier = inferContractTier(c.name ?? "");
      if (!tier) continue;
      if (!bestTier || (TIER_RANK[tier] ?? 0) > (TIER_RANK[bestTier] ?? 0)) bestTier = tier;
    }
    if (bestTier) {
      const label = bestTier.charAt(0).toUpperCase() + bestTier.slice(1);
      return { kind: "tier", label, tierId: bestTier };
    }
    // Tier not in contract name yet — keep a clear membership signal until customer branch updates.
    return { kind: "active_membership", label: "Active membership" };
  }

  return { kind: "inactive", label: "Inactive" };
}

function serviceTypeTone(info: ServiceTypeInfo): "success" | "warning" | "error" | "info" | "neutral" {
  if (info.kind === "tier") {
    if (info.tierId === "gold") return "warning";
    if (info.tierId === "silver") return "info";
    return "neutral";
  }
  if (info.kind === "hot_order") return "info";
  if (info.kind === "inactive") return "error";
  return "success";
}

type CustomerRow = CustomerLocation & {
  activeEquipmentCount: number;
  serviceType: ServiceTypeInfo;
};

/** Active equipment = not Retired (still on the service relationship). */
function isActiveEquipment(operatingStatus: string | null | undefined): boolean {
  return (operatingStatus ?? "").toLowerCase().trim() !== "retired";
}

function locationMatches(c: CustomerLocation, filter: string, value: string | null | undefined): boolean {
  if (!filter) return true;
  return (nonEmpty(value) ?? "").toLowerCase() === filter.toLowerCase();
}

function customerSearchHaystack(c: CustomerRow): string {
  const parts = [
    c.name,
    c.primary_contact_name,
    c.email,
    c.phone,
    c.service_address,
    c.billing_address,
    c.city,
    c.state,
    c.zip_code,
    c.region,
    c.country,
    c.status,
    String(c.activeEquipmentCount),
    c.serviceType.label,
    formatCustomerLocationLabel(c),
  ];
  return parts
    .filter((p) => p != null && String(p).trim() !== "")
    .join(" ")
    .toLowerCase();
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV with BOM so Excel opens UTF-8 correctly and treats columns as text. */
function buildCustomersExcelCsv(rows: CustomerRow[]): string {
  const headers = [
    "Name",
    "Contact",
    "Email",
    "Phone",
    "Location",
    "Street Address",
    "City",
    "State",
    "ZIP",
    "Active Equipment",
    "Service Type",
    "Status",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((c) =>
      [
        c.name,
        c.primary_contact_name,
        c.email,
        c.phone,
        formatCustomerLocationLabel(c),
        nonEmpty(c.service_address) ?? nonEmpty(c.billing_address) ?? "",
        c.city,
        c.state,
        c.zip_code,
        c.activeEquipmentCount,
        c.serviceType.label,
        c.status,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

function downloadCustomersExcel(rows: CustomerRow[]) {
  const csv = buildCustomersExcelCsv(rows);
  const blob = new Blob([csv], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `customers-${format(new Date(), "yyyy-MM-dd")}.xls`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CustomersPage() {
  const supabase = createClient();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterState, setFilterState] = useState(ALL);
  const [filterCity, setFilterCity] = useState(ALL);
  const [form, setForm] = useState(emptyCustomerForm);

  async function load() {
    setLoading(true);
    const [{ data: customerData }, { data: equipmentData }, { data: contractData }] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("equipment").select("customer_id, operating_status"),
      supabase.from("service_contracts").select("id, customer_id, name, status, end_date"),
    ]);

    const counts = new Map<string, number>();
    for (const eq of equipmentData ?? []) {
      if (!eq.customer_id || !isActiveEquipment(eq.operating_status as string)) continue;
      counts.set(eq.customer_id, (counts.get(eq.customer_id) ?? 0) + 1);
    }

    const contractsByCustomer = new Map<string, Array<Pick<ServiceContract, "name" | "status" | "end_date">>>();
    for (const sc of contractData ?? []) {
      if (!sc.customer_id) continue;
      const list = contractsByCustomer.get(sc.customer_id) ?? [];
      list.push({
        name: sc.name as string,
        status: sc.status as string,
        end_date: sc.end_date as string,
      });
      contractsByCustomer.set(sc.customer_id, list);
    }

    const rows: CustomerRow[] = ((customerData as CustomerLocation[]) ?? []).map((c) => ({
      ...c,
      activeEquipmentCount: counts.get(c.id) ?? 0,
      serviceType: resolveServiceType(contractsByCustomer.get(c.id) ?? []),
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

  const stateOptions = useMemo(() => uniqueSorted(customers.map((c) => c.state)), [customers]);
  const cityOptions = useMemo(() => {
    const base = filterState
      ? customers.filter((c) => locationMatches(c, filterState, c.state))
      : customers;
    return uniqueSorted(base.map((c) => c.city));
  }, [customers, filterState]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];

    return customers.filter((c) => {
      if (!locationMatches(c, filterState, c.state)) return false;
      if (!locationMatches(c, filterCity, c.city)) return false;
      if (terms.length === 0) return true;
      const hay = customerSearchHaystack(c);
      return terms.every((t) => hay.includes(t));
    });
  }, [customers, filterState, filterCity, searchQuery]);

  const hasFilters = Boolean(searchQuery.trim() || filterState || filterCity);

  function clearFilters() {
    setSearchQuery("");
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
          <>
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={() => downloadCustomersExcel(filteredCustomers)}
              disabled={loading || filteredCustomers.length === 0}
              title={
                filteredCustomers.length === 0
                  ? "No customers to export"
                  : `Export ${filteredCustomers.length} customer${filteredCustomers.length === 1 ? "" : "s"} (current search/filters)`
              }
            >
              <Download className="h-4 w-4" aria-hidden />
              Export to Excel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
              Add Customer
            </button>
          </>
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
            <p className="text-sm font-medium">Search &amp; filter</p>
            {hasFilters ? (
              <button type="button" className="btn btn-ghost btn-xs" onClick={clearFilters}>
                Clear
              </button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="form-control w-full sm:col-span-2 lg:col-span-2">
              <span className="label-text mb-1 text-xs opacity-70">Search</span>
              <input
                type="search"
                className="input input-bordered input-sm w-full"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Name, contact, email, phone, location, service type…"
                aria-label="Search customers"
              />
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
          <p className="mt-2 text-xs opacity-60">
            Showing {filteredCustomers.length} of {customers.length} customers
          </p>
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
                title="No customers match"
                description="Try a different search or location filter, or clear filters to see all customers."
                action={
                  <button type="button" className="btn btn-primary btn-sm" onClick={clearFilters}>
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
                    <th>Service Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((c) => {
                    const locationLabel = formatCustomerLocationLabel(c);
                    const contactLabel = nonEmpty(c.primary_contact_name) ?? "—";
                    const st = c.serviceType;
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
                          {st.kind === "tier" && st.tierId ? (
                            <span className={`badge badge-sm ${tierBadgeClass(st.tierId)}`}>{st.label}</span>
                          ) : (
                            <StatusBadge label={st.label} tone={serviceTypeTone(st)} />
                          )}
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
