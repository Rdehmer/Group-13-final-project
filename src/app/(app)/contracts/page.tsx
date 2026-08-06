"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { ClickableStatCard } from "@/components/ClickableStatCard";
import { EmptyState, StatCard, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney, grossProfit, profitMargin, formatPct } from "@/lib/calculations";
import type { Customer, Profile, ServiceContract } from "@/lib/types";
import { ApplyContractPlanPreset } from "@/components/ApplyContractPlanPreset";
import {
  contractMatchesPlanFilters,
  listActivePacks,
  loadCatalog,
  packGoldMidPrice,
  parsePlanSnapshotFromNotes,
  type ServiceLevelId,
} from "@/lib/contract-plans";
import { ClipboardList } from "lucide-react";

type ContractRow = ServiceContract & { customers?: { id: string; name: string } | null };

const CONTRACT_STATUSES = [
  "Draft",
  "Pending Approval",
  "Active",
  "Expired",
  "Canceled",
  "Pending Renewal",
] as const;

const emptyContractForm = {
  customer_id: "",
  name: "",
  contract_type: "Preventive Maintenance",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  billing_method: "Monthly Recurring Charge",
  contract_price: "0",
  included_service_visits: "4",
  included_labor_hours: "8",
  included_replacement_parts: "0",
  service_frequency: "Quarterly",
  emergency_response_commitment: "Next business day",
  payment_terms: "Net 30",
  renewal_option: "Manual renewal",
  approval_requirements: "",
  notes: "",
  status: "Draft",
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
 * This business faces contract visibility and onboarding friction risk.
 * Our app reduces the risk by linking contracts to related records and letting managers create customers inline.
 */
export default function ContractsPage() {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statusFromUrl = searchParams.get("status") ?? "";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyContractForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [filters, setFilters] = useState({
    name: "",
    customer: "",
    type: "",
    price: "",
    status: statusFromUrl,
    end: "",
  });
  const [sort, setSort] = useState<{
    column: "name" | "customer" | "type" | "price" | "status" | "end";
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [planIndustry, setPlanIndustry] = useState<"all" | "unlabeled" | string>("all");
  const [planTier, setPlanTier] = useState<"all" | ServiceLevelId>("all");
  const [planPacks, setPlanPacks] = useState(() =>
    typeof window !== "undefined" ? listActivePacks(loadCatalog()) : [],
  );

  const isManager =
    profile?.role === "service_manager" || profile?.role === "administrator";
  const isAdmin = profile?.role === "administrator";

  useEffect(() => {
    setPlanPacks(listActivePacks(loadCatalog()));
  }, []);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, status: statusFromUrl }));
  }, [statusFromUrl]);

  async function load() {
    const [{ data: sc }, { data: cust }, { data: { user } }] = await Promise.all([
      supabase
        .from("service_contracts")
        .select("*, customers(id, name)")
        .order("created_at", { ascending: false }),
      supabase.from("customers").select("*").order("name"),
      supabase.auth.getUser(),
    ]);
    setContracts((sc as ContractRow[]) ?? []);
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
      name: uniqueSorted(contracts.map((c) => c.name)),
      customer: uniqueSorted(contracts.map((c) => c.customers?.name ?? "")),
      type: uniqueSorted(contracts.map((c) => c.contract_type)),
      price: uniqueSorted(contracts.map((c) => formatMoney(c.contract_price))),
      status: uniqueSorted([
        ...contracts.map((c) => c.status),
        ...CONTRACT_STATUSES,
      ]),
      end: uniqueSorted(contracts.map((c) => c.end_date)),
    };
  }, [contracts]);

  const filteredContracts = useMemo(() => {
    const rows = contracts.filter((c) => {
      if (filters.name && c.name !== filters.name) return false;
      if (filters.customer && (c.customers?.name ?? "") !== filters.customer) return false;
      if (filters.type && c.contract_type !== filters.type) return false;
      if (filters.price && formatMoney(c.contract_price) !== filters.price) return false;
      if (filters.status && c.status !== filters.status) return false;
      if (filters.end && c.end_date !== filters.end) return false;
      if (!contractMatchesPlanFilters(c.notes, planIndustry, planTier)) return false;
      return true;
    });

    const valueFor = (c: ContractRow) => {
      switch (sort.column) {
        case "customer":
          return c.customers?.name ?? "";
        case "type":
          return c.contract_type;
        case "price":
          return String(c.contract_price).padStart(16, "0");
        case "status":
          return c.status;
        case "end":
          return c.end_date;
        case "name":
        default:
          return c.name;
      }
    };

    return [...rows].sort((a, b) => {
      if (sort.column === "price") {
        const cmp = Number(a.contract_price) - Number(b.contract_price);
        return sort.direction === "asc" ? cmp : -cmp;
      }
      const cmp = valueFor(a).localeCompare(valueFor(b), undefined, { sensitivity: "base" });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [contracts, filters, sort, planIndustry, planTier]);

  const hasActiveFilters =
    Object.values(filters).some((v) => v.trim() !== "") ||
    planIndustry !== "all" ||
    planTier !== "all";

  function clearFilters() {
    setFilters({ name: "", customer: "", type: "", price: "", status: "", end: "" });
    setPlanIndustry("all");
    setPlanTier("all");
    if (searchParams.toString()) {
      router.replace(pathname);
    }
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
    if (column === "status") {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set("status", value);
      else params.delete("status");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
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

  const totalRevenue = contracts
    .filter((c) => c.status === "Active")
    .reduce((s, c) => s + Number(c.contract_price), 0);
  const estCostPerVisit = 350;
  const estDirectCost = contracts
    .filter((c) => c.status === "Active")
    .reduce((s, c) => s + c.included_service_visits * estCostPerVisit, 0);
  const profit = grossProfit(totalRevenue, estDirectCost);
  const margin = profitMargin(totalRevenue, profit);

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
    const payload = {
      customer_id: form.customer_id,
      name: form.name,
      contract_type: form.contract_type,
      start_date: form.start_date,
      end_date: form.end_date,
      billing_method: form.billing_method,
      contract_price: Number(form.contract_price),
      included_service_visits: Number(form.included_service_visits),
      included_labor_hours: Number(form.included_labor_hours),
      included_replacement_parts: Number(form.included_replacement_parts) || 0,
      service_frequency: form.service_frequency || null,
      emergency_response_commitment: form.emergency_response_commitment || null,
      payment_terms: form.payment_terms || null,
      renewal_option: form.renewal_option || null,
      approval_requirements: form.approval_requirements || null,
      notes: form.notes || null,
      status: form.status,
      created_by: user?.id ?? null,
    };
    const { data, error: insertError } = await supabase
      .from("service_contracts")
      .insert(payload)
      .select()
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "contract",
      recordId: data.id,
      newValue: form.name,
    });
    setShowForm(false);
    setShowNewCustomer(false);
    setForm(emptyContractForm);
    load();
  }

  function openAddForm() {
    setError(null);
    setCustomerError(null);
    setShowNewCustomer(false);
    setForm({
      ...emptyContractForm,
      start_date: new Date().toISOString().slice(0, 10),
    });
    setShowForm(true);
  }

  async function updateStatus(contractId: string, previous: string, next: string) {
    if (previous === next) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("service_contracts")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", contractId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setContracts((prev) =>
      prev.map((c) => (c.id === contractId ? { ...c, status: next } : c)),
    );
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "status_change",
      recordType: "contract",
      recordId: contractId,
      previousValue: previous,
      newValue: next,
    });
  }

  async function approveContract(contract: ContractRow) {
    setError(null);
    setActionBusyId(contract.id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const price = Number(contract.contract_price) || 0;
    const { error: updateError } = await supabase
      .from("service_contracts")
      .update({
        status: "Active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", contract.id);
    if (updateError) {
      setError(updateError.message);
      setActionBusyId(null);
      return;
    }
    setContracts((prev) =>
      prev.map((c) => (c.id === contract.id ? { ...c, status: "Active" } : c)),
    );
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "contract_approved",
      recordType: "contract",
      recordId: contract.id,
      previousValue: "Pending Approval",
      newValue: `Active @ ${formatMoney(price)}`,
    });
    setActionBusyId(null);
  }

  async function rejectContract(contract: ContractRow) {
    setError(null);
    setActionBusyId(contract.id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const note = [contract.notes, "Rejected by Ridley (customer request not approved)."]
      .filter(Boolean)
      .join("\n");
    const { error: updateError } = await supabase
      .from("service_contracts")
      .update({
        status: "Canceled",
        notes: note,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contract.id);
    if (updateError) {
      setError(updateError.message);
      setActionBusyId(null);
      return;
    }
    setContracts((prev) =>
      prev.map((c) =>
        c.id === contract.id ? { ...c, status: "Canceled", notes: note } : c,
      ),
    );
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "contract_rejected",
      recordType: "contract",
      recordId: contract.id,
      previousValue: "Pending Approval",
      newValue: "Canceled",
    });
    setActionBusyId(null);
  }

  const pendingRequests = useMemo(
    () => contracts.filter((c) => c.status === "Pending Approval"),
    [contracts],
  );

  const activeCustomers = customers.filter((c) => c.status === "Active");

  return (
    <div>
      <PageHeader
        title="Service Contracts"
        description="Manage maintenance agreements and profitability"
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={openAddForm}>
            New Contract
          </button>
        }
      />

      {isManager ? (
        <div className="mb-6 card bg-base-100 shadow">
          <div className="card-body gap-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 opacity-70" />
                <div>
                  <p className="font-semibold">Contract plans</p>
                  <p className="text-sm opacity-70">
                    Choose an industry plan and coverage level from the menus to filter contracts.
                  </p>
                </div>
              </div>
              {isAdmin ? (
                <Link href="/settings/contract-plans" className="btn btn-outline btn-sm gap-1">
                  <ClipboardList className="h-4 w-4" /> Edit plans
                </Link>
              ) : null}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="form-control w-full max-w-xs">
                <span className="label-text text-xs">Industry plan</span>
                <select
                  className="select select-bordered select-sm"
                  value={planIndustry}
                  onChange={(e) => setPlanIndustry(e.target.value)}
                >
                  <option value="all">All industries</option>
                  <option value="unlabeled">Unlabeled (no plan tag)</option>
                  {planPacks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — Gold Mid from {formatMoney(packGoldMidPrice(p))}/yr
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control w-full max-w-xs">
                <span className="label-text text-xs">Coverage level</span>
                <select
                  className="select select-bordered select-sm"
                  value={planTier}
                  onChange={(e) => setPlanTier(e.target.value as "all" | ServiceLevelId)}
                >
                  <option value="all">All levels</option>
                  <option value="gold">Gold</option>
                  <option value="silver">Silver</option>
                  <option value="bronze">Bronze</option>
                </select>
              </label>
              {planIndustry !== "all" || planTier !== "all" ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setPlanIndustry("all");
                    setPlanTier("all");
                  }}
                >
                  Clear plan filters
                </button>
              ) : null}
              <p className="pb-1 text-xs opacity-60">
                Showing {filteredContracts.length} of {contracts.length} contracts
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {isManager ? (
          <>
            <ClickableStatCard
              label="Active Contract Revenue"
              value={formatMoney(totalRevenue)}
              href="/reports/contracts?from=contracts&focus=revenue"
              ariaLabel="View active contract revenue on reports"
            />
            <ClickableStatCard
              label="Est. Direct Cost"
              value={formatMoney(estDirectCost)}
              hint="Assumes $350/visit avg"
              href="/reports/contracts?from=contracts&focus=cost"
              ariaLabel="View estimated direct cost on reports"
            />
            <ClickableStatCard
              label="Est. Gross Margin"
              value={formatPct(margin)}
              hint={`Profit ${formatMoney(profit)}`}
              href="/reports/contracts?from=contracts&focus=margin"
              ariaLabel="View estimated gross margin on reports"
            />
          </>
        ) : (
          <>
            <StatCard label="Active Contract Revenue" value={formatMoney(totalRevenue)} />
            <StatCard
              label="Est. Direct Cost"
              value={formatMoney(estDirectCost)}
              hint="Assumes $350/visit avg"
            />
            <StatCard
              label="Est. Gross Margin"
              value={formatPct(margin)}
              hint={`Profit ${formatMoney(profit)}`}
            />
          </>
        )}
      </div>

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">New Contract</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              {isManager ? (
                <ApplyContractPlanPreset
                  form={form}
                  compact
                  updateName
                  customerName={
                    customers.find((c) => c.id === form.customer_id)?.name ||
                    customerForm.name.trim() ||
                    undefined
                  }
                  onApply={(next) => setForm(next)}
                />
              ) : null}

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
              <FormRow label="Type">
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
              </FormRow>
              <FormRow label="Start">
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="End">
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  required
                />
              </FormRow>
              <FormRow label="Price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.contract_price}
                  onChange={(e) => setForm({ ...form, contract_price: e.target.value })}
                />
              </FormRow>
              <FormRow label="Visits">
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={form.included_service_visits}
                  onChange={(e) => setForm({ ...form, included_service_visits: e.target.value })}
                />
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

      {isManager && pendingRequests.length > 0 ? (
        <div className="mb-6 card border border-warning/40 bg-base-100 shadow">
          <div className="card-body gap-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="card-title text-base">Pending customer requests</h2>
                <p className="text-sm opacity-70">
                  Approve to activate, or reject. Names starting with [Request] are portal submissions.
                </p>
              </div>
              <Link
                href="/contracts?status=Pending%20Approval"
                className="btn btn-ghost btn-sm"
              >
                Filter table →
              </Link>
            </div>
            {error ? <div className="alert alert-error text-sm">{error}</div> : null}
            <ul className="space-y-3">
              {pendingRequests.map((c) => (
                <li
                  key={c.id}
                  className="rounded-box border border-base-300 bg-base-200/40 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                      <Link
                        href={`/contracts/${c.id}`}
                        className="link link-primary font-medium break-words"
                      >
                        {c.name}
                      </Link>
                      <p className="mt-1 text-sm opacity-70">
                        {c.customers?.name ?? "—"} · {c.contract_type} · starts {c.start_date}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={actionBusyId === c.id}
                        onClick={() => void approveContract(c)}
                      >
                        {actionBusyId === c.id ? "Working…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-error btn-sm"
                        disabled={actionBusyId === c.id}
                        onClick={() => void rejectContract(c)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div id="contract-list" className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {contracts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No contracts"
                description="Create service agreements to track recurring revenue."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th>End</th>
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
                        <ColumnFilterSelect column="type" label="type" options={filterOptions.type} />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect column="price" label="price" options={filterOptions.price} />
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
                          <ColumnFilterSelect column="end" label="end date" options={filterOptions.end} />
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
                  {filteredContracts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6">
                        <EmptyState
                          title="No matching contracts"
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
                    filteredContracts.map((c) => (
                      <tr key={c.id}>
                        <td className="align-top">
                          {isManager ? (
                            <>
                              <Link
                                href={`/contracts/${c.id}`}
                                className="link link-primary font-medium break-words"
                                aria-label={`Open contract ${c.name}`}
                              >
                                {c.name}
                              </Link>
                              {parsePlanSnapshotFromNotes(c.notes) ? (
                                <p className="mt-0.5 text-[11px] opacity-60">
                                  {(() => {
                                    const snap = parsePlanSnapshotFromNotes(c.notes)!;
                                    return `${snap.packName} · ${snap.tierName} · ${snap.bandLabel}`;
                                  })()}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <span className="font-medium break-words">{c.name}</span>
                          )}
                        </td>
                        <td className="align-top break-words">
                          {isManager && c.customers?.id ? (
                            <Link
                              href={`/customers/${c.customers.id}`}
                              className="link link-primary"
                              aria-label={`Open customer ${c.customers.name}`}
                            >
                              {c.customers.name}
                            </Link>
                          ) : (
                            (c.customers?.name ?? "—")
                          )}
                        </td>
                        <td className="align-top break-words">{c.contract_type}</td>
                        <td className="align-top">{formatMoney(c.contract_price)}</td>
                        <td className="align-top">
                          {isManager ? (
                            <div className="dropdown dropdown-hover dropdown-end">
                              <div
                                tabIndex={0}
                                role="button"
                                className="cursor-pointer rounded-btn outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                aria-label={`Change status, currently ${c.status}`}
                              >
                                <StatusBadge label={c.status} tone={statusTone(c.status)} />
                              </div>
                              <ul
                                tabIndex={0}
                                className="dropdown-content menu z-20 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow"
                              >
                                {CONTRACT_STATUSES.map((option) => (
                                  <li key={option}>
                                    <button
                                      type="button"
                                      className={option === c.status ? "active" : ""}
                                      onClick={() => updateStatus(c.id, c.status, option)}
                                    >
                                      <StatusBadge label={option} tone={statusTone(option)} />
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <StatusBadge label={c.status} tone={statusTone(c.status)} />
                          )}
                        </td>
                        <td className="align-top">{c.end_date}</td>
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
