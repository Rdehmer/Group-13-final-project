"use client";

/**
 * Management UI: assign work needed + supply orders to a vendor.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type {
  Profile,
  VendorSupplyOrder,
  VendorSupplyOrderStatus,
  VendorWorkItem,
  VendorWorkItemStatus,
} from "@/lib/types";
import {
  VENDOR_ORDER_STATUSES,
  VENDOR_WORK_STATUSES,
  deleteSupplyOrder,
  deleteWorkItem,
  listSupplyOrdersForVendor,
  listWorkItemsForVendor,
  upsertSupplyOrder,
  upsertWorkItem,
} from "@/lib/vendorPortal";

export function VendorPortalAssignments({
  vendorId,
  profile,
  canManage,
}: {
  vendorId: string;
  profile: Profile;
  canManage: boolean;
}) {
  const supabase = createClient();
  const [workItems, setWorkItems] = useState<VendorWorkItem[]>([]);
  const [orders, setOrders] = useState<VendorSupplyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [workForm, setWorkForm] = useState({
    id: null as string | null,
    title: "",
    description: "",
    status: "Pending" as VendorWorkItemStatus,
    due_date: "",
  });
  const [orderForm, setOrderForm] = useState({
    id: null as string | null,
    item_name: "",
    quantity: "1",
    status: "Pending" as VendorSupplyOrderStatus,
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [w, o] = await Promise.all([
      listWorkItemsForVendor(supabase, vendorId),
      listSupplyOrdersForVendor(supabase, vendorId),
    ]);
    if (w.error || o.error) {
      setError(w.error ?? o.error);
      setWorkItems([]);
      setOrders([]);
    } else {
      setWorkItems(w.data);
      setOrders(o.data);
    }
    setLoading(false);
  }, [supabase, vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetWorkForm() {
    setWorkForm({
      id: null,
      title: "",
      description: "",
      status: "Pending",
      due_date: "",
    });
  }

  function resetOrderForm() {
    setOrderForm({
      id: null,
      item_name: "",
      quantity: "1",
      status: "Pending",
      notes: "",
    });
  }

  async function saveWork(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !workForm.title.trim()) return;
    setBusy(true);
    setError(null);
    const res = await upsertWorkItem(supabase, {
      id: workForm.id,
      vendor_id: vendorId,
      title: workForm.title,
      description: workForm.description,
      status: workForm.status,
      due_date: workForm.due_date || null,
      created_by: profile.id,
    });
    if (res.error) setError(res.error);
    else {
      resetWorkForm();
      await load();
    }
    setBusy(false);
  }

  async function saveOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !orderForm.item_name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await upsertSupplyOrder(supabase, {
      id: orderForm.id,
      vendor_id: vendorId,
      item_name: orderForm.item_name,
      quantity: Number(orderForm.quantity),
      status: orderForm.status,
      notes: orderForm.notes,
      created_by: profile.id,
    });
    if (res.error) setError(res.error);
    else {
      resetOrderForm();
      await load();
    }
    setBusy(false);
  }

  if (loading) {
    return <p className="text-sm opacity-50">Loading portal assignments…</p>;
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="card bg-base-100 shadow">
        <div className="card-body space-y-4">
          <h2 className="card-title text-base">Work needed</h2>
          <p className="text-sm opacity-60">
            Jobs assigned to this vendor. Vendors can accept or reject from their portal.
          </p>

          {canManage ? (
            <form onSubmit={saveWork} className="grid gap-3 rounded-xl border border-base-300 p-3 md:grid-cols-2">
              <FormRow label="Title" required>
                <input
                  className="input input-bordered w-full"
                  value={workForm.title}
                  onChange={(e) => setWorkForm((f) => ({ ...f, title: e.target.value }))}
                  required
                />
              </FormRow>
              <FormRow label="Due date">
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={workForm.due_date}
                  onChange={(e) => setWorkForm((f) => ({ ...f, due_date: e.target.value }))}
                />
              </FormRow>
              <FormRow label="Status">
                <select
                  className="select select-bordered w-full"
                  value={workForm.status}
                  onChange={(e) =>
                    setWorkForm((f) => ({
                      ...f,
                      status: e.target.value as VendorWorkItemStatus,
                    }))
                  }
                >
                  {VENDOR_WORK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Description">
                <input
                  className="input input-bordered w-full"
                  value={workForm.description}
                  onChange={(e) => setWorkForm((f) => ({ ...f, description: e.target.value }))}
                />
              </FormRow>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  {workForm.id ? "Update work item" : "Add work item"}
                </button>
                {workForm.id ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={resetWorkForm}>
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}

          {workItems.length === 0 ? (
            <EmptyState title="No work assigned" description="Add a work item for this vendor." />
          ) : (
            <ul className="space-y-2">
              {workItems.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-base-300 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{item.title}</p>
                    {item.description ? (
                      <p className="text-sm opacity-70">{item.description}</p>
                    ) : null}
                    <p className="text-xs opacity-50">
                      Due {item.due_date ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={item.status} tone={statusTone(item.status)} />
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() =>
                            setWorkForm({
                              id: item.id,
                              title: item.title,
                              description: item.description ?? "",
                              status: item.status,
                              due_date: item.due_date ?? "",
                            })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-error"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm("Delete this work item?")) return;
                            void (async () => {
                              setBusy(true);
                              const { error: delErr } = await deleteWorkItem(supabase, item.id);
                              if (delErr) setError(delErr);
                              else await load();
                              setBusy(false);
                            })();
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card bg-base-100 shadow">
        <div className="card-body space-y-4">
          <h2 className="card-title text-base">Orders needed</h2>
          <p className="text-sm opacity-60">
            Parts / supplies this vendor should fulfill. Vendors can accept or reject from their portal.
          </p>

          {canManage ? (
            <form
              onSubmit={saveOrder}
              className="grid gap-3 rounded-xl border border-base-300 p-3 md:grid-cols-2"
            >
              <FormRow label="Item / part" required>
                <input
                  className="input input-bordered w-full"
                  value={orderForm.item_name}
                  onChange={(e) => setOrderForm((f) => ({ ...f, item_name: e.target.value }))}
                  required
                />
              </FormRow>
              <FormRow label="Quantity" required>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  className="input input-bordered w-full"
                  value={orderForm.quantity}
                  onChange={(e) => setOrderForm((f) => ({ ...f, quantity: e.target.value }))}
                  required
                />
              </FormRow>
              <FormRow label="Status">
                <select
                  className="select select-bordered w-full"
                  value={orderForm.status}
                  onChange={(e) =>
                    setOrderForm((f) => ({
                      ...f,
                      status: e.target.value as VendorSupplyOrderStatus,
                    }))
                  }
                >
                  {VENDOR_ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Notes">
                <input
                  className="input input-bordered w-full"
                  value={orderForm.notes}
                  onChange={(e) => setOrderForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </FormRow>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  {orderForm.id ? "Update order" : "Add order"}
                </button>
                {orderForm.id ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={resetOrderForm}>
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}

          {orders.length === 0 ? (
            <EmptyState title="No orders assigned" description="Add a supply order for this vendor." />
          ) : (
            <ul className="space-y-2">
              {orders.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-base-300 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {order.item_name}{" "}
                      <span className="opacity-60">× {Number(order.quantity)}</span>
                    </p>
                    {order.notes ? <p className="text-sm opacity-70">{order.notes}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={order.status} tone={statusTone(order.status)} />
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() =>
                            setOrderForm({
                              id: order.id,
                              item_name: order.item_name,
                              quantity: String(order.quantity),
                              status: order.status,
                              notes: order.notes ?? "",
                            })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-error"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm("Delete this order?")) return;
                            void (async () => {
                              setBusy(true);
                              const { error: delErr } = await deleteSupplyOrder(supabase, order.id);
                              if (delErr) setError(delErr);
                              else await load();
                              setBusy(false);
                            })();
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
