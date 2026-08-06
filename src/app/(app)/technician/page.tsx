"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Printer,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type {
  Part,
  Profile,
  TechnicianLabor,
  WorkOrder,
  WorkOrderPart,
  AdditionalWorkRequest,
} from "@/lib/types";
import {
  type ScheduleWo,
  type ScheduleCategory,
  type TimedWo,
  type Meridiem,
  type ClockParts,
  DAY_START_HOUR,
  DAY_END_HOUR,
  HOUR_WIDTH,
  WO_PAGE_SIZE,
  CATEGORY_STYLES,
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  minutesToLabel,
  minutesToClockParts,
  clockPartsToMinutes,
  formatTimeForDb,
  snapMinuteOption,
  withDerivedTimes,
  markConflicts,
  techName,
  customerName,
  densityRowHeight,
  DAY_TIMELINE_MIN_LANES,
  DAY_VIEW_HEIGHT_MIN,
  DAY_VIEW_HEIGHT_MAX,
  exportDayCsv,
  downloadTextFile,
  nextWeekDate,
  profileLabel,
  HOUR_12_OPTIONS,
  MINUTE_OPTIONS,
  DURATION_PRESETS_MIN,
  isOpenPastJob,
  daysPastScheduled,
} from "@/lib/technician-schedule";
import { statusAfterPlacingOnSchedule } from "@/lib/work-order-status";

/**
 * Field execution gap risk when technicians lack a single workspace.
 * Consolidates schedule, labor, parts, and approvals in one view.
 */

type DragPayload = { id: string; durationMinutes: number };

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

function ScheduleLegend({ sticky }: { sticky?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-box border border-base-300 bg-base-100/95 px-3 py-2 text-xs backdrop-blur-sm ${
        sticky ? "sticky top-2 z-20 print:hidden" : ""
      }`}
      role="list"
      aria-label="Schedule color legend"
    >
      <span className="font-semibold opacity-70">Legend:</span>
      {(Object.keys(CATEGORY_STYLES) as ScheduleCategory[]).map((key) => (
        <span key={key} role="listitem" className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm ${CATEGORY_STYLES[key].chip}`} />
          {CATEGORY_STYLES[key].label}
        </span>
      ))}
      <span role="listitem" className="inline-flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-error" aria-hidden />
        Conflict
      </span>
    </div>
  );
}

export default function TechnicianPage() {
  const supabase = createClient();
  const dayCalendarRef = useRef<HTMLDivElement>(null);
  const timelineDropRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [workOrders, setWorkOrders] = useState<ScheduleWo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [dayPanelOpen, setDayPanelOpen] = useState(false);
  const [labor, setLabor] = useState<TechnicianLabor[]>([]);
  const [parts, setParts] = useState<(WorkOrderPart & { parts?: Part })[]>([]);
  const [additional, setAdditional] = useState<AdditionalWorkRequest[]>([]);
  const [inventory, setInventory] = useState<Part[]>([]);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [laborForm, setLaborForm] = useState({ regular_hours: "1", overtime_hours: "0", notes: "" });
  const [partForm, setPartForm] = useState({ part_id: "", quantity_used: "1" });
  const [awrForm, setAwrForm] = useState({ description: "", estimated_additional_charge: "0" });
  const [busy, setBusy] = useState(false);
  // Default prefs on SSR + first paint so server/client HTML match (avoids hydration crash).
  // Real localStorage prefs load after mount.
  const [categoryFilter, setCategoryFilter] = useState<"all" | ScheduleCategory>(DEFAULT_PREFS.categoryFilter);
  const [listExpanded, setListExpanded] = useState(DEFAULT_PREFS.listExpanded);
  const [density, setDensity] = useState<"compact" | "comfortable">(DEFAULT_PREFS.density);
  const [techView, setTechView] = useState<string>(DEFAULT_PREFS.techView);
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const [visibleCount, setVisibleCount] = useState(WO_PAGE_SIZE);
  const [pastJobsVisibleCount, setPastJobsVisibleCount] = useState(WO_PAGE_SIZE);
  const [pastQueueExpanded, setPastQueueExpanded] = useState(true);
  const [closeoutBusyId, setCloseoutBusyId] = useState<string | null>(null);
  const [closeoutMessage, setCloseoutMessage] = useState<string | null>(null);
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
  const [bulkForm, setBulkForm] = useState({ scheduled_date: "", assigned_technician_id: "" });
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [dayViewHeight, setDayViewHeight] = useState(DEFAULT_PREFS.dayViewHeight);
  const dayResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const isServiceManager = profile?.role === "service_manager";
  const isManager = profile?.role === "administrator" || isServiceManager;
  // Managers schedule at comfortable height so timeline bubbles stay readable.
  const baseRowHeight = densityRowHeight(isManager ? "comfortable" : density);

  useEffect(() => {
    const prefs = loadPrefs();
    setCategoryFilter(prefs.categoryFilter);
    setListExpanded(prefs.listExpanded);
    setDensity(prefs.density);
    setTechView(prefs.techView);
    if (typeof prefs.dayViewHeight === "number" && Number.isFinite(prefs.dayViewHeight)) {
      setDayViewHeight(
        Math.min(DAY_VIEW_HEIGHT_MAX, Math.max(DAY_VIEW_HEIGHT_MIN, prefs.dayViewHeight)),
      );
    }
    setPrefsHydrated(true);
  }, []);

  useEffect(() => {
    if (!prefsHydrated) return;
    // Persist comfortable for managers so compact never sticks for this role.
    savePrefs({
      categoryFilter,
      listExpanded,
      density: isServiceManager ? "comfortable" : density,
      techView,
      dayViewHeight,
    });
  }, [categoryFilter, listExpanded, density, techView, dayViewHeight, prefsHydrated, isServiceManager]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const start = dayResizeRef.current;
      if (!start) return;
      const delta = e.clientY - start.startY;
      const next = Math.min(
        DAY_VIEW_HEIGHT_MAX,
        Math.max(DAY_VIEW_HEIGHT_MIN, start.startHeight + delta),
      );
      setDayViewHeight(next);
    }
    function onUp() {
      dayResizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  function beginDayCalendarResize(e: React.PointerEvent) {
    e.preventDefault();
    dayResizeRef.current = { startY: e.clientY, startHeight: dayViewHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  }

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

  const reloadAll = useCallback(async () => {
    if (profile) await loadWorkOrders(profile.id, profile.role, technicians);
  }, [loadWorkOrders, profile, technicians]);

  const loadInventory = useCallback(async () => {
    // Match Parts tab: load full inventory, then prefer active / in-stock items for the picker.
    const { data, error } = await supabase.from("parts").select("*").order("name");
    if (error) {
      setInventoryError(error.message);
      setInventory([]);
      return;
    }
    setInventoryError(null);
    const all = (data as Part[]) ?? [];
    const active = all.filter((p) => p.is_active === true || p.is_active == null);
    // If nothing is flagged active, still show all rows so technicians can pick Parts-tab stock.
    setInventory(active.length > 0 ? active : all);
  }, [supabase]);

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
      if (!cancelled) await loadInventory();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile, loadWorkOrders, loadInventory, supabase]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
      void loadInventory();
    }
  }, [selectedId, loadInventory]);

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

  useEffect(() => {
    setScheduleDirty(false);
    setScheduleSaved(false);
  }, [selectedId]);

  useEffect(() => {
    const channel = supabase
      .channel("technician-schedule-work-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, () => {
        void reloadAll();
      })
      .subscribe();

    const poll = window.setInterval(() => {
      void reloadAll();
    }, 45_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") void reloadAll();
    };
    const onFocus = () => void reloadAll();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [supabase, reloadAll]);

  const timedOrders = useMemo(
    () => markConflicts(workOrders.map(withDerivedTimes)),
    [workOrders],
  );

  const filteredByTech = useMemo(() => {
    if (techView === "all") return timedOrders;
    if (techView === "mine" && profile) {
      return timedOrders.filter((wo) => wo.assigned_technician_id === profile.id);
    }
    if (techView !== "all" && techView !== "mine") {
      return timedOrders.filter((wo) => wo.assigned_technician_id === techView);
    }
    return timedOrders;
  }, [timedOrders, techView, profile]);

  const filteredOrders = useMemo(() => {
    if (categoryFilter === "all") return filteredByTech;
    return filteredByTech.filter((wo) => wo.category === categoryFilter);
  }, [filteredByTech, categoryFilter]);

  const unscheduledOrders = useMemo(
    () => timedOrders.filter((wo) => !wo.scheduled_date),
    [timedOrders],
  );

  const openPastJobs = useMemo(() => {
    return filteredByTech
      .filter((wo) => isOpenPastJob(wo))
      .sort((a, b) => {
        const da = a.scheduled_date ?? "";
        const db = b.scheduled_date ?? "";
        return da.localeCompare(db);
      });
  }, [filteredByTech]);

  const visiblePastJobs = useMemo(
    () => openPastJobs.slice(0, pastJobsVisibleCount),
    [openPastJobs, pastJobsVisibleCount],
  );

  useEffect(() => {
    setVisibleCount(WO_PAGE_SIZE);
  }, [categoryFilter, techView]);

  const visibleOrders = useMemo(
    () => filteredOrders.slice(0, visibleCount),
    [filteredOrders, visibleCount],
  );
  const hasMoreOrders = visibleCount < filteredOrders.length;

  const categoryCounts = useMemo(() => {
    const counts: Record<ScheduleCategory, number> = {
      in_progress: 0,
      waiting_parts: 0,
      completed: 0,
      overdue: 0,
      upcoming: 0,
    };
    for (const wo of filteredByTech) counts[wo.category] += 1;
    return counts;
  }, [filteredByTech]);

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

  const dayLaneCount = Math.max(dayTimeline.laneCount, DAY_TIMELINE_MIN_LANES);
  // Stretch rows to fill the user-resized day calendar height.
  const dayTimelineBodyHeight = dayViewHeight;
  const dayBubbleRowHeight = Math.max(
    Math.min(baseRowHeight, 64),
    Math.floor((dayTimelineBodyHeight - 28) / dayLaneCount),
  );

  function selectWorkOrder(id: string) {
    if (bulkMode) {
      setBulkSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
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

  function handleDayKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSelectedDay((d) => addDays(d, -1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setSelectedDay((d) => addDays(d, 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSelectedDay(startOfDay(new Date()));
    }
  }

  function parseDragPayload(e: React.DragEvent): DragPayload | null {
    try {
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return null;
      return JSON.parse(raw) as DragPayload;
    } catch {
      return null;
    }
  }

  function applyLocalScheduleUpdate(
    woId: string,
    patch: {
      scheduled_date?: string | null;
      scheduled_start_time?: string | null;
      scheduled_end_time?: string | null;
      estimated_labor_hours?: number | null;
      assigned_technician_id?: string | null;
      status?: string;
      completion_date?: string | null;
      updated_at?: string;
    },
  ) {
    setWorkOrders((prev) =>
      prev.map((w) => {
        if (w.id !== woId) return w;
        const next = { ...w, ...patch };
        if ("assigned_technician_id" in patch) {
          const tid = patch.assigned_technician_id;
          next.technician = tid ? technicians.find((t) => t.id === tid) ?? w.technician : null;
        }
        return next;
      }),
    );
  }

  async function markPastJobCompleted(woId: string) {
    if (!isManager) return;
    setCloseoutBusyId(woId);
    setCloseoutMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const completionDate = format(new Date(), "yyyy-MM-dd");
    const nowIso = new Date().toISOString();
    const basePayload: Record<string, unknown> = {
      completion_date: completionDate,
      updated_at: nowIso,
      work_performed: "Completed from past-job closeout queue",
    };
    if (profile?.id) {
      basePayload.approved_by = profile.id;
      basePayload.approved_at = nowIso;
    }

    // Prefer Completed; DB may require photo/signature and force Closed instead.
    let finalStatus = "Completed";
    applyLocalScheduleUpdate(woId, {
      status: finalStatus,
      completion_date: completionDate,
      updated_at: nowIso,
    });

    let { error } = await supabase
      .from("work_orders")
      .update({ ...basePayload, status: finalStatus })
      .eq("id", woId);

    if (error && /photo|signature/i.test(error.message)) {
      finalStatus = "Closed";
      applyLocalScheduleUpdate(woId, {
        status: finalStatus,
        completion_date: completionDate,
        updated_at: nowIso,
      });
      ({ error } = await supabase
        .from("work_orders")
        .update({ ...basePayload, status: finalStatus })
        .eq("id", woId));
    }

    if (error) {
      setCloseoutMessage(`Could not complete work order: ${error.message}`);
      await reloadAll();
      setCloseoutBusyId(null);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "completed_from_past_queue",
      recordType: "work_order",
      recordId: woId,
      newValue: finalStatus,
    });

    setCloseoutMessage(
      finalStatus === "Closed"
        ? "Closed (DB requires photo/signature for Completed). Calendars and lists updated."
        : "Marked completed. Calendars, filters, and lists updated.",
    );
    if (selectedId === woId) {
      setScheduleDirty(false);
    }
    await reloadAll();
    if (selectedId === woId) await loadDetail(woId);
    setCloseoutBusyId(null);
  }

  function reschedulePastJob(woId: string) {
    selectWorkOrder(woId);
    setCloseoutMessage("Work order selected — use Schedule & assign below to set a new date/time, then save.");
    // Scroll schedule form into view after render
    window.setTimeout(() => {
      document.getElementById("schedule-assign-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  async function reschedulePastJobToday(woId: string) {
    if (!isManager) return;
    setCloseoutBusyId(woId);
    setCloseoutMessage(null);
    const today = format(new Date(), "yyyy-MM-dd");
    const patch = {
      scheduled_date: today,
      scheduled_start_time: formatTimeForDb(9 * 60),
      scheduled_end_time: formatTimeForDb(11 * 60),
      estimated_labor_hours: 2,
    };
    applyLocalScheduleUpdate(woId, patch);
    const ok = await persistScheduleUpdate(woId, patch);
    if (!ok) {
      setCloseoutMessage("Could not reschedule — try again or use the schedule form.");
      await reloadAll();
      setCloseoutBusyId(null);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "rescheduled_from_past_queue",
      recordType: "work_order",
      recordId: woId,
      newValue: `${today} 9:00 AM–11:00 AM`,
    });
    setSelectedDay(startOfDay(new Date()));
    setMonthCursor(startOfMonth(new Date()));
    selectWorkOrder(woId);
    setCloseoutMessage("Rescheduled to today 9:00 AM–11:00 AM. Showing on day calendar.");
    await reloadAll();
    setCloseoutBusyId(null);
  }

  async function persistScheduleUpdate(
    woId: string,
    patch: {
      scheduled_date: string;
      scheduled_start_time: string;
      scheduled_end_time?: string;
      estimated_labor_hours: number;
      assigned_technician_id?: string | null;
    },
  ): Promise<boolean> {
    const current = workOrders.find((w) => w.id === woId);
    const nextStatus =
      isServiceManager &&
      patch.scheduled_date != null &&
      String(patch.scheduled_date).trim() !== ""
        ? statusAfterPlacingOnSchedule(current?.status)
        : null;
    const payload: Record<string, unknown> = {
      ...patch,
      updated_at: new Date().toISOString(),
      ...(nextStatus ? { status: nextStatus } : {}),
    };

    const { error } = await supabase.from("work_orders").update(payload).eq("id", woId);
    if (error && patch.scheduled_end_time && /scheduled_end_time|end_time/i.test(error.message)) {
      const { scheduled_end_time: _, ...fallback } = payload;
      const { error: err2 } = await supabase.from("work_orders").update(fallback).eq("id", woId);
      if (err2) return false;
      if (nextStatus) applyLocalScheduleUpdate(woId, { status: nextStatus });
      return true;
    }
    if (!error && nextStatus) {
      applyLocalScheduleUpdate(woId, { status: nextStatus });
    }
    return !error;
  }

  async function handleTimelineDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!isManager) return;
    const payload = parseDragPayload(e);
    if (!payload || !timelineDropRef.current) return;

    const rect = timelineDropRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const minutesFromStart = Math.round(((x / HOUR_WIDTH) * 60) / 5) * 5;
    const newStart = dayTimeline.rangeStartMin + Math.max(0, minutesFromStart);
    const newEnd = newStart + payload.durationMinutes;
    const hours = Math.round(((newEnd - newStart) / 60) * 100) / 100;

    const patch = {
      scheduled_date: dayKey,
      scheduled_start_time: formatTimeForDb(newStart),
      scheduled_end_time: formatTimeForDb(newEnd),
      estimated_labor_hours: hours,
    };

    applyLocalScheduleUpdate(payload.id, patch);
    setBusy(true);
    await persistScheduleUpdate(payload.id, patch);
    await reloadAll();
    setBusy(false);
  }

  async function handleMonthCellDrop(e: React.DragEvent, targetDay: Date) {
    e.preventDefault();
    e.stopPropagation();
    if (!isManager) return;
    const payload = parseDragPayload(e);
    if (!payload) return;

    const wo = timedOrders.find((w) => w.id === payload.id);
    if (!wo) return;

    const targetDate = format(targetDay, "yyyy-MM-dd");
    // Day-to-day moves keep the same clock times; only the date changes.
    const startMin = wo.startMinutes;
    const endMin = Math.max(wo.endMinutes, startMin + Math.max(payload.durationMinutes, 15));
    const hours = Math.round(((endMin - startMin) / 60) * 100) / 100;

    const patch = {
      scheduled_date: targetDate,
      scheduled_start_time: formatTimeForDb(startMin),
      scheduled_end_time: formatTimeForDb(endMin),
      estimated_labor_hours: hours,
    };

    applyLocalScheduleUpdate(payload.id, patch);
    setSelectedDay(startOfDay(targetDay));
    setMonthCursor(startOfMonth(targetDay));
    setBusy(true);
    await persistScheduleUpdate(payload.id, patch);
    await reloadAll();
    setBusy(false);
  }

  function handleDragStart(e: React.DragEvent, wo: TimedWo) {
    const durationMinutes = wo.endMinutes - wo.startMinutes;
    e.dataTransfer.setData("text/plain", JSON.stringify({ id: wo.id, durationMinutes }));
    e.dataTransfer.effectAllowed = "move";
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
    await reloadAll();
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
    const endMin = clockPartsToMinutes(
      scheduleForm.endHour,
      scheduleForm.endMinute,
      scheduleForm.endPeriod,
    );
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
    const endTimeDb = formatTimeForDb(endMin);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const nextStatus = isServiceManager
      ? statusAfterPlacingOnSchedule(workOrders.find((w) => w.id === selectedId)?.status)
      : null;

    const payload = {
      scheduled_date: scheduleForm.scheduled_date,
      scheduled_start_time: startTimeDb,
      scheduled_end_time: endTimeDb,
      estimated_labor_hours: hours,
      assigned_technician_id: scheduleForm.assigned_technician_id || null,
      updated_at: new Date().toISOString(),
      ...(nextStatus ? { status: nextStatus } : {}),
    };

    const { data: updated, error } = await supabase
      .from("work_orders")
      .update(payload)
      .eq("id", selectedId)
      .select("*, customers(id, name)")
      .single();

    if (error) {
      if (/scheduled_end_time|end_time/i.test(error.message)) {
        const { scheduled_end_time: _, ...fallback } = payload;
        const { error: err2 } = await supabase.from("work_orders").update(fallback).eq("id", selectedId);
        if (err2) {
          setScheduleError(err2.message || error.message);
          setBusy(false);
          return;
        }
        applyLocalScheduleUpdate(selectedId, {
          scheduled_date: payload.scheduled_date,
          scheduled_start_time: payload.scheduled_start_time,
          estimated_labor_hours: payload.estimated_labor_hours,
        });
      } else {
        const { error: err2 } = await supabase.from("work_orders").update(payload).eq("id", selectedId);
        if (err2) {
          setScheduleError(err2.message || error.message);
          setBusy(false);
          return;
        }
        applyLocalScheduleUpdate(selectedId, {
          scheduled_date: payload.scheduled_date,
          scheduled_start_time: payload.scheduled_start_time,
          scheduled_end_time: payload.scheduled_end_time,
          estimated_labor_hours: payload.estimated_labor_hours,
        });
      }
    } else if (updated) {
      const tech = payload.assigned_technician_id
        ? technicians.find((t) => t.id === payload.assigned_technician_id) ?? null
        : null;
      setWorkOrders((prev) =>
        prev.map((w) =>
          w.id === selectedId ? { ...(updated as ScheduleWo), technician: tech } : w,
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
    void reloadAll();
    setBusy(false);
  }

  function applyDurationPreset(minutes: number) {
    const startMin = clockPartsToMinutes(
      scheduleForm.startHour,
      scheduleForm.startMinute,
      scheduleForm.startPeriod,
    );
    if (startMin == null) return;
    const endMin = startMin + minutes;
    const endParts = minutesToClockParts(endMin);
    setScheduleSaved(false);
    setScheduleDirty(true);
    setScheduleForm((f) => ({
      ...f,
      endHour: endParts.hour12,
      endMinute: snapMinuteOption(endParts.minute),
      endPeriod: endParts.period,
    }));
  }

  async function placeToday(woId: string) {
    if (!isManager) return;
    setBusy(true);
    const today = format(new Date(), "yyyy-MM-dd");
    const patch = {
      scheduled_date: today,
      scheduled_start_time: formatTimeForDb(9 * 60),
      scheduled_end_time: formatTimeForDb(11 * 60),
      estimated_labor_hours: 2,
    };
    applyLocalScheduleUpdate(woId, patch);
    await persistScheduleUpdate(woId, patch);
    await reloadAll();
    setBusy(false);
  }

  async function applyBulkSchedule() {
    if (!isManager || bulkSelected.size === 0) return;
    setBusy(true);
    for (const id of bulkSelected) {
      const patch: {
        scheduled_date?: string;
        scheduled_start_time?: string;
        scheduled_end_time?: string;
        estimated_labor_hours?: number;
        assigned_technician_id?: string | null;
      } = { assigned_technician_id: bulkForm.assigned_technician_id || null };
      if (bulkForm.scheduled_date) {
        const wo = timedOrders.find((w) => w.id === id);
        patch.scheduled_date = bulkForm.scheduled_date;
        patch.scheduled_start_time = wo?.scheduled_start_time ?? formatTimeForDb(9 * 60);
        patch.scheduled_end_time = wo?.scheduled_end_time ?? formatTimeForDb(11 * 60);
        patch.estimated_labor_hours = wo?.estimated_labor_hours ?? 2;
      }
      await persistScheduleUpdate(id, patch as Parameters<typeof persistScheduleUpdate>[1]);
    }
    setBulkSelected(new Set());
    await reloadAll();
    setBusy(false);
  }

  async function cloneNextWeek(wo: TimedWo) {
    if (!isManager || !wo.scheduled_date) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const woNumber = `WO-${Date.now()}`;
    const insertPayload: Partial<WorkOrder> = {
      work_order_number: woNumber,
      customer_id: wo.customer_id,
      equipment_id: wo.equipment_id,
      contract_id: wo.contract_id,
      work_order_type: wo.work_order_type,
      priority: wo.priority,
      assigned_technician_id: wo.assigned_technician_id,
      scheduled_date: nextWeekDate(wo.scheduled_date),
      scheduled_start_time: wo.scheduled_start_time,
      scheduled_end_time: wo.scheduled_end_time ?? formatTimeForDb(wo.endMinutes),
      problem_description: wo.problem_description,
      requested_service: wo.requested_service,
      estimated_labor_hours: wo.estimated_labor_hours,
      status: isServiceManager
        ? "Scheduled"
        : wo.assigned_technician_id
          ? "Assigned"
          : "Requested",
    };
    const { data, error } = await supabase.from("work_orders").insert(insertPayload).select().single();
    if (!error && data) {
      await logActivity(supabase, {
        userId: user?.id ?? null,
        action: "cloned",
        recordType: "work_order",
        recordId: data.id,
        newValue: woNumber,
      });
    }
    await reloadAll();
    setBusy(false);
  }

  function exportSelectedDayCsv() {
    const csv = exportDayCsv(selectedDay, dayOrders);
    downloadTextFile(`schedule-${dayKey}.csv`, csv);
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
    await loadInventory();
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

      {/* Work order list + filters */}
      <section className="card bg-base-100 shadow print:hidden">
        <div className="card-body gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="card-title text-base">
              Total work orders
              <span className="badge badge-neutral badge-lg tabular-nums">{filteredOrders.length}</span>
              {categoryFilter !== "all" || techView !== "all" ? (
                <span className="text-sm font-normal opacity-60">of {filteredByTech.length}</span>
              ) : null}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`btn btn-sm ${bulkMode ? "btn-primary" : "btn-ghost"}`}
                onClick={() => {
                  setBulkMode((m) => !m);
                  if (bulkMode) setBulkSelected(new Set());
                }}
                aria-pressed={bulkMode}
              >
                Bulk select
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm gap-1"
                onClick={() => setListExpanded((open) => !open)}
                aria-expanded={listExpanded}
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
          </div>

          {/* Tech filter */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Technician filter">
            <span className="text-xs font-semibold opacity-60">Tech:</span>
            <button
              type="button"
              className={`btn btn-xs ${techView === "all" ? "btn-neutral" : "btn-ghost"}`}
              onClick={() => setTechView("all")}
              aria-pressed={techView === "all"}
            >
              All techs
            </button>
            {profile ? (
              <button
                type="button"
                className={`btn btn-xs ${techView === "mine" ? "btn-neutral" : "btn-ghost"}`}
                onClick={() => setTechView("mine")}
                aria-pressed={techView === "mine"}
              >
                My schedule
              </button>
            ) : null}
            {isManager ? (
              <select
                className="select select-bordered select-xs max-w-[12rem]"
                value={techView !== "all" && techView !== "mine" ? techView : ""}
                onChange={(e) => {
                  if (e.target.value) setTechView(e.target.value);
                }}
                aria-label="Filter by technician"
              >
                <option value="">Specific tech…</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {profileLabel(t)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {/* Density — technicians only; managers stay on comfortable */}
          {!isServiceManager ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Calendar density">
              <span className="text-xs font-semibold opacity-60">Density:</span>
              <button
                type="button"
                className={`btn btn-xs ${density === "compact" ? "btn-neutral" : "btn-ghost"}`}
                onClick={() => setDensity("compact")}
                aria-pressed={density === "compact"}
              >
                Compact
              </button>
              <button
                type="button"
                className={`btn btn-xs ${density === "comfortable" ? "btn-neutral" : "btn-ghost"}`}
                onClick={() => setDensity("comfortable")}
                aria-pressed={density === "comfortable"}
              >
                Comfortable
              </button>
            </div>
          ) : null}

          {/* Category filters */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by schedule status">
            <button
              type="button"
              className={`btn btn-sm ${categoryFilter === "all" ? "btn-neutral" : "btn-ghost"}`}
              onClick={() => setCategoryFilter("all")}
              aria-pressed={categoryFilter === "all"}
            >
              All ({filteredByTech.length})
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

          {/* Bulk assign bar */}
          {bulkMode && bulkSelected.size > 0 && isManager ? (
            <div className="flex flex-wrap items-end gap-2 rounded-box border border-primary/30 bg-primary/5 p-3">
              <span className="text-sm font-semibold">{bulkSelected.size} selected</span>
              <FormRow label="Date">
                <input
                  type="date"
                  className="input input-bordered input-sm"
                  value={bulkForm.scheduled_date}
                  onChange={(e) => setBulkForm({ ...bulkForm, scheduled_date: e.target.value })}
                />
              </FormRow>
              <FormRow label="Technician">
                <select
                  className="select select-bordered select-sm"
                  value={bulkForm.assigned_technician_id}
                  onChange={(e) => setBulkForm({ ...bulkForm, assigned_technician_id: e.target.value })}
                >
                  <option value="">No change</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {profileLabel(t)}
                    </option>
                  ))}
                </select>
              </FormRow>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void applyBulkSchedule()} disabled={busy}>
                Apply to selected
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBulkSelected(new Set())}>
                Clear
              </button>
            </div>
          ) : null}

          {listExpanded ? (
            <div className="space-y-3">
              <p className="text-xs opacity-60">
                Click a work order to highlight it on the calendars; click again to clear.
                {isManager ? " Drag a work order onto the month or day calendar to schedule it." : ""}
                {bulkMode ? " Bulk mode: toggle multiple selections." : ""} Showing{" "}
                {Math.min(visibleCount, filteredOrders.length)} of {filteredOrders.length}.
              </p>

              {filteredOrders.length === 0 ? (
                <p className="text-sm opacity-60">No work orders match this filter.</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-2">
                    {visibleOrders.map((wo) => {
                      const style = CATEGORY_STYLES[wo.category];
                      const active = bulkMode ? bulkSelected.has(wo.id) : selectedId === wo.id;
                      return (
                        <li key={wo.id}>
                          <button
                            type="button"
                            onClick={() => selectWorkOrder(wo.id)}
                            draggable={isManager}
                            onDragStart={(e) => handleDragStart(e, wo)}
                            className={`rounded-box border px-3 py-1.5 text-left text-sm transition ${style.chip} ${
                              active ? `ring-2 ring-offset-2 ${style.ring}` : "opacity-90 hover:opacity-100"
                            } ${wo.hasConflict ? "outline outline-2 outline-error outline-offset-1" : ""} ${
                              isManager ? "cursor-grab active:cursor-grabbing" : ""
                            }`}
                            aria-pressed={active}
                            title={isManager ? "Drag to month or day calendar to schedule" : undefined}
                          >
                            {bulkMode ? (
                              <span className="mr-1 inline-block h-3 w-3 rounded border border-current align-middle" aria-hidden />
                            ) : null}
                            <span className="font-semibold">{wo.work_order_number}</span>
                            <span className="mx-1 opacity-70">·</span>
                            <span className="opacity-90">{customerName(wo)}</span>
                            {wo.scheduled_date ? (
                              <span className="ml-1 opacity-70">
                                · {wo.scheduled_date.slice(0, 10)} {wo.startLabel}
                              </span>
                            ) : (
                              <span className="ml-1 opacity-70">· Unscheduled</span>
                            )}
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
            <p className="text-sm opacity-60">
              List collapsed
              {selectedId ? " · a work order is still highlighted on the calendars" : ""}.
            </p>
          )}
        </div>
      </section>

      {/* Queues: unscheduled + open past jobs */}
      {(isManager && unscheduledOrders.length > 0) || openPastJobs.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2 print:hidden">
          {isManager && unscheduledOrders.length > 0 ? (
            <section className="card bg-base-100 shadow">
              <div className="card-body p-4">
                <h2 className="card-title text-base">
                  Unscheduled
                  <span className="badge badge-warning">{unscheduledOrders.length}</span>
                </h2>
                <ul className="mt-2 space-y-2">
                  {unscheduledOrders.slice(0, 8).map((wo) => (
                    <li key={wo.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      {isServiceManager ? (
                        <Link
                          href={`/work-orders/${wo.id}`}
                          className="link link-hover link-primary font-medium"
                          onClick={() => selectWorkOrder(wo.id)}
                        >
                          {wo.work_order_number}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="link link-hover link-primary"
                          onClick={() => selectWorkOrder(wo.id)}
                        >
                          {wo.work_order_number}
                        </button>
                      )}
                      <span className="opacity-70">{customerName(wo)}</span>
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        onClick={() => void placeToday(wo.id)}
                        disabled={busy}
                      >
                        Place today 9 AM–11 AM
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {openPastJobs.length > 0 ? (
            <section className="card border border-error/30 bg-base-100 shadow">
              <div className="card-body p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="card-title text-base text-error">
                      Needs closeout (past schedule)
                      <span className="badge badge-error">{openPastJobs.length}</span>
                    </h2>
                    <p className="mt-1 max-w-xl text-xs opacity-70">
                      Scheduled before today, but status is still open in the system. These show as{" "}
                      <strong className="text-error">Overdue (red)</strong> on the calendars — not green —
                      until you complete or reschedule them here. Actions update lists, filters, and both
                      calendars immediately.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setPastQueueExpanded((o) => !o)}
                    aria-expanded={pastQueueExpanded}
                  >
                    {pastQueueExpanded ? "Collapse" : "Expand"}
                  </button>
                </div>

                {closeoutMessage ? (
                  <div className="alert alert-info mt-2 py-2 text-sm">{closeoutMessage}</div>
                ) : null}

                {pastQueueExpanded ? (
                  <>
                    <ul className="mt-3 space-y-3">
                      {visiblePastJobs.map((wo) => {
                        const days = daysPastScheduled(wo);
                        const rowBusy = closeoutBusyId === wo.id || busy;
                        return (
                          <li
                            key={wo.id}
                            className={`rounded-box border border-base-300 p-3 ${
                              selectedId === wo.id ? "ring-2 ring-error/50" : ""
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                {isServiceManager ? (
                                  <Link
                                    href={`/work-orders/${wo.id}`}
                                    className="link link-hover link-primary font-semibold"
                                    onClick={() => selectWorkOrder(wo.id)}
                                  >
                                    {wo.work_order_number}
                                  </Link>
                                ) : (
                                  <button
                                    type="button"
                                    className="link link-hover link-primary font-semibold"
                                    onClick={() => selectWorkOrder(wo.id)}
                                  >
                                    {wo.work_order_number}
                                  </button>
                                )}
                                <p className="text-sm opacity-70">
                                  Scheduled {wo.scheduled_date?.slice(0, 10)} · {days} day
                                  {days === 1 ? "" : "s"} past · {customerName(wo)}
                                </p>
                                <p className="text-xs opacity-60">
                                  Tech: {techName(wo)} · {wo.startLabel} – {wo.endLabel}
                                </p>
                              </div>
                              <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {isManager ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-success btn-xs"
                                    disabled={rowBusy}
                                    onClick={() => void markPastJobCompleted(wo.id)}
                                  >
                                    {closeoutBusyId === wo.id ? "Saving…" : "Mark completed"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-xs"
                                    disabled={rowBusy}
                                    onClick={() => void reschedulePastJobToday(wo.id)}
                                  >
                                    Reschedule to today
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    disabled={rowBusy}
                                    onClick={() => reschedulePastJob(wo.id)}
                                  >
                                    Custom reschedule
                                  </button>
                                </>
                              ) : null}
                              <Link href={`/work-orders/${wo.id}`} className="btn btn-ghost btn-xs">
                                Open work order
                              </Link>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {pastJobsVisibleCount < openPastJobs.length ? (
                        <button
                          type="button"
                          className="btn btn-outline btn-xs"
                          onClick={() => setPastJobsVisibleCount((n) => n + WO_PAGE_SIZE)}
                        >
                          Load more ({openPastJobs.length - pastJobsVisibleCount} remaining)
                        </button>
                      ) : null}
                      {pastJobsVisibleCount > WO_PAGE_SIZE ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => setPastJobsVisibleCount(WO_PAGE_SIZE)}
                        >
                          Show fewer
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-sm opacity-60">
                    Queue collapsed · {openPastJobs.length} open past job
                    {openPastJobs.length === 1 ? "" : "s"} still need closeout.
                  </p>
                )}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <ScheduleLegend sticky />

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Day calendar — first on mobile */}
        <section
          ref={dayCalendarRef}
          tabIndex={0}
          onKeyDown={handleDayKeyDown}
          className="card order-1 bg-base-100 shadow outline-none focus-visible:ring-2 focus-visible:ring-primary xl:order-2"
          aria-label="Day calendar. Use arrow keys to change day, Home for today."
        >
          <div className="card-body p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
              <h2 className="card-title text-base">Day calendar</h2>
              <div className="flex flex-wrap items-center gap-1">
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
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setSelectedDay(startOfDay(new Date()))}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={() => window.print()}
                  aria-label="Print day schedule"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={exportSelectedDayCsv}
                  aria-label="Export day schedule as CSV"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </button>
              </div>
            </div>

            <div className="hidden print:block">
              <h2 className="text-lg font-bold">{format(selectedDay, "EEEE, MMMM d, yyyy")}</h2>
              <p className="text-sm">{dayOrders.length} work order(s)</p>
            </div>

            <div className="relative overflow-x-auto rounded-box border border-base-300">
              <div className="relative" style={{ width: dayTimeline.timelineWidth + 8, minWidth: "100%" }}>
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
                  ref={timelineDropRef}
                  className="relative"
                  style={{
                    height: dayTimelineBodyHeight,
                    width: dayTimeline.timelineWidth,
                    minHeight: DAY_VIEW_HEIGHT_MIN,
                  }}
                  onDragOver={(e) => {
                    if (isManager) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={(e) => void handleTimelineDrop(e)}
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
                      ((wo.startMinutes - dayTimeline.rangeStartMin) / 60) * HOUR_WIDTH + lane * 12;
                    const width = Math.max(
                      ((wo.endMinutes - wo.startMinutes) / 60) * HOUR_WIDTH - 6,
                      HOUR_WIDTH * 0.55,
                    );
                    const style = CATEGORY_STYLES[wo.category];
                    const active = selectedId === wo.id;
                    const bubbleH = Math.max(40, dayBubbleRowHeight - 10);
                    return (
                      <div
                        key={wo.id}
                        className={`absolute z-10 ${active ? "z-20" : ""}`}
                        style={{
                          left,
                          width,
                          top: 10 + lane * dayBubbleRowHeight,
                          height: bubbleH,
                        }}
                        draggable={isManager}
                        onDragStart={(e) => handleDragStart(e, wo)}
                      >
                        <button
                          type="button"
                          onClick={() => selectWorkOrder(wo.id)}
                          className={`relative h-full w-full overflow-hidden rounded-md border px-2.5 py-1.5 text-left shadow-sm transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${style.block} ${
                            active ? `ring-2 ring-offset-2 ${style.ring}` : ""
                          } ${wo.hasConflict ? "ring-2 ring-error ring-offset-1" : ""} ${
                            isManager ? "cursor-grab active:cursor-grabbing" : ""
                          }`}
                          aria-label={`Work order ${wo.work_order_number} from ${wo.startLabel} to ${wo.endLabel}`}
                          aria-pressed={active}
                        >
                          {wo.hasConflict ? (
                            <AlertTriangle
                              className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-error-content"
                              aria-label="Schedule conflict"
                            />
                          ) : null}
                          <div className="truncate text-sm font-semibold leading-snug">{wo.work_order_number}</div>
                          <div className="truncate text-xs leading-snug opacity-95">{techName(wo)}</div>
                          <div className="truncate text-xs leading-snug opacity-95">{customerName(wo)}</div>
                          <div className="truncate text-xs font-medium leading-snug opacity-90">
                            {wo.startLabel} – {wo.endLabel}
                          </div>
                        </button>
                      </div>
                    );
                  })}

                  {dayOrders.length === 0 ? (
                    <div className="flex h-full min-h-[8rem] items-center justify-center text-sm opacity-50">
                      {isManager
                        ? "No work orders this day — drag one here from the list above"
                        : "No work orders this day"}
                      {categoryFilter !== "all" ? " for this filter" : ""}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Drag edge: pull down to expand / up to shrink the day calendar */}
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize day calendar height. Drag up or down to expand or shrink."
                aria-valuemin={DAY_VIEW_HEIGHT_MIN}
                aria-valuemax={DAY_VIEW_HEIGHT_MAX}
                aria-valuenow={Math.round(dayViewHeight)}
                tabIndex={0}
                onPointerDown={beginDayCalendarResize}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setDayViewHeight((h) => Math.min(DAY_VIEW_HEIGHT_MAX, h + 24));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setDayViewHeight((h) => Math.max(DAY_VIEW_HEIGHT_MIN, h - 24));
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    setDayViewHeight(DAY_VIEW_HEIGHT_MIN);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    setDayViewHeight(DAY_VIEW_HEIGHT_MAX);
                  }
                }}
                className="group flex h-4 cursor-ns-resize select-none items-center justify-center border-t border-base-300 bg-base-200/50 print:hidden hover:bg-primary/15 active:bg-primary/25"
                title="Drag up or down to resize the day calendar"
              >
                <span className="h-1 w-10 rounded-full bg-base-content/25 group-hover:bg-primary/60" aria-hidden />
              </div>
            </div>
            <p className="mt-1 text-center text-[10px] opacity-50 print:hidden">
              Drag the bar below the day calendar up or down to resize · {Math.round(dayViewHeight)}px
            </p>
          </div>
        </section>

        {/* Month calendar — second on mobile */}
        <section className="card order-2 bg-base-100 shadow xl:order-1">
          <div className="card-body p-4">
            <div className="mb-3 flex items-center justify-between gap-2 print:hidden">
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
                const emptyDay = list.length === 0;
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDay(day)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDay(day);
                      }
                    }}
                    onDragOver={(e) => {
                      if (isManager) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => void handleMonthCellDrop(e, day)}
                    className={`relative min-h-[6.5rem] cursor-pointer overflow-hidden rounded-box border p-1 text-left transition hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                      inMonth ? "border-base-300" : "border-transparent opacity-50"
                    } ${isSelectedDay ? "ring-2 ring-primary ring-offset-1" : ""} ${
                      emptyDay
                        ? ""
                        : inMonth
                          ? "bg-base-100"
                          : "bg-base-200/40"
                    } ${!emptyDay && isToday(day) ? "bg-base-200/80" : ""}`}
                    style={
                      emptyDay
                        ? {
                            // White / grey diagonal hatch for days with nothing scheduled
                            backgroundColor: inMonth ? "#ffffff" : "rgba(243,244,246,0.7)",
                            backgroundImage:
                              "repeating-linear-gradient(-45deg, #ffffff 0px, #ffffff 5px, #e5e7eb 5px, #e5e7eb 10px)",
                          }
                        : undefined
                    }
                    aria-label={`${format(day, "MMMM d, yyyy")}: ${list.length} work orders. ${
                      isManager ? "Drop a work order here to schedule." : ""
                    } Click to open day details.`}
                  >
                    <div className="relative z-[1] mb-1 flex items-center justify-between px-0.5">
                      <span className={`text-xs font-semibold ${isToday(day) ? "text-primary" : ""}`}>
                        {format(day, "d")}
                      </span>
                      {list.length > 0 ? (
                        <span className="badge badge-ghost badge-xs tabular-nums">{list.length}</span>
                      ) : null}
                    </div>
                    <div className="relative z-[1] flex flex-col gap-0.5">
                      {list.slice(0, 3).map((wo) => {
                        const style = CATEGORY_STYLES[wo.category];
                        const active = selectedId === wo.id;
                        return (
                          <button
                            key={wo.id}
                            type="button"
                            draggable={isManager}
                            onDragStart={(e) => {
                              e.stopPropagation();
                              handleDragStart(e, wo);
                            }}
                            className={`truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight ${style.chip} ${
                              active ? `ring-2 ring-offset-1 ${style.ring}` : ""
                            } ${wo.hasConflict ? "outline outline-1 outline-error" : ""} ${
                              isManager ? "cursor-grab active:cursor-grabbing" : ""
                            }`}
                            title={`${wo.work_order_number} · ${wo.startLabel} · ${techName(wo)}${
                              isManager ? " — drag to another day to reschedule" : ""
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectWorkOrder(wo.id);
                            }}
                          >
                            <span className="font-semibold">{wo.work_order_number}</span>
                            {wo.assigned_technician_id || wo.technician ? (
                              <span className="opacity-80"> · {techName(wo).split(" ")[0]}</span>
                            ) : null}
                          </button>
                        );
                      })}
                      {list.length > 3 ? (
                        <span className="px-1 text-[10px] opacity-60">+{list.length - 3} more</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* Day detail modal */}
      {dayPanelOpen ? (
        <dialog className="modal modal-open print:hidden">
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
                        {isServiceManager ? (
                          <Link
                            href={`/work-orders/${wo.id}`}
                            className="link link-hover link-primary font-semibold"
                            onClick={() => selectWorkOrder(wo.id)}
                          >
                            {wo.work_order_number}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className="link link-hover link-primary font-semibold"
                            onClick={() => selectWorkOrder(wo.id)}
                          >
                            {wo.work_order_number}
                          </button>
                        )}
                        <div className="flex items-center gap-1">
                          {wo.hasConflict ? (
                            <span className="badge badge-error badge-xs gap-0.5">
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                              Conflict
                            </span>
                          ) : null}
                          <span className={`rounded-full px-2 py-0.5 text-xs ${style.chip}`}>{style.label}</span>
                        </div>
                      </div>
                      <dl className="mt-2 grid gap-1 text-sm">
                        <div>
                          <dt className="inline opacity-60">Time: </dt>
                          <dd className="inline">
                            {wo.startLabel} – {wo.endLabel}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline opacity-60">Technician: </dt>
                          <dd className="inline">{techName(wo)}</dd>
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
                        {isManager && wo.scheduled_date ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs gap-1"
                            onClick={() => void cloneNextWeek(wo)}
                            disabled={busy}
                          >
                            <Copy className="h-3 w-3" />
                            Clone next week
                          </button>
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
      <section className="space-y-4 print:hidden">
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
                    <h2 className="text-lg font-bold">
                      {isServiceManager ? (
                        <Link
                          href={`/work-orders/${selected.id}`}
                          className="link link-hover link-primary"
                        >
                          {selected.work_order_number}
                        </Link>
                      ) : (
                        selected.work_order_number
                      )}
                    </h2>
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
                    {selected.hasConflict ? (
                      <span className="badge badge-error gap-1">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        Conflict
                      </span>
                    ) : null}
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
                  {isManager && selected.scheduled_date ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm gap-1"
                      onClick={() => void cloneNextWeek(selected)}
                      disabled={busy}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Clone next week
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {isManager ? (
              <div id="schedule-assign-panel" className="card border border-primary/20 bg-base-100 shadow">
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
                            {profileLabel(t)}
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
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <span className="text-xs font-semibold opacity-60 self-center">Duration presets:</span>
                      {DURATION_PRESETS_MIN.map((min) => (
                        <button
                          key={min}
                          type="button"
                          className="btn btn-outline btn-xs"
                          onClick={() => applyDurationPreset(min)}
                        >
                          {min < 60 ? `${min}m` : `${min / 60}h`}
                        </button>
                      ))}
                    </div>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">Parts Used</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs opacity-60">{inventory.length} parts available</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => void loadInventory()}
                    >
                      Refresh list
                    </button>
                    <Link href="/parts" className="btn btn-ghost btn-xs">
                      Open Parts tab
                    </Link>
                  </div>
                </div>
                {inventoryError ? (
                  <div className="alert alert-error mt-2 text-sm">{inventoryError}</div>
                ) : null}
                <form onSubmit={addPart} className="mt-2 grid gap-3 sm:grid-cols-2">
                  <FormRow label="Part">
                    <select
                      className="select select-bordered w-full"
                      value={partForm.part_id}
                      onChange={(e) => setPartForm({ ...partForm, part_id: e.target.value })}
                      required
                      disabled={inventory.length === 0}
                    >
                      <option value="">
                        {inventory.length === 0 ? "No parts loaded — refresh or open Parts tab" : "Select…"}
                      </option>
                      {inventory.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.part_number} — {p.name} (qty {p.quantity_on_hand}
                          {p.is_active === false ? ", inactive" : ""})
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
                  <div className="flex items-end gap-2">
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={busy || inventory.length === 0}
                    >
                      Add Part
                    </button>
                  </div>
                </form>
                {inventory.length === 0 && !inventoryError ? (
                  <p className="mt-2 text-sm opacity-70">
                    No parts found. Add stock on the{" "}
                    <Link href="/parts" className="link link-primary">
                      Parts
                    </Link>{" "}
                    tab, then click Refresh list.
                  </p>
                ) : null}
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
