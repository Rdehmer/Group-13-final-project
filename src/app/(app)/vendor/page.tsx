"use client";

/**
 * Vendor portal home — read-only profile + accept/reject for work/orders.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type {
  Profile,
  Vendor,
  VendorSupplyOrder,
  VendorSupplyOrderStatus,
  VendorWorkItem,
  VendorWorkItemStatus,
} from "@/lib/types";
import {
  listSupplyOrdersForVendor,
  listWorkItemsForVendor,
  loadVendorById,
  updateSupplyOrderStatus,
  updateWorkItemStatus,
} from "@/lib/vendorPortal";

export default function VendorPortalPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [workItems, setWorkItems] = useState<VendorWorkItem[]>([]);
  const [orders, setOrders] = useState<VendorSupplyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    const me = prof as Profile | null;
    setProfile(me);

    if (!me || me.role !== "vendor" || !me.vendor_id) {
      setVendor(null);
      setWorkItems([]);
      setOrders([]);
      setError(
        !me
          ? "Profile not found."
          : me.role !== "vendor"
            ? "This page is for vendor accounts."
            : "Your account is not linked to a vendor profile. Ask an administrator to set vendor_id.",
      );
      setLoading(false);
      return;
    }

    const [vRes, wRes, oRes] = await Promise.all([
      loadVendorById(supabase, me.vendor_id),
      listWorkItemsForVendor(supabase, me.vendor_id),
      listSupplyOrdersForVendor(supabase, me.vendor_id),
    ]);

    if (vRes.error || wRes.error || oRes.error) {
      setError(vRes.error ?? wRes.error ?? oRes.error);
    }
    setVendor(vRes.data);
    setWorkItems(wRes.data);
    setOrders(oRes.data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onWorkResponse(id: string, status: VendorWorkItemStatus) {
    setBusyId(id);
    setError(null);
    setMessage(null);
    const { error: updErr } = await updateWorkItemStatus(supabase, id, status);
    if (updErr) setError(updErr);
    else {
      setMessage(status === "Accepted" ? "Work accepted." : "Work rejected.");
      await load();
    }
    setBusyId(null);
  }

  async function onOrderResponse(id: string, status: VendorSupplyOrderStatus) {
    setBusyId(id);
    setError(null);
    setMessage(null);
    const { error: updErr } = await updateSupplyOrderStatus(supabase, id, status);
    if (updErr) setError(updErr);
    else {
      setMessage(status === "Accepted" ? "Order accepted." : "Order rejected.");
      await load();
    }
    setBusyId(null);
  }

  if (loading) {
    return <p className="p-8 text-center text-sm opacity-50">Loading vendor portal…</p>;
  }

  if (profile && profile.role !== "vendor") {
    return (
      <p className="p-8 text-center text-sm opacity-60">
        This page is for vendor logins. Switch to the Vendor demo persona or use a vendor account.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor Home"
        description="View your profile and accept or reject assigned work and supply orders."
      />

      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      ) : null}
      {message ? (
        <div className="alert alert-success text-sm">
          <span>{message}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {vendor ? (
        <section className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title text-base">Your profile</h2>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="opacity-60">Company</dt>
                <dd className="font-medium">{vendor.name}</dd>
              </div>
              <div>
                <dt className="opacity-60">Specialty</dt>
                <dd className="font-medium">{vendor.specialty ?? "—"}</dd>
              </div>
              <div>
                <dt className="opacity-60">Contact</dt>
                <dd className="font-medium">{vendor.contact_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="opacity-60">Email</dt>
                <dd className="font-medium">{vendor.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="opacity-60">Phone</dt>
                <dd className="font-medium">{vendor.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="opacity-60">Address</dt>
                <dd className="font-medium">
                  {[vendor.address_line1, vendor.city, vendor.state, vendor.postal_code]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      ) : null}

      <section className="card bg-base-100 shadow">
        <div className="card-body space-y-3">
          <h2 className="card-title text-base">Work assigned to you</h2>
          {workItems.length === 0 ? (
            <EmptyState title="No work items" description="Management has not assigned work yet." />
          ) : (
            <ul className="space-y-3">
              {workItems.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-base-300 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{item.title}</p>
                      {item.description ? (
                        <p className="mt-1 text-sm opacity-70">{item.description}</p>
                      ) : null}
                      <p className="mt-1 text-xs opacity-50">Due {item.due_date ?? "—"}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge label={item.status} tone={statusTone(item.status)} />
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="btn btn-success btn-sm"
                          disabled={busyId === item.id || item.status === "Accepted"}
                          onClick={() => void onWorkResponse(item.id, "Accepted")}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn btn-error btn-outline btn-sm"
                          disabled={busyId === item.id || item.status === "Rejected"}
                          onClick={() => void onWorkResponse(item.id, "Rejected")}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card bg-base-100 shadow">
        <div className="card-body space-y-3">
          <h2 className="card-title text-base">Orders assigned to you</h2>
          {orders.length === 0 ? (
            <EmptyState title="No orders" description="Management has not assigned supply orders yet." />
          ) : (
            <ul className="space-y-3">
              {orders.map((order) => (
                <li
                  key={order.id}
                  className="rounded-xl border border-base-300 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {order.item_name}{" "}
                        <span className="font-normal opacity-60">× {Number(order.quantity)}</span>
                      </p>
                      {order.notes ? (
                        <p className="mt-1 text-sm opacity-70">{order.notes}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge label={order.status} tone={statusTone(order.status)} />
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="btn btn-success btn-sm"
                          disabled={busyId === order.id || order.status === "Accepted"}
                          onClick={() => void onOrderResponse(order.id, "Accepted")}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn btn-error btn-outline btn-sm"
                          disabled={busyId === order.id || order.status === "Rejected"}
                          onClick={() => void onOrderResponse(order.id, "Rejected")}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
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
