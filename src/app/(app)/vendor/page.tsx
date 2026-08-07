"use client";

/**
 * Vendor portal home — profile, job offers (accept/reject), and supply orders.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatCustomerPhone } from "@/lib/technician-field";
import type {
  Profile,
  Vendor,
  VendorSupplyOrder,
  VendorSupplyOrderStatus,
  VendorWorkItem,
  VendorWorkItemStatus,
  WorkOrder,
} from "@/lib/types";
import {
  listSupplyOrdersForVendor,
  listWorkItemsForVendor,
  loadVendorById,
  updateSupplyOrderStatus,
  updateWorkItemStatus,
} from "@/lib/vendorPortal";

type AssignedJob = {
  id: string;
  work_order_number: string;
  status: string;
  priority: WorkOrder["priority"];
  scheduled_date: string | null;
  dispatch_status?: string | null;
  problem_description: string | null;
  requested_service: string | null;
  vendor_assignment_status?: WorkOrder["vendor_assignment_status"];
  customers?: { name?: string | null; phone?: string | null } | { name?: string | null; phone?: string | null }[] | null;
};

function assignedJobCustomer(job: AssignedJob) {
  const customers = job.customers;
  if (!customers) return null;
  return Array.isArray(customers) ? customers[0] ?? null : customers;
}

export default function VendorPortalPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [assignedJobs, setAssignedJobs] = useState<AssignedJob[]>([]);
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
      setAssignedJobs([]);
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

    const [vRes, jobsRes, wRes, oRes] = await Promise.all([
      loadVendorById(supabase, me.vendor_id),
      supabase
        .from("work_orders")
        .select(
          "id, work_order_number, status, priority, scheduled_date, dispatch_status, problem_description, requested_service, vendor_assignment_status, customers(name, phone)",
        )
        .eq("assigned_vendor_id", me.vendor_id)
        .not("status", "in", '("Closed","Canceled")')
        .order("scheduled_date", { ascending: true, nullsFirst: false }),
      listWorkItemsForVendor(supabase, me.vendor_id),
      listSupplyOrdersForVendor(supabase, me.vendor_id),
    ]);

    if (vRes.error || jobsRes.error || wRes.error || oRes.error) {
      setError(vRes.error ?? jobsRes.error?.message ?? wRes.error ?? oRes.error);
    }
    setVendor(vRes.data);
    setAssignedJobs((jobsRes.data as AssignedJob[]) ?? []);
    setWorkItems(wRes.data);
    setOrders(oRes.data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onJobOffer(job: AssignedJob, decision: "Accepted" | "Rejected") {
    if (!profile) return;
    setBusyId(job.id);
    setError(null);
    setMessage(null);
    const now = new Date().toISOString();
    if (decision === "Accepted") {
      const nextStatus = job.scheduled_date ? "Scheduled" : "Assigned";
      const { error: updErr } = await supabase
        .from("work_orders")
        .update({
          vendor_assignment_status: "Accepted",
          status: ["Completed", "Closed", "Canceled", "Ready for Review", "In Progress"].includes(
            job.status,
          )
            ? job.status
            : nextStatus,
          updated_at: now,
        })
        .eq("id", job.id)
        .eq("assigned_vendor_id", profile.vendor_id);
      if (updErr) {
        setError(updErr.message);
        setBusyId(null);
        return;
      }
      await logActivity(supabase, {
        userId: profile.id,
        action: "vendor_job_accepted",
        recordType: "work_order",
        recordId: job.id,
        newValue: "Accepted",
      });
      setMessage(`${job.work_order_number} accepted — open it from Jobs to start work.`);
    } else {
      const { error: updErr } = await supabase
        .from("work_orders")
        .update({
          assigned_vendor_id: null,
          vendor_assignment_status: null,
          status: ["Completed", "Closed", "Canceled", "Ready for Review", "In Progress"].includes(
            job.status,
          )
            ? job.status
            : "Requested",
          updated_at: now,
        })
        .eq("id", job.id)
        .eq("assigned_vendor_id", profile.vendor_id);
      if (updErr) {
        setError(updErr.message);
        setBusyId(null);
        return;
      }
      await logActivity(supabase, {
        userId: profile.id,
        action: "vendor_job_rejected",
        recordType: "work_order",
        recordId: job.id,
        newValue: "Rejected",
      });
      setMessage(`${job.work_order_number} rejected — returned to the service desk.`);
    }
    await load();
    setBusyId(null);
  }

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

  const pendingJobs = assignedJobs.filter((j) => j.vendor_assignment_status === "Pending");
  const acceptedJobs = assignedJobs.filter(
    (j) => j.vendor_assignment_status === "Accepted" || j.vendor_assignment_status == null,
  );
  const hasAssignedWork =
    pendingJobs.length > 0 || acceptedJobs.length > 0 || workItems.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor Home"
        description="Accept or reject job offers, then run accepted work from Jobs."
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
                <dd className="font-medium">
                  {vendor.phone?.trim() ? formatCustomerPhone(vendor.phone) : "—"}
                </dd>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="card-title text-base">Work assigned to you</h2>
            {acceptedJobs.length > 0 ? (
              <Link href="/vendor/jobs" className="link link-hover text-sm">
                View all jobs
              </Link>
            ) : null}
          </div>

          {!hasAssignedWork ? (
            <EmptyState
              title="No work assigned"
              description="When a service manager offers a work order to your company, it will show up here for accept or reject."
            />
          ) : (
            <ul className="space-y-3">
              {pendingJobs.map((job) => {
                const customer = assignedJobCustomer(job);
                const customerName = customer?.name ?? "Customer";
                const phone = customer?.phone?.trim();
                const summary =
                  job.problem_description || job.requested_service || "No description";
                return (
                  <li key={job.id} className="rounded-xl border border-warning/40 bg-warning/5 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {job.work_order_number}{" "}
                          <span className="font-normal opacity-70">· {customerName}</span>
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm opacity-70">{summary}</p>
                        <p className="mt-1 text-xs opacity-50">
                          Scheduled {job.scheduled_date ?? "—"}
                          {job.priority ? ` · ${job.priority}` : ""}
                          {phone ? ` · ${formatCustomerPhone(phone)}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge label="Pending" tone={statusTone("Pending")} />
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            className="btn btn-success btn-sm"
                            disabled={busyId === job.id}
                            onClick={() => void onJobOffer(job, "Accepted")}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="btn btn-error btn-outline btn-sm"
                            disabled={busyId === job.id}
                            onClick={() => void onJobOffer(job, "Rejected")}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}

              {acceptedJobs.map((job) => {
                const customer = assignedJobCustomer(job);
                const customerName = customer?.name ?? "Customer";
                const phone = customer?.phone?.trim();
                const summary =
                  job.problem_description || job.requested_service || "No description";
                const statusLabel = job.dispatch_status || job.status;
                return (
                  <li key={job.id} className="rounded-xl border border-base-300 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {job.work_order_number}{" "}
                          <span className="font-normal opacity-70">· {customerName}</span>
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm opacity-70">{summary}</p>
                        <p className="mt-1 text-xs opacity-50">
                          Scheduled {job.scheduled_date ?? "—"}
                          {job.priority ? ` · ${job.priority}` : ""}
                          {phone ? ` · ${formatCustomerPhone(phone)}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge label={statusLabel} tone={statusTone(statusLabel)} />
                        <Link
                          href={`/vendor/jobs?job=${job.id}`}
                          className="btn btn-primary btn-sm"
                        >
                          Open job
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}

              {workItems.map((item) => (
                <li key={item.id} className="rounded-xl border border-base-300 px-3 py-3">
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
                <li key={order.id} className="rounded-xl border border-base-300 px-3 py-3">
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
