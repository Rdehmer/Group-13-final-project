"use client";

/**
 * Risk Controls — manager audit of create / approve parts / release billing.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge } from "@/components/ui";
import {
  RISK_CONTROL_CATEGORIES,
  allRiskControlActions,
  formatRiskAction,
  matchRiskControlCategory,
  recordHref,
  recordTypeLabel,
  riskControlActorLabel,
  riskControlSummary,
  type RiskControlActivityRow,
  type RiskControlCategoryId,
} from "@/lib/risk-controls";
import type { Profile } from "@/lib/types";
import { profileHasModule } from "@/lib/employeePermissions";

type TabFilter = "all" | RiskControlCategoryId;

function categoryTone(
  id: RiskControlCategoryId,
): "info" | "warning" | "success" {
  if (id === "work_order_creation") return "info";
  if (id === "parts_approvals") return "warning";
  return "success";
}

function categoryLabel(id: RiskControlCategoryId): string {
  return RISK_CONTROL_CATEGORIES.find((c) => c.id === id)?.shortLabel ?? id;
}

export default function RiskControlsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [rows, setRows] = useState<RiskControlActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");
  const [explainOpen, setExplainOpen] = useState(true);
  const limit = 150;

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setProfile(null);
        setAuthReady(true);
        return;
      }
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile((data as Profile) ?? null);
      setAuthReady(true);
    })();
  }, [supabase]);

  const allowed = profile ? profileHasModule(profile, "risk_controls") : false;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const actions = allRiskControlActions();

    let data: RiskControlActivityRow[] | null = null;
    const rich = await supabase
      .from("activity_logs")
      .select(
        "id, action, record_type, record_id, previous_value, new_value, created_at, user_id, profiles(full_name, email)",
      )
      .in("action", actions)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!rich.error && rich.data) {
      data = rich.data as RiskControlActivityRow[];
    } else {
      const plain = await supabase
        .from("activity_logs")
        .select(
          "id, action, record_type, record_id, previous_value, new_value, created_at, user_id",
        )
        .in("action", actions)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (plain.error) {
        setError(plain.error.message);
        data = [];
      } else {
        data = (plain.data as RiskControlActivityRow[]) ?? [];
      }
    }

    const matched = (data ?? []).filter((r) => matchRiskControlCategory(r) != null);
    setRows(matched);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!authReady) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    void load();
  }, [authReady, allowed, load]);

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    return rows.filter((r) => matchRiskControlCategory(r) === tab);
  }, [rows, tab]);

  const counts = useMemo(() => {
    const c: Record<TabFilter, number> = {
      all: rows.length,
      work_order_creation: 0,
      parts_approvals: 0,
      billing_releases: 0,
    };
    for (const r of rows) {
      const id = matchRiskControlCategory(r);
      if (id) c[id] += 1;
    }
    return c;
  }, [rows]);

  if (!authReady) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Risk Controls"
          description="Internal audit of create, approve, and bill events"
        />
        <EmptyState
          title="Access restricted"
          description="Risk Controls is available to administrators and service managers only."
          action={
            <Link href="/dashboard" className="btn btn-outline btn-sm">
              Back to dashboard
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Risk Controls"
        description="Who created work orders, approved extra parts, and authorized billing releases"
        actions={
          <div className="flex flex-wrap gap-2">
            {profile?.role === "administrator" ? (
              <Link href="/settings" className="btn btn-outline btn-sm gap-1">
                <ArrowLeft className="h-4 w-4" /> Settings
              </Link>
            ) : null}
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        }
      />

      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-0 p-0">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
            onClick={() => setExplainOpen((v) => !v)}
            aria-expanded={explainOpen}
          >
            <span className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-[#00a3a6]" aria-hidden />
              <span className="font-semibold text-[#1e2a36]">
                SOX-style segregation of duties
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 opacity-50 transition-transform ${explainOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {explainOpen ? (
            <div className="border-t border-base-200 px-4 py-3 text-sm leading-relaxed text-[#5c6b7a] sm:px-5">
              <p>
                This view demonstrates internal risk controls: separating{" "}
                <strong className="font-semibold text-[#1e2a36]">who creates</strong> work,
                <strong className="font-semibold text-[#1e2a36]"> who approves</strong> extra
                parts, and <strong className="font-semibold text-[#1e2a36]">who releases</strong>{" "}
                billing. Events come from the activity log — each row shows actor, timestamp, and
                a link to the related record when available.
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                {RISK_CONTROL_CATEGORIES.map((cat) => (
                  <li
                    key={cat.id}
                    className="rounded-box border border-base-200 bg-base-200/40 p-3"
                  >
                    <p className="font-medium text-[#1e2a36]">{cat.label}</p>
                    <p className="mt-1 text-xs opacity-80">{cat.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Risk control filters">
        {(
          [
            ["all", "All events"],
            ["work_order_creation", "Work order creation"],
            ["parts_approvals", "Parts approvals"],
            ["billing_releases", "Billing releases"],
          ] as const
        ).map(([id, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`btn btn-sm ${active ? "btn-primary" : "btn-outline"}`}
              onClick={() => setTab(id)}
            >
              {label}
              <span className="badge badge-sm ml-1 opacity-80">{counts[id]}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-sm opacity-60">Loading control events…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No control events yet"
          description="When staff create work orders, approve extra parts, or release invoices to customers, those actions appear here automatically."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#dce3ea] bg-white shadow-[0_1px_2px_rgba(30,42,54,0.04)]">
          <table className="table table-sm">
            <thead>
              <tr className="text-xs text-[#5c6b7a]">
                <th>When</th>
                <th>Actor</th>
                <th>Control</th>
                <th>Action</th>
                <th>Record</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const cat = matchRiskControlCategory(r);
                const href = recordHref(r.record_type, r.record_id);
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap text-xs opacity-70">
                      <time dateTime={r.created_at}>
                        {new Date(r.created_at).toLocaleString()}
                      </time>
                    </td>
                    <td className="max-w-[10rem] text-sm font-medium text-[#1e2a36]">
                      {riskControlActorLabel(r)}
                    </td>
                    <td>
                      {cat ? (
                        <StatusBadge label={categoryLabel(cat)} tone={categoryTone(cat)} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="capitalize text-sm">{formatRiskAction(r.action)}</td>
                    <td className="text-sm">
                      {href ? (
                        <Link
                          href={href}
                          className="inline-flex items-center gap-1 text-[#007a7c] hover:underline"
                        >
                          {recordTypeLabel(r.record_type)}
                          <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
                        </Link>
                      ) : (
                        <span className="opacity-70">{recordTypeLabel(r.record_type)}</span>
                      )}
                    </td>
                    <td className="max-w-xs break-words text-xs text-[#5c6b7a]">
                      {riskControlSummary(r)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
