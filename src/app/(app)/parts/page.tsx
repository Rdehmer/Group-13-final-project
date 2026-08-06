"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Minus, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge } from "@/components/ui";
import { PurchaseOrderRequest } from "@/components/PurchaseOrderRequest";
import { EmergencyPurchaseLog } from "@/components/EmergencyPurchaseLog";
import { TechnicianPartsHub } from "@/components/technician/TechnicianPartsHub";
import type { EmergencyPurchaseReviewRow } from "@/components/EmergencyPurchaseReview";
import { formatMoney, formatPct } from "@/lib/calculations";
import type { Part, Profile, TechPartOrderRequest, WorkOrder } from "@/lib/types";

type PartForm = {
  part_number: string;
  name: string;
  category: string;
  supplier: string;
  quantity_on_hand: string;
  reorder_level: string;
  unit_cost: string;
  standard_customer_price: string;
};

type SortKey =
  | "part_number"
  | "name"
  | "category"
  | "supplier"
  | "quantity_on_hand"
  | "reorder_level"
  | "unit_cost"
  | "standard_customer_price"
  | "margin"
  | "status";

type SortDirection = "asc" | "desc";

type FilterColumn =
  | "part_number"
  | "name"
  | "category"
  | "supplier"
  | "qty"
  | "reorder"
  | "cost"
  | "price"
  | "margin"
  | "status";

type PurchaseOrderRow = TechPartOrderRequest & {
  parts?: Pick<Part, "id" | "part_number" | "name" | "quantity_on_hand"> | null;
  technician?: Pick<Profile, "id" | "full_name" | "email"> | null;
};
type JobOption = Pick<WorkOrder, "id" | "work_order_number" | "problem_description">;

const EMPTY_FORM: PartForm = {
  part_number: "",
  name: "",
  category: "",
  supplier: "",
  quantity_on_hand: "0",
  reorder_level: "5",
  unit_cost: "0",
  standard_customer_price: "0",
};

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function isLowStock(part: Part) {
  return part.quantity_on_hand <= part.reorder_level;
}

function stockLabel(part: Part) {
  return isLowStock(part) ? "Low Stock" : "OK";
}

function partMargin(part: Part) {
  return Number(part.standard_customer_price) - Number(part.unit_cost);
}

function partMarginPct(part: Part): number | null {
  const cost = Number(part.unit_cost);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return partMargin(part) / cost;
}

function techLabel(p: Pick<Profile, "full_name" | "email"> | null | undefined) {
  return p?.full_name?.trim() || p?.email || "Technician";
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * This business faces inventory visibility and restock friction risk.
 * Our app reduces the risk with manager search, margins, low-stock tools, and PO fulfillment.
 */
export default function PartsPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRow[]>([]);
  const [managerPos, setManagerPos] = useState<PurchaseOrderRow[]>([]);
  const [emergencyPurchases, setEmergencyPurchases] = useState<EmergencyPurchaseReviewRow[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPurchaseOrder, setShowPurchaseOrder] = useState(false);
  const [showEmergencyPurchase, setShowEmergencyPurchase] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [qtyBusyId, setQtyBusyId] = useState<string | null>(null);
  const [poBusyId, setPoBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkReorderValue, setBulkReorderValue] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "name",
    direction: "asc",
  });
  const [filters, setFilters] = useState({
    part_number: "",
    name: "",
    category: "",
    supplier: "",
    qty: "",
    reorder: "",
    cost: "",
    price: "",
    margin: "",
    status: "",
  });
  const [form, setForm] = useState<PartForm>(EMPTY_FORM);

  const isManager =
    profile?.role === "administrator" || profile?.role === "service_manager";

  async function loadTechnicianData(technicianId: string) {
    const [{ data: requests }, { data: assignedJobs }, purchasesResult] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select("*, parts(part_number, name)")
        .eq("technician_id", technicianId)
        .neq("status", "fulfilled")
        .order("created_at", { ascending: false }),
      supabase
        .from("work_orders")
        .select("id, work_order_number, problem_description")
        .eq("assigned_technician_id", technicianId)
        .neq("status", "Canceled")
        .order("scheduled_date", { ascending: false }),
      supabase
        .from("emergency_purchases")
        .select(
          `
          *,
          parts:parts!emergency_purchases_part_id_fkey(id, part_number, name),
          work_orders:work_orders!emergency_purchases_job_id_fkey(id, work_order_number, problem_description)
        `,
        )
        .eq("technician_id", technicianId)
        .order("purchased_at", { ascending: false }),
    ]);

    setPurchaseOrders((requests as PurchaseOrderRow[]) ?? []);
    setJobs((assignedJobs as JobOption[]) ?? []);

    if (purchasesResult.error) {
      const { data: flat } = await supabase
        .from("emergency_purchases")
        .select("*")
        .eq("technician_id", technicianId)
        .order("purchased_at", { ascending: false });
      setEmergencyPurchases((flat as EmergencyPurchaseReviewRow[]) ?? []);
    } else {
      setEmergencyPurchases((purchasesResult.data as EmergencyPurchaseReviewRow[]) ?? []);
    }
  }

  async function loadManagerPos() {
    const { data } = await supabase
      .from("purchase_orders")
      .select("*, parts(id, part_number, name, quantity_on_hand)")
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false });
    const rows = (data as PurchaseOrderRow[]) ?? [];
    const techIds = [...new Set(rows.map((r) => r.technician_id).filter(Boolean))];
    let techMap = new Map<string, Pick<Profile, "id" | "full_name" | "email">>();
    if (techIds.length > 0) {
      const { data: techs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", techIds);
      techMap = new Map(
        ((techs as Pick<Profile, "id" | "full_name" | "email">[]) ?? []).map((t) => [t.id, t]),
      );
    }
    setManagerPos(
      rows.map((r) => ({
        ...r,
        technician: techMap.get(r.technician_id) ?? null,
      })),
    );
  }

  async function load() {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const [{ data: currentProfile }, { data }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("parts").select("*").order("name"),
    ]);
    const loadedProfile = currentProfile as Profile | null;
    setProfile(loadedProfile);
    setParts((data as Part[]) ?? []);
    if (loadedProfile?.role === "technician") {
      await loadTechnicianData(loadedProfile.id);
    } else if (
      loadedProfile?.role === "administrator" ||
      loadedProfile?.role === "service_manager"
    ) {
      await loadManagerPos();
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const lowStockCount = useMemo(
    () => parts.filter((p) => p.is_active && isLowStock(p)).length,
    [parts],
  );

  const filterOptions = useMemo(() => {
    const uniqueSorted = (values: string[]) =>
      Array.from(new Set(values.filter((v) => v.trim() !== ""))).sort((a, b) =>
        naturalCollator.compare(a, b),
      );

    return {
      part_number: uniqueSorted(parts.map((p) => p.part_number)),
      name: uniqueSorted(parts.map((p) => p.name)),
      category: uniqueSorted(parts.map((p) => p.category ?? "")),
      supplier: uniqueSorted(parts.map((p) => p.supplier ?? "")),
      qty: uniqueSorted(parts.map((p) => String(p.quantity_on_hand))),
      reorder: uniqueSorted(parts.map((p) => String(p.reorder_level))),
      cost: uniqueSorted(parts.map((p) => formatMoney(p.unit_cost))),
      price: uniqueSorted(parts.map((p) => formatMoney(p.standard_customer_price))),
      margin: uniqueSorted(parts.map((p) => formatMoney(partMargin(p)))),
      status: ["OK", "Low Stock"],
    };
  }, [parts]);

  const filteredParts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = parts.filter((p) => {
      if (!showInactive && !p.is_active) return false;
      if (lowStockOnly && !isLowStock(p)) return false;
      if (q) {
        const hay = `${p.part_number} ${p.name} ${p.category ?? ""} ${p.supplier ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.part_number && p.part_number !== filters.part_number) return false;
      if (filters.name && p.name !== filters.name) return false;
      if (filters.category && (p.category ?? "") !== filters.category) return false;
      if (filters.supplier && (p.supplier ?? "") !== filters.supplier) return false;
      if (filters.qty && String(p.quantity_on_hand) !== filters.qty) return false;
      if (filters.reorder && String(p.reorder_level) !== filters.reorder) return false;
      if (filters.cost && formatMoney(p.unit_cost) !== filters.cost) return false;
      if (filters.price && formatMoney(p.standard_customer_price) !== filters.price) return false;
      if (filters.margin && formatMoney(partMargin(p)) !== filters.margin) return false;
      if (filters.status && stockLabel(p) !== filters.status) return false;
      return true;
    });

    const valueFor = (p: Part): string | number => {
      switch (sort.key) {
        case "part_number":
          return p.part_number;
        case "name":
          return p.name;
        case "category":
          return p.category ?? "";
        case "supplier":
          return p.supplier ?? "";
        case "quantity_on_hand":
          return p.quantity_on_hand;
        case "reorder_level":
          return p.reorder_level;
        case "unit_cost":
          return p.unit_cost;
        case "standard_customer_price":
          return p.standard_customer_price;
        case "margin":
          return partMargin(p);
        case "status":
          return stockLabel(p);
        default:
          return p.name;
      }
    };

    return [...rows].sort((a, b) => {
      if (
        sort.key === "quantity_on_hand" ||
        sort.key === "reorder_level" ||
        sort.key === "unit_cost" ||
        sort.key === "standard_customer_price" ||
        sort.key === "margin"
      ) {
        const cmp = Number(valueFor(a)) - Number(valueFor(b));
        return sort.direction === "asc" ? cmp : -cmp;
      }
      if (sort.key === "status") {
        const cmp = Number(isLowStock(a)) - Number(isLowStock(b));
        return sort.direction === "asc" ? cmp : -cmp;
      }
      const cmp = naturalCollator.compare(String(valueFor(a)), String(valueFor(b)));
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [parts, filters, sort, search, showInactive, lowStockOnly]);

  const hasActiveFilters =
    Object.values(filters).some((v) => v.trim() !== "") || lowStockOnly || search.trim() !== "";

  function clearFilters() {
    setFilters({
      part_number: "",
      name: "",
      category: "",
      supplier: "",
      qty: "",
      reorder: "",
      cost: "",
      price: "",
      margin: "",
      status: "",
    });
    setSearch("");
    setLowStockOnly(false);
  }

  function onColumnFilterChange(column: FilterColumn, value: string) {
    const sortKeyForColumn: Record<FilterColumn, SortKey> = {
      part_number: "part_number",
      name: "name",
      category: "category",
      supplier: "supplier",
      qty: "quantity_on_hand",
      reorder: "reorder_level",
      cost: "unit_cost",
      price: "standard_customer_price",
      margin: "margin",
      status: "status",
    };
    if (value === "__sort_asc") {
      setSort({ key: sortKeyForColumn[column], direction: "asc" });
      return;
    }
    if (value === "__sort_desc") {
      setSort({ key: sortKeyForColumn[column], direction: "desc" });
      return;
    }
    setFilters((prev) => ({ ...prev, [column]: value }));
  }

  function ColumnFilterSelect({
    column,
    label,
    options,
  }: {
    column: FilterColumn;
    label: string;
    options: string[];
  }) {
    const sortKeyForColumn: Record<FilterColumn, SortKey> = {
      part_number: "part_number",
      name: "name",
      category: "category",
      supplier: "supplier",
      qty: "quantity_on_hand",
      reorder: "reorder_level",
      cost: "unit_cost",
      price: "standard_customer_price",
      margin: "margin",
      status: "status",
    };
    const sortingThis = sort.key === sortKeyForColumn[column];
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

  function openCreateForm() {
    setEditingPart(null);
    setForm(EMPTY_FORM);
    setError(null);
    setSuccess(null);
    setShowForm(true);
  }

  function openEditForm(part: Part) {
    setEditingPart(part);
    setForm({
      part_number: part.part_number,
      name: part.name,
      category: part.category ?? "",
      supplier: part.supplier ?? "",
      quantity_on_hand: String(part.quantity_on_hand),
      reorder_level: String(part.reorder_level),
      unit_cost: String(part.unit_cost),
      standard_customer_price: String(part.standard_customer_price),
    });
    setError(null);
    setSuccess(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingPart(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  function validateForm() {
    if (!form.part_number.trim() || !form.name.trim()) {
      return "Part # and Name are required.";
    }
    const numericFields = [
      ["Qty", form.quantity_on_hand],
      ["Reorder", form.reorder_level],
      ["Unit Cost", form.unit_cost],
      ["Price", form.standard_customer_price],
    ] as const;
    for (const [label, value] of numericFields) {
      if (value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0) {
        return `${label} must be zero or greater.`;
      }
    }
    return null;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const payload = {
      part_number: form.part_number.trim(),
      name: form.name.trim(),
      category: form.category.trim() || null,
      supplier: form.supplier.trim() || null,
      quantity_on_hand: Number(form.quantity_on_hand),
      reorder_level: Number(form.reorder_level),
      unit_cost: Number(form.unit_cost),
      standard_customer_price: Number(form.standard_customer_price),
    };

    if (editingPart) {
      const { data, error: updateError } = await supabase
        .from("parts")
        .update(payload)
        .eq("id", editingPart.id)
        .select()
        .single();
      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
      setParts((current) =>
        current.map((part) => (part.id === editingPart.id ? (data as Part) : part)),
      );
      await logActivity(supabase, {
        userId: user?.id ?? null,
        action: "updated",
        recordType: "part",
        recordId: editingPart.id,
        previousValue: editingPart.name,
        newValue: payload.name,
      });
      closeForm();
      setSuccess("Part updated successfully");
      setSaving(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("parts")
      .insert(payload)
      .select()
      .single();
    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "part",
      recordId: data.id,
      newValue: form.name,
    });
    setParts((current) => [...current, data as Part]);
    closeForm();
    setSaving(false);
  }

  function changeSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  async function adjustQty(part: Part, delta: number) {
    if (!isManager) return;
    const next = Math.max(0, part.quantity_on_hand + delta);
    if (next === part.quantity_on_hand) return;
    setQtyBusyId(part.id);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: updateError } = await supabase
      .from("parts")
      .update({ quantity_on_hand: next, updated_at: new Date().toISOString() })
      .eq("id", part.id)
      .select()
      .single();
    if (updateError) {
      setError(updateError.message);
      setQtyBusyId(null);
      return;
    }
    setParts((prev) => prev.map((p) => (p.id === part.id ? (data as Part) : p)));
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "qty_adjust",
      recordType: "part",
      recordId: part.id,
      previousValue: String(part.quantity_on_hand),
      newValue: String(next),
    });
    setQtyBusyId(null);
  }

  function toggleBulk(id: string) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectVisible() {
    const ids = filteredParts.map((p) => p.id);
    const allSelected = ids.length > 0 && ids.every((id) => bulkSelected.has(id));
    if (allSelected) {
      setBulkSelected(new Set());
      return;
    }
    setBulkSelected(new Set(ids));
  }

  async function applyBulkReorder() {
    if (!isManager || bulkSelected.size === 0) return;
    const value = Number(bulkReorderValue);
    if (!Number.isFinite(value) || value < 0) {
      setError("Reorder level must be zero or greater.");
      return;
    }
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const ids = [...bulkSelected];
    const { error: updateError } = await supabase
      .from("parts")
      .update({ reorder_level: value, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    setParts((prev) =>
      prev.map((p) => (bulkSelected.has(p.id) ? { ...p, reorder_level: value } : p)),
    );
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "bulk_reorder_level",
      recordType: "part",
      recordId: ids[0],
      newValue: `${ids.length} parts → reorder ${value}`,
    });
    setBulkSelected(new Set());
    setBulkReorderValue("");
    setSuccess(`Updated reorder level on ${ids.length} part(s).`);
    setSaving(false);
  }

  function exportFilteredCsv() {
    const header = [
      "Part #",
      "Name",
      "Category",
      "Supplier",
      "On Hand",
      "Reorder",
      "Cost",
      "Price",
      "Margin",
      "Margin %",
      "Status",
      "Active",
    ];
    const lines = filteredParts.map((p) =>
      [
        p.part_number,
        p.name,
        p.category ?? "",
        p.supplier ?? "",
        p.quantity_on_hand,
        p.reorder_level,
        p.unit_cost,
        p.standard_customer_price,
        partMargin(p),
        partMarginPct(p) != null ? (partMarginPct(p)! * 100).toFixed(1) : "",
        stockLabel(p),
        p.is_active ? "yes" : "no",
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    );
    downloadCsv(`parts-inventory-${new Date().toISOString().slice(0, 10)}.csv`, [header.join(","), ...lines].join("\n"));
  }

  async function approvePo(row: PurchaseOrderRow) {
    if (!isManager) return;
    setPoBusyId(row.id);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (updateError) {
      setError(updateError.message);
      setPoBusyId(null);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "purchase_order_approved",
      recordType: "purchase_order",
      recordId: row.id,
      newValue: row.parts?.part_number ?? row.part_id,
    });
    await loadManagerPos();
    setSuccess("Purchase order approved.");
    setPoBusyId(null);
  }

  async function fulfillPo(row: PurchaseOrderRow) {
    if (!isManager) return;
    setPoBusyId(row.id);
    setError(null);
    const qty = Number(row.quantity_requested);
    const partId = row.part_id;
    const warehouseQty = row.parts?.quantity_on_hand ?? parts.find((p) => p.id === partId)?.quantity_on_hand ?? 0;

    if (warehouseQty < qty) {
      setError(
        `Not enough warehouse stock to fulfill (${warehouseQty} on hand, ${qty} requested). Adjust inventory first.`,
      );
      setPoBusyId(null);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const now = new Date().toISOString();

    const nextWarehouse = Math.max(0, warehouseQty - qty);
    const { error: partError } = await supabase
      .from("parts")
      .update({ quantity_on_hand: nextWarehouse, updated_at: now })
      .eq("id", partId);
    if (partError) {
      setError(partError.message);
      setPoBusyId(null);
      return;
    }

    const { error: poError } = await supabase
      .from("purchase_orders")
      .update({ status: "fulfilled", updated_at: now })
      .eq("id", row.id);
    if (poError) {
      setError(poError.message);
      setPoBusyId(null);
      return;
    }

    setParts((prev) =>
      prev.map((p) => (p.id === partId ? { ...p, quantity_on_hand: nextWarehouse } : p)),
    );
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "purchase_order_fulfilled",
      recordType: "purchase_order",
      recordId: row.id,
      newValue: `${row.parts?.part_number ?? partId} × ${qty}`,
    });
    await loadManagerPos();
    setSuccess("Purchase order fulfilled — warehouse stock reduced.");
    setPoBusyId(null);
  }

  const displayParts = isManager
    ? filteredParts
    : [...parts]
        .filter((p) => p.is_active)
        .sort((a, b) => {
          let comparison: number;
          if (sort.key === "part_number" || sort.key === "name" || sort.key === "category" || sort.key === "supplier") {
            comparison = naturalCollator.compare(
              String(a[sort.key === "supplier" ? "supplier" : sort.key] ?? ""),
              String(b[sort.key === "supplier" ? "supplier" : sort.key] ?? ""),
            );
          } else if (sort.key === "status") {
            comparison =
              Number(isLowStock(a)) === Number(isLowStock(b)) ? 0 : isLowStock(a) ? -1 : 1;
          } else if (sort.key === "margin") {
            comparison = partMargin(a) - partMargin(b);
          } else {
            comparison = Number(a[sort.key as keyof Part]) - Number(b[sort.key as keyof Part]);
          }
          return sort.direction === "asc" ? comparison : -comparison;
        });

  const sortableHeaders: { label: string; key: SortKey }[] = [
    { label: "Part #", key: "part_number" },
    { label: "Name", key: "name" },
    { label: "On Hand", key: "quantity_on_hand" },
    { label: "Reorder", key: "reorder_level" },
    { label: "Cost", key: "unit_cost" },
    { label: "Price", key: "standard_customer_price" },
    { label: "Status", key: "status" },
  ];

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading inventory…</div>;
  }

  if (!profile) {
    return (
      <EmptyState title="Inventory unavailable" description="Your user profile could not be loaded." />
    );
  }

  if (profile?.role === "technician") {
    return (
      <TechnicianPartsHub
        profile={profile}
        parts={parts}
        purchaseOrders={purchaseOrders}
        emergencyPurchases={emergencyPurchases}
        jobs={jobs}
        success={success}
        error={error}
        onDismissMessages={() => {
          setSuccess(null);
          setError(null);
        }}
        onReloadTechData={async () => {
          await loadTechnicianData(profile.id);
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Parts Inventory"
        description="Track stock levels, pricing, and restock requests"
        actions={
          <div className="flex flex-wrap gap-2">
            {isManager ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm gap-1"
                onClick={exportFilteredCsv}
                aria-label="Export filtered parts as CSV"
              >
                <Download className="h-4 w-4" />
                CSV
              </button>
            ) : null}
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreateForm}>
              Add Part
            </button>
          </div>
        }
      />

      {success ? (
        <div role="status" className="alert alert-success mb-4">
          <span>{success}</span>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

      {isManager && lowStockCount > 0 ? (
        <button
          type="button"
          role="alert"
          className={`alert alert-warning mb-4 w-full cursor-pointer text-left ${lowStockOnly ? "ring-2 ring-warning" : ""}`}
          onClick={() => {
            setLowStockOnly((v) => !v);
            if (!lowStockOnly) setFilters((prev) => ({ ...prev, status: "Low Stock" }));
            else setFilters((prev) => ({ ...prev, status: "" }));
          }}
          aria-pressed={lowStockOnly}
        >
          <span>
            {lowStockCount} part(s) at or below reorder level — click to{" "}
            {lowStockOnly ? "clear" : "filter"}
          </span>
        </button>
      ) : lowStockCount > 0 ? (
        <div role="alert" className="alert alert-warning mb-4">
          <span>{lowStockCount} part(s) at or below reorder level</span>
        </div>
      ) : null}

      {isManager && managerPos.length > 0 ? (
        <section className="card mb-4 bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">
              Restock requests
              <span className="badge badge-warning">{managerPos.length}</span>
            </h2>
            <ul className="space-y-3">
              {managerPos.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-box border border-base-300 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold">
                      {row.parts?.part_number ?? "Part"} — {row.parts?.name ?? "Catalog item"}
                    </p>
                    <p className="text-sm opacity-70">
                      Qty {row.quantity_requested} · {techLabel(row.technician)}
                      {row.note ? ` · ${row.note}` : ""}
                    </p>
                    <p className="text-xs opacity-60">
                      Warehouse on hand: {row.parts?.quantity_on_hand ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={row.status}
                      tone={row.status === "approved" ? "info" : "warning"}
                    />
                    {row.status === "pending" ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        disabled={poBusyId === row.id}
                        onClick={() => void approvePo(row)}
                      >
                        Approve
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      disabled={poBusyId === row.id}
                      onClick={() => void fulfillPo(row)}
                    >
                      {poBusyId === row.id ? "Working…" : "Fulfill"}
                    </button>
                    {row.parts?.id ? (
                      <Link href={`/parts/${row.parts.id}`} className="btn btn-ghost btn-xs">
                        Open part
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">{editingPart ? "Edit Part" : "New Part"}</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onSave} noValidate className="mt-4 space-y-3">
              <FormRow label="Part #" required>
                <input
                  className="input input-bordered w-full"
                  value={form.part_number}
                  onChange={(e) => setForm({ ...form, part_number: e.target.value })}
                  required
                />
              </FormRow>
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
              <FormRow label="Supplier">
                <input
                  className="input input-bordered w-full"
                  value={form.supplier}
                  onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                />
              </FormRow>
              <FormRow label="Qty">
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={form.quantity_on_hand}
                  onChange={(e) => setForm({ ...form, quantity_on_hand: e.target.value })}
                />
              </FormRow>
              <FormRow label="Reorder">
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={form.reorder_level}
                  onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                />
              </FormRow>
              <FormRow label="Unit cost">
                <input
                  type="number"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.unit_cost}
                  onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                />
              </FormRow>
              <FormRow label="Price">
                <input
                  type="number"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.standard_customer_price}
                  onChange={(e) => setForm({ ...form, standard_customer_price: e.target.value })}
                />
              </FormRow>
              <div className="modal-action">
                <button type="button" className="btn" onClick={closeForm} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {editingPart ? "Save Changes" : "Save"}
                </button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={closeForm}>
              close
            </button>
          </form>
        </dialog>
      ) : null}

      {isManager ? (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="form-control w-full max-w-xs">
            <span className="label-text text-xs opacity-70">Search</span>
            <input
              className="input input-bordered input-sm w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Part #, name, category, supplier…"
              aria-label="Search parts"
            />
          </label>
          <label className="label cursor-pointer gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span className="label-text text-sm">Show inactive</span>
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
          <FormRow label="Set reorder level">
            <input
              type="number"
              min="0"
              className="input input-bordered input-sm w-28"
              value={bulkReorderValue}
              onChange={(e) => setBulkReorderValue(e.target.value)}
            />
          </FormRow>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving}
            onClick={() => void applyBulkReorder()}
          >
            Apply reorder
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
          {parts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No parts in inventory"
                description="Add parts to track usage on work orders."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    {isManager ? (
                      <>
                        <th className="w-10">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-xs"
                            checked={
                              filteredParts.length > 0 &&
                              filteredParts.every((p) => bulkSelected.has(p.id))
                            }
                            onChange={toggleSelectVisible}
                            aria-label="Select all visible parts"
                          />
                        </th>
                        <th>Part #</th>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Supplier</th>
                        <th>On Hand</th>
                        <th>Reorder</th>
                        <th>Cost</th>
                        <th>Price</th>
                        <th>Margin</th>
                        <th>Status</th>
                      </>
                    ) : (
                      <>
                        {sortableHeaders.map((header) => (
                          <th
                            key={header.key}
                            className="cursor-pointer select-none"
                            aria-sort={
                              sort.key === header.key
                                ? sort.direction === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                            onClick={() => changeSort(header.key)}
                          >
                            <button
                              type="button"
                              className="flex w-full cursor-pointer items-center gap-1 text-left"
                            >
                              {header.label}
                              {sort.key === header.key ? (
                                <span aria-hidden="true">
                                  {sort.direction === "asc" ? "▲" : "▼"}
                                </span>
                              ) : null}
                            </button>
                          </th>
                        ))}
                        <th>Actions</th>
                      </>
                    )}
                  </tr>
                  {isManager ? (
                    <tr className="bg-base-200/50">
                      <th />
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="part_number"
                          label="part number"
                          options={filterOptions.part_number}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="name"
                          label="name"
                          options={filterOptions.name}
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
                          column="supplier"
                          label="supplier"
                          options={filterOptions.supplier}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect column="qty" label="quantity" options={filterOptions.qty} />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="reorder"
                          label="reorder"
                          options={filterOptions.reorder}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect column="cost" label="cost" options={filterOptions.cost} />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="price"
                          label="price"
                          options={filterOptions.price}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="margin"
                          label="margin"
                          options={filterOptions.margin}
                        />
                      </th>
                      <th className="font-normal">
                        <div className="flex gap-1">
                          <ColumnFilterSelect
                            column="status"
                            label="status"
                            options={filterOptions.status}
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
                  {displayParts.length === 0 ? (
                    <tr>
                      <td colSpan={isManager ? 11 : 8} className="p-6">
                        <EmptyState
                          title="No matching parts"
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
                    displayParts.map((p) => {
                      const low = isLowStock(p);
                      const margin = partMargin(p);
                      const marginPct = partMarginPct(p);
                      const negativeMargin = margin < 0;
                      return (
                        <tr
                          key={p.id}
                          className={`${low ? "bg-warning/10" : ""} ${!p.is_active ? "opacity-60" : ""}`}
                        >
                          {isManager ? (
                            <td className="align-top">
                              <input
                                type="checkbox"
                                className="checkbox checkbox-xs"
                                checked={bulkSelected.has(p.id)}
                                onChange={() => toggleBulk(p.id)}
                                aria-label={`Select ${p.part_number}`}
                              />
                            </td>
                          ) : null}
                          <td className="align-top">
                            {isManager ? (
                              <Link
                                href={`/parts/${p.id}`}
                                className="link link-primary font-mono text-sm"
                                aria-label={`Open part ${p.part_number}`}
                              >
                                {p.part_number}
                              </Link>
                            ) : (
                              p.part_number
                            )}
                          </td>
                          <td className="align-top">
                            {isManager ? (
                              <Link
                                href={`/parts/${p.id}`}
                                className="link link-primary font-medium break-words"
                                aria-label={`Edit part ${p.name}`}
                              >
                                {p.name}
                              </Link>
                            ) : (
                              <span className="font-medium">{p.name}</span>
                            )}
                            {!p.is_active ? (
                              <span className="ml-2 badge badge-ghost badge-xs">Inactive</span>
                            ) : null}
                          </td>
                          {isManager ? (
                            <>
                              <td className="align-top">{p.category ?? "—"}</td>
                              <td className="align-top">{p.supplier ?? "—"}</td>
                            </>
                          ) : null}
                          <td className="align-top">
                            {isManager ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs btn-square"
                                  aria-label={`Decrease quantity for ${p.part_number}`}
                                  disabled={qtyBusyId === p.id || p.quantity_on_hand <= 0}
                                  onClick={() => void adjustQty(p, -1)}
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="min-w-[1.5rem] text-center font-medium">
                                  {p.quantity_on_hand}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs btn-square"
                                  aria-label={`Increase quantity for ${p.part_number}`}
                                  disabled={qtyBusyId === p.id}
                                  onClick={() => void adjustQty(p, 1)}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              p.quantity_on_hand
                            )}
                          </td>
                          <td className="align-top">{p.reorder_level}</td>
                          <td className="align-top">{formatMoney(p.unit_cost)}</td>
                          <td className="align-top">{formatMoney(p.standard_customer_price)}</td>
                          {isManager ? (
                            <td className="align-top">
                              <div className="flex flex-wrap items-center gap-1">
                                <span className={negativeMargin ? "text-error font-medium" : ""}>
                                  {formatMoney(margin)}
                                </span>
                                {marginPct != null ? (
                                  <span className="text-xs opacity-60">{formatPct(marginPct)}</span>
                                ) : null}
                                {negativeMargin ? (
                                  <StatusBadge label="Neg margin" tone="error" />
                                ) : null}
                              </div>
                            </td>
                          ) : null}
                          <td className="align-top">
                            {low ? (
                              <StatusBadge label="Low Stock" tone="warning" />
                            ) : (
                              <StatusBadge label="OK" tone="success" />
                            )}
                          </td>
                          {!isManager ? (
                            <td className="align-top">
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={() => openEditForm(p)}
                              >
                                Edit
                              </button>
                            </td>
                          ) : null}
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
