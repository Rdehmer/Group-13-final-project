"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { StatusHoverEditor } from "@/components/StatusHoverEditor";
import { ColumnFilterSelect, applyColumnSortValue } from "@/components/ColumnFilterSelect";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney, formatPct } from "@/lib/calculations";
import {
  buildCoverageMap,
  coverageFor,
  EQUIPMENT_COVERAGE_SELECT,
  type ContractEquipmentLink,
  type EquipmentCoverage,
} from "@/lib/equipmentCoverage";
import {
  customerConcentration,
  downloadEquipmentCsv,
  emptyCostRollup,
  equipmentAgeYears,
  finalizeCostRollup,
  isActiveEquipmentUnit,
  needsAttentionStatus,
  serviceCompliance,
  serviceComplianceTone,
  warrantyAging,
  warrantyAgingTone,
  type EquipmentCostRollup,
  type ServiceCompliance,
  type WarrantyAging,
} from "@/lib/equipmentAccounting";
import type { Customer, Equipment, Profile } from "@/lib/types";

type ManagerEquipmentRow = Equipment & {
  customers?: { id: string; name: string } | null;
  coverage: EquipmentCoverage;
};

type ActiveContractOption = {
  id: string;
  name: string;
  customer_id: string;
};

type InvoiceCostRow = {
  equipment_id: string | null;
  labor_charges: number | null;
  parts_charges: number | null;
  recurring_service_charge: number | null;
  additional_charges: number | null;
  discounts: number | null;
  warranty_deductions: number | null;
  invoice_total: number | null;
};

type LaborCostRow = {
  work_order_id: string;
  regular_hours: number | null;
  overtime_hours: number | null;
  hourly_cost_rate: number | null;
  overtime_cost_rate: number | null;
};

type PartsCostRow = {
  work_order_id: string;
  quantity_used: number | null;
  unit_cost: number | null;
  warranty_covered_amount: number | null;
  billable_amount: number | null;
};

type FilterKey =
  | "name"
  | "customer"
  | "serial"
  | "category"
  | "manufacturer"
  | "model"
  | "status"
  | "location"
  | "contract"
  | "warranty"
  | "compliance"
  | "install"
  | "age"
  | "lastService"
  | "cost";

type SortKey = FilterKey;

const emptyEquipmentForm = {
  customer_id: "",
  name: "",
  category: "",
  manufacturer: "",
  model: "",
  serial_number: "",
  location: "",
  installation_date: "",
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

const emptyFilters: Record<FilterKey, string> = {
  name: "",
  customer: "",
  serial: "",
  category: "",
  manufacturer: "",
  model: "",
  status: "",
  location: "",
  contract: "",
  warranty: "",
  compliance: "",
  install: "",
  age: "",
  lastService: "",
  cost: "",
};

const STATUS_OPTIONS: Equipment["operating_status"][] = [
  "Operational",
  "Needs Service",
  "Out of Service",
  "Retired",
];

function yearStartIso(year = new Date().getFullYear()) {
  return `${year}-01-01`;
}

function invoiceBillable(inv: InvoiceCostRow) {
  const fromCharges =
    Number(inv.labor_charges || 0) +
    Number(inv.parts_charges || 0) +
    Number(inv.recurring_service_charge || 0) +
    Number(inv.additional_charges || 0) -
    Number(inv.discounts || 0);
  if (Number.isFinite(fromCharges)) return fromCharges;
  return Number(inv.invoice_total || 0) - Number(inv.warranty_deductions || 0);
}

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function chunkIds<T>(ids: T[], size = 150): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

function rowClassName(
  eq: ManagerEquipmentRow,
  highlighted: boolean,
): string | undefined {
  if (highlighted) return "bg-primary/10";
  if (eq.operating_status === "Out of Service") return "bg-error/5";
  if (eq.operating_status === "Needs Service") return "bg-warning/10";
  return undefined;
}

/**
 * This business faces uncovered assets, warranty leakage, and weak cost-to-serve visibility risk.
 * Our app reduces the risk by surfacing coverage queues, warranty aging, YTD costs, and quick contract attach for managers.
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
  const [activeContracts, setActiveContracts] = useState<ActiveContractOption[]>([]);
  const [costByEquipment, setCostByEquipment] = useState<Record<string, EquipmentCostRollup>>({});
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyEquipmentForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [uncoveredOnly, setUncoveredOnly] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [sort, setSort] = useState<{ column: SortKey; direction: "asc" | "desc" }>({
    column: "name",
    direction: "asc",
  });

  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<Equipment["operating_status"] | "">("");
  const [bulkContractId, setBulkContractId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const [attachTarget, setAttachTarget] = useState<ManagerEquipmentRow | null>(null);
  const [attachContractId, setAttachContractId] = useState("");
  const [attaching, setAttaching] = useState(false);

  const isManager =
    profile?.role === "administrator" || profile?.role === "service_manager";

  async function loadCostRollups(): Promise<Record<string, EquipmentCostRollup>> {
    const yearStart = yearStartIso();
    const [{ data: wos }, { data: invoices }] = await Promise.all([
      supabase
        .from("work_orders")
        .select("id, equipment_id")
        .not("equipment_id", "is", null)
        .gte("created_at", yearStart),
      supabase
        .from("invoices")
        .select(
          "equipment_id, labor_charges, parts_charges, recurring_service_charge, additional_charges, discounts, warranty_deductions, invoice_total",
        )
        .not("equipment_id", "is", null)
        .gte("invoice_date", yearStart),
    ]);

    const woRows = (wos as { id: string; equipment_id: string }[]) ?? [];
    const woToEquipment = new Map(woRows.map((w) => [w.id, w.equipment_id]));
    const woIds = woRows.map((w) => w.id);

    const partial = new Map<
      string,
      { laborCost: number; partsCost: number; billable: number; warranty: number }
    >();

    const ensure = (equipmentId: string) => {
      const cur = partial.get(equipmentId) ?? {
        laborCost: 0,
        partsCost: 0,
        billable: 0,
        warranty: 0,
      };
      partial.set(equipmentId, cur);
      return cur;
    };

    if (woIds.length > 0) {
      const laborRows: LaborCostRow[] = [];
      const partsRows: PartsCostRow[] = [];
      for (const chunk of chunkIds(woIds)) {
        const [{ data: labor }, { data: parts }] = await Promise.all([
          supabase
            .from("technician_labor")
            .select(
              "work_order_id, regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate",
            )
            .in("work_order_id", chunk),
          supabase
            .from("work_order_parts")
            .select(
              "work_order_id, quantity_used, unit_cost, warranty_covered_amount, billable_amount",
            )
            .in("work_order_id", chunk),
        ]);
        laborRows.push(...((labor as LaborCostRow[]) ?? []));
        partsRows.push(...((parts as PartsCostRow[]) ?? []));
      }

      for (const row of laborRows) {
        const equipmentId = woToEquipment.get(row.work_order_id);
        if (!equipmentId) continue;
        const cur = ensure(equipmentId);
        cur.laborCost +=
          Number(row.regular_hours || 0) * Number(row.hourly_cost_rate || 0) +
          Number(row.overtime_hours || 0) * Number(row.overtime_cost_rate || 0);
      }

      for (const row of partsRows) {
        const equipmentId = woToEquipment.get(row.work_order_id);
        if (!equipmentId) continue;
        const cur = ensure(equipmentId);
        cur.partsCost += Number(row.quantity_used || 0) * Number(row.unit_cost || 0);
        cur.warranty += Number(row.warranty_covered_amount || 0);
      }
    }

    for (const inv of (invoices as InvoiceCostRow[]) ?? []) {
      if (!inv.equipment_id) continue;
      const cur = ensure(inv.equipment_id);
      cur.billable += invoiceBillable(inv);
      cur.warranty += Number(inv.warranty_deductions || 0);
    }

    const out: Record<string, EquipmentCostRollup> = {};
    for (const [equipmentId, values] of partial) {
      out[equipmentId] = finalizeCostRollup(values);
    }
    return out;
  }

  async function load() {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let nextProfile: Profile | null = null;
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      nextProfile = p as Profile;
      setProfile(nextProfile);
    }

    const manager =
      nextProfile?.role === "administrator" ||
      nextProfile?.role === "service_manager";

    const [{ data: eq }, { data: cust }, { data: links }] = await Promise.all([
      supabase.from("equipment").select("*, customers(id, name)").order("name"),
      supabase.from("customers").select("*").order("name"),
      supabase.from("contract_equipment").select(EQUIPMENT_COVERAGE_SELECT),
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

    if (manager) {
      const [{ data: contracts }, costs] = await Promise.all([
        supabase
          .from("service_contracts")
          .select("id, name, customer_id")
          .eq("status", "Active")
          .order("name"),
        loadCostRollups(),
      ]);
      setActiveContracts((contracts as ActiveContractOption[]) ?? []);
      setCostByEquipment(costs);
    } else {
      setActiveContracts([]);
      setCostByEquipment({});
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!highlightId || equipment.length === 0) return;
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, equipment]);

  const costFor = (id: string) => costByEquipment[id] ?? emptyCostRollup();

  const uncoveredActiveCount = useMemo(
    () =>
      equipment.filter(
        (eq) => isActiveEquipmentUnit(eq.operating_status) && !eq.coverage.covered,
      ).length,
    [equipment],
  );

  const concentration = useMemo(
    () => (isManager ? customerConcentration(equipment, 5) : []),
    [equipment, isManager],
  );

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
      manufacturer: uniqueSorted(equipment.map((e) => e.manufacturer ?? "")),
      model: uniqueSorted(equipment.map((e) => e.model ?? "")),
      status: uniqueSorted(equipment.map((e) => e.operating_status)),
      location: uniqueSorted(equipment.map((e) => e.location ?? "")),
      contract: uniqueSorted(
        equipment.map((e) =>
          e.coverage.covered ? (e.coverage.contractName ?? "Covered") : "Not covered",
        ),
      ),
      warranty: uniqueSorted(equipment.map((e) => warrantyAging(e))),
      compliance: uniqueSorted(
        equipment.map((e) => serviceCompliance(e.next_scheduled_service_date)),
      ),
      install: uniqueSorted(equipment.map((e) => e.installation_date ?? "")),
      age: uniqueSorted(
        equipment
          .map((e) => equipmentAgeYears(e.installation_date))
          .filter((n): n is number => n != null)
          .map((n) => String(n)),
      ),
      lastService: uniqueSorted(equipment.map((e) => e.last_service_date ?? "")),
      cost: uniqueSorted(equipment.map((e) => formatMoney(costFor(e.id).totalCost))),
    };
  }, [equipment, costByEquipment]);

  const filteredEquipment = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = equipment.filter((eq) => {
      if (!showRetired && eq.operating_status === "Retired") return false;
      if (uncoveredOnly && (eq.coverage.covered || !isActiveEquipmentUnit(eq.operating_status))) {
        return false;
      }
      if (q) {
        const hay =
          `${eq.name} ${eq.serial_number ?? ""} ${eq.customers?.name ?? ""} ${eq.manufacturer ?? ""} ${eq.model ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.name && eq.name !== filters.name) return false;
      if (filters.customer && (eq.customers?.name ?? "") !== filters.customer) return false;
      if (filters.serial && (eq.serial_number ?? "") !== filters.serial) return false;
      if (filters.category && (eq.category ?? "") !== filters.category) return false;
      if (filters.manufacturer && (eq.manufacturer ?? "") !== filters.manufacturer) return false;
      if (filters.model && (eq.model ?? "") !== filters.model) return false;
      if (filters.status && eq.operating_status !== filters.status) return false;
      if (filters.location && (eq.location ?? "") !== filters.location) return false;
      if (filters.contract) {
        const label = eq.coverage.covered
          ? (eq.coverage.contractName ?? "Covered")
          : "Not covered";
        if (label !== filters.contract) return false;
      }
      if (filters.warranty && warrantyAging(eq) !== filters.warranty) return false;
      if (
        filters.compliance &&
        serviceCompliance(eq.next_scheduled_service_date) !== filters.compliance
      ) {
        return false;
      }
      if (filters.install && (eq.installation_date ?? "") !== filters.install) return false;
      if (filters.age) {
        const age = equipmentAgeYears(eq.installation_date);
        if (String(age ?? "") !== filters.age) return false;
      }
      if (filters.lastService && (eq.last_service_date ?? "") !== filters.lastService) return false;
      if (filters.cost && formatMoney(costFor(eq.id).totalCost) !== filters.cost) return false;
      return true;
    });

    const valueFor = (eq: ManagerEquipmentRow): string | number => {
      switch (sort.column) {
        case "customer":
          return eq.customers?.name ?? "";
        case "serial":
          return eq.serial_number ?? "";
        case "category":
          return eq.category ?? "";
        case "manufacturer":
          return eq.manufacturer ?? "";
        case "model":
          return eq.model ?? "";
        case "status":
          return eq.operating_status;
        case "location":
          return eq.location ?? "";
        case "contract":
          return eq.coverage.covered
            ? (eq.coverage.contractName ?? "Covered")
            : "Not covered";
        case "warranty":
          return warrantyAging(eq);
        case "compliance":
          return serviceCompliance(eq.next_scheduled_service_date);
        case "install":
          return eq.installation_date ?? "";
        case "age":
          return equipmentAgeYears(eq.installation_date) ?? -1;
        case "lastService":
          return eq.last_service_date ?? "";
        case "cost":
          return costFor(eq.id).totalCost;
        case "name":
        default:
          return eq.name;
      }
    };

    return [...rows].sort((a, b) => {
      if (sort.column === "age" || sort.column === "cost") {
        const cmp = Number(valueFor(a)) - Number(valueFor(b));
        return sort.direction === "asc" ? cmp : -cmp;
      }
      const cmp = String(valueFor(a)).localeCompare(String(valueFor(b)), undefined, {
        sensitivity: "base",
      });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [
    equipment,
    filters,
    sort,
    search,
    showRetired,
    uncoveredOnly,
    costByEquipment,
  ]);

  const hasActiveFilters =
    Object.values(filters).some((v) => v.trim() !== "") ||
    uncoveredOnly ||
    search.trim() !== "";

  function clearFilters() {
    setFilters(emptyFilters);
    setSearch("");
    setUncoveredOnly(false);
  }

  function onColumnFilterChange(column: FilterKey, value: string) {
    if (applyColumnSortValue(value, (direction) => setSort({ column, direction }))) {
      return;
    }
    setFilters((prev) => ({ ...prev, [column]: value }));
  }

  function equipmentColumnFilter(
    column: FilterKey,
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

  function toggleSelect(id: string) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    const ids = filteredEquipment.map((e) => e.id);
    const allSelected = ids.length > 0 && ids.every((id) => bulkSelected.has(id));
    if (allSelected) {
      setBulkSelected(new Set());
      return;
    }
    setBulkSelected(new Set(ids));
  }

  function exportFilteredCsv() {
    const header = [
      "serial",
      "customer",
      "coverage",
      "warranty_aging",
      "status",
      "last_service",
      "install_age_years",
      "cost_ytd",
      "replacement_cost",
      "residual",
    ];
    const lines = filteredEquipment.map((eq) => {
      const cost = costFor(eq.id);
      const age = equipmentAgeYears(eq.installation_date);
      return [
        eq.serial_number ?? "",
        eq.customers?.name ?? "",
        eq.coverage.covered ? (eq.coverage.contractName ?? "Covered") : "Not covered",
        warrantyAging(eq),
        eq.operating_status,
        eq.last_service_date ?? "",
        age ?? "",
        cost.totalCost,
        eq.replacement_cost ?? "",
        eq.estimated_residual ?? "",
      ]
        .map(csvCell)
        .join(",");
    });
    downloadEquipmentCsv(
      `equipment-${new Date().toISOString().slice(0, 10)}.csv`,
      [header.join(","), ...lines].join("\n"),
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
    const payload = {
      customer_id: form.customer_id,
      name: form.name.trim(),
      category: form.category.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      location: form.location.trim() || null,
      installation_date: form.installation_date || null,
      operating_status: form.operating_status,
    };
    const { data, error: insertError } = await supabase
      .from("equipment")
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
      recordType: "equipment",
      recordId: data.id,
      newValue: form.name,
    });
    setShowForm(false);
    setShowNewCustomer(false);
    setForm(emptyEquipmentForm);
    void load();
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

  async function applyBulkStatus() {
    if (!isManager || !bulkStatus || bulkSelected.size === 0) return;
    setBulkBusy(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const ids = [...bulkSelected];
    const { error: updateError } = await supabase
      .from("equipment")
      .update({ operating_status: bulkStatus, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (updateError) {
      setError(updateError.message);
      setBulkBusy(false);
      return;
    }
    setEquipment((prev) =>
      prev.map((eq) =>
        bulkSelected.has(eq.id) ? { ...eq, operating_status: bulkStatus } : eq,
      ),
    );
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "bulk_status_change",
      recordType: "equipment",
      recordId: ids[0] ?? null,
      newValue: `${bulkStatus} (${ids.length} units)`,
    });
    setBulkSelected(new Set());
    setBulkStatus("");
    setBulkBusy(false);
  }

  async function applyBulkAttach() {
    if (!isManager || !bulkContractId || bulkSelected.size === 0) return;
    const contract = activeContracts.find((c) => c.id === bulkContractId);
    if (!contract) return;

    const eligible = equipment.filter(
      (eq) => bulkSelected.has(eq.id) && eq.customer_id === contract.customer_id,
    );
    if (eligible.length === 0) {
      setError("No selected equipment belongs to that contract’s customer.");
      return;
    }

    setBulkBusy(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rows = eligible.map((eq) => ({
      contract_id: bulkContractId,
      equipment_id: eq.id,
    }));
    const { error: insertError } = await supabase.from("contract_equipment").insert(rows);
    if (insertError) {
      setError(insertError.message);
      setBulkBusy(false);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "bulk_contract_attach",
      recordType: "equipment",
      recordId: eligible[0]?.id ?? null,
      newValue: `attached ${eligible.length} to contract ${contract.name}`,
    });

    setBulkSelected(new Set());
    setBulkContractId("");
    setBulkBusy(false);
    void load();
  }

  async function attachSingleContract() {
    if (!isManager || !attachTarget || !attachContractId) return;
    setAttaching(true);
    setError(null);

    const { data: existing } = await supabase
      .from("contract_equipment")
      .select("contract_id")
      .eq("contract_id", attachContractId)
      .eq("equipment_id", attachTarget.id)
      .maybeSingle();

    if (existing) {
      setError("Equipment is already linked to that contract.");
      setAttaching(false);
      return;
    }

    const { error: insertError } = await supabase.from("contract_equipment").insert({
      contract_id: attachContractId,
      equipment_id: attachTarget.id,
    });

    if (insertError) {
      setError(insertError.message);
      setAttaching(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "updated",
      recordType: "equipment",
      recordId: attachTarget.id,
      newValue: `attached contract ${attachContractId}`,
    });

    setAttachTarget(null);
    setAttachContractId("");
    setAttaching(false);
    void load();
  }

  const activeCustomers = customers.filter((c) => c.status === "Active");
  const attachContractsForTarget = attachTarget
    ? activeContracts.filter((c) => c.customer_id === attachTarget.customer_id)
    : [];
  const bulkContract = activeContracts.find((c) => c.id === bulkContractId);
  const bulkEligibleCount = bulkContract
    ? equipment.filter(
        (eq) => bulkSelected.has(eq.id) && eq.customer_id === bulkContract.customer_id,
      ).length
    : 0;

  const managerColSpan = 16;

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  return (
    <div>
      <PageHeader
        title="Equipment"
        description="Track installed commercial equipment"
        actions={
          <div className="flex flex-wrap gap-2">
            {isManager ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm gap-1"
                onClick={exportFilteredCsv}
                aria-label="Export filtered equipment as CSV"
              >
                <Download className="h-4 w-4" />
                CSV
              </button>
            ) : null}
            <button type="button" className="btn btn-primary btn-sm gap-1" onClick={openAddForm}>
              <Plus className="h-4 w-4" />
              Add Equipment
            </button>
          </div>
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
              <FormRow label="Install date">
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={form.installation_date}
                  onChange={(e) => setForm({ ...form, installation_date: e.target.value })}
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
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
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

      {attachTarget ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-bold">Attach to contract</h3>
            <p className="mt-1 text-sm opacity-70">
              {attachTarget.name}
              {attachTarget.customers?.name ? ` · ${attachTarget.customers.name}` : ""}
            </p>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            {attachContractsForTarget.length === 0 ? (
              <p className="mt-4 text-sm opacity-70">
                No active contracts for this customer. Create one on the Contracts tab first.
              </p>
            ) : (
              <FormRow label="Active contract" required>
                <select
                  className="select select-bordered w-full"
                  value={attachContractId}
                  onChange={(e) => setAttachContractId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {attachContractsForTarget.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormRow>
            )}
            <div className="modal-action">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setAttachTarget(null);
                  setAttachContractId("");
                }}
                disabled={attaching}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!attachContractId || attaching || attachContractsForTarget.length === 0}
                onClick={() => void attachSingleContract()}
              >
                {attaching ? "Attaching…" : "Attach"}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button
              type="button"
              onClick={() => {
                setAttachTarget(null);
                setAttachContractId("");
              }}
            >
              close
            </button>
          </form>
        </dialog>
      ) : null}

      {error && !showForm && !attachTarget ? (
        <div className="alert alert-error mb-4 text-sm">{error}</div>
      ) : null}

      {isManager && uncoveredActiveCount > 0 ? (
        <button
          type="button"
          className={`alert mb-4 w-full text-left ${uncoveredOnly ? "alert-warning" : "alert-info"}`}
          onClick={() => setUncoveredOnly((v) => !v)}
          aria-pressed={uncoveredOnly}
        >
          <span className="text-sm">
            <strong>{uncoveredActiveCount}</strong> active unit
            {uncoveredActiveCount === 1 ? "" : "s"} with no active contract coverage.
            {uncoveredOnly ? " Click to clear filter." : " Click to show uncovered only."}
          </span>
        </button>
      ) : null}

      {isManager && concentration.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-200/40 px-3 py-2 text-sm">
          <span className="opacity-70">Top customers by units:</span>
          {concentration.map((c) => (
            <button
              key={c.customerId}
              type="button"
              className={`btn btn-ghost btn-xs ${filters.customer === c.name ? "btn-active" : ""}`}
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  customer: prev.customer === c.name ? "" : c.name,
                }))
              }
            >
              {c.name} ({c.count})
            </button>
          ))}
        </div>
      ) : null}

      {isManager ? (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="form-control w-full max-w-xs">
            <span className="label-text text-xs opacity-70">Search</span>
            <input
              className="input input-bordered input-sm w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, serial, customer, mfr, model…"
              aria-label="Search equipment"
            />
          </label>
          <label className="label cursor-pointer gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
            />
            <span className="label-text text-sm">Show retired</span>
          </label>
          {hasActiveFilters ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              Clear search/filters
            </button>
          ) : null}
        </div>
      ) : null}

      {isManager && bulkSelected.size > 0 ? (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-box border border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-semibold">{bulkSelected.size} selected</span>
          <FormRow label="Set status">
            <select
              className="select select-bordered select-sm"
              value={bulkStatus}
              onChange={(e) =>
                setBulkStatus(e.target.value as Equipment["operating_status"] | "")
              }
            >
              <option value="">Select…</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormRow>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!bulkStatus || bulkBusy}
            onClick={() => void applyBulkStatus()}
          >
            Apply status
          </button>
          <FormRow label="Attach to contract">
            <select
              className="select select-bordered select-sm min-w-[12rem]"
              value={bulkContractId}
              onChange={(e) => setBulkContractId(e.target.value)}
            >
              <option value="">Select…</option>
              {activeContracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormRow>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!bulkContractId || bulkBusy || bulkEligibleCount === 0}
            onClick={() => void applyBulkAttach()}
            title={
              bulkContractId && bulkEligibleCount === 0
                ? "No selected rows match that contract’s customer"
                : undefined
            }
          >
            Attach ({bulkEligibleCount})
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setBulkSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
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
            <DualHorizontalScroll>
              <table className="table table-sm">
                <thead>
                  <tr>
                    {isManager ? (
                      <th className="w-8">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={
                            filteredEquipment.length > 0 &&
                            filteredEquipment.every((e) => bulkSelected.has(e.id))
                          }
                          onChange={toggleSelectAllFiltered}
                          aria-label="Select all filtered equipment"
                        />
                      </th>
                    ) : null}
                    <th>Name</th>
                    <th>Customer</th>
                    <th>Serial #</th>
                    {isManager ? (
                      <>
                        <th>Manufacturer</th>
                        <th>Model</th>
                      </>
                    ) : null}
                    <th>Category</th>
                    <th>Status</th>
                    {isManager ? (
                      <>
                        <th>Install</th>
                        <th>Age</th>
                        <th>Last service</th>
                        <th>Warranty</th>
                        <th>Cost YTD</th>
                        <th>Service</th>
                      </>
                    ) : (
                      <th>Location</th>
                    )}
                    <th>Contract</th>
                    {isManager ? <th>Actions</th> : null}
                  </tr>
                  {isManager ? (
                    <tr className="bg-base-200/50">
                      <th />
                      <th className="font-normal">
                        {equipmentColumnFilter("name", "name", filterOptions.name)}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter("customer", "customer", filterOptions.customer)}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter("serial", "serial", filterOptions.serial)}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter(
                          "manufacturer",
                          "manufacturer",
                          filterOptions.manufacturer,
                        )}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter("model", "model", filterOptions.model)}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter("category", "category", filterOptions.category)}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter("status", "status", filterOptions.status)}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter("install", "install", filterOptions.install, "date")}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter("age", "age", filterOptions.age, "numeric")}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter(
                          "lastService",
                          "last service",
                          filterOptions.lastService,
                          "date",
                        )}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter("warranty", "warranty", filterOptions.warranty)}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter("cost", "cost YTD", filterOptions.cost, "numeric")}
                      </th>
                      <th className="font-normal">
                        {equipmentColumnFilter(
                          "compliance",
                          "service compliance",
                          filterOptions.compliance,
                        )}
                      </th>
                      <th className="font-normal">
                        <div className="flex gap-1">
                          {equipmentColumnFilter("contract", "contract", filterOptions.contract)}
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
                      <th />
                    </tr>
                  ) : null}
                </thead>
                <tbody>
                  {filteredEquipment.length === 0 ? (
                    <tr>
                      <td colSpan={isManager ? managerColSpan : 7} className="p-6">
                        <EmptyState
                          title="No matching equipment"
                          description="Try clearing search or column filters."
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
                      const aging = warrantyAging(eq) as WarrantyAging;
                      const compliance = serviceCompliance(
                        eq.next_scheduled_service_date,
                      ) as ServiceCompliance;
                      const cost = costFor(eq.id);
                      const age = equipmentAgeYears(eq.installation_date);
                      const attention = needsAttentionStatus(eq.operating_status);

                      return (
                        <tr
                          key={eq.id}
                          ref={highlighted ? highlightRef : undefined}
                          className={rowClassName(eq, highlighted)}
                        >
                          {isManager ? (
                            <td className="align-top">
                              <input
                                type="checkbox"
                                className="checkbox checkbox-sm"
                                checked={bulkSelected.has(eq.id)}
                                onChange={() => toggleSelect(eq.id)}
                                aria-label={`Select ${eq.name}`}
                              />
                            </td>
                          ) : null}
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
                          {isManager ? (
                            <>
                              <td className="align-top">{eq.manufacturer ?? "—"}</td>
                              <td className="align-top">{eq.model ?? "—"}</td>
                            </>
                          ) : null}
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
                            {isManager && attention ? (
                              <span className="sr-only">Needs attention</span>
                            ) : null}
                          </td>
                          {isManager ? (
                            <>
                              <td className="align-top whitespace-nowrap text-xs">
                                {eq.installation_date ?? "—"}
                              </td>
                              <td className="align-top text-xs">
                                {age != null ? `${age} yr` : "—"}
                              </td>
                              <td className="align-top whitespace-nowrap text-xs">
                                {eq.last_service_date ?? "—"}
                              </td>
                              <td className="align-top">
                                <StatusBadge
                                  label={aging}
                                  tone={warrantyAgingTone(aging)}
                                  className="max-w-[9rem]"
                                />
                              </td>
                              <td className="align-top whitespace-nowrap">
                                <span
                                  className="font-medium"
                                  title={
                                    cost.billablePct != null || cost.warrantyPct != null
                                      ? `Billable ${formatPct(cost.billablePct)} · Warranty ${formatPct(cost.warrantyPct)}`
                                      : undefined
                                  }
                                >
                                  {formatMoney(cost.totalCost)}
                                </span>
                                {(cost.billablePct != null || cost.warrantyPct != null) && (
                                  <p className="text-[10px] leading-tight opacity-60">
                                    B {formatPct(cost.billablePct)} · W {formatPct(cost.warrantyPct)}
                                  </p>
                                )}
                              </td>
                              <td className="align-top">
                                <StatusBadge
                                  label={compliance}
                                  tone={serviceComplianceTone(compliance)}
                                  className="max-w-[7rem]"
                                />
                              </td>
                            </>
                          ) : (
                            <td className="align-top">{eq.location ?? "—"}</td>
                          )}
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
                                {isManager &&
                                (eq.coverage.contractType || eq.coverage.contractPrice != null) ? (
                                  <p className="text-[10px] opacity-60">
                                    {[eq.coverage.contractType, formatMoney(eq.coverage.contractPrice ?? 0)]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <StatusBadge label="Not covered" tone="neutral" />
                                {isManager && isActiveEquipmentUnit(eq.operating_status) ? (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    onClick={() => {
                                      setError(null);
                                      setAttachContractId("");
                                      setAttachTarget(eq);
                                    }}
                                  >
                                    Attach
                                  </button>
                                ) : null}
                              </div>
                            )}
                          </td>
                          {isManager ? (
                            <td className="align-top whitespace-nowrap">
                              <Link
                                href={`/work-orders?new=1&customer_id=${encodeURIComponent(eq.customer_id)}&equipment_id=${encodeURIComponent(eq.id)}`}
                                className="btn btn-ghost btn-xs"
                              >
                                Create WO
                              </Link>
                            </td>
                          ) : null}
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
