"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus, ChevronRight, Wrench, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import { EquipmentAttachPanel } from "@/components/EquipmentAttachPanel";
import {
  JOB_STAGES,
  isJobOpen,
  isJobUrgent,
  jobBoardMatch,
  jobStageIndex,
  type JobBoardFilter,
} from "@/lib/jobs";
import { equipmentLabel } from "@/lib/equipment";
import type { Customer, Equipment, Profile, WorkOrder } from "@/lib/types";

type JobRow = WorkOrder & {
  customers?: { name: string };
  equipment?: {
    name: string;
    model?: string | null;
    serial_number?: string | null;
    installation_date?: string | null;
  } | null;
};

function nextWoNumber() {
  return `WO-${Date.now().toString().slice(-8)}`;
}

/**
 * This business faces missed emergency response risk.
 * Our app reduces the risk by highlighting Critical and Emergency jobs.
 *
 * ServiceTitan-style Jobs board: filters, stage strip, list + side preview.
 */
export default function JobsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [technicians, setTechnicians] = useState<Profile[]>([]);
  const [techMap, setTechMap] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<JobBoardFilter>("open");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: "",
    equipment_id: "",
    work_order_type: "Preventive Maintenance",
    priority: "Normal" as WorkOrder["priority"],
    assigned_technician_id: "",
    scheduled_date: "",
    problem_description: "",
  });

  async function load() {
    const [{ data: wo }, { data: cust }, { data: tech }] = await Promise.all([
      supabase
        .from("work_orders")
        .select("*, customers(name), equipment(name, model, serial_number, installation_date)")
        .order("created_at", { ascending: false }),
      supabase.from("customers").select("*").eq("status", "Active").order("name"),
      supabase.from("profiles").select("*").eq("role", "technician").eq("is_active", true),
    ]);
    const list = (wo as JobRow[]) ?? [];
    setJobs(list);
    setCustomers((cust as Customer[]) ?? []);
    const techs = (tech as Profile[]) ?? [];
    setTechnicians(techs);
    const map: Record<string, string> = {};
    for (const t of techs) map[t.id] = t.full_name || t.email;
    // also load names for any assigned non-tech users
    const missing = [...new Set(list.map((j) => j.assigned_technician_id).filter(Boolean))] as string[];
    const need = missing.filter((id) => !map[id]);
    if (need.length) {
      const { data: extra } = await supabase.from("profiles").select("id, full_name, email").in("id", need);
      for (const p of extra ?? []) {
        map[p.id] = p.full_name || p.email;
      }
    }
    setTechMap(map);
    if (!selectedId && list.length > 0) {
      const firstOpen = list.find((j) => isJobOpen(j.status));
      setSelectedId((firstOpen ?? list[0]).id);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!form.customer_id) {
      setEquipment([]);
      return;
    }
    supabase
      .from("equipment")
      .select("*")
      .eq("customer_id", form.customer_id)
      .then(({ data }) => setEquipment((data as Equipment[]) ?? []));
  }, [form.customer_id]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (!jobBoardMatch(j, filter, todayIso)) return false;
      if (!q) return true;
      const tech = j.assigned_technician_id ? techMap[j.assigned_technician_id] ?? "" : "";
      return (
        j.work_order_number.toLowerCase().includes(q) ||
        (j.customers?.name ?? "").toLowerCase().includes(q) ||
        j.status.toLowerCase().includes(q) ||
        j.work_order_type.toLowerCase().includes(q) ||
        tech.toLowerCase().includes(q)
      );
    });
  }, [jobs, filter, query, todayIso, techMap]);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  const stats = useMemo(() => {
    let open = 0;
    let today = 0;
    let unassigned = 0;
    let review = 0;
    let unbilled = 0;
    let critical = 0;
    for (const j of jobs) {
      if (isJobOpen(j.status)) open += 1;
      if (j.scheduled_date === todayIso && isJobOpen(j.status)) today += 1;
      if (!j.assigned_technician_id && isJobOpen(j.status)) unassigned += 1;
      if (j.status === "Ready for Review") review += 1;
      if (j.status === "Completed" && j.billing_status === "Unbilled") unbilled += 1;
      if (isJobUrgent(j) && isJobOpen(j.status)) critical += 1;
    }
    return { open, today, unassigned, review, unbilled, critical };
  }, [jobs, todayIso]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const hasTech = Boolean(form.assigned_technician_id);
    const hasSchedule = Boolean(form.scheduled_date);
    let status = "Requested";
    if (hasTech && hasSchedule) status = "Scheduled";
    else if (hasTech) status = "Assigned";

    const payload = {
      work_order_number: nextWoNumber(),
      customer_id: form.customer_id,
      equipment_id: form.equipment_id || null,
      work_order_type: form.work_order_type,
      priority: form.priority,
      assigned_technician_id: form.assigned_technician_id || null,
      scheduled_date: form.scheduled_date || null,
      problem_description: form.problem_description || null,
      status,
      billing_status: "Unbilled",
    };
    const { data, error: insertError } = await supabase.from("work_orders").insert(payload).select().single();
    if (insertError) {
      setError(insertError.message);
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
    setForm({
      customer_id: "",
      equipment_id: "",
      work_order_type: "Preventive Maintenance",
      priority: "Normal",
      assigned_technician_id: "",
      scheduled_date: "",
      problem_description: "",
    });
    await load();
    setSelectedId(data.id);
    router.push(`/work-orders/${data.id}`);
  }

  function rowClass(wo: WorkOrder) {
    if (isJobUrgent(wo)) return "bg-error/10";
    if (wo.priority === "High") return "bg-warning/10";
    return "";
  }

  const boardTabs: { id: JobBoardFilter; label: string; count?: number }[] = [
    { id: "open", label: "Open", count: stats.open },
    { id: "today", label: "Today", count: stats.today },
    { id: "unassigned", label: "Unassigned", count: stats.unassigned },
    { id: "critical", label: "Critical", count: stats.critical },
    { id: "review", label: "Review", count: stats.review },
    { id: "unbilled", label: "Ready to bill", count: stats.unbilled },
    { id: "completed", label: "Completed" },
    { id: "all", label: "All" },
  ];

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="ServiceTitan-style job board — book, schedule, dispatch, complete, and invoice"
        actions={
          <button type="button" className="btn btn-primary btn-sm gap-1" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Book job
          </button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open jobs" value={stats.open} />
        <StatCard label="Scheduled today" value={stats.today} />
        <StatCard label="Ready for review" value={stats.review} danger={stats.review > 0} />
        <StatCard label="Completed, unbilled" value={stats.unbilled} hint="Send to Billing" />
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="tabs tabs-box tabs-sm w-full overflow-x-auto lg:w-auto">
          {boardTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${filter === t.id ? "tab-active" : ""}`}
              onClick={() => setFilter(t.id)}
            >
              {t.label}
              {t.count != null ? <span className="ml-1 opacity-60">{t.count}</span> : null}
            </button>
          ))}
        </div>
        <label className="input input-bordered flex w-full items-center gap-2 lg:max-w-xs">
          <Search className="h-4 w-4 opacity-50" />
          <input
            type="search"
            className="grow"
            placeholder="Search job, customer, tech…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">Book new job</h3>
            <p className="text-sm opacity-70">Creates a work order and starts the job lifecycle.</p>
            {error ? <div className="alert alert-error mt-3 text-sm">{error}</div> : null}
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <FormRow label="Customer" required>
                <select
                  className="select select-bordered w-full"
                  value={form.customer_id}
                  onChange={(e) => setForm({ ...form, customer_id: e.target.value, equipment_id: "" })}
                  required
                >
                  <option value="">Select…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <EquipmentAttachPanel
                customerId={form.customer_id}
                equipment={equipment}
                selectedId={form.equipment_id}
                onSelect={(equipmentId) => setForm({ ...form, equipment_id: equipmentId })}
                onCreated={(row) => setEquipment((prev) => [...prev, row as Equipment])}
              />
              <FormRow label="Job type">
                <select
                  className="select select-bordered w-full"
                  value={form.work_order_type}
                  onChange={(e) => setForm({ ...form, work_order_type: e.target.value })}
                >
                  <option>Preventive Maintenance</option>
                  <option>Repair</option>
                  <option>Emergency Repair</option>
                  <option>Inspection</option>
                  <option>Warranty Repair</option>
                  <option>Installation</option>
                  <option>Follow-Up Service</option>
                </select>
              </FormRow>
              <FormRow label="Priority">
                <select
                  className="select select-bordered w-full"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as WorkOrder["priority"] })}
                >
                  <option value="Low">Low</option>
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </FormRow>
              <FormRow label="Technician">
                <select
                  className="select select-bordered w-full"
                  value={form.assigned_technician_id}
                  onChange={(e) => setForm({ ...form, assigned_technician_id: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name ?? t.email}
                    </option>
                  ))}
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
              <div className="modal-action">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Book job
                </button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setShowForm(false)}>
              close
            </button>
          </form>
        </dialog>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="card bg-base-100 shadow">
          <div className="card-body p-0">
            {filtered.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No jobs match" description="Change filters or book a new job." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Job #</th>
                      <th>Customer</th>
                      <th>Type</th>
                      <th>Tech</th>
                      <th>Scheduled</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Billing</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((job) => {
                      const active = selectedId === job.id;
                      return (
                        <tr
                          key={job.id}
                          className={`cursor-pointer hover:bg-base-200/80 ${rowClass(job)} ${active ? "bg-primary/10" : ""}`}
                          onClick={() => setSelectedId(job.id)}
                        >
                          <td className="font-medium">
                            <span className="inline-flex items-center gap-1">
                              {isJobUrgent(job) ? <AlertTriangle className="h-3.5 w-3.5 text-error" /> : null}
                              <Link
                                href={`/work-orders/${job.id}`}
                                className="link link-hover"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {job.work_order_number}
                              </Link>
                            </span>
                          </td>
                          <td>
                            {job.customer_id ? (
                              <Link
                                href={`/customers/${job.customer_id}`}
                                className="link link-hover"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {job.customers?.name ?? "—"}
                              </Link>
                            ) : (
                              job.customers?.name ?? "—"
                            )}
                          </td>
                          <td className="max-w-[8rem] truncate">{job.work_order_type}</td>
                          <td className="max-w-[7rem] truncate text-xs">
                            {job.assigned_technician_id ? techMap[job.assigned_technician_id] ?? "—" : (
                              <span className="opacity-50">Unassigned</span>
                            )}
                          </td>
                          <td>{job.scheduled_date ?? "—"}</td>
                          <td>
                            <StatusBadge label={job.priority} tone={statusTone(job.priority)} />
                          </td>
                          <td>
                            <StatusBadge label={job.status} tone={statusTone(job.status)} />
                          </td>
                          <td>
                            <StatusBadge label={job.billing_status} tone={statusTone(job.billing_status)} />
                          </td>
                          <td>
                            <Link
                              href={`/work-orders/${job.id}`}
                              className="btn btn-ghost btn-xs"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Open ${job.work_order_number}`}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Link>
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

        <div className="card bg-base-100 shadow xl:sticky xl:top-20 xl:self-start">
          <div className="card-body">
            {selected ? (
              <JobPreview
                job={selected}
                techName={
                  selected.assigned_technician_id
                    ? techMap[selected.assigned_technician_id] ?? "—"
                    : "Unassigned"
                }
              />
            ) : (
              <EmptyState title="Select a job" description="Click a row to preview the job lifecycle." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function JobPreview({ job, techName }: { job: JobRow; techName: string }) {
  const stageIdx = jobStageIndex(job.status);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-60">Job preview</p>
          <h3 className="text-xl font-bold">
            <Link href={`/work-orders/${job.id}`} className="link link-hover">
              {job.work_order_number}
            </Link>
          </h3>
          <p className="text-sm opacity-70">
            {job.customer_id ? (
              <Link href={`/customers/${job.customer_id}`} className="link link-hover font-medium">
                {job.customers?.name ?? "Customer"}
              </Link>
            ) : (
              job.customers?.name ?? "Customer"
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge label={job.status} tone={statusTone(job.status)} />
          <StatusBadge label={job.billing_status} tone={statusTone(job.billing_status)} />
        </div>
      </div>

      {isJobUrgent(job) ? (
        <div className="alert alert-error py-2 text-sm">
          <AlertTriangle className="h-4 w-4" />
          {job.priority === "Critical" ? "Critical priority" : "Emergency repair"} — expedite dispatch
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">Lifecycle</p>
        <ul className="steps steps-vertical w-full text-xs sm:steps-horizontal sm:text-[10px] lg:text-xs">
          {JOB_STAGES.map((stage, i) => (
            <li key={stage.key} className={`step ${i <= stageIdx ? "step-primary" : ""}`}>
              {stage.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-box bg-base-200/60 p-3">
          <p className="opacity-60">Type</p>
          <p className="font-medium">{job.work_order_type}</p>
        </div>
        <div className="rounded-box bg-base-200/60 p-3">
          <p className="opacity-60">Priority</p>
          <p className="font-medium">{job.priority}</p>
        </div>
        <div className="rounded-box bg-base-200/60 p-3">
          <p className="opacity-60">Technician</p>
          <p className="font-medium">{techName}</p>
        </div>
        <div className="rounded-box bg-base-200/60 p-3">
          <p className="opacity-60">Scheduled</p>
          <p className="font-medium">{job.scheduled_date ?? "Not set"}</p>
        </div>
        <div className="col-span-2 rounded-box bg-base-200/60 p-3">
          <p className="opacity-60">Equipment (model / serial)</p>
          <p className="font-medium">
            {job.equipment_id && job.equipment ? (
              <Link href="/equipment" className="link link-hover">
                {equipmentLabel(job.equipment)}
              </Link>
            ) : (
              "Not linked"
            )}
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Problem</p>
        <p className="mt-1 text-sm">{job.problem_description ?? "No description"}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/work-orders/${job.id}`} className="btn btn-primary btn-sm gap-1">
          <Wrench className="h-4 w-4" /> Open job
        </Link>
        <Link href={`/customers/${job.customer_id}`} className="btn btn-outline btn-sm">
          Customer
        </Link>
        {job.status === "Completed" && job.billing_status === "Unbilled" ? (
          <Link href={`/billing?wo=${job.id}`} className="btn btn-outline btn-sm">
            Invoice
          </Link>
        ) : null}
      </div>
    </div>
  );
}
