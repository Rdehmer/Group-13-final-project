"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  Package,
  AlertTriangle,
  Wrench,
  ArrowDownToLine,
  ExternalLink,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone, StatCard } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import type { Part, WorkOrderPart } from "@/lib/types";

type UsageRow = WorkOrderPart & {
  parts?: { name: string; part_number: string } | null;
  work_orders?: {
    id: string;
    work_order_number: string;
    status: string;
    assigned_technician_id: string | null;
    customer_id?: string | null;
    customers?: { name: string } | null;
  } | null;
};

type StockFilter = "all" | "low" | "ok" | "inactive";

/**
 * This business faces inventory shrinkage / negative stock risk.
 * Our app reduces the risk by tracking on-hand qty, low-stock alerts, and field usage.
 */
export default function PartsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const deepPart = searchParams.get("part");
  const deepFilter = searchParams.get("filter") as StockFilter | null;

  const [parts, setParts] = useState<Part[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [techNames, setTechNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<StockFilter>(deepFilter ?? "all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(deepPart);
  const [showForm, setShowForm] = useState(false);
  const [receiveQty, setReceiveQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    part_number: "",
    name: "",
    category: "",
    quantity_on_hand: "0",
    reorder_level: "5",
    unit_cost: "0",
    standard_customer_price: "0",
    supplier: "",
  });

  async function load() {
    const [{ data: partRows }, { data: useRows }] = await Promise.all([
      supabase.from("parts").select("*").order("name"),
      supabase
        .from("work_order_parts")
        .select(
          "*, parts(name, part_number), work_orders(id, work_order_number, status, assigned_technician_id, customer_id, customers(name))",
        )
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const list = (partRows as Part[]) ?? [];
    setParts(list);
    setUsage((useRows as UsageRow[]) ?? []);

    const techIds = [
      ...new Set(
        ((useRows as UsageRow[]) ?? [])
          .map((u) => u.work_orders?.assigned_technician_id)
          .filter(Boolean) as string[],
      ),
    ];
    if (techIds.length) {
      const { data: techs } = await supabase.from("profiles").select("id, full_name, email").in("id", techIds);
      const map: Record<string, string> = {};
      for (const t of techs ?? []) map[t.id] = t.full_name || t.email;
      setTechNames(map);
    }

    if (deepPart && list.some((p) => p.id === deepPart)) {
      setSelectedId(deepPart);
    } else if (!selectedId && list.length > 0) {
      const firstLow = list.find((p) => p.is_active && p.quantity_on_hand <= p.reorder_level);
      setSelectedId((firstLow ?? list[0]).id);
    }
  }

  useEffect(() => {
    load();
  }, [deepPart]);

  useEffect(() => {
    if (deepFilter) setFilter(deepFilter);
  }, [deepFilter]);

  const selected = parts.find((p) => p.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parts.filter((p) => {
      if (filter === "low" && !(p.is_active && p.quantity_on_hand <= p.reorder_level)) return false;
      if (filter === "ok" && !(p.is_active && p.quantity_on_hand > p.reorder_level)) return false;
      if (filter === "inactive" && p.is_active) return false;
      if (filter === "all" && !p.is_active) return false;
      if (!q) return true;
      return (
        p.part_number.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q) ||
        (p.supplier ?? "").toLowerCase().includes(q)
      );
    });
  }, [parts, filter, query]);

  const stats = useMemo(() => {
    const active = parts.filter((p) => p.is_active);
    const low = active.filter((p) => p.quantity_on_hand <= p.reorder_level);
    const value = active.reduce((s, p) => s + Number(p.quantity_on_hand) * Number(p.unit_cost), 0);
    const usedQty = usage.reduce((s, u) => s + Number(u.quantity_used), 0);
    return {
      skus: active.length,
      low: low.length,
      value,
      usageEvents: usage.length,
      usedQty,
    };
  }, [parts, usage]);

  const selectedUsage = useMemo(
    () => (selectedId ? usage.filter((u) => u.part_id === selectedId) : []),
    [usage, selectedId],
  );

  const recentUsage = useMemo(() => usage.slice(0, 12), [usage]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      part_number: form.part_number,
      name: form.name,
      category: form.category || null,
      quantity_on_hand: Number(form.quantity_on_hand),
      reorder_level: Number(form.reorder_level),
      unit_cost: Number(form.unit_cost),
      standard_customer_price: Number(form.standard_customer_price),
      supplier: form.supplier || null,
      is_active: true,
    };
    const { data, error: insertError } = await supabase.from("parts").insert(payload).select().single();
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "part",
      recordId: data.id,
      newValue: form.name,
    });
    setShowForm(false);
    setForm({
      part_number: "",
      name: "",
      category: "",
      quantity_on_hand: "0",
      reorder_level: "5",
      unit_cost: "0",
      standard_customer_price: "0",
      supplier: "",
    });
    await load();
    setSelectedId(data.id);
    setBusy(false);
  }

  async function receiveStock() {
    if (!selected) return;
    const qty = Number(receiveQty);
    if (!qty || qty <= 0) return;
    setBusy(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const next = Number(selected.quantity_on_hand) + qty;
    const { error: updError } = await supabase
      .from("parts")
      .update({ quantity_on_hand: next, updated_at: new Date().toISOString() })
      .eq("id", selected.id);
    if (updError) {
      setError(updError.message);
      setBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "stock_received",
      recordType: "part",
      recordId: selected.id,
      newValue: `+${qty} → ${next}`,
    });
    setReceiveQty("1");
    await load();
    setBusy(false);
  }

  function stockTone(p: Part) {
    if (!p.is_active) return "neutral" as const;
    if (p.quantity_on_hand <= 0) return "error" as const;
    if (p.quantity_on_hand <= p.reorder_level) return "warning" as const;
    return "success" as const;
  }

  function stockLabel(p: Part) {
    if (!p.is_active) return "Inactive";
    if (p.quantity_on_hand <= 0) return "Out of stock";
    if (p.quantity_on_hand <= p.reorder_level) return "Low stock";
    return "In stock";
  }

  const tabs: { id: StockFilter; label: string; count?: number }[] = [
    { id: "all", label: "Active", count: stats.skus },
    { id: "low", label: "Low / out", count: stats.low },
    { id: "ok", label: "Healthy" },
    { id: "inactive", label: "Inactive" },
  ];

  return (
    <div>
      <PageHeader
        title="Parts Inventory"
        description="Stock levels, pricing, and technician field usage"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/technician" className="btn btn-outline btn-sm gap-1">
              <Wrench className="h-4 w-4" /> Technician usage
            </Link>
            <button type="button" className="btn btn-primary btn-sm gap-1" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Add part
            </button>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active SKUs" value={stats.skus} />
        <StatCard
          label="Low / out of stock"
          value={stats.low}
          danger={stats.low > 0}
          hint="At or below reorder level"
        />
        <StatCard label="Inventory value" value={formatMoney(stats.value)} hint="At unit cost" />
        <StatCard
          label="Recent field usage"
          value={stats.usageEvents}
          hint={`${stats.usedQty} units on recent jobs`}
        />
      </div>

      {stats.low > 0 ? (
        <div role="alert" className="alert alert-warning mb-4">
          <AlertTriangle className="h-4 w-4" />
          <span>
            {stats.low} part(s) need attention.{" "}
            <button type="button" className="link font-medium" onClick={() => setFilter("low")}>
              Show low stock
            </button>
            {" · "}
            <Link href="/technician" className="link font-medium">
              Check field usage
            </Link>
          </span>
        </div>
      ) : null}

      {error ? <div className="alert alert-error mb-4 text-sm">{error}</div> : null}

      {showForm ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">New part</h3>
            <form onSubmit={onCreate} className="mt-4 space-y-3">
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
              <FormRow label="Qty on hand">
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={form.quantity_on_hand}
                  onChange={(e) => setForm({ ...form, quantity_on_hand: e.target.value })}
                />
              </FormRow>
              <FormRow label="Reorder level">
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={form.reorder_level}
                  onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                />
              </FormRow>
              <FormRow label="Unit cost">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.unit_cost}
                  onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                />
              </FormRow>
              <FormRow label="Customer price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input input-bordered w-full"
                  value={form.standard_customer_price}
                  onChange={(e) => setForm({ ...form, standard_customer_price: e.target.value })}
                />
              </FormRow>
              <div className="modal-action">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Save
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

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="tabs tabs-box tabs-sm w-full overflow-x-auto lg:w-auto">
          {tabs.map((t) => (
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
            placeholder="Search part #, name, category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="card bg-base-100 shadow">
          <div className="card-body p-0">
            {filtered.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No parts match" description="Change filters or add a part to inventory." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Part #</th>
                      <th>Name</th>
                      <th className="text-right">On hand</th>
                      <th className="text-right">Reorder</th>
                      <th className="text-right">Cost</th>
                      <th className="text-right">Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => {
                      const low = p.is_active && p.quantity_on_hand <= p.reorder_level;
                      const active = selectedId === p.id;
                      return (
                        <tr
                          key={p.id}
                          className={`cursor-pointer hover:bg-base-200/80 ${low ? "bg-warning/10" : ""} ${active ? "bg-primary/10" : ""}`}
                          onClick={() => setSelectedId(p.id)}
                        >
                          <td className="font-mono text-xs">{p.part_number}</td>
                          <td className="font-medium">{p.name}</td>
                          <td className="text-right font-semibold">{p.quantity_on_hand}</td>
                          <td className="text-right">{p.reorder_level}</td>
                          <td className="text-right">{formatMoney(p.unit_cost)}</td>
                          <td className="text-right">{formatMoney(p.standard_customer_price)}</td>
                          <td>
                            <StatusBadge label={stockLabel(p)} tone={stockTone(p)} />
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

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              {selected ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide opacity-60">Part detail</p>
                      <h3 className="text-xl font-bold">{selected.name}</h3>
                      <p className="font-mono text-sm opacity-70">{selected.part_number}</p>
                    </div>
                    <StatusBadge label={stockLabel(selected)} tone={stockTone(selected)} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-box bg-base-200/60 p-3">
                      <p className="opacity-60">On hand</p>
                      <p className="text-lg font-bold">{selected.quantity_on_hand}</p>
                    </div>
                    <div className="rounded-box bg-base-200/60 p-3">
                      <p className="opacity-60">Reorder at</p>
                      <p className="text-lg font-bold">{selected.reorder_level}</p>
                    </div>
                    <div className="rounded-box bg-base-200/60 p-3">
                      <p className="opacity-60">Unit cost</p>
                      <p className="font-medium">{formatMoney(selected.unit_cost)}</p>
                    </div>
                    <div className="rounded-box bg-base-200/60 p-3">
                      <p className="opacity-60">Customer price</p>
                      <p className="font-medium">{formatMoney(selected.standard_customer_price)}</p>
                    </div>
                  </div>

                  {selected.category || selected.supplier ? (
                    <div className="text-sm">
                      {selected.category ? (
                        <p>
                          <span className="opacity-60">Category:</span> {selected.category}
                        </p>
                      ) : null}
                      {selected.supplier ? (
                        <p>
                          <span className="opacity-60">Supplier:</span> {selected.supplier}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded-box border border-base-300 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                      Receive stock
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="number"
                        min="1"
                        className="input input-bordered input-sm w-24"
                        value={receiveQty}
                        onChange={(e) => setReceiveQty(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-outline btn-sm gap-1"
                        disabled={busy}
                        onClick={receiveStock}
                      >
                        <ArrowDownToLine className="h-4 w-4" /> Receive
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
                        Field usage (this part)
                      </p>
                      <Link href="/technician" className="btn btn-ghost btn-xs gap-1">
                        Tech schedule <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                    {selectedUsage.length === 0 ? (
                      <p className="text-sm opacity-60">Not used on recent jobs.</p>
                    ) : (
                      <ul className="max-h-52 space-y-2 overflow-y-auto text-sm">
                        {selectedUsage.map((u) => (
                          <li key={u.id} className="rounded-box bg-base-200/60 p-2">
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <span>
                                Qty <strong>{u.quantity_used}</strong> · {formatMoney(u.billable_amount)}
                              </span>
                              {u.work_orders?.id ? (
                                <Link
                                  href={`/work-orders/${u.work_orders.id}`}
                                  className="link link-primary text-xs"
                                >
                                  {u.work_orders.work_order_number}
                                </Link>
                              ) : null}
                            </div>
                            <p className="text-xs opacity-70">
                              {u.work_orders?.customer_id && u.work_orders.customers?.name ? (
                                <Link href={`/customers/${u.work_orders.customer_id}`} className="link link-hover">
                                  {u.work_orders.customers.name}
                                </Link>
                              ) : (
                                u.work_orders?.customers?.name ?? "Job"
                              )}
                              {u.work_orders?.assigned_technician_id
                                ? ` · ${techNames[u.work_orders.assigned_technician_id] ?? "Tech"}`
                                : ""}
                              {u.date_used ? ` · ${u.date_used}` : ""}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState title="Select a part" description="Click a row to see stock and field usage." />
              )}
            </div>
          </div>

          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="card-title text-base gap-2">
                  <Package className="h-4 w-4" /> Recent technician usage
                </h3>
                <Link href="/technician" className="btn btn-primary btn-xs gap-1">
                  <Wrench className="h-3 w-3" /> Open tech view
                </Link>
              </div>
              {recentUsage.length === 0 ? (
                <p className="text-sm opacity-60">
                  No parts logged yet. Usage appears when techs add parts on jobs.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-xs">
                    <thead>
                      <tr>
                        <th>Part</th>
                        <th>Job</th>
                        <th className="text-right">Qty</th>
                        <th>Tech</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentUsage.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <button
                              type="button"
                              className="link link-hover text-left font-medium"
                              onClick={() => setSelectedId(u.part_id)}
                            >
                              {u.parts?.name ?? "Part"}
                            </button>
                          </td>
                          <td>
                            {u.work_orders?.id ? (
                              <Link href={`/work-orders/${u.work_orders.id}`} className="link link-primary">
                                {u.work_orders.work_order_number}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="text-right">{u.quantity_used}</td>
                          <td className="max-w-[5rem] truncate text-xs">
                            {u.work_orders?.assigned_technician_id
                              ? techNames[u.work_orders.assigned_technician_id] ?? "—"
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
