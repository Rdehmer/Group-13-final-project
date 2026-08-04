"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ActivityRow = {
  id: string;
  action: string;
  record_type: string;
  previous_value: string | null;
  new_value: string | null;
  created_at: string;
};

/**
 * This business faces audit and unauthorized-change risk.
 * Our app reduces the risk by showing who changed important records and when.
 */
export function ActivityFeed({
  recordType,
  recordId,
}: {
  recordType: string;
  recordId: string;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<ActivityRow[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("activity_logs")
        .select("id, action, record_type, previous_value, new_value, created_at")
        .eq("record_type", recordType)
        .eq("record_id", recordId)
        .order("created_at", { ascending: false })
        .limit(20);
      setRows((data as ActivityRow[]) ?? []);
    }
    if (recordId) load();
  }, [recordType, recordId, supabase]);

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h3 className="card-title text-base">Activity history</h3>
        {rows.length === 0 ? (
          <p className="text-sm opacity-60">No activity recorded yet for this record.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="rounded-box bg-base-200/60 p-3">
                <div className="font-medium">{r.action}</div>
                <div className="opacity-70">
                  {r.previous_value ? `${r.previous_value} → ` : ""}
                  {r.new_value ?? ""}
                </div>
                <div className="text-xs opacity-50">
                  {new Date(r.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
