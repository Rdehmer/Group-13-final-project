"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { formatMoney } from "@/lib/calculations";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge } from "@/components/ui";
import {
  EmergencyPurchaseReview,
  type EmergencyPurchaseReviewRow,
} from "@/components/EmergencyPurchaseReview";
import type { Profile } from "@/lib/types";

type StatusFilter = "all" | "submitted" | "reimbursed";

function techLabel(tech: EmergencyPurchaseReviewRow["technician"]) {
  if (!tech) return "Unknown technician";
  return tech.full_name?.trim() || tech.email || "Technician";
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return iso;
  }
}

/**
 * Manager inbox for technician “I bought a part” emergency store purchases.
 */
export default function EmergencyPurchasesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<EmergencyPurchaseReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewPurchase, setReviewPurchase] = useState<EmergencyPurchaseReviewRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: qErr } = await supabase
      .from("emergency_purchases")
      .select(
        `
        *,
        technician:profiles!emergency_purchases_technician_id_fkey(id, full_name, email),
        parts:parts!emergency_purchases_part_id_fkey(id, part_number, name),
        work_orders:work_orders!emergency_purchases_job_id_fkey(id, work_order_number, problem_description)
      `,
      )
      .order("purchased_at", { ascending: false });

    if (qErr) {
      const { data: flat, error: flatErr } = await supabase
        .from("emergency_purchases")
        .select("*")
        .order("purchased_at", { ascending: false });
      if (flatErr) {
        setError(flatErr.message);
        setRows([]);
        setLoading(false);
        return;
      }
      setRows((flat as EmergencyPurchaseReviewRow[]) ?? []);
    } else {
      setRows((data as EmergencyPurchaseReviewRow[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      const next = p as Profile | null;
      setProfile(next);
      if (next?.role !== "service_manager") {
        router.replace("/parts");
        return;
      }
      setReady(true);
      await load();
    })();
  }, [load, router, supabase]);

  const visible = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const submittedCount = useMemo(
    () => rows.filter((r) => r.status === "submitted").length,
    [rows],
  );
  const totalOutstanding = useMemo(
    () =>
      rows
        .filter((r) => r.status === "submitted")
        .reduce((sum, r) => sum + Number(r.amount_paid || 0), 0),
    [rows],
  );

  async function markReimbursed(row: EmergencyPurchaseReviewRow) {
    if (!profile || row.status === "reimbursed") return;
    setBusyId(row.id);
    setError(null);
    const reimbursedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("emergency_purchases")
      .update({ status: "reimbursed", reimbursed_at: reimbursedAt })
      .eq("id", row.id);
    if (updErr) {
      setError(updErr.message);
      setBusyId(null);
      return;
    }
    await logActivity(supabase, {
      userId: profile.id,
      action: "emergency_purchase_reimbursed",
      recordType: "emergency_purchase",
      recordId: row.id,
      newValue: `${row.part_name} · ${formatMoney(row.amount_paid)}`,
    });
    const updated: EmergencyPurchaseReviewRow = {
      ...row,
      status: "reimbursed",
      reimbursed_at: reimbursedAt,
    };
    setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
    setReviewPurchase((current) => (current?.id === row.id ? updated : current));
    setBusyId(null);
  }

  if (!ready || profile?.role !== "service_manager") {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  return (
    <div>
      <PageHeader
        title="Reimbursements"
        description="Emergency store purchases logged by technicians — review the full inquiry, then reimburse."
        actions={
          <Link href="/parts" className="btn btn-ghost btn-sm">
            ← Parts
          </Link>
        }
      />

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="stats stats-horizontal shadow">
          <div className="stat px-4 py-3">
            <div className="stat-title text-xs">Awaiting reimbursement</div>
            <div className="stat-value text-2xl">{submittedCount}</div>
          </div>
          <div className="stat px-4 py-3">
            <div className="stat-title text-xs">Outstanding total</div>
            <div className="stat-value text-2xl">{formatMoney(totalOutstanding)}</div>
          </div>
        </div>
        <select
          className="select select-bordered select-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="submitted">Submitted</option>
          <option value="reimbursed">Reimbursed</option>
        </select>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-24 w-full rounded-2xl" />
          <div className="skeleton h-24 w-full rounded-2xl" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No emergency purchases yet"
          description="When a technician uses Parts → I bought a part, the store purchase, job, amount, and receipt appear here."
        />
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow">
          <table className="table">
            <thead>
              <tr>
                <th>Purchased</th>
                <th>Technician</th>
                <th>Part</th>
                <th>Qty</th>
                <th>Amount</th>
                <th>Store</th>
                <th>Job</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const partNumber = row.parts?.part_number;
                const partName = row.parts?.name ?? row.part_name;
                const wo = row.work_orders;
                return (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-sm">{formatWhen(row.purchased_at)}</td>
                    <td>{techLabel(row.technician)}</td>
                    <td>
                      {partNumber ? (
                        <span className="font-medium">{partNumber}</span>
                      ) : (
                        <span className="font-medium">{row.part_name}</span>
                      )}
                      <p className="text-xs opacity-70">{partName}</p>
                    </td>
                    <td>{row.quantity}</td>
                    <td className="font-semibold">{formatMoney(row.amount_paid)}</td>
                    <td>{row.store_name}</td>
                    <td>
                      {wo ? (
                        <span>{wo.work_order_number}</span>
                      ) : (
                        <span className="opacity-60">—</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge
                        label={row.status}
                        tone={row.status === "reimbursed" ? "success" : "warning"}
                      />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="btn btn-outline btn-xs"
                          onClick={() => setReviewPurchase(row)}
                        >
                          Review
                        </button>
                        {row.status === "submitted" ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            disabled={busyId === row.id}
                            onClick={() => void markReimbursed(row)}
                          >
                            {busyId === row.id ? "Saving…" : "Mark reimbursed"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reviewPurchase ? (
        <EmergencyPurchaseReview
          purchase={reviewPurchase}
          reimbursing={busyId === reviewPurchase.id}
          onClose={() => setReviewPurchase(null)}
          onMarkReimbursed={async (purchase) => {
            await markReimbursed(purchase);
          }}
        />
      ) : null}
    </div>
  );
}
