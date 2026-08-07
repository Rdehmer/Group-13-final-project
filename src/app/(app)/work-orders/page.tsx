"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format, isBefore, parseISO, startOfDay } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Customer, Equipment, Profile, Vendor, WorkOrder } from "@/lib/types";
import { WORK_ORDER_TYPES, scheduleVisitKind } from "@/lib/work-order-types";
import {
  WO_STATUSES,
  scheduleFieldsForStatusChange,
  statusForNewWorkOrder,
} from "@/lib/work-order-status";
import {
  assignmentPatchFromTarget,
  decodeAssignTarget,
  encodeAssignTarget,
  hasAssignee,
} from "@/lib/work-order-assign";
import {
  STAFF_DELINQUENCY_LOCK_MESSAGE,
  isDelinquencyLockError,
} from "@/lib/contract-billing";
import { useLiveReload } from "@/components/LiveDataRefresh";

type WorkOrderRow = WorkOrder & { customers?: { id: string; name: string } | null };

function nextWoNumber() {
  return `WO-${Date.now().toString().slice(-8)}`;
}

const CLOSED = new Set(["Completed", "Closed", "Canceled"]);

const PRIORITIES: WorkOrder["priority"][] = ["Low", "Normal", "High", "Critical"];

const emptyCustomerForm = {
  name: "",
  primary_contact_name: "",
  email: "",
  phone: "",
  city: "",
  state: "",
  status: "Active" as Customer["status"],
};

const emptyWorkOrderForm = {
  customer_id: "",
  equipment_id: "",
  work_order_type: "Preventive Maintenance",
  priority: "Normal" as WorkOrder["priority"],
  assign_target: "",
  scheduled_date: "",
  problem_description: "",
  completion_proof_requirement: "photo_or_signature" as WorkOrder["completion_proof_requirement"],
};

/**
 * This business faces missed emergency response risk.
 * Our app reduces the risk by highlighting Critical and Emergency work orders.
 */
export default function WorkOrdersPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [technicians, setTechnicians] = useState<Profile[]>([]);
  const [portalVendors, setPortalVendors] = useState<Vendor[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyWorkOrderForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [filters, setFilters] = useState({
    number: "",
    customer: "",
    type: "",
    priority: "",
    scheduled: "",
    status: searchParams.get("status") ?? "",
  });
  const [sort, setSort] = useState<{
    column: "number" | "customer" | "type" | "priority" | "scheduled" | "status";
    direction: "asc" | "desc";
  }>({ column: "number", direction: "asc" });

  const isManager =
    profile?.role === "administrator" || profile?.role === "service_manager";
  const filter = searchParams.get("filter");
  const typeFilter = searchParams.get("type");
  const statusFilter = searchParams.get("status");
  const today = startOfDay(new Date());

  async function load() {
    const [{ data: wo }, { data: cust }, { data: tech }, { data: vendors }, { data: { user } }] = await Promise.all([
      supabase
        .from("work_orders")
        .select("*, customers(id, name)")
        .order("created_at", { ascending: false }),
      supabase.from("customers").select("*").order("name"),
      supabase.from("profiles").select("*").eq("role", "technician").eq("is_active", true),
      supabase
        .from("vendors")
        .select("id, name, approval_status, is_active")
        .eq("is_active", true)
        .eq("approval_status", "Approved")
        .order("name"),
      supabase.auth.getUser(),
    ]);
    setWorkOrders((wo as WorkOrderRow[]) ?? []);
    setCustomers((cust as Customer[]) ?? []);
    setTechnicians((tech as Profile[]) ?? []);
    setPortalVendors((vendors as Vendor[]) ?? []);
    if (user) {
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useLiveReload(load, 40_000);

  // Prefill create form from Equipment "Create work order" links (manager).
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    const customerId = searchParams.get("customer_id") ?? "";
    const equipmentId = searchParams.get("equipment_id") ?? "";
    setForm({
      ...emptyWorkOrderForm,
      customer_id: customerId,
      equipment_id: equipmentId,
    });
    setShowForm(true);
    setError(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    params.delete("customer_id");
    params.delete("equipment_id");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [searchParams, pathname, router]);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, status: statusFilter ?? "" }));
  }, [statusFilter]);

  useEffect(() => {
    if (!form.customer_id) {
      setEquipment([]);
      return;
    }
    supabase
      .from("equipment")
      .select("*")
      .eq("customer_id", form.customer_id)
      .then(({ data }) => {
        setEquipment((data as Equipment[]) ?? []);
      });
  }, [form.customer_id]);

  const activeCustomers = customers.filter((c) => c.status === "Active");

  const filterOptions = useMemo(() => {
    const uniqueSorted = (values: string[]) =>
      Array.from(new Set(values.filter((v) => v.trim() !== ""))).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    return {
      number: uniqueSorted(workOrders.map((wo) => wo.work_order_number)),
      customer: uniqueSorted(workOrders.map((wo) => wo.customers?.name ?? "")),
      type: uniqueSorted(workOrders.map((wo) => wo.work_order_type)),
      priority: uniqueSorted([...workOrders.map((wo) => wo.priority), ...PRIORITIES]),
      scheduled: uniqueSorted(workOrders.map((wo) => wo.scheduled_date ?? "")),
      status: uniqueSorted([...workOrders.map((wo) => wo.status), ...WO_STATUSES]),
    };
  }, [workOrders]);

  const filteredWorkOrders = useMemo(() => {
    const rows = workOrders.filter((wo) => {
      if (filter === "open" && CLOSED.has(wo.status)) return false;
      if (filter === "urgent") {
        if (CLOSED.has(wo.status)) return false;
        if (!["Critical", "High"].includes(wo.priority)) return false;
      }
      if (filter === "overdue") {
        if (CLOSED.has(wo.status)) return false;
        if (!wo.scheduled_date) return false;
        if (!isBefore(parseISO(wo.scheduled_date), today)) return false;
      }
      if (filter === "completed") {
        if (!["Completed", "Closed"].includes(wo.status)) return false;
      }
      if (filter === "unbilled") {
        if (!["Completed", "Closed"].includes(wo.status)) return false;
        if (wo.billing_status !== "Unbilled") return false;
      }
      if (typeFilter && wo.work_order_type !== typeFilter) return false;
      if (statusFilter && wo.status !== statusFilter) return false;

      if (isManager) {
        if (filters.number && wo.work_order_number !== filters.number) return false;
        if (filters.customer && (wo.customers?.name ?? "") !== filters.customer) return false;
        if (filters.type && wo.work_order_type !== filters.type) return false;
        if (filters.priority && wo.priority !== filters.priority) return false;
        if (filters.scheduled && (wo.scheduled_date ?? "") !== filters.scheduled) return false;
        if (filters.status && wo.status !== filters.status) return false;
      }
      return true;
    });

    if (!isManager) return rows;

    const valueFor = (wo: WorkOrderRow) => {
      switch (sort.column) {
        case "customer":
          return wo.customers?.name ?? "";
        case "type":
          return wo.work_order_type;
        case "priority":
          return wo.priority;
        case "scheduled":
          return wo.scheduled_date ?? "";
        case "status":
          return wo.status;
        case "number":
        default:
          return wo.work_order_number;
      }
    };

    return [...rows].sort((a, b) => {
      const cmp = valueFor(a).localeCompare(valueFor(b), undefined, { sensitivity: "base" });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [
    workOrders,
    filter,
    typeFilter,
    statusFilter,
    today,
    isManager,
    filters,
    sort,
  ]);

  const hasColumnFilters = Object.values(filters).some((v) => v.trim() !== "");

  const activeFilterLabel = [
    filter === "open" ? "Open" : null,
    filter === "urgent" ? "High / Critical" : null,
    filter === "overdue" ? "Overdue" : null,
    filter === "completed" ? "Completed" : null,
    filter === "unbilled" ? "Unbilled completed" : null,
    typeFilter ? `Type: ${typeFilter}` : null,
    statusFilter && !isManager ? `Status: ${statusFilter}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function clearFilters() {
    setFilters({ number: "", customer: "", type: "", priority: "", scheduled: "", status: "" });
    router.push(pathname);
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

  async function onCreateCustomer(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    if (!isManager) return;
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
    setCustomers((prev) =>
      [...prev, data as Customer].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setForm((prev) => ({ ...prev, customer_id: data.id, equipment_id: "" }));
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
    const target = decodeAssignTarget(form.assign_target);
    const assignee = assignmentPatchFromTarget(target);
    const assigned = hasAssignee(target);
    const payload = {
      work_order_number: nextWoNumber(),
      customer_id: form.customer_id,
      equipment_id: form.equipment_id || null,
      work_order_type: form.work_order_type,
      visit_kind: scheduleVisitKind({
        work_order_type: form.work_order_type,
        priority: form.priority,
      }),
      priority: form.priority,
      ...assignee,
      scheduled_date: form.scheduled_date || null,
      problem_description: form.problem_description || null,
      completion_proof_requirement: form.completion_proof_requirement,
      status: isManager
        ? statusForNewWorkOrder({
            scheduled_date: form.scheduled_date || null,
            ...assignee,
          })
        : assigned && target.kind !== "vendor"
          ? "Assigned"
          : assigned && target.kind === "vendor"
            ? "Requested"
          : "Requested",
    };
    const { data, error: insertError } = await supabase
      .from("work_orders")
      .insert(payload)
      .select()
      .single();
    if (insertError) {
      setError(
        isDelinquencyLockError(insertError.message)
          ? STAFF_DELINQUENCY_LOCK_MESSAGE
          : insertError.message,
      );
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "work_order",
      recordId: data.id,
      newValue: payload.work_order_number,
    });
    setShowForm(false);
    setShowNewCustomer(false);
    setForm(emptyWorkOrderForm);
    load();
  }

  function openAddForm() {
    setError(null);
    setCustomerError(null);
    setShowNewCustomer(false);
    setForm(emptyWorkOrderForm);
    setCustomerForm(emptyCustomerForm);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setShowNewCustomer(false);
    setCustomerError(null);
  }

  async function updateStatus(workOrderId: string, previous: string, next: string) {
    if (!isManager) return;
    if (previous === next) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const current = workOrders.find((wo) => wo.id === workOrderId);
    const todayIso = format(new Date(), "yyyy-MM-dd");
    const scheduleExtra = scheduleFieldsForStatusChange(
      next,
      {
        scheduled_date: current?.scheduled_date,
        scheduled_start_time: current?.scheduled_start_time,
      },
      todayIso,
    );
    const { error: updateError } = await supabase
      .from("work_orders")
      .update({ status: next, ...scheduleExtra, updated_at: new Date().toISOString() })
      .eq("id", workOrderId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setWorkOrders((prev) =>
      prev.map((wo) =>
        wo.id === workOrderId
          ? { ...wo, status: next, ...(scheduleExtra as Partial<WorkOrderRow>) }
          : wo,
      ),
    );
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "status_change",
      recordType: "work_order",
      recordId: workOrderId,
      previousValue: previous,
      newValue: next,
    });
  }

  async function updatePriority(
    workOrderId: string,
    previous: WorkOrder["priority"],
    next: WorkOrder["priority"],
  ) {
    if (!isManager) return;
    if (previous === next) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("work_orders")
      .update({ priority: next, updated_at: new Date().toISOString() })
      .eq("id", workOrderId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setWorkOrders((prev) =>
      prev.map((wo) => (wo.id === workOrderId ? { ...wo, priority: next } : wo)),
    );
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "priority_change",
      recordType: "work_order",
      recordId: workOrderId,
      previousValue: previous,
      newValue: next,
    });
  }

  function rowClass(wo: WorkOrder) {
    if (wo.priority === "Critical" || wo.work_order_type === "Emergency Repair") return "bg-error/10";
    if (wo.priority === "High") return "bg-warning/10";
    return "";
  }

  return (
    <div>
      <PageHeader
        title="Work Orders"
        description="Schedule and track service work"
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={openAddForm}>
            Create Work Order
          </button>
        }
      />

      {activeFilterLabel ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-box bg-base-200/60 px-3 py-2 text-sm">
          <span className="opacity-70">Showing:</span>
          <span className="badge badge-primary badge-outline">{activeFilterLabel}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={clearFilters}>
            Clear filter
          </button>
        </div>
      ) : null}

      {error ? <div className="alert alert-error mb-4 text-sm">{error}</div> : null}

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">New Work Order</h3>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <FormRow label="Customer" required>
                <select
                  className="select select-bordered w-full"
                  value={form.customer_id}
                  onChange={(e) =>
                    setForm({ ...form, customer_id: e.target.value, equipment_id: "" })
                  }
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
                          onChange={(e) =>
                            setCustomerForm({ ...customerForm, name: e.target.value })
                          }
                          required
                        />
                      </FormRow>
                      <FormRow label="Contact">
                        <input
                          className="input input-bordered w-full"
                          value={customerForm.primary_contact_name}
                          onChange={(e) =>
                            setCustomerForm({
                              ...customerForm,
                              primary_contact_name: e.target.value,
                            })
                          }
                        />
                      </FormRow>
                      <FormRow label="Email">
                        <input
                          type="email"
                          className="input input-bordered w-full"
                          value={customerForm.email}
                          onChange={(e) =>
                            setCustomerForm({ ...customerForm, email: e.target.value })
                          }
                        />
                      </FormRow>
                      <FormRow label="Phone">
                        <input
                          className="input input-bordered w-full"
                          value={customerForm.phone}
                          onChange={(e) =>
                            setCustomerForm({ ...customerForm, phone: e.target.value })
                          }
                        />
                      </FormRow>
                      <div className="grid grid-cols-2 gap-2">
                        <FormRow label="City">
                          <input
                            className="input input-bordered w-full"
                            value={customerForm.city}
                            onChange={(e) =>
                              setCustomerForm({ ...customerForm, city: e.target.value })
                            }
                          />
                        </FormRow>
                        <FormRow label="State">
                          <input
                            className="input input-bordered w-full"
                            value={customerForm.state}
                            onChange={(e) =>
                              setCustomerForm({ ...customerForm, state: e.target.value })
                            }
                          />
                        </FormRow>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setShowNewCustomer(false);
                            setCustomerError(null);
                            setCustomerForm(emptyCustomerForm);
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={onCreateCustomer}
                        >
                          Save customer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <FormRow label="Equipment">
                <select
                  className="select select-bordered w-full"
                  value={form.equipment_id}
                  onChange={(e) => setForm({ ...form, equipment_id: e.target.value })}
                >
                  <option value="">Optional</option>
                  {equipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Type">
                <select
                  className="select select-bordered w-full"
                  value={form.work_order_type}
                  onChange={(e) => setForm({ ...form, work_order_type: e.target.value })}
                >
                  {WORK_ORDER_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Priority">
                <select
                  className="select select-bordered w-full"
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value as WorkOrder["priority"] })
                  }
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Assigned to">
                <select
                  className="select select-bordered w-full"
                  value={form.assign_target}
                  onChange={(e) => setForm({ ...form, assign_target: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  <optgroup label="Technicians">
                    {technicians.map((t) => (
                      <option key={t.id} value={encodeAssignTarget({ kind: "tech", id: t.id })}>
                        {t.full_name ?? t.email}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Vendors (portal)">
                    {portalVendors.map((v) => (
                      <option key={v.id} value={encodeAssignTarget({ kind: "vendor", id: v.id })}>
                        {v.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </FormRow>
              <FormRow label="Scheduled">
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={form.scheduled_date}
                  onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })}
                />
              </FormRow>
              <FormRow label="Problem">
                <textarea
                  className="textarea textarea-bordered w-full"
                  rows={3}
                  value={form.problem_description}
                  onChange={(e) => setForm({ ...form, problem_description: e.target.value })}
                />
              </FormRow>
              <FormRow label="Completion proof">
                <select
                  className="select select-bordered w-full"
                  value={form.completion_proof_requirement}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      completion_proof_requirement: e.target
                        .value as WorkOrder["completion_proof_requirement"],
                    })
                  }
                >
                  <option value="photo_or_signature">Photo or signature</option>
                  <option value="photo">Photo required</option>
                  <option value="signature">Signature required</option>
                  <option value="both">Photo and signature required</option>
                </select>
              </FormRow>
              <div className="modal-action">
                <button type="button" className="btn" onClick={closeForm}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isManager && showNewCustomer}
                >
                  Create
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

      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {filteredWorkOrders.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={workOrders.length === 0 ? "No work orders" : "No matching work orders"}
                description={
                  workOrders.length === 0
                    ? "Create a work order to schedule service."
                    : "Try clearing the filter to see all work orders."
                }
                action={
                  activeFilterLabel || hasColumnFilters ? (
                    <button type="button" className="btn btn-sm" onClick={clearFilters}>
                      Clear filter
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <DualHorizontalScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th>WO #</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Priority</th>
                    <th>Scheduled</th>
                    <th>Status</th>
                    {!isManager ? <th /> : null}
                  </tr>
                  {isManager ? (
                    <tr className="bg-base-200/50">
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="number"
                          label="work order number"
                          options={filterOptions.number}
                        />
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
                          column="type"
                          label="type"
                          options={filterOptions.type}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="priority"
                          label="priority"
                          options={filterOptions.priority}
                        />
                      </th>
                      <th className="font-normal">
                        <ColumnFilterSelect
                          column="scheduled"
                          label="scheduled date"
                          options={filterOptions.scheduled}
                        />
                      </th>
                      <th className="font-normal">
                        <div className="flex gap-1">
                          <ColumnFilterSelect
                            column="status"
                            label="status"
                            options={filterOptions.status}
                          />
                          {hasColumnFilters || activeFilterLabel ? (
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
                  {filteredWorkOrders.map((wo) => (
                    <tr key={wo.id} className={rowClass(wo)}>
                      <td className="align-top font-medium">
                        {isManager ? (
                          <Link
                            href={`/work-orders/${wo.id}`}
                            className="link link-primary"
                            aria-label={`Open work order ${wo.work_order_number}`}
                          >
                            {wo.work_order_number}
                          </Link>
                        ) : (
                          wo.work_order_number
                        )}
                      </td>
                      <td className="align-top break-words">
                        {isManager && wo.customers?.id ? (
                          <Link
                            href={`/customers/${wo.customers.id}`}
                            className="link link-primary"
                            aria-label={`Open customer ${wo.customers.name}`}
                          >
                            {wo.customers.name}
                          </Link>
                        ) : (
                          (wo.customers?.name ?? "—")
                        )}
                      </td>
                      <td className="align-top break-words">{wo.work_order_type}</td>
                      <td className="align-top">
                        {isManager ? (
                          <div className="dropdown dropdown-hover dropdown-end">
                            <div
                              tabIndex={0}
                              role="button"
                              className="cursor-pointer rounded-btn outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={`Change priority, currently ${wo.priority}`}
                            >
                              <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                            </div>
                            <ul
                              tabIndex={0}
                              className="dropdown-content menu z-20 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow"
                            >
                              {PRIORITIES.map((option) => (
                                <li key={option}>
                                  <button
                                    type="button"
                                    className={option === wo.priority ? "active" : ""}
                                    onClick={() => updatePriority(wo.id, wo.priority, option)}
                                  >
                                    <StatusBadge label={option} tone={statusTone(option)} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                        )}
                      </td>
                      <td className="align-top">{wo.scheduled_date ?? "—"}</td>
                      <td className="align-top">
                        {isManager ? (
                          <div className="dropdown dropdown-hover dropdown-end">
                            <div
                              tabIndex={0}
                              role="button"
                              className="cursor-pointer rounded-btn outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={`Change status, currently ${wo.status}`}
                            >
                              <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                            </div>
                            <ul
                              tabIndex={0}
                              className="dropdown-content menu z-20 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow"
                            >
                              {WO_STATUSES.map((option) => (
                                <li key={option}>
                                  <button
                                    type="button"
                                    className={option === wo.status ? "active" : ""}
                                    onClick={() => updateStatus(wo.id, wo.status, option)}
                                  >
                                    <StatusBadge label={option} tone={statusTone(option)} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                        )}
                      </td>
                      {!isManager ? (
                        <td>
                          <Link href={`/work-orders/${wo.id}`} className="btn btn-ghost btn-xs">
                            Open
                          </Link>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </DualHorizontalScroll>
          )}
        </div>
      </div>
    </div>
  );
}
