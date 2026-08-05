"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Part, Profile, TechnicianLabor, WorkOrder, WorkOrderPart, AdditionalWorkRequest } from "@/lib/types";

/**
 * This business faces field execution gap risk when technicians lack a single workspace.
 * Our app reduces the risk by consolidating schedule, labor, parts, and approvals in one view.
 */

type ScheduleWo = WorkOrder & {
  customers?: { id?: string; name: string } | null;
  technician?: { id?: string; full_name: string | null } | null;
};

type ScheduleCategory = "in_progress" | "completed" | "overdue" | "upcoming";

type TimedWo = ScheduleWo & {
  startMinutes: number;
  endMinutes: number;
  startLabel: string;
  endLabel: string;
  category: ScheduleCategory;
};

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 19;
/** Pixels per hour on the horizontal day timeline. */
const HOUR_WIDTH = 96;
const DAY_ROW_HEIGHT = 56;
/** How many work-order chips to show initially / each Load more click. */
const WO_PAGE_SIZE = 6;

const CATEGORY_STYLES: Record<
  ScheduleCategory,
  { chip: string; block: string; ring: string; label: string }
> = {
  in_progress: {
    chip: "bg-warning/90 text-warning-content",
    block: "border-warning bg-warning/80 text-warning-content",
    ring: "ring-warning",
    label: "In Progress",
  },
  completed: {
    chip: "bg-success/90 text-success-content",
    block: "border-success bg-success/80 text-success-content",
    ring: "ring-success",
    label: "Completed",
  },
  overdue: {
    chip: "bg-error/90 text-error-content",
    block: "border-error bg-error/80 text-error-content",
    ring: "ring-error",
    label: "Overdue",
  },
  upcoming: {
    chip: "bg-info/90 text-info-content",
    block: "border-info bg-info/80 text-info-content",
    ring: "ring-info",
    label: "Upcoming",
  },
};

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Parse many human time inputs into minutes-from-midnight.
 * Accepts 9:00, 09:00, 9:00 AM, 2:30pm, 14:30:00, etc.
 */
function parseFlexibleTime(time: string | null | undefined): number | null {
  if (time == null) return null;
  const raw = String(time).trim().toLowerCase();
  if (!raw) return null;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!ampm) return null;

  let hours = Number(ampm[1]);
  const minutes = Number(ampm[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59 || hours > 23) return null;

  const mer = ampm[4]?.replace(/\./g, "") ?? "";
  if (mer.startsWith("p") && hours < 12) hours += 12;
  if (mer.startsWith("a") && hours === 12) hours = 0;
  if (!mer && hours > 23) return null;

  return hours * 60 + minutes;
}

function parseTimeToMinutes(time: string | null | undefined): number | null {
  return parseFlexibleTime(time);
}

function minutesToLabel(total: number): string {
  const clamped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function minutesToInputValue(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Meridiem = "AM" | "PM";

type ClockParts = {
  hour12: string;
  minute: string;
  period: Meridiem;
};

function minutesToClockParts(total: number): ClockParts {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  const period: Meridiem = h24 >= 12 ? "PM" : "AM";
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return {
    hour12: String(hour12),
    minute: String(m).padStart(2, "0"),
    period,
  };
}

/** Convert 12-hour parts + AM/PM into minutes-from-midnight (24h). */
function clockPartsToMinutes(hour12: string, minute: string, period: Meridiem): number | null {
  let h = Number(hour12);
  const m = Number(minute);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 1 || h > 12 || m < 0 || m > 59) return null;
  if (period === "AM") {
    if (h === 12) h = 0;
  } else {
    if (h !== 12) h += 12;
  }
  return h * 60 + m;
}

function formatTimeForDb(minutes: number): string {
  return `${minutesToInputValue(minutes)}:00`;
}

const HOUR_12_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")); // 00, 05, … 55

function snapMinuteOption(minute: string): string {
  const m = Number(minute);
  if (!Number.isFinite(m)) return "00";
  const snapped = Math.round(m / 5) * 5;
  return String(snapped === 60 ? 55 : snapped).padStart(2, "0");
}

function AmpmTimeFields({
  label,
  hour12,
  minute,
  period,
  onChange,
  required,
}: {
  label: string;
  hour12: string;
  minute: string;
  period: Meridiem;
  onChange: (next: ClockParts) => void;
  required?: boolean;
}) {
  return (
    <FormRow label={label} required={required}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="select select-bordered select-sm w-20"
          value={hour12}
          onChange={(e) => onChange({ hour12: e.target.value, minute, period })}
          aria-label={`${label} hour`}
          required={required}
        >
          {HOUR_12_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="opacity-50">:</span>
        <select
          className="select select-bordered select-sm w-20"
          value={snapMinuteOption(minute)}
          onChange={(e) => onChange({ hour12, minute: e.target.value, period })}
          aria-label={`${label} minutes`}
          required={required}
        >
          {MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          className="select select-bordered select-sm w-24 font-semibold"
          value={period}
          onChange={(e) => onChange({ hour12, minute, period: e.target.value as Meridiem })}
          aria-label={`${label} AM or PM`}
          required={required}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </FormRow>
  );
}

function getScheduleCategory(wo: ScheduleWo, now = new Date()): ScheduleCategory {
  const status = (wo.status ?? "").toLowerCase();
  if (status.includes("complete") || status === "closed") return "completed";

  // Past scheduled days are treated as completed for schedule views.
  if (wo.scheduled_date) {
    const day = startOfDay(parseISO(wo.scheduled_date));
    if (isBefore(day, startOfDay(now))) return "completed";
  }

  if (
    status.includes("progress") ||
    status.includes("ready for review") ||
    status.includes("waiting") ||
    !!wo.started_at ||
    !!wo.arrival_at
  ) {
    return "in_progress";
  }

  if (status.includes("overdue") || status.includes("past due")) return "overdue";

  // Today, after scheduled window, still open → overdue
  if (wo.scheduled_date) {
    const day = startOfDay(parseISO(wo.scheduled_date));
    if (isSameDay(day, now)) {
      const timed = (() => {
        const seed = hashSeed(wo.id);
        const storedStart = parseTimeToMinutes(wo.scheduled_start_time);
        const durationHours = Math.max(0.5, Number(wo.estimated_labor_hours) || 1 + (seed % 3));
        const startMinutes = storedStart ?? 8 * 60 + (seed % 15) * 30;
        return startMinutes + Math.round(durationHours * 60);
      })();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (nowMinutes > timed) return "overdue";
    }
  }

  return "upcoming";
}

function withDerivedTimes(wo: ScheduleWo): TimedWo {
  const seed = hashSeed(wo.id);
  const storedStart = parseFlexibleTime(wo.scheduled_start_time);

  // Prefer stored duration; if missing, use a stable fake only as a last resort.
  let durationHours =
    wo.estimated_labor_hours != null && Number(wo.estimated_labor_hours) > 0
      ? Number(wo.estimated_labor_hours)
      : null;

  let startMinutes = storedStart;
  if (startMinutes == null) {
    // Stable faux start between 8:00 and 15:00 in 30-minute steps (only if never set)
    startMinutes = 8 * 60 + (seed % 15) * 30;
  }

  if (durationHours == null) {
    durationHours = 1 + (seed % 3);
  }

  const durationMinutes = Math.max(15, Math.round(durationHours * 60));
  // Do not rewrite user-chosen start times by clamping into a view window.
  const endMinutes = startMinutes + durationMinutes;

  return {
    ...wo,
    startMinutes,
    endMinutes,
    startLabel: minutesToLabel(startMinutes),
    endLabel: minutesToLabel(endMinutes),
    category: getScheduleCategory(wo),
  };
}

function techName(wo: ScheduleWo): string {
  return wo.technician?.full_name?.trim() || "Unassigned";
}

function customerName(wo: ScheduleWo): string {
  return wo.customers?.name?.trim() || "Unknown customer";
}

export default function TechnicianPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workOrders, setWorkOrders] = useState<ScheduleWo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [dayPanelOpen, setDayPanelOpen] = useState(false);
  const [labor, setLabor] = useState<TechnicianLabor[]>([]);
  const [parts, setParts] = useState<(WorkOrderPart & { parts?: Part })[]>([]);
  const [additional, setAdditional] = useState<AdditionalWorkRequest[]>([]);
  const [inventory, setInventory] = useState<Part[]>([]);
  const [laborForm, setLaborForm] = useState({ regular_hours: "1", overtime_hours: "0", notes: "" });
  const [partForm, setPartForm] = useState({ part_id: "", quantity_used: "1" });
  const [awrForm, setAwrForm] = useState({ description: "", estimated_additional_charge: "0" });
  const [busy, setBusy] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"all" | ScheduleCategory>("all");
  const [listExpanded, setListExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(WO_PAGE_SIZE);
  const [technicians, setTechnicians] = useState<Profile[]>([]);
  const [scheduleForm, setScheduleForm] = useState({
    scheduled_date: "",
    startHour: "9",
    startMinute: "00",
    startPeriod: "AM" as Meridiem,
    endHour: "11",
    endMinute: "00",
    endPeriod: "AM" as Meridiem,
    assigned_technician_id: "",
  });
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);

  const isManager =
    profile?.role === "administrator" || profile?.role === "service_manager";

  const loadProfile = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    const profileRow = p as Profile | null;
    setProfile(profileRow);
    return profileRow;
  }, [supabase]);

  const loadWorkOrders = useCallback(
    async (techId?: string, role?: Profile["role"], techRoster?: Profile[]) => {
      let query = supabase
        .from("work_orders")
        .select("*, customers(id, name)")
        .not("status", "in", '("Canceled")')
        .order("scheduled_date", { ascending: true });
      if (techId && role === "technician") {
        query = query.eq("assigned_technician_id", techId);
      }
      const { data } = await query;
      const rows = (data as ScheduleWo[]) ?? [];

      const roster = techRoster ?? technicians;
      const techMap: Record<string, Profile> = {};
      for (const t of roster) techMap[t.id] = t;

      const missingIds = Array.from(
        new Set(
          rows
            .map((r) => r.assigned_technician_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0 && !techMap[id]),
        ),
      );
      if (missingIds.length > 0) {
        const { data: techs } = await supabase.from("profiles").select("*").in("id", missingIds);
        for (const t of (techs as Profile[]) ?? []) techMap[t.id] = t;
      }

      setWorkOrders(
        rows.map((r) => ({
          ...r,
          technician: r.assigned_technician_id ? techMap[r.assigned_technician_id] ?? null : null,
        })),
      );
    },
    [supabase, technicians],
  );

  async function loadDetail(woId: string) {
    const [{ data: l }, { data: p }, { data: a }] = await Promise.all([
      supabase.from("technician_labor").select("*").eq("work_order_id", woId).order("work_date", { ascending: false }),
      supabase.from("work_order_parts").select("*, parts(*)").eq("work_order_id", woId),
      supabase.from("additional_work_requests").select("*").eq("work_order_id", woId),
    ]);
    setLabor((l as TechnicianLabor[]) ?? []);
    setParts((p as typeof parts) ?? []);
    setAdditional((a as AdditionalWorkRequest[]) ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await loadProfile();
      if (cancelled) return;
      const { data: techData } = await supabase
        .from("profiles")
        .select("*")
        .eq("role", "technician")
        .eq("is_active", true)
        .order("full_name");
      const roster = (techData as Profile[]) ?? [];
      if (!cancelled) setTechnicians(roster);
      if (p) await loadWorkOrders(p.id, p.role, roster);
      const { data: inv } = await supabase.from("parts").select("*").eq("is_active", true).order("name");
      if (!cancelled) setInventory((inv as Part[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile, loadWorkOrders, supabase]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  // Keep schedule form in sync with the selected work order (don't clobber while typing)
  useEffect(() => {
    if (!selectedId) {
      setScheduleDirty(false);
      return;
    }
    if (scheduleDirty) return;
    const wo = workOrders.find((w) => w.id === selectedId);
    if (!wo) return;
    const timed = withDerivedTimes(wo);
    const startParts = minutesToClockParts(timed.startMinutes);
    const endParts = minutesToClockParts(timed.endMinutes);
    setScheduleForm({
      scheduled_date: wo.scheduled_date?.slice(0, 10) ?? "",
      startHour: startParts.hour12,
      startMinute: snapMinuteOption(startParts.minute),
      startPeriod: startParts.period,
      endHour: endParts.hour12,
      endMinute: snapMinuteOption(endParts.minute),
      endPeriod: endParts.period,
      assigned_technician_id: wo.assigned_technician_id ?? "",
    });
    setScheduleError(null);
  }, [selectedId, workOrders, scheduleDirty]);

  // Reset dirty when selecting another work order
  useEffect(() => {
    setScheduleDirty(false);
    setScheduleSaved(false);
  }, [selectedId]);

  // Live refresh when work orders change
  useEffect(() => {
    const channel = supabase
      .channel("technician-schedule-work-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_orders" },
        () => {
          void loadWorkOrders(profile?.id, profile?.role);
        },
      )
      .subscribe();

    const poll = window.setInterval(() => {
      void loadWorkOrders(profile?.id, profile?.role);
    }, 45_000);

    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [supabase, loadWorkOrders, profile?.id, profile?.role]);

  const timedOrders = useMemo(() => workOrders.map(withDerivedTimes), [workOrders]);

  const filteredOrders = useMemo(() => {
    if (categoryFilter === "all") return timedOrders;
    return timedOrders.filter((wo) => wo.category === categoryFilter);
  }, [timedOrders, categoryFilter]);

  // Reset paging when the filter changes
  useEffect(() => {
    setVisibleCount(WO_PAGE_SIZE);
  }, [categoryFilter]);

  const visibleOrders = useMemo(
    () => filteredOrders.slice(0, visibleCount),
    [filteredOrders, visibleCount],
  );
  const hasMoreOrders = visibleCount < filteredOrders.length;

  const categoryCounts = useMemo(() => {
    const counts: Record<ScheduleCategory, number> = {
      in_progress: 0,
      completed: 0,
      overdue: 0,
      upcoming: 0,
    };
    for (const wo of timedOrders) counts[wo.category] += 1;
    return counts;
  }, [timedOrders]);

  const monthCells = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthCursor));
    const end = endOfWeek(endOfMonth(monthCursor));
    const days: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    return days;
  }, [monthCursor]);

  const ordersByDayKey = useMemo(() => {
    const map = new Map<string, TimedWo[]>();
    for (const wo of filteredOrders) {
      if (!wo.scheduled_date) continue;
      const key = wo.scheduled_date.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(wo);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startMinutes - b.startMinutes);
    }
    return map;
  }, [filteredOrders]);

  const dayKey = format(selectedDay, "yyyy-MM-dd");
  const dayOrders = ordersByDayKey.get(dayKey) ?? [];
  const selected = timedOrders.find((w) => w.id === selectedId) ?? null;

  const dayTimeline = useMemo(() => {
    let minMin = DAY_START_HOUR * 60;
    let maxMin = DAY_END_HOUR * 60;
    for (const wo of dayOrders) {
      minMin = Math.min(minMin, wo.startMinutes);
      maxMin = Math.max(maxMin, wo.endMinutes);
    }
    const rangeStartMin = Math.max(0, Math.floor(minMin / 60) * 60);
    let rangeEndMin = Math.min(24 * 60, Math.ceil(maxMin / 60) * 60);
    if (rangeEndMin <= rangeStartMin) rangeEndMin = rangeStartMin + 60;

    const hoursList: number[] = [];
    for (let h = Math.floor(rangeStartMin / 60); h < Math.ceil(rangeEndMin / 60); h++) {
      hoursList.push(h);
    }

    // Staircase: earliest start on top (lane 0). Overlaps cascade downward.
    const sorted = [...dayOrders].sort(
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

    const timelineWidth = Math.max(((rangeEndMin - rangeStartMin) / 60) * HOUR_WIDTH, HOUR_WIDTH * 6);

    return {
      hours: hoursList,
      rangeStartMin,
      rangeEndMin,
      placed,
      laneCount: Math.max(1, laneEnds.length),
      timelineWidth,
    };
  }, [dayOrders]);

  function selectWorkOrder(id: string) {
    if (selectedId === id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(id);
    const wo = timedOrders.find((w) => w.id === id);
    if (wo?.scheduled_date) {
      const day = startOfDay(parseISO(wo.scheduled_date));
      setSelectedDay(day);
      setMonthCursor(startOfMonth(day));
    }
  }

  function openDay(day: Date) {
    setSelectedDay(startOfDay(day));
    setDayPanelOpen(true);
  }

  async function woAction(action: "arrival" | "start" | "pause" | "ready") {
    if (!selectedId) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    if (action === "arrival") {
      updates.arrival_at = now;
      updates.status = "In Progress";
    }
    if (action === "start") {
      updates.started_at = now;
      updates.paused_at = null;
      updates.status = "In Progress";
    }
    if (action === "pause") {
      updates.paused_at = now;
      updates.status = "In Progress";
    }
    if (action === "ready") {
      updates.status = "Ready for Review";
    }
    await supabase.from("work_orders").update(updates).eq("id", selectedId);
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action,
      recordType: "work_order",
      recordId: selectedId,
      newValue: String(updates.status),
    });
    await loadWorkOrders(profile?.id, profile?.role);
    await loadDetail(selectedId);
    setBusy(false);
  }

  async function saveSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !isManager) return;
    setScheduleError(null);
    setScheduleSaved(false);
    setBusy(true);

    if (!scheduleForm.scheduled_date) {
      setScheduleError("Choose a schedule date for this work order.");
      setBusy(false);
      return;
    }

    const startMin = clockPartsToMinutes(
      scheduleForm.startHour,
      scheduleForm.startMinute,
      scheduleForm.startPeriod,
    );
    const endMin = clockPartsToMinutes(scheduleForm.endHour, scheduleForm.endMinute, scheduleForm.endPeriod);
    if (startMin == null) {
      setScheduleError("Choose a valid start time and AM/PM.");
      setBusy(false);
      return;
    }
    if (endMin == null) {
      setScheduleError("Choose a valid complete-by time and AM/PM.");
      setBusy(false);
      return;
    }
    if (endMin <= startMin) {
      setScheduleError("Complete-by time must be after the start time (check AM/PM).");
      setBusy(false);
      return;
    }

    const hours = Math.round(((endMin - startMin) / 60) * 100) / 100;
    const startTimeDb = formatTimeForDb(startMin);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload = {
      scheduled_date: scheduleForm.scheduled_date,
      scheduled_start_time: startTimeDb,
      estimated_labor_hours: hours,
      assigned_technician_id: scheduleForm.assigned_technician_id || null,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error } = await supabase
      .from("work_orders")
      .update(payload)
      .eq("id", selectedId)
      .select("*, customers(id, name)")
      .single();

    if (error) {
      // Still try without select in case RLS blocks returning the row
      const { error: err2 } = await supabase.from("work_orders").update(payload).eq("id", selectedId);
      if (err2) {
        setScheduleError(err2.message || error.message);
        setBusy(false);
        return;
      }
      // Optimistically apply so the calendars move immediately
      setWorkOrders((prev) =>
        prev.map((w) =>
          w.id === selectedId
            ? {
                ...w,
                scheduled_date: payload.scheduled_date,
                scheduled_start_time: payload.scheduled_start_time,
                estimated_labor_hours: payload.estimated_labor_hours,
                assigned_technician_id: payload.assigned_technician_id,
                technician: payload.assigned_technician_id
                  ? technicians.find((t) => t.id === payload.assigned_technician_id) ?? w.technician
                  : null,
              }
            : w,
        ),
      );
    } else if (updated) {
      const tech = payload.assigned_technician_id
        ? technicians.find((t) => t.id === payload.assigned_technician_id) ?? null
        : null;
      setWorkOrders((prev) =>
        prev.map((w) =>
          w.id === selectedId
            ? { ...(updated as ScheduleWo), technician: tech }
            : w,
        ),
      );
    }

    const techLabel =
      technicians.find((t) => t.id === scheduleForm.assigned_technician_id)?.full_name || "Unassigned";
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "rescheduled",
      recordType: "work_order",
      recordId: selectedId,
      newValue: `${payload.scheduled_date} ${minutesToLabel(startMin)}–${minutesToLabel(endMin)} · ${techLabel}`,
    });

    // Normalize form to saved values
    const startParts = minutesToClockParts(startMin);
    const endParts = minutesToClockParts(endMin);
    setScheduleForm((f) => ({
      ...f,
      startHour: startParts.hour12,
      startMinute: snapMinuteOption(startParts.minute),
      startPeriod: startParts.period,
      endHour: endParts.hour12,
      endMinute: snapMinuteOption(endParts.minute),
      endPeriod: endParts.period,
    }));
    setScheduleDirty(false);
    setSelectedDay(startOfDay(parseISO(scheduleForm.scheduled_date)));
    setMonthCursor(startOfMonth(parseISO(scheduleForm.scheduled_date)));
    setScheduleSaved(true);
    // Background refresh for full roster
    void loadWorkOrders(profile?.id, profile?.role, technicians);
    setBusy(false);
  }

  async function addLabor(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !profile) return;
    setBusy(true);
    const rate = profile.hourly_cost_rate ?? 45;
    const billing = profile.hourly_billing_rate ?? 95;
    await supabase.from("technician_labor").insert({
      work_order_id: selectedId,
      technician_id: profile.id,
      work_date: format(new Date(), "yyyy-MM-dd"),
      regular_hours: Number(laborForm.regular_hours),
      overtime_hours: Number(laborForm.overtime_hours),
      hourly_cost_rate: rate,
      overtime_cost_rate: rate * 1.5,
      customer_billing_rate: billing,
      notes: laborForm.notes || null,
    });
    setLaborForm({ regular_hours: "1", overtime_hours: "0", notes: "" });
    await loadDetail(selectedId);
    setBusy(false);
  }

  async function addPart(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !partForm.part_id) return;
    setBusy(true);
    const part = inventory.find((p) => p.id === partForm.part_id);
    if (!part) {
      setBusy(false);
      return;
    }
    const qty = Number(partForm.quantity_used);
    const billable = part.standard_customer_price * qty;
    await supabase.from("work_order_parts").insert({
      work_order_id: selectedId,
      part_id: part.id,
      quantity_used: qty,
      unit_cost: part.unit_cost,
      customer_price: part.standard_customer_price,
      billable_amount: billable,
    });
    await supabase.from("parts").update({ quantity_on_hand: part.quantity_on_hand - qty }).eq("id", part.id);
    setPartForm({ part_id: "", quantity_used: "1" });
    await loadDetail(selectedId);
    const { data: inv } = await supabase.from("parts").select("*").eq("is_active", true).order("name");
    setInventory((inv as Part[]) ?? []);
    setBusy(false);
  }

  async function addAdditionalWork(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !profile) return;
    setBusy(true);
    await supabase.from("additional_work_requests").insert({
      work_order_id: selectedId,
      description: awrForm.description,
      estimated_additional_charge: Number(awrForm.estimated_additional_charge),
      requested_by: profile.id,
    });
    setAwrForm({ description: "", estimated_additional_charge: "0" });
    await loadDetail(selectedId);
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Technician Schedule"
        description="Month and day calendars for scheduled work, plus job execution tools"
      />

      {/* Totals / work order list (outside calendars) */}
      <section className="card bg-base-100 shadow">
        <div className="card-body gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="card-title text-base">
              Total work orders
              <span className="badge badge-neutral badge-lg tabular-nums">{filteredOrders.length}</span>
              {categoryFilter !== "all" ? (
                <span className="text-sm font-normal opacity-60">of {timedOrders.length}</span>
              ) : null}
            </h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-1"
              onClick={() => setListExpanded((open) => !open)}
              aria-expanded={listExpanded}
              aria-controls="work-order-list-panel"
            >
              {listExpanded ? (
                <>
                  Collapse list <ChevronLeft className="h-4 w-4 -rotate-90" />
                </>
              ) : (
                <>
                  Expand list <ChevronRight className="h-4 w-4 rotate-90" />
                </>
              )}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by schedule status">
            <button
              type="button"
              className={`btn btn-sm ${categoryFilter === "all" ? "btn-neutral" : "btn-ghost"}`}
              onClick={() => setCategoryFilter("all")}
              aria-pressed={categoryFilter === "all"}
            >
              All ({timedOrders.length})
            </button>
            {(Object.keys(CATEGORY_STYLES) as ScheduleCategory[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`btn btn-sm ${categoryFilter === key ? "btn-active ring-2 ring-offset-1 " + CATEGORY_STYLES[key].ring : "btn-ghost"} ${categoryFilter === key ? CATEGORY_STYLES[key].chip : ""}`}
                onClick={() => setCategoryFilter(key)}
                aria-pressed={categoryFilter === key}
              >
                <span className={`mr-1 inline-block h-2 w-2 rounded-full ${CATEGORY_STYLES[key].chip}`} />
                {CATEGORY_STYLES[key].label} ({categoryCounts[key]})
              </button>
            ))}
          </div>

          {listExpanded ? (
            <div id="work-order-list-panel" className="space-y-3">
              <p className="text-xs opacity-60">
                Click a work order to highlight it on the calendars; click again to clear. Past-dated jobs show as
                completed. Showing {Math.min(visibleCount, filteredOrders.length)} of {filteredOrders.length}.
              </p>

              {filteredOrders.length === 0 ? (
                <p className="text-sm opacity-60">No work orders match this filter.</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-2">
                    {visibleOrders.map((wo) => {
                      const style = CATEGORY_STYLES[wo.category];
                      const active = selectedId === wo.id;
                      return (
                        <li key={wo.id}>
                          <button
                            type="button"
                            onClick={() => selectWorkOrder(wo.id)}
                            className={`rounded-box border px-3 py-1.5 text-left text-sm transition ${style.chip} ${
                              active ? `ring-2 ring-offset-2 ${style.ring}` : "opacity-90 hover:opacity-100"
                            }`}
                            aria-pressed={active}
                          >
                            <span className="font-semibold">{wo.work_order_number}</span>
                            <span className="mx-1 opacity-70">·</span>
                            <span className="opacity-90">{customerName(wo)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasMoreOrders ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => setVisibleCount((n) => n + WO_PAGE_SIZE)}
                      >
                        Load more (+{Math.min(WO_PAGE_SIZE, filteredOrders.length - visibleCount)})
                      </button>
                    ) : null}
                    {visibleCount > WO_PAGE_SIZE ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setVisibleCount(WO_PAGE_SIZE)}
                      >
                        Show fewer
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : (
            <p id="work-order-list-panel" className="text-sm opacity-60">
              List collapsed
              {selectedId ? " · a work order is still highlighted on the calendars" : ""}. Use Expand list to browse
              chips again.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Month calendar */}
        <section className="card bg-base-100 shadow">
          <div className="card-body p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="card-title text-base">Month calendar</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-square"
                  aria-label="Previous month"
                  onClick={() => setMonthCursor((m) => startOfMonth(subMonths(m, 1)))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[9rem] text-center text-sm font-semibold">
                  {format(monthCursor, "MMMM yyyy")}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-square"
                  aria-label="Next month"
                  onClick={() => setMonthCursor((m) => startOfMonth(addMonths(m, 1)))}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium opacity-60">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {monthCells.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const list = ordersByDayKey.get(key) ?? [];
                const inMonth = isSameMonth(day, monthCursor);
                const isSelectedDay = isSameDay(day, selectedDay);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => openDay(day)}
                    className={`min-h-[5.5rem] rounded-box border p-1 text-left transition hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                      inMonth ? "border-base-300 bg-base-100" : "border-transparent bg-base-200/40 opacity-50"
                    } ${isSelectedDay ? "ring-2 ring-primary ring-offset-1" : ""} ${isToday(day) ? "bg-base-200/80" : ""}`}
                    aria-label={`${format(day, "MMMM d, yyyy")}: ${list.length} work orders. Click to open day details.`}
                  >
                    <div className="mb-1 flex items-center justify-between px-0.5">
                      <span className={`text-xs font-semibold ${isToday(day) ? "text-primary" : ""}`}>
                        {format(day, "d")}
                      </span>
                      {list.length > 0 ? (
                        <span className="badge badge-ghost badge-xs tabular-nums">{list.length}</span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {list.slice(0, 3).map((wo) => {
                        const style = CATEGORY_STYLES[wo.category];
                        const active = selectedId === wo.id;
                        return (
                          <span
                            key={wo.id}
                            className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${style.chip} ${
                              active ? `ring-2 ring-offset-1 ${style.ring}` : ""
                            }`}
                            title={`${wo.work_order_number} · ${wo.startLabel}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectWorkOrder(wo.id);
                              openDay(day);
                            }}
                          >
                            {wo.work_order_number}
                          </span>
                        );
                      })}
                      {list.length > 3 ? (
                        <span className="px-1 text-[10px] opacity-60">+{list.length - 3} more</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Day calendar */}
        <section className="card bg-base-100 shadow">
          <div className="card-body p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="card-title text-base">Day calendar</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-square"
                  aria-label="Previous day"
                  onClick={() => setSelectedDay((d) => addDays(d, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[10rem] text-center text-sm font-semibold">
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
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSelectedDay(startOfDay(new Date()))}>
                  Today
                </button>
              </div>
            </div>

            <div className="relative overflow-x-auto rounded-box border border-base-300">
              <div className="relative" style={{ width: dayTimeline.timelineWidth + 8, minWidth: "100%" }}>
                {/* Hour labels along the top (horizontal axis) */}
                <div className="relative h-8 border-b border-base-300 bg-base-200/40">
                  {dayTimeline.hours.map((h) => (
                    <div
                      key={h}
                      className="absolute top-0 border-l border-base-300/70 pl-1 pt-1 text-[10px] opacity-60"
                      style={{
                        left: ((h * 60 - dayTimeline.rangeStartMin) / 60) * HOUR_WIDTH,
                        width: HOUR_WIDTH,
                      }}
                    >
                      {minutesToLabel(h * 60)}
                    </div>
                  ))}
                </div>

                <div
                  className="relative"
                  style={{
                    height: dayTimeline.laneCount * DAY_ROW_HEIGHT + 20,
                    width: dayTimeline.timelineWidth,
                  }}
                >
                  {dayTimeline.hours.map((h) => (
                    <div
                      key={h}
                      className="absolute bottom-0 top-0 border-l border-base-300/50"
                      style={{ left: ((h * 60 - dayTimeline.rangeStartMin) / 60) * HOUR_WIDTH }}
                    />
                  ))}

                  {dayTimeline.placed.map(({ wo, lane }) => {
                    const left =
                      ((wo.startMinutes - dayTimeline.rangeStartMin) / 60) * HOUR_WIDTH + lane * 10;
                    const width = Math.max(
                      ((wo.endMinutes - wo.startMinutes) / 60) * HOUR_WIDTH - 4,
                      HOUR_WIDTH * 0.4,
                    );
                    const style = CATEGORY_STYLES[wo.category];
                    const active = selectedId === wo.id;
                    return (
                      <div
                        key={wo.id}
                        className={`tooltip tooltip-bottom absolute z-10 cursor-pointer before:z-50 before:max-w-xs before:whitespace-pre-line before:text-left before:text-xs ${
                          active ? "z-20" : ""
                        }`}
                        style={{
                          left,
                          width,
                          top: 8 + lane * DAY_ROW_HEIGHT,
                          height: DAY_ROW_HEIGHT - 14,
                        }}
                        data-tip={`${wo.work_order_number}\n${wo.startLabel} – ${wo.endLabel}\nTech: ${techName(wo)}\nCustomer: ${customerName(wo)}\n${CATEGORY_STYLES[wo.category].label}`}
                      >
                        <button
                          type="button"
                          onClick={() => selectWorkOrder(wo.id)}
                          className={`h-full w-full overflow-hidden rounded-md border px-2 py-1 text-left text-xs shadow-sm transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${style.block} ${
                            active ? `ring-2 ring-offset-2 ${style.ring}` : ""
                          }`}
                          aria-label={`Work order ${wo.work_order_number} from ${wo.startLabel} to ${wo.endLabel}`}
                          aria-pressed={active}
                        >
                          <div className="truncate font-semibold leading-tight">{wo.work_order_number}</div>
                          <div className="truncate opacity-90">{customerName(wo)}</div>
                          <div className="truncate text-[10px] opacity-80">
                            {wo.startLabel} – {wo.endLabel}
                          </div>
                        </button>
                      </div>
                    );
                  })}

                  {dayOrders.length === 0 ? (
                    <div className="flex h-full min-h-[4rem] items-center justify-center text-sm opacity-50">
                      No work orders this day
                      {categoryFilter !== "all" ? " for this filter" : ""}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Day detail panel (from month click) */}
      {dayPanelOpen ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="text-lg font-bold">{format(selectedDay, "EEEE, MMMM d, yyyy")}</h3>
            <p className="text-sm opacity-70">
              {dayOrders.length} work order{dayOrders.length === 1 ? "" : "s"} scheduled
            </p>
            {dayOrders.length === 0 ? (
              <p className="mt-4 text-sm opacity-60">Nothing scheduled on this date.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {dayOrders.map((wo) => {
                  const style = CATEGORY_STYLES[wo.category];
                  const active = selectedId === wo.id;
                  const customerId = wo.customer_id || wo.customers?.id;
                  return (
                    <li
                      key={wo.id}
                      className={`rounded-box border border-base-300 p-3 ${active ? `ring-2 ${style.ring}` : ""}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <button
                          type="button"
                          className="link link-hover link-primary font-semibold"
                          onClick={() => selectWorkOrder(wo.id)}
                        >
                          {wo.work_order_number}
                        </button>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${style.chip}`}>{style.label}</span>
                      </div>
                      <dl className="mt-2 grid gap-1 text-sm">
                        <div>
                          <dt className="inline opacity-60">Time: </dt>
                          <dd className="inline">
                            {wo.startLabel} – {wo.endLabel}
                            {!wo.scheduled_start_time ? (
                              <span className="ml-1 text-xs opacity-50">(estimated)</span>
                            ) : null}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline opacity-60">Technician: </dt>
                          <dd className="inline">
                            <Link href="/technician" className="link link-hover">
                              {techName(wo)}
                            </Link>
                          </dd>
                        </div>
                        <div>
                          <dt className="inline opacity-60">Customer: </dt>
                          <dd className="inline">
                            {customerId ? (
                              <Link href={`/customers/${customerId}`} className="link link-hover link-primary">
                                {customerName(wo)}
                              </Link>
                            ) : (
                              customerName(wo)
                            )}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link href={`/work-orders/${wo.id}`} className="btn btn-ghost btn-xs">
                          Open work order
                        </Link>
                        {customerId ? (
                          <Link href={`/customers/${customerId}`} className="btn btn-ghost btn-xs">
                            Open customer
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="modal-action">
              <button type="button" className="btn" onClick={() => setDayPanelOpen(false)}>
                Close
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setDayPanelOpen(false)}>
              close
            </button>
          </form>
        </dialog>
      ) : null}

      {/* Job workspace */}
      <section className="space-y-4">
        {!selected ? (
          <EmptyState
            title="Select a work order"
            description="Click a work order in the list or on a calendar to log labor, parts, and status."
          />
        ) : (
          <>
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold">{selected.work_order_number}</h2>
                    <p className="text-sm opacity-70">
                      <Link
                        href={
                          selected.customer_id || selected.customers?.id
                            ? `/customers/${selected.customer_id || selected.customers?.id}`
                            : "/customers"
                        }
                        className="link link-hover link-primary"
                      >
                        {customerName(selected)}
                      </Link>
                      {" · "}
                      {selected.scheduled_date ?? "Unscheduled"}
                      {" · "}
                      {selected.startLabel} – {selected.endLabel}
                    </p>
                    <p className="text-sm opacity-70">Technician: {techName(selected)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${CATEGORY_STYLES[selected.category].chip}`}>
                      {CATEGORY_STYLES[selected.category].label}
                    </span>
                    <StatusBadge label={selected.status} tone={statusTone(selected.status)} />
                    {selected.priority === "Critical" || selected.work_order_type === "Emergency Repair" ? (
                      <StatusBadge label="URGENT" tone="critical" />
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-sm">{selected.problem_description ?? "No description"}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => woAction("arrival")} disabled={busy}>
                    Record Arrival
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => woAction("start")} disabled={busy}>
                    Start Work
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => woAction("pause")} disabled={busy}>
                    Pause
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => woAction("ready")} disabled={busy}>
                    Ready for Review
                  </button>
                  <Link href={`/work-orders/${selected.id}`} className="btn btn-ghost btn-sm">
                    Full Detail
                  </Link>
                </div>
              </div>
            </div>

            {isManager ? (
              <div className="card border border-primary/20 bg-base-100 shadow">
                <div className="card-body">
                  <h3 className="font-semibold">Schedule & assign technician</h3>
                  <p className="text-sm opacity-70">
                    Set when this job should run and which technician completes it. Calendars update when you save.
                  </p>
                  {scheduleError ? <div className="alert alert-error text-sm">{scheduleError}</div> : null}
                  {scheduleSaved ? (
                    <div className="alert alert-success text-sm">Schedule updated. Calendars refreshed.</div>
                  ) : null}
                  <form onSubmit={saveSchedule} className="mt-2 grid gap-3 sm:grid-cols-2">
                    <FormRow label="Schedule date" required>
                      <input
                        type="date"
                        className="input input-bordered w-full"
                        value={scheduleForm.scheduled_date}
                        onChange={(e) => {
                          setScheduleSaved(false);
                          setScheduleDirty(true);
                          setScheduleForm({ ...scheduleForm, scheduled_date: e.target.value });
                        }}
                        required
                      />
                    </FormRow>
                    <FormRow label="Assigned technician">
                      <select
                        className="select select-bordered w-full"
                        value={scheduleForm.assigned_technician_id}
                        onChange={(e) => {
                          setScheduleSaved(false);
                          setScheduleDirty(true);
                          setScheduleForm({ ...scheduleForm, assigned_technician_id: e.target.value });
                        }}
                      >
                        <option value="">Unassigned</option>
                        {technicians.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.full_name || t.email}
                          </option>
                        ))}
                      </select>
                    </FormRow>
                    <AmpmTimeFields
                      label="Start time"
                      required
                      hour12={scheduleForm.startHour}
                      minute={scheduleForm.startMinute}
                      period={scheduleForm.startPeriod}
                      onChange={(next) => {
                        setScheduleSaved(false);
                        setScheduleDirty(true);
                        setScheduleForm({
                          ...scheduleForm,
                          startHour: next.hour12,
                          startMinute: next.minute,
                          startPeriod: next.period,
                        });
                      }}
                    />
                    <AmpmTimeFields
                      label="Complete-by / end time"
                      required
                      hour12={scheduleForm.endHour}
                      minute={scheduleForm.endMinute}
                      period={scheduleForm.endPeriod}
                      onChange={(next) => {
                        setScheduleSaved(false);
                        setScheduleDirty(true);
                        setScheduleForm({
                          ...scheduleForm,
                          endHour: next.hour12,
                          endMinute: next.minute,
                          endPeriod: next.period,
                        });
                      }}
                    />
                    <p className="text-xs opacity-60 sm:col-span-2">
                      Pick hour, minutes, and AM/PM. Values are stored in 24-hour time and shown on the calendars with
                      matching AM/PM labels (e.g. 2:00 PM → mid-afternoon on the day timeline).
                    </p>
                    <div className="flex items-end sm:col-span-2">
                      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                        {busy ? "Saving…" : "Save schedule & assignment"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h3 className="font-semibold">Labor</h3>
                <form onSubmit={addLabor} className="grid gap-3 sm:grid-cols-2">
                  <FormRow label="Regular hrs">
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      className="input input-bordered w-full"
                      value={laborForm.regular_hours}
                      onChange={(e) => setLaborForm({ ...laborForm, regular_hours: e.target.value })}
                    />
                  </FormRow>
                  <FormRow label="OT hrs">
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      className="input input-bordered w-full"
                      value={laborForm.overtime_hours}
                      onChange={(e) => setLaborForm({ ...laborForm, overtime_hours: e.target.value })}
                    />
                  </FormRow>
                  <FormRow label="Notes">
                    <input
                      className="input input-bordered w-full"
                      value={laborForm.notes}
                      onChange={(e) => setLaborForm({ ...laborForm, notes: e.target.value })}
                    />
                  </FormRow>
                  <div className="flex items-end">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                      Add Labor
                    </button>
                  </div>
                </form>
                {labor.length > 0 ? (
                  <table className="table table-sm mt-4">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Regular</th>
                        <th>OT</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labor.map((l) => (
                        <tr key={l.id}>
                          <td>{l.work_date}</td>
                          <td>{l.regular_hours}</td>
                          <td>{l.overtime_hours}</td>
                          <td>{l.notes ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            </div>

            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h3 className="font-semibold">Parts Used</h3>
                <form onSubmit={addPart} className="mt-2 grid gap-3 sm:grid-cols-2">
                  <FormRow label="Part">
                    <select
                      className="select select-bordered w-full"
                      value={partForm.part_id}
                      onChange={(e) => setPartForm({ ...partForm, part_id: e.target.value })}
                      required
                    >
                      <option value="">Select…</option>
                      {inventory.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.part_number} — {p.name} ({p.quantity_on_hand})
                        </option>
                      ))}
                    </select>
                  </FormRow>
                  <FormRow label="Qty">
                    <input
                      type="number"
                      min="1"
                      className="input input-bordered w-full"
                      value={partForm.quantity_used}
                      onChange={(e) => setPartForm({ ...partForm, quantity_used: e.target.value })}
                    />
                  </FormRow>
                  <div className="flex items-end">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                      Add Part
                    </button>
                  </div>
                </form>
                {parts.length > 0 ? (
                  <table className="table table-sm mt-4">
                    <thead>
                      <tr>
                        <th>Part</th>
                        <th>Qty</th>
                        <th>Billable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parts.map((p) => (
                        <tr key={p.id}>
                          <td>{p.parts?.name ?? p.part_id}</td>
                          <td>{p.quantity_used}</td>
                          <td>${Number(p.billable_amount).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            </div>

            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h3 className="font-semibold">Additional Work Request</h3>
                <form onSubmit={addAdditionalWork} className="mt-2 space-y-3">
                  <FormRow label="Description">
                    <textarea
                      className="textarea textarea-bordered w-full"
                      rows={2}
                      value={awrForm.description}
                      onChange={(e) => setAwrForm({ ...awrForm, description: e.target.value })}
                      required
                    />
                  </FormRow>
                  <FormRow label="Est. charge">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input input-bordered w-full"
                      value={awrForm.estimated_additional_charge}
                      onChange={(e) => setAwrForm({ ...awrForm, estimated_additional_charge: e.target.value })}
                    />
                  </FormRow>
                  <button type="submit" className="btn btn-outline btn-sm" disabled={busy}>
                    Submit Request
                  </button>
                </form>
                {additional.length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {additional.map((a) => (
                      <li key={a.id} className="rounded-box bg-base-200 p-3 text-sm">
                        {a.description} — <StatusBadge label={a.approval_status} tone={statusTone(a.approval_status)} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
