"use client";

/**
 * A/P Aging Summary — filter by bucket, drill into vendor bills, export CSV.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import type { Profile, Vendor, VendorBill } from "@/lib/types";
import {
  agingBucketLabel,
  agingFilterToBucket,
  billBalance,
  billsInAgingBucket,
  buildApAgingCsv,
  buildApAgingSummary,
  downloadApAgingCsv,
  isVendorSchemaError,
  todayIso,
  type AgingBucket,
  type AgingFilterKey,
  type VendorAgingRow,
} from "@/lib/vendors";

const ALLOWED_ROLES = new Set(["administrator", "service_manager", "billing"]);

type AgingFilter = AgingFilterKey | null;

type DrillTarget = {
  vendorId: string;
  vendorName: string;
  bucket: AgingBucket | null;
};

const BUCKETS: {
  key: AgingFilterKey;
  label: string;
  amountKey: keyof Pick<VendorAgingRow, "current" | "d1_30" | "d31_60" | "d61_plus" | "total">;
  chipClass: string;
}[] = [
  {
    key: "current",
    label: "Current",
    amountKey: "current",
    chipClass: "border-base-300 bg-base-100",
  },
  {
    key: "d1_30",
    label: "1–30 days",
    amountKey: "d1_30",
    chipClass: "border-base-300 bg-base-100",
  },
  {
    key: "d31_60",
    label: "31–60 days",
    amountKey: "d31_60",
    chipClass: "border-warning/40 bg-warning/5",
  },
  {
    key: "d61_plus",
    label: "61+ days",
    amountKey: "d61_plus",
    chipClass: "border-error/30 bg-error/5",
  },
  {
    key: "total",
    label: "Total",
    amountKey: "total",
    chipClass: "border-base-300 bg-base-100",
  },
];

function rowMatchesFilter(row: VendorAgingRow, filter: AgingFilter): boolean {
  if (!filter || filter === "total") return row.total > 0;
  return row[filter] > 0;
}

function headerButtonClass(active: boolean) {
  const base = "w-full text-right font-semibold underline-offset-2 hover:underline";
  return active ? `${base} text-primary` : `${base} opacity-80 hover:opacity-100`;
}

function cellButtonClass(activeColumn: boolean, hasAmount: boolean) {
  const base = "w-full text-right tabular-nums rounded px-1 py-0.5";
  if (!hasAmount) return `${base} opacity-40 cursor-default`;
  if (activeColumn) return `${base} font-semibold text-primary hover:bg-primary/10`;
  return `${base} hover:bg-base-200`;
}

export default function ApAgingPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<VendorBill[]>([]);
  const [asOf, setAsOf] = useState(todayIso());
  const [filter, setFilter] = useState<AgingFilter>(null);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
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
    setProfile((prof as Profile) ?? null);

    const [{ data: vendorRows, error: vendorError }, { data: billRows, error: billError }] =
      await Promise.all([
        supabase.from("vendors").select("id, name, approval_status, is_active").order("name"),
        supabase
          .from("vendor_bills")
          .select("id, vendor_id, bill_number, bill_date, due_date, amount, amount_paid, status, memo")
          .neq("status", "Void"),
      ]);

    if (vendorError || billError) {
      const msg = vendorError?.message ?? billError?.message ?? "Failed to load aging.";
      setError(
        isVendorSchemaError(msg)
          ? "Vendor tables are not set up yet. Run supabase/migrations/20260806_vendors_ap.sql in Supabase."
          : msg,
      );
      setVendors([]);
      setBills([]);
    } else {
      const approved = ((vendorRows as Vendor[]) ?? []).filter(
        (v) => (v.approval_status ?? "Approved") === "Approved",
      );
      setVendors(approved);
      setBills((billRows as VendorBill[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const summary = useMemo(
    () => buildApAgingSummary(vendors, bills, asOf),
    [vendors, bills, asOf],
  );

  const filteredRows = useMemo(
    () => summary.rows.filter((row) => rowMatchesFilter(row, filter)),
    [summary.rows, filter],
  );

  const filteredTotals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => ({
        current: acc.current + r.current,
        d1_30: acc.d1_30 + r.d1_30,
        d31_60: acc.d31_60 + r.d31_60,
        d61_plus: acc.d61_plus + r.d61_plus,
        total: acc.total + r.total,
      }),
      { current: 0, d1_30: 0, d31_60: 0, d61_plus: 0, total: 0 },
    );
  }, [filteredRows]);

  const drillBills = useMemo(() => {
    if (!drill) return [];
    const vendorBills = bills.filter((b) => b.vendor_id === drill.vendorId);
    return billsInAgingBucket(vendorBills, drill.bucket, asOf);
  }, [drill, bills, asOf]);

  function toggleFilter(key: AgingFilterKey) {
    setFilter((prev) => {
      if (key === "total") return null;
      return prev === key ? null : key;
    });
  }

  function openDrill(row: VendorAgingRow, column: AgingFilterKey) {
    const amount =
      column === "current"
        ? row.current
        : column === "d1_30"
          ? row.d1_30
          : column === "d31_60"
            ? row.d31_60
            : column === "d61_plus"
              ? row.d61_plus
              : row.total;
    if (amount <= 0) return;
    setDrill({
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      bucket: agingFilterToBucket(column === "total" ? null : column),
    });
  }

  function exportCsv() {
    const label =
      filter && filter !== "total"
        ? BUCKETS.find((b) => b.key === filter)?.label ?? "Filtered"
        : "All";
    const csv = buildApAgingCsv(filteredRows, asOf, label);
    downloadApAgingCsv(`ap-aging-${asOf}.csv`, csv);
  }

  const activeLabel =
    filter && filter !== "total"
      ? BUCKETS.find((b) => b.key === filter)?.label ?? null
      : null;

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading A/P aging…</div>;
  }

  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return (
      <EmptyState
        title="A/P Aging unavailable"
        description="Only administrators, service managers, and billing can view this report."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="A/P Aging Summary"
        description={
          activeLabel
            ? `Supplier payables · ${activeLabel} only · as of ${asOf}`
            : `Open supplier payables by age as of ${asOf}`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/vendors" className="btn btn-ghost btn-sm">
              ← Suppliers
            </Link>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={exportCsv}
              disabled={filteredRows.length === 0}
            >
              Export CSV
            </button>
          </div>
        }
      />

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="form-control">
          <span className="label-text text-xs opacity-70">As of date</span>
          <input
            type="date"
            className="input input-bordered input-sm"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value || todayIso())}
          />
        </label>
        <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Filter by aging bucket">
          {BUCKETS.map((bucket) => {
            const active = filter === bucket.key || (bucket.key === "total" && filter === null);
            const amount = summary.totals[bucket.amountKey];
            return (
              <button
                key={bucket.key}
                type="button"
                onClick={() => toggleFilter(bucket.key)}
                aria-pressed={active}
                className={`rounded-lg border px-3 py-2 text-left transition ${bucket.chipClass} ${
                  active ? "ring-2 ring-primary ring-offset-1 ring-offset-base-200" : "hover:opacity-90"
                }`}
              >
                {bucket.label}{" "}
                <strong
                  className={`tabular-nums ${bucket.key === "d61_plus" ? "text-error" : ""}`}
                >
                  {formatMoney(amount)}
                </strong>
              </button>
            );
          })}
        </div>
        {activeLabel ? (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setFilter(null)}>
            Clear filter
          </button>
        ) : null}
      </div>

      <p className="mb-3 text-xs opacity-60">
        Click a header to filter. Click a dollar amount to see that vendor&apos;s bills in the bucket.
      </p>

      {summary.rows.length === 0 ? (
        <EmptyState
          title="No open payables"
          description="Enter vendor bills with an unpaid balance to see aging buckets."
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          title={`No vendors in ${activeLabel ?? "this bucket"}`}
          description="Choose another bucket or clear the filter."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Supplier</th>
                {BUCKETS.map((bucket) => {
                  const active =
                    filter === bucket.key || (bucket.key === "total" && filter === null);
                  return (
                    <th key={bucket.key} className="text-right">
                      <button
                        type="button"
                        className={headerButtonClass(active)}
                        onClick={() => toggleFilter(bucket.key)}
                        aria-pressed={active}
                      >
                        {bucket.label}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.vendorId} className="hover">
                  <td>
                    <Link href={`/vendors/${row.vendorId}`} className="link link-hover font-medium">
                      {row.vendorName}
                    </Link>
                  </td>
                  {(
                    [
                      ["current", row.current],
                      ["d1_30", row.d1_30],
                      ["d31_60", row.d31_60],
                      ["d61_plus", row.d61_plus],
                      ["total", row.total],
                    ] as const
                  ).map(([col, amount]) => (
                    <td key={col} className="text-right">
                      <button
                        type="button"
                        className={cellButtonClass(filter === col, amount > 0)}
                        disabled={amount <= 0}
                        onClick={() => openDrill(row, col)}
                        title={
                          amount > 0
                            ? `View ${row.vendorName} bills — ${BUCKETS.find((b) => b.key === col)?.label}`
                            : undefined
                        }
                      >
                        {formatMoney(amount)}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>{activeLabel ? `Total (${activeLabel})` : "Total"}</td>
                <td className="text-right tabular-nums">{formatMoney(filteredTotals.current)}</td>
                <td className="text-right tabular-nums">{formatMoney(filteredTotals.d1_30)}</td>
                <td className="text-right tabular-nums">{formatMoney(filteredTotals.d31_60)}</td>
                <td className="text-right tabular-nums">{formatMoney(filteredTotals.d61_plus)}</td>
                <td className="text-right tabular-nums">{formatMoney(filteredTotals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {drill ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h2 className="text-xl font-bold">{drill.vendorName}</h2>
            <p className="text-sm opacity-70">
              {agingBucketLabel(drill.bucket)} · as of {asOf}
            </p>
            {drillBills.length === 0 ? (
              <p className="mt-4 text-sm opacity-60">No open bills in this bucket.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Bill #</th>
                      <th>Bill date</th>
                      <th>Due</th>
                      <th className="text-right">Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillBills.map((bill) => (
                      <tr key={bill.id}>
                        <td className="font-medium">{bill.bill_number}</td>
                        <td>{bill.bill_date}</td>
                        <td>{bill.due_date}</td>
                        <td className="text-right tabular-nums">
                          {formatMoney(billBalance(bill))}
                        </td>
                        <td>
                          <StatusBadge label={bill.status} tone={statusTone(bill.status)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setDrill(null)}>
                Close
              </button>
              <Link href={`/vendors/${drill.vendorId}`} className="btn btn-primary">
                Open vendor
              </Link>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setDrill(null)}>
              close
            </button>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
