"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { ClickableStatCard } from "@/components/ClickableStatCard";
import { ColumnFilterSelect, applyColumnSortValue } from "@/components/ColumnFilterSelect";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney, formatPct } from "@/lib/calculations";
import type {
  Customer,
  Invoice,
  Profile,
  ServiceContract,
  WorkOrder,
} from "@/lib/types";
import { ApplyContractPlanPreset } from "@/components/ApplyContractPlanPreset";
import {
  contractMatchesPlanFilters,
  listActivePacks,
  packGoldMidPrice,
  parsePlanSnapshotFromNotes,
  type IndustryPack,
  type ServiceLevelId,
} from "@/lib/contract-plans";
import { loadCompanyCatalog } from "@/lib/company-catalog";
import { generateMonthlyInvoicesForPeriod, getContractPaymentStanding,
  monthlyFromAnnual,
  resolveMoneyFromContractNotes,
  resolvedDeductible,
  resolvedMonthlyAmount,
  standingBadgeClass,
  currentBillingPeriodKey,
  formatStandingDetail,
} from "@/lib/contract-billing";
import {
  contractEconomicsInRange,
  currentMonthRange,
  periodLabel,
  sumEconomics,
  TECH_HOURLY_COST,
} from "@/lib/contract-monthly-economics";
import { ClipboardList } from "lucide-react";
import { formatMonthLabel } from "@/lib/billing";
import { stripRequestPrefixFromContractName } from "@/lib/contracts";

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
  monthly_amount: "0",
  deductible: "0",
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
  const typeFromUrl = searchParams.get("type") ?? "";
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
    type: typeFromUrl,
    price: "",
    monthly: "",
    directCost: "",
    margin: "",
    deductible: "",
    feeStatus: "",
    status: statusFromUrl,
    end: "",
  });
  const [sort, setSort] = useState<{
    column:
      | "name"
      | "customer"
      | "type"
      | "price"
      | "monthly"
      | "directCost"
      | "margin"
      | "deductible"
      | "feeStatus"
      | "status"
      | "end";
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [planIndustry, setPlanIndustry] = useState<"all" | "unlabeled" | string>("all");
  const [planTier, setPlanTier] = useState<"all" | ServiceLevelId>("all");
  const [planPacks, setPlanPacks] = useState<IndustryPack[]>([]);
  const [standingInvoices, setStandingInvoices] = useState<Invoice[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);

  const isManager =
    profile?.role === "service_manager" || profile?.role === "administrator";
  const isAdmin = profile?.role === "administrator";

  useEffect(() => {
    void (async () => {
      const { catalog } = await loadCompanyCatalog(supabase);
      setPlanPacks(listActivePacks(catalog));
    })();
  }, [supabase]);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, status: statusFromUrl, type: typeFromUrl }));
  }, [statusFromUrl, typeFromUrl]);

  async function load() {
    const [
      { data: sc },
      { data: cust },
      {
        data: { user },
      },
      { data: inv },
      { data: wo },
    ] = await Promise.all([
      supabase
        .from("service_contracts")
        .select("*, customers(id, name)")
        .order("created_at", { ascending: false }),
      supabase.from("customers").select("*").order("name"),
      supabase.auth.getUser(),
      supabase
        .from("invoices")
        .select("*")
        .is("work_order_id", null)
        .gt("recurring_service_charge", 0),
      supabase.from("work_orders").select("id, contract_id, status, completion_date, scheduled_date, created_at"),
    ]);
    setContracts((sc as ContractRow[]) ?? []);
    setCustomers((cust as Customer[]) ?? []);
    setStandingInvoices((inv as Invoice[]) ?? []);
    setWorkOrders((wo as WorkOrder[]) ?? []);
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const monthRange = useMemo(() => currentMonthRange(new Date()), []);
  const monthLabel = periodLabel(monthRange);

  const economicsByContract = useMemo(() => {
    const map = new Map<string, ReturnType<typeof contractEconomicsInRange>>();
    for (const c of contracts) {
      map.set(c.id, contractEconomicsInRange(c, workOrders, monthRange));
    }
    return map;
  }, [contracts, workOrders, monthRange]);

  const activeMonthSummary = useMemo(() => {
    const rows = contracts
      .filter((c) => c.status === "Active")
      .map((c) => economicsByContract.get(c.id)!)
      .filter(Boolean);
    return sumEconomics(rows);
  }, [contracts, economicsByContract]);

  const totalRevenue = activeMonthSummary.monthlyRevenue;
  const directCost = activeMonthSummary.directCost;
  const profit = activeMonthSummary.profit;
  const margin = activeMonthSummary.margin;

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
      monthly: uniqueSorted(contracts.map((c) => formatMoney(resolvedMonthlyAmount(c)))),
      directCost: uniqueSorted(
        contracts.map((c) => formatMoney(economicsByContract.get(c.id)?.directCost ?? 0)),
      ),
      margin: uniqueSorted(
        contracts.map((c) => formatPct(economicsByContract.get(c.id)?.margin ?? null)),
      ),
      deductible: uniqueSorted(contracts.map((c) => formatMoney(resolvedDeductible(c)))),
      feeStatus: uniqueSorted(
        contracts.map((c) => {
          const s = getContractPaymentStanding(c, standingInvoices);
          return s.id === "not_monthly" ? "—" : s.label;
        }),
      ),
      status: uniqueSorted([
        ...contracts.map((c) => c.status),
        ...CONTRACT_STATUSES,
      ]),
      end: uniqueSorted(contracts.map((c) => c.end_date)),
    };
  }, [contracts, economicsByContract, standingInvoices]);

  const filteredContracts = useMemo(() => {
    const rows = contracts.filter((c) => {
      const econ = economicsByContract.get(c.id);
      const standing = getContractPaymentStanding(c, standingInvoices);
      const feeLabel = standing.id === "not_monthly" ? "—" : standing.label;
      if (filters.name && c.name !== filters.name) return false;
      if (filters.customer && (c.customers?.name ?? "") !== filters.customer) return false;
      if (filters.type && c.contract_type !== filters.type) return false;
      if (filters.price && formatMoney(c.contract_price) !== filters.price) return false;
      if (filters.monthly && formatMoney(resolvedMonthlyAmount(c)) !== filters.monthly) return false;
      if (filters.directCost && formatMoney(econ?.directCost ?? 0) !== filters.directCost) {
        return false;
      }
      if (filters.margin && formatPct(econ?.margin ?? null) !== filters.margin) return false;
      if (filters.deductible && formatMoney(resolvedDeductible(c)) !== filters.deductible) {
        return false;
      }
      if (filters.feeStatus && feeLabel !== filters.feeStatus) return false;
      if (filters.status && c.status !== filters.status) return false;
      if (filters.end && c.end_date !== filters.end) return false;
      if (!contractMatchesPlanFilters(c.notes, planIndustry, planTier)) return false;
      return true;
    });

    const numericColumns = new Set(["price", "monthly", "directCost", "margin", "deductible"]);

    const numericValue = (c: ContractRow): number => {
      const econ = economicsByContract.get(c.id);
      switch (sort.column) {
        case "price":
          return Number(c.contract_price) || 0;
        case "monthly":
          return resolvedMonthlyAmount(c);
        case "directCost":
          return econ?.directCost ?? 0;
        case "margin":
          return econ?.margin ?? -999;
        case "deductible":
          return resolvedDeductible(c);
        default:
          return 0;
      }
    };

    const textValue = (c: ContractRow): string => {
      const standing = getContractPaymentStanding(c, standingInvoices);
      switch (sort.column) {
        case "customer":
          return c.customers?.name ?? "";
        case "type":
          return c.contract_type;
        case "feeStatus":
          return standing.id === "not_monthly" ? "—" : standing.label;
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
      if (numericColumns.has(sort.column)) {
        const cmp = numericValue(a) - numericValue(b);
        return sort.direction === "asc" ? cmp : -cmp;
      }
      const cmp = textValue(a).localeCompare(textValue(b), undefined, { sensitivity: "base" });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [
    contracts,
    filters,
    sort,
    planIndustry,
    planTier,
    economicsByContract,
    standingInvoices,
  ]);

  const hasActiveFilters =
    Object.values(filters).some((v) => v.trim() !== "") ||
    planIndustry !== "all" ||
    planTier !== "all";

  function clearFilters() {
    setFilters({
      name: "",
      customer: "",
      type: "",
      price: "",
      monthly: "",
      directCost: "",
      margin: "",
      deductible: "",
      feeStatus: "",
      status: "",
      end: "",
    });
    setPlanIndustry("all");
    setPlanTier("all");
    if (searchParams.toString()) {
      router.replace(pathname);
    }
  }

  function onColumnFilterChange(column: keyof typeof filters, value: string) {
    if (
      applyColumnSortValue(value, (direction) =>
        setSort({ column, direction }),
      )
    ) {
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

  function contractColumnFilter(
    column: keyof typeof filters,
    label: string,
    options: string[],
    sortMode: "text" | "numeric" | "date" = "text",
  ) {
    return (
      <ColumnFilterSelect
        label={label}
        value={filters[column]}
        options={options}
        sortMode={sortMode}
        activeSort={sort.column === column ? { direction: sort.direction } : null}
        onChange={(v) => onColumnFilterChange(column, v)}
      />
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
    const annual = Number(form.contract_price) || 0;
    const monthly =
      Number(form.monthly_amount) > 0
        ? Number(form.monthly_amount)
        : /monthly\s*recurring/i.test(form.billing_method)
          ? monthlyFromAnnual(annual)
          : 0;
    const payload = {
      customer_id: form.customer_id,
      name: form.name,
      contract_type: form.contract_type,
      start_date: form.start_date,
      end_date: form.end_date,
      billing_method: form.billing_method,
      contract_price: annual,
      monthly_amount: monthly,
      deductible: Number(form.deductible) || 0,
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
    const contract = contracts.find((c) => c.id === contractId);
    const patch: {
      status: string;
      updated_at: string;
      name?: string;
    } = { status: next, updated_at: new Date().toISOString() };
    if (contract && (next === "Active" || next === "Renewed")) {
      const cleanedName = stripRequestPrefixFromContractName(contract.name);
      if (cleanedName !== contract.name) patch.name = cleanedName;
    }
    const { error: updateError } = await supabase
      .from("service_contracts")
      .update(patch)
      .eq("id", contractId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setContracts((prev) =>
      prev.map((c) =>
        c.id === contractId
          ? { ...c, status: next, ...(patch.name ? { name: patch.name } : {}) }
          : c,
      ),
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

    let price = Number(contract.contract_price) || 0;
    let monthly = resolvedMonthlyAmount(contract);
    let deductible = resolvedDeductible(contract);
    if (price <= 0) {
      const fromPlan = resolveMoneyFromContractNotes(contract.notes);
      if (fromPlan) {
        price = fromPlan.contract_price;
        monthly = fromPlan.monthly_amount;
        deductible = fromPlan.deductible;
      }
    } else if (monthly <= 0 && /monthly\s*recurring/i.test(contract.billing_method)) {
      monthly = monthlyFromAnnual(price);
    }

    const activatedName = stripRequestPrefixFromContractName(contract.name);

    const { error: updateError } = await supabase
      .from("service_contracts")
      .update({
        status: "Active",
        name: activatedName,
        contract_price: price,
        monthly_amount: monthly,
        deductible,
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
        c.id === contract.id
          ? {
              ...c,
              status: "Active",
              name: activatedName,
              contract_price: price,
              monthly_amount: monthly,
              deductible,
            }
          : c,
      ),
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

  async function generateMonthlyFees() {
    if (!isManager) return;
    setGenBusy(true);
    setGenMessage(null);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const period = currentBillingPeriodKey();
    const result = await generateMonthlyInvoicesForPeriod(supabase, {
      billingPeriod: period,
      userId: user?.id ?? null,
    });
    setGenBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setGenMessage(
      `Monthly fees for ${formatMonthLabel(period)}: created ${result.created}, skipped ${result.skipped}.${
        result.errors.length ? ` ${result.errors.slice(0, 3).join(" ")}` : ""
      }`,
    );
    await load();
  }

  async function rejectContract(contract: ContractRow) {
    setError(null);
    setActionBusyId(contract.id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const note = [contract.notes, "Rejected by EquipmentIQ (customer request not approved)."]
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
          <div className="flex flex-wrap gap-2">
            {isManager ? (
              <>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={genBusy}
                  onClick={() => void generateMonthlyFees()}
                >
                  {genBusy ? "Generating…" : "Generate monthly fees"}
                </button>
                <Link href="/reports?report=deferred_revenue" className="btn btn-ghost btn-sm">
                  Deferred revenue
                </Link>
              </>
            ) : null}
            <button type="button" className="btn btn-primary btn-sm" onClick={openAddForm}>
              New Contract
            </button>
          </div>
        }
      />
      {genMessage ? (
        <div className="alert alert-success mb-4 text-sm">
          <span>{genMessage}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setGenMessage(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

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
                      {p.name} — from {formatMoney(Math.round(packGoldMidPrice(p) / 12))}/mo
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
                  {[
                    ...new Map(
                      planPacks
                        .flatMap((p) => p.levels)
                        .map((l) => [l.id, l.name] as const),
                    ).entries(),
                  ].map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
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

      {isManager ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <ClickableStatCard
            label="Monthly Fee Revenue"
            value={formatMoney(totalRevenue)}
            hint={`${monthLabel} · sum of monthly fees`}
            href="/reports/contracts?from=contracts&focus=revenue"
            ariaLabel="View monthly fee revenue on reports"
          />
          <ClickableStatCard
            label="Monthly Direct Cost"
            value={formatMoney(directCost)}
            hint={`Labor @ $${TECH_HOURLY_COST}/hr + parts ÷ 12`}
            href="/reports/contracts?from=contracts&focus=cost"
            ariaLabel="View monthly direct cost on reports"
          />
          <ClickableStatCard
            label="Monthly Gross Margin"
            value={formatPct(margin)}
            hint={`Profit ${formatMoney(profit)} · ${monthLabel}`}
            href="/reports/contracts?from=contracts&focus=margin"
            ariaLabel="View monthly gross margin on reports"
          />
        </div>
      ) : null}

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
              <FormRow label="Annual price">
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
              </FormRow>
              <FormRow label="Monthly fee">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.monthly_amount}
                  onChange={(e) => setForm({ ...form, monthly_amount: e.target.value })}
                />
              </FormRow>
              <FormRow label="Deductible">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.deductible}
                  onChange={(e) => setForm({ ...form, deductible: e.target.value })}
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
            <DualHorizontalScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Annual</th>
                    <th>Monthly fee</th>
                    {isManager ? (
                      <>
                        <th>Direct cost ({monthLabel.split(" ")[0]})</th>
                        <th>Margin</th>
                      </>
                    ) : null}
                    <th>Deductible</th>
                    <th>Fee status</th>
                    <th>Status</th>
                    <th>End</th>
                  </tr>
                  {isManager ? (
                    <tr className="bg-base-200/50">
                      <th className="font-normal">
                        {contractColumnFilter("name", "name", filterOptions.name)}
                      </th>
                      <th className="font-normal">
                        {contractColumnFilter("customer", "customer", filterOptions.customer)}
                      </th>
                      <th className="font-normal">
                        {contractColumnFilter("type", "type", filterOptions.type)}
                      </th>
                      <th className="font-normal">
                        {contractColumnFilter("price", "annual", filterOptions.price, "numeric")}
                      </th>
                      <th className="font-normal">
                        {contractColumnFilter("monthly", "monthly fee", filterOptions.monthly, "numeric")}
                      </th>
                      <th className="font-normal">
                        {contractColumnFilter(
                          "directCost",
                          "direct cost",
                          filterOptions.directCost,
                          "numeric",
                        )}
                      </th>
                      <th className="font-normal">
                        {contractColumnFilter("margin", "margin", filterOptions.margin, "numeric")}
                      </th>
                      <th className="font-normal">
                        {contractColumnFilter(
                          "deductible",
                          "deductible",
                          filterOptions.deductible,
                          "numeric",
                        )}
                      </th>
                      <th className="font-normal">
                        {contractColumnFilter("feeStatus", "fee status", filterOptions.feeStatus)}
                      </th>
                      <th className="font-normal">
                        {contractColumnFilter("status", "status", filterOptions.status)}
                      </th>
                      <th className="font-normal">
                        <div className="flex gap-1">
                          {contractColumnFilter("end", "end date", filterOptions.end, "date")}
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
                        <td colSpan={isManager ? 11 : 9} className="p-6">
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
                    filteredContracts.map((c) => {
                      const standing = getContractPaymentStanding(c, standingInvoices);
                      const econ = economicsByContract.get(c.id);
                      return (
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
                        <td className="align-top tabular-nums">
                          {formatMoney(resolvedMonthlyAmount(c))}
                        </td>
                        {isManager ? (
                          <>
                            <td className="align-top tabular-nums">
                              <span>{formatMoney(econ?.directCost ?? 0)}</span>
                              {econ ? (
                                <p className="mt-0.5 text-[11px] opacity-60">
                                  {econ.includedLaborHours}h × ${TECH_HOURLY_COST} + parts{" "}
                                  {formatMoney(econ.includedPartsAllowance)} ÷ 12
                                  {econ.includedVisits > 0
                                    ? ` · ${econ.usedVisits}/${econ.includedVisits} visits`
                                    : ""}
                                </p>
                              ) : null}
                            </td>
                            <td className="align-top tabular-nums">
                              <span
                                className={
                                  econ && econ.margin !== null && econ.margin < 0.2
                                    ? econ.margin < 0
                                      ? "text-error font-medium"
                                      : "text-warning font-medium"
                                    : undefined
                                }
                              >
                                {formatPct(econ?.margin ?? null)}
                              </span>
                            </td>
                          </>
                        ) : null}
                        <td className="align-top tabular-nums">
                          {formatMoney(resolvedDeductible(c))}
                        </td>
                        <td className="align-top">
                          {standing.id === "not_monthly" ? (
                            <span className="text-xs opacity-50">—</span>
                          ) : (
                            <div>
                              <span className={`badge badge-sm ${standingBadgeClass(standing.id)}`}>
                                {standing.label}
                              </span>
                              <p className="mt-1 max-w-[10rem] text-xs opacity-60">
                                {formatStandingDetail(standing)}
                              </p>
                            </div>
                          )}
                        </td>
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
                      );
                    })
                  )}
                </tbody>
              </table>
            </DualHorizontalScroll>
          )}
        </div>
      </div>
    </div>
  );
}
