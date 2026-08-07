"use client";

/**
 * Technician Parts hub — catalog browse, restock, emergency buy, reimbursements.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge } from "@/components/ui";
import { PurchaseOrderRequest } from "@/components/PurchaseOrderRequest";
import { EmergencyPurchaseLog } from "@/components/EmergencyPurchaseLog";
import {
  EmergencyPurchaseReview,
  type EmergencyPurchaseReviewRow,
} from "@/components/EmergencyPurchaseReview";
import { formatMoney } from "@/lib/calculations";
import type { Part, Profile, TechPartOrderRequest, WorkOrder } from "@/lib/types";

type PurchaseOrderRow = TechPartOrderRequest & {
  parts?: Pick<Part, "id" | "part_number" | "name" | "quantity_on_hand"> | null;
  vendor_supply_orders?: { id: string; status: string; item_name: string } | null;
};

type JobOption = Pick<WorkOrder, "id" | "work_order_number" | "problem_description">;

type StockFilter = "all" | "in_stock" | "low" | "out";
type ReimburseFilter = "all" | "submitted" | "reimbursed";

function isLowStock(part: Part) {
  return part.quantity_on_hand > 0 && part.quantity_on_hand <= part.reorder_level;
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

export function TechnicianPartsHub({
  profile,
  parts,
  purchaseOrders,
  emergencyPurchases,
  jobs,
  success,
  error,
  onDismissMessages,
  onReloadTechData,
}: {
  profile: Profile;
  parts: Part[];
  purchaseOrders: PurchaseOrderRow[];
  emergencyPurchases: EmergencyPurchaseReviewRow[];
  jobs: JobOption[];
  success: string | null;
  error: string | null;
  onDismissMessages: () => void;
  onReloadTechData: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [category, setCategory] = useState("all");
  const [reimburseFilter, setReimburseFilter] = useState<ReimburseFilter>("all");
  const [showPurchaseOrder, setShowPurchaseOrder] = useState(false);
  const [showEmergencyPurchase, setShowEmergencyPurchase] = useState(false);
  const [reviewPurchase, setReviewPurchase] = useState<EmergencyPurchaseReviewRow | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  const activeParts = useMemo(() => parts.filter((p) => p.is_active), [parts]);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(activeParts.map((p) => (p.category ?? "").trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [activeParts],
  );

  const stats = useMemo(() => {
    const inStock = activeParts.filter((p) => p.quantity_on_hand > 0).length;
    const low = activeParts.filter(isLowStock).length;
    const out = activeParts.filter((p) => p.quantity_on_hand <= 0).length;
    return { total: activeParts.length, inStock, low, out };
  }, [activeParts]);

  const pendingReimbursements = useMemo(
    () => emergencyPurchases.filter((p) => p.status === "submitted"),
    [emergencyPurchases],
  );

  const visiblePurchases = useMemo(() => {
    if (reimburseFilter === "all") return emergencyPurchases;
    return emergencyPurchases.filter((p) => p.status === reimburseFilter);
  }, [emergencyPurchases, reimburseFilter]);

  const listed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeParts
      .filter((p) => {
        if (category !== "all" && (p.category ?? "") !== category) return false;
        if (stockFilter === "in_stock" && p.quantity_on_hand <= 0) return false;
        if (stockFilter === "low" && !isLowStock(p)) return false;
        if (stockFilter === "out" && p.quantity_on_hand > 0) return false;
        if (!q) return true;
        return `${p.part_number} ${p.name} ${p.category ?? ""} ${p.supplier ?? ""}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => {
        const as = a.quantity_on_hand > 0 ? 0 : 1;
        const bs = b.quantity_on_hand > 0 ? 0 : 1;
        if (as !== bs) return as - bs;
        const al = isLowStock(a) ? 0 : 1;
        const bl = isLowStock(b) ? 0 : 1;
        if (al !== bl) return al - bl;
        return a.name.localeCompare(b.name);
      });
  }, [activeParts, search, stockFilter, category]);

  const flash = localSuccess ?? success;

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-8">
      <PageHeader
        title="Parts"
        description="Find stock, request restock, log emergency buys"
        actions={
          <Link href="/technician" className="btn btn-ghost btn-sm min-h-11">
            ← My Day
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-base-300 bg-base-100 px-3 py-2 text-center">
          <p className="text-lg font-bold tabular-nums">{stats.total}</p>
          <p className="text-[11px] opacity-60">Catalog</p>
        </div>
        <div className="rounded-xl border border-base-300 bg-base-100 px-3 py-2 text-center">
          <p className="text-lg font-bold tabular-nums text-success">{stats.inStock}</p>
          <p className="text-[11px] opacity-60">In stock</p>
        </div>
        <div className="rounded-xl border border-warning/40 bg-warning/5 px-3 py-2 text-center">
          <p className="text-lg font-bold tabular-nums text-warning">{stats.low}</p>
          <p className="text-[11px] opacity-60">Low</p>
        </div>
        <div className="rounded-xl border border-error/30 bg-error/5 px-3 py-2 text-center">
          <p className="text-lg font-bold tabular-nums text-error">{stats.out}</p>
          <p className="text-[11px] opacity-60">Out</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary min-h-12 flex-1 sm:flex-none"
          onClick={() => {
            onDismissMessages();
            setLocalSuccess(null);
            setShowPurchaseOrder(true);
          }}
        >
          Request restock
        </button>
        <button
          type="button"
          className="btn btn-warning min-h-12 flex-1 sm:flex-none"
          onClick={() => {
            onDismissMessages();
            setLocalSuccess(null);
            setShowEmergencyPurchase(true);
          }}
        >
          I bought a part
        </button>
      </div>

      {flash ? (
        <div role="status" className="alert alert-success">
          <span>{flash}</span>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      ) : null}

      {pendingReimbursements.length > 0 ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-semibold">
            {pendingReimbursements.length} pending reimbursement
            {pendingReimbursements.length === 1 ? "" : "s"}
          </p>
          <p className="opacity-70">
            Waiting on manager approval for store purchases you logged.
          </p>
          <button
            type="button"
            className="btn btn-warning btn-xs mt-2"
            onClick={() => setReimburseFilter("submitted")}
          >
            Show pending
          </button>
        </div>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold">
            My reimbursements
            {pendingReimbursements.length > 0 ? (
              <span className="badge badge-warning badge-sm">{pendingReimbursements.length}</span>
            ) : null}
          </h2>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Reimbursement filter">
            {(
              [
                ["all", "All"],
                ["submitted", "Pending"],
                ["reimbursed", "Accepted"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn btn-xs min-h-8 ${reimburseFilter === id ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setReimburseFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {visiblePurchases.length === 0 ? (
          <p className="text-sm opacity-60">
            {reimburseFilter === "submitted"
              ? "No pending reimbursements."
              : reimburseFilter === "reimbursed"
                ? "No accepted reimbursements yet."
                : "When you log “I bought a part”, purchases show here until and after the manager reimburses them."}
          </p>
        ) : (
          <ul className="space-y-2">
            {visiblePurchases.map((purchase) => {
              const partLabel =
                purchase.parts?.part_number != null
                  ? `${purchase.parts.part_number} — ${purchase.parts.name ?? purchase.part_name}`
                  : purchase.part_name;
              const wo = purchase.work_orders;
              return (
                <li
                  key={purchase.id}
                  className="flex flex-col gap-2 rounded-xl border border-base-300 bg-base-200/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{partLabel}</p>
                    <p className="text-sm opacity-70">
                      Qty {purchase.quantity} · {formatMoney(purchase.amount_paid)} ·{" "}
                      {purchase.store_name}
                    </p>
                    <p className="text-xs opacity-55">
                      {formatWhen(purchase.purchased_at)}
                      {wo ? ` · ${wo.work_order_number}` : ""}
                      {purchase.status === "reimbursed" && purchase.reimbursed_at
                        ? ` · Accepted ${formatWhen(purchase.reimbursed_at)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={
                        purchase.status === "reimbursed" ? "Accepted" : "Pending reimbursement"
                      }
                      tone={purchase.status === "reimbursed" ? "success" : "warning"}
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-xs min-h-9"
                      onClick={() => setReviewPurchase(purchase)}
                    >
                      Review
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {stats.low > 0 ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-semibold">{stats.low} item(s) below reorder</p>
          <p className="opacity-70">Tap Restock on a card when you need more on a job.</p>
          <button
            type="button"
            className="btn btn-warning btn-xs mt-2"
            onClick={() => setStockFilter("low")}
          >
            Show low only
          </button>
        </div>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Warehouse catalog</h2>
          <span className="text-xs opacity-50">{listed.length} shown</span>
        </div>

        <input
          className="input input-bordered min-h-12 w-full"
          placeholder="Search part #, name, category, supplier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search catalog"
        />

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stock filter">
          {(
            [
              ["all", "All"],
              ["in_stock", "In stock"],
              ["low", "Low"],
              ["out", "Out"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn btn-xs min-h-9 ${stockFilter === id ? "btn-primary" : "btn-outline"}`}
              onClick={() => setStockFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={`btn btn-xs min-h-8 ${category === "all" ? "btn-secondary" : "btn-ghost"}`}
              onClick={() => setCategory("all")}
            >
              All cats
            </button>
            {categories.slice(0, 10).map((c) => (
              <button
                key={c}
                type="button"
                className={`btn btn-xs min-h-8 ${category === c ? "btn-secondary" : "btn-ghost"}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}

        {listed.length === 0 ? (
          <EmptyState
            title={search || stockFilter !== "all" ? "No matching parts" : "No parts in catalog"}
            description={
              search || stockFilter !== "all"
                ? "Try another filter or clear the search."
                : "Ask a manager to add parts, or request a restock."
            }
          />
        ) : (
          <ul className="space-y-2">
            {listed.map((part) => {
              const low = isLowStock(part);
              const out = part.quantity_on_hand <= 0;
              return (
                <li
                  key={part.id}
                  className={`rounded-xl border px-3 py-3 ${
                    out
                      ? "border-base-200 opacity-60"
                      : low
                        ? "border-warning/40 bg-warning/5"
                        : "border-base-300 bg-base-100"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold opacity-60">
                          {part.part_number}
                        </span>
                        <StatusBadge
                          label={out ? "Out" : low ? "Low Stock" : "OK"}
                          tone={out ? "error" : low ? "warning" : "success"}
                        />
                        {part.category ? (
                          <span className="badge badge-ghost badge-xs">{part.category}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 font-semibold leading-snug">{part.name}</p>
                      <p className="text-sm opacity-70">
                        <span className="text-lg font-bold tabular-nums text-base-content">
                          {part.quantity_on_hand}
                        </span>{" "}
                        on hand
                        {part.supplier ? ` · ${part.supplier}` : ""}
                        {low ? ` · reorder at ${part.reorder_level}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm min-h-10"
                      onClick={() => {
                        onDismissMessages();
                        setLocalSuccess(null);
                        setShowPurchaseOrder(true);
                      }}
                    >
                      Restock
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-bold">
          Pending requests
          {purchaseOrders.length > 0 ? (
            <span className="badge badge-warning badge-sm">{purchaseOrders.length}</span>
          ) : null}
        </h2>
        {purchaseOrders.length === 0 ? (
          <p className="text-sm opacity-60">No open restock requests.</p>
        ) : (
          <ul className="space-y-3">
            {purchaseOrders.map((request) => (
              <li
                key={request.id}
                className="flex flex-col gap-2 rounded-xl bg-base-200 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold">
                    {request.parts?.part_number ?? "Part"} — {request.parts?.name ?? "Catalog item"}
                  </p>
                  <p className="text-sm opacity-70">
                    Qty {request.quantity_requested}
                    {request.note ? ` · ${request.note}` : ""}
                    {request.vendor_supply_orders ? (
                      <>
                        {" "}
                        · Vendor {request.vendor_supply_orders.status.toLowerCase()}
                      </>
                    ) : request.status === "approved" ? (
                      <> · Waiting on vendor / warehouse</>
                    ) : null}
                  </p>
                </div>
                <StatusBadge
                  label={request.status}
                  tone={request.status === "approved" ? "info" : "warning"}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {showPurchaseOrder ? (
        <PurchaseOrderRequest
          technicianId={profile.id}
          parts={activeParts}
          onClose={() => setShowPurchaseOrder(false)}
          onSubmitted={async () => {
            setShowPurchaseOrder(false);
            setLocalSuccess("Restock request submitted");
            await onReloadTechData();
          }}
        />
      ) : null}

      {showEmergencyPurchase ? (
        <EmergencyPurchaseLog
          technicianId={profile.id}
          parts={activeParts}
          jobs={jobs}
          onClose={() => setShowEmergencyPurchase(false)}
          onSubmitted={async () => {
            setShowEmergencyPurchase(false);
            setLocalSuccess("Emergency purchase logged — pending reimbursement");
            await onReloadTechData();
          }}
        />
      ) : null}

      {reviewPurchase ? (
        <EmergencyPurchaseReview
          purchase={reviewPurchase}
          hideTechnician
          onClose={() => setReviewPurchase(null)}
        />
      ) : null}
    </div>
  );
}
