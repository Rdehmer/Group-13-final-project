"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, format, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Profile } from "@/lib/types";
import {
  CATEGORY_STYLES,
  DAY_END_HOUR,
  DAY_START_HOUR,
  DAY_TIMELINE_MIN_LANES,
  HOUR_WIDTH,
  customerName,
  markConflicts,
  minutesToLabel,
  techName,
  withDerivedTimes,
  type ScheduleWo,
  type TimedWo,
} from "@/lib/technician-schedule";
import { useLiveReload } from "@/components/LiveDataRefresh";

/**
 * Read-only day timeline for managers — mirrors Technician Schedule day view, simplified for Overview.
 */

const BUBBLE_ROW = 44;

function isCanceledStatus(status: string | null | undefined): boolean {
  return (status ?? "").toLowerCase().includes("cancel");
}

function scheduledDateKey(value: string | null | undefined): string {
  if (!value) return "";
  // Accept date, timestamptz, or ISO strings ("2026-08-04", "2026-08-04T00:00:00...")
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s.slice(0, 10);
}

export function ManagerDaySchedule() {
  const supabase = useMemo(() => createClient(), []);
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [orders, setOrders] = useState<TimedWo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dayKey = format(selectedDay, "yyyy-MM-dd");
  const isToday = format(startOfDay(new Date()), "yyyy-MM-dd") === dayKey;

  const loadDay = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Same query shape as Technician Schedule (which loads successfully for managers).
      // Prefer simple select; fall back without join; never rely on optional columns.
      let rows: ScheduleWo[] = [];

      const primary = await supabase
        .from("work_orders")
        .select("*, customers(id, name)")
        .order("scheduled_date", { ascending: true });

      if (!primary.error && primary.data) {
        rows = primary.data as ScheduleWo[];
      } else {
        const bare = await supabase
          .from("work_orders")
          .select("*")
          .order("scheduled_date", { ascending: true });

        if (bare.error) {
          // Last resort: no order clause
          const raw = await supabase.from("work_orders").select("*");
          if (raw.error) {
            setError(raw.error.message || primary.error?.message || "Failed to load work orders");
            setOrders([]);
            setLoading(false);
            return;
          }
          rows = (raw.data as ScheduleWo[]) ?? [];
        } else {
          rows = (bare.data as ScheduleWo[]) ?? [];
        }
      }

      const dayRows = rows.filter(
        (wo) => !isCanceledStatus(wo.status) && scheduledDateKey(wo.scheduled_date) === dayKey,
      );

      const techIds = Array.from(
        new Set(
          dayRows
            .map((r) => r.assigned_technician_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );
      const techMap: Record<string, Profile> = {};
      if (techIds.length > 0) {
        const { data: techs } = await supabase.from("profiles").select("*").in("id", techIds);
        for (const t of (techs as Profile[]) ?? []) techMap[t.id] = t;
      }

      const hydrated = dayRows.map((r) => ({
        ...r,
        technician: r.assigned_technician_id ? techMap[r.assigned_technician_id] ?? null : null,
      }));

      setOrders(markConflicts(hydrated.map(withDerivedTimes)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load schedule");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [dayKey, supabase]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  useLiveReload(loadDay, 40_000);

  const timeline = useMemo(() => {
    let minMin = DAY_START_HOUR * 60;
    let maxMin = DAY_END_HOUR * 60;
    for (const wo of orders) {
      minMin = Math.min(minMin, wo.startMinutes);
      maxMin = Math.max(maxMin, wo.endMinutes);
    }
    const rangeStartMin = Math.max(0, Math.floor(minMin / 60) * 60);
    let rangeEndMin = Math.min(24 * 60, Math.ceil(maxMin / 60) * 60);
    if (rangeEndMin <= rangeStartMin) rangeEndMin = rangeStartMin + 60;

    const hours: number[] = [];
    for (let h = Math.floor(rangeStartMin / 60); h < Math.ceil(rangeEndMin / 60); h++) {
      hours.push(h);
    }

    const sorted = [...orders].sort(
      (a, b) =>
        a.startMinutes - b.startMinutes ||
        a.endMinutes - b.endMinutes ||
        a.work_order_number.localeCompare(b.work_order_number),
    );
    const laneEnds: number[] = [];
    const placed: { wo: TimedWo; lane: number }[] = [];
    for (const wo of sorted) {
      let lane = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= wo.startMinutes) {
          lane = i;
          break;
        }
      }
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(wo.endMinutes);
      } else {
        laneEnds[lane] = wo.endMinutes;
      }
      placed.push({ wo, lane });
    }

    const laneCount = Math.max(laneEnds.length, DAY_TIMELINE_MIN_LANES, 1);
    const bodyHeight = Math.max(140, 12 + laneCount * BUBBLE_ROW);
    const timelineWidth = Math.max(
      ((rangeEndMin - rangeStartMin) / 60) * HOUR_WIDTH,
      HOUR_WIDTH * 6,
    );

    return {
      hours,
      rangeStartMin,
      rangeEndMin,
      placed,
      laneCount,
      bodyHeight,
      timelineWidth,
    };
  }, [orders]);

  const completedCount = orders.filter((o) => o.category === "completed").length;
  const openCount = orders.length - completedCount;
  const conflictCount = orders.filter((o) => o.hasConflict).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold leading-tight">Daily Schedule</h2>
          <p className="text-xs text-base-content/55">
            {isToday ? "Today's work orders" : "Work orders for this day"} · opens Technician day calendar
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Link
            href={`/technician?day=${dayKey}#day-calendar`}
            className="btn btn-primary btn-xs"
          >
            Day calendar
          </Link>
          <Link href="/technician" className="btn btn-ghost btn-xs">
            Full schedule
          </Link>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-square"
          aria-label="Previous day"
          onClick={() => setSelectedDay((d) => addDays(d, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[9.5rem] text-center text-sm font-semibold">
          {format(selectedDay, "EEE, MMM d")}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-square"
          aria-label="Next day"
          onClick={() => setSelectedDay((d) => addDays(d, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setSelectedDay(startOfDay(new Date()))}
        >
          Today
        </button>
      </div>

      {!loading && !error ? (
        <div className="flex shrink-0 flex-wrap gap-2 text-xs">
          <span className="badge badge-ghost badge-sm tabular-nums">{orders.length} total</span>
          <span className="badge badge-ghost badge-sm tabular-nums">{openCount} open</span>
          {completedCount > 0 ? (
            <span className="badge badge-success badge-sm tabular-nums">{completedCount} done</span>
          ) : null}
          {conflictCount > 0 ? (
            <span className="badge badge-error badge-sm tabular-nums">{conflictCount} conflict</span>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {error ? (
          <EmptyState
            title="Could not load schedule"
            description={error}
            action={
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void loadDay()}>
                Retry
              </button>
            }
          />
        ) : loading ? (
          <div className="space-y-2">
            <div className="skeleton h-8 w-full" />
            <div className="skeleton h-32 w-full" />
            <div className="skeleton h-16 w-full" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="min-h-0 shrink-0 overflow-x-auto rounded-xl border border-base-300/80">
              <div
                className="relative"
                style={{ width: timeline.timelineWidth + 8, minWidth: "100%" }}
              >
                <div className="relative h-7 border-b border-base-300 bg-base-200/50">
                  {timeline.hours.map((h) => (
                    <div
                      key={h}
                      className="absolute top-0 border-l border-base-300/70 pl-1 pt-1 text-[10px] opacity-60"
                      style={{
                        left: ((h * 60 - timeline.rangeStartMin) / 60) * HOUR_WIDTH,
                        width: HOUR_WIDTH,
                      }}
                    >
                      {minutesToLabel(h * 60)}
                    </div>
                  ))}
                </div>
                <div
                  className="relative bg-base-100"
                  style={{ height: timeline.bodyHeight, width: timeline.timelineWidth }}
                >
                  {timeline.hours.map((h) => (
                    <div
                      key={h}
                      className="absolute bottom-0 top-0 border-l border-base-300/40"
                      style={{ left: ((h * 60 - timeline.rangeStartMin) / 60) * HOUR_WIDTH }}
                    />
                  ))}
                  {timeline.placed.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-base-content/50">
                      No work orders scheduled this day
                    </div>
                  ) : (
                    timeline.placed.map(({ wo, lane }) => {
                      const left =
                        ((wo.startMinutes - timeline.rangeStartMin) / 60) * HOUR_WIDTH + lane * 8;
                      const width = Math.max(
                        ((wo.endMinutes - wo.startMinutes) / 60) * HOUR_WIDTH - 4,
                        HOUR_WIDTH * 0.5,
                      );
                      const style = CATEGORY_STYLES[wo.category];
                      return (
                        <div
                          key={wo.id}
                          className="absolute z-10"
                          style={{
                            left,
                            width,
                            top: 8 + lane * BUBBLE_ROW,
                            height: BUBBLE_ROW - 8,
                          }}
                        >
                          <Link
                            href={`/technician?day=${dayKey}&wo=${wo.id}#day-calendar`}
                            className={`block h-full w-full overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${style.block} ${
                              wo.hasConflict ? "ring-2 ring-error ring-offset-1" : ""
                            }`}
                            title={`${wo.work_order_number} · ${wo.startLabel}–${wo.endLabel} · ${techName(wo)} · ${wo.status}`}
                          >
                            <span className="block truncate text-[11px] font-semibold leading-tight">
                              {wo.work_order_number}
                            </span>
                            <span className="block truncate text-[10px] leading-tight opacity-90">
                              {techName(wo).split(" ")[0]} · {wo.startLabel}
                            </span>
                          </Link>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="min-h-0">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-base-content/50">
                Day roster
              </p>
              {orders.length === 0 ? (
                <p className="text-sm text-base-content/55">
                  Nothing on the calendar.{" "}
                  <Link href="/technician" className="link link-primary">
                    Schedule work orders
                  </Link>
                </p>
              ) : (
                <ul className="divide-y divide-base-300 rounded-xl border border-base-300/70">
                  {orders.map((wo) => (
                    <li key={wo.id}>
                      <Link
                        href={`/technician?day=${dayKey}&wo=${wo.id}#day-calendar`}
                        className="flex flex-wrap items-center gap-2 px-2.5 py-2 transition-colors hover:bg-base-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      >
                        <span className="min-w-[4.5rem] font-medium text-primary">
                          {wo.work_order_number}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {customerName(wo)}
                          <span className="text-base-content/55">
                            {" · "}
                            {techName(wo)}
                          </span>
                        </span>
                        <span className="text-xs tabular-nums opacity-70">
                          {wo.startLabel}–{wo.endLabel}
                        </span>
                        <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                        <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
