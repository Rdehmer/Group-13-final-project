"use client";

/**
 * Collapsible audit trail from activity_logs for a single record.
 * Default collapsed so detail pages stay clean; expand to inspect who/what/when.
 */

import { useEffect, useState } from "react";
import { ChevronDown, History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ActivityRow = {
  id: string;
  action: string;
  record_type: string;
  previous_value: string | null;
  new_value: string | null;
  created_at: string;
  user_id?: string | null;
  profiles?: { full_name?: string | null; email?: string | null } | null;
};

function actorLabel(row: ActivityRow): string {
  const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return p?.full_name?.trim() || p?.email?.trim() || "System / unknown";
}

function formatAction(action: string): string {
  return action.replace(/_/g, " ");
}

type Props = {
  recordType: string;
  recordId: string;
  /** When true, panel starts expanded. Default: collapsed. */
  defaultOpen?: boolean;
  title?: string;
  className?: string;
  limit?: number;
};

/**
 * This business faces audit and unauthorized-change risk.
 * Our app reduces the risk by showing who changed important records and when.
 */
export function ActivityFeed({
  recordType,
  recordId,
  defaultOpen = false,
  title = "Audit trail",
  className = "",
  limit = 40,
}: Props) {
  const supabase = createClient();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!recordId) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      // Prefer join for actor name; fall back if RLS/relationship blocks it.
      let data: ActivityRow[] | null = null;
      const rich = await supabase
        .from("activity_logs")
        .select(
          "id, action, record_type, previous_value, new_value, created_at, user_id, profiles(full_name, email)",
        )
        .eq("record_type", recordType)
        .eq("record_id", recordId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!rich.error && rich.data) {
        data = rich.data as ActivityRow[];
      } else {
        const plain = await supabase
          .from("activity_logs")
          .select("id, action, record_type, previous_value, new_value, created_at, user_id")
          .eq("record_type", recordType)
          .eq("record_id", recordId)
          .order("created_at", { ascending: false })
          .limit(limit);
        data = (plain.data as ActivityRow[]) ?? [];
      }
      if (!cancelled) {
        setRows(data ?? []);
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- client is stable for this session
  }, [recordType, recordId, limit]);

  const countLabel = loading ? "…" : String(rows.length);

  return (
    <div className={`card bg-base-100 shadow ${className}`.trim()}>
      <div className="card-body gap-0 p-0">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="flex min-w-0 items-center gap-2">
            <History className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
            <span>
              <span className="font-semibold">{title}</span>
              <span className="ml-2 text-xs font-normal opacity-50">
                {countLabel} event{rows.length === 1 ? "" : "s"}
              </span>
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 opacity-50 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>

        {open ? (
          <div className="border-t border-base-200 px-4 py-3 sm:px-5">
            {loading ? (
              <p className="text-sm opacity-60">Loading audit trail…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm opacity-60">No activity recorded yet for this record.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-box border border-base-200 bg-base-200/40 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 font-medium capitalize">{formatAction(r.action)}</div>
                      <time
                        className="shrink-0 text-xs opacity-50"
                        dateTime={r.created_at}
                      >
                        {new Date(r.created_at).toLocaleString()}
                      </time>
                    </div>
                    <p className="mt-0.5 text-xs opacity-60">{actorLabel(r)}</p>
                    {(r.previous_value || r.new_value) && (
                      <p className="mt-1 break-words text-xs opacity-80">
                        {r.previous_value ? (
                          <>
                            <span className="opacity-50">{r.previous_value}</span>
                            {" → "}
                          </>
                        ) : null}
                        <span>{r.new_value ?? "—"}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
